/**
 * QuickBooks Transaction Matcher
 * Matches receipts to existing credit card transactions
 */

const qboClient = require('./client');
const logger = require('../../utils/logger');
const dayjs = require('dayjs');

class TransactionMatcher {
  constructor() {
    this.vendorCache = new Map();
    this.customerCache = new Map();
    this.accountCache = new Map();
  }

  /**
   * Find matching credit card transaction for a receipt
   */
  async findMatchingTransaction(receipt) {
    try {
      const { transaction, vendor } = receipt;

      // Search for purchases within date range
      const startDate = dayjs(transaction.date).subtract(3, 'day').format('YYYY-MM-DD');
      const endDate = dayjs(transaction.date).add(3, 'day').format('YYYY-MM-DD');

      // Query for purchases
      const query = `SELECT * FROM Purchase WHERE TxnDate >= '${startDate}' AND TxnDate <= '${endDate}'`;

      const response = await qboClient.makeApiCall('GET', `/query?query=${encodeURIComponent(query)}`);

      const purchases = response.QueryResponse?.Purchase || [];

      // Find best match
      const match = this.findBestMatch(purchases, receipt);

      if (match) {
        logger.qbo('found matching transaction', {
          receiptId: receipt.id,
          transactionId: match.Id,
          amount: match.TotalAmt
        });
      }

      return match;
    } catch (error) {
      logger.error('Transaction matching failed', { error: error.message });
      return null;
    }
  }

  /**
   * Find the best matching transaction from a list
   */
  findBestMatch(transactions, receipt) {
    const { transaction, payment } = receipt;
    let bestMatch = null;
    let bestScore = 0;

    for (const txn of transactions) {
      let score = 0;

      // Amount match (most important)
      const amountDiff = Math.abs(txn.TotalAmt - transaction.total);
      if (amountDiff === 0) {
        score += 100;
      } else if (amountDiff < 0.10) {
        score += 80;
      } else if (amountDiff < 1.00) {
        score += 50;
      } else if (amountDiff < 5.00) {
        score += 20;
      }

      // Date match
      if (txn.TxnDate === transaction.date) {
        score += 30;
      } else if (dayjs(txn.TxnDate).diff(dayjs(transaction.date), 'day') <= 1) {
        score += 20;
      }

      // Card last 4 match (if available)
      if (payment.cardLast4 && txn.Credit?.CCDetail?.CCNumber) {
        const txnLast4 = txn.Credit.CCDetail.CCNumber.slice(-4);
        if (txnLast4 === payment.cardLast4) {
          score += 50;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = txn;
      }
    }

    // Only return if score is good enough
    return bestScore >= 80 ? bestMatch : null;
  }

  /**
   * Find or create vendor in QuickBooks
   */
  async findOrCreateVendor(vendorName) {
    // Check cache first
    if (this.vendorCache.has(vendorName)) {
      return this.vendorCache.get(vendorName);
    }

    try {
      // Search for existing vendor
      const query = `SELECT * FROM Vendor WHERE DisplayName LIKE '%${vendorName}%'`;
      const response = await qboClient.makeApiCall('GET', `/query?query=${encodeURIComponent(query)}`);

      const vendors = response.QueryResponse?.Vendor || [];

      if (vendors.length > 0) {
        const vendor = vendors[0];
        this.vendorCache.set(vendorName, vendor);
        return vendor;
      }

      // Create new vendor
      const newVendor = await qboClient.makeApiCall('POST', '/vendor', {
        DisplayName: vendorName
      });

      this.vendorCache.set(vendorName, newVendor.Vendor);
      logger.qbo('created vendor', { name: vendorName, id: newVendor.Vendor.Id });

      return newVendor.Vendor;
    } catch (error) {
      logger.error('Vendor lookup/create failed', { vendorName, error: error.message });
      return null;
    }
  }

  /**
   * Find or create customer/project in QuickBooks
   * If job name doesn't exist, automatically creates a new Project
   */
  async findOrCreateCustomer(jobName) {
    if (!jobName) return null;

    // Check cache first
    if (this.customerCache.has(jobName)) {
      return this.customerCache.get(jobName);
    }

    try {
      // Search for customer/project
      const query = `SELECT * FROM Customer WHERE DisplayName LIKE '%${jobName}%'`;
      const response = await qboClient.makeApiCall('GET', `/query?query=${encodeURIComponent(query)}`);

      const customers = response.QueryResponse?.Customer || [];

      if (customers.length > 0) {
        const customer = customers[0];
        this.customerCache.set(jobName, customer);
        return customer;
      }

      // Customer/Project not found - create a new one
      logger.info(`Job "${jobName}" not found in QuickBooks, creating new project...`);

      const newCustomer = await qboClient.makeApiCall('POST', '/customer', {
        DisplayName: jobName,
        CompanyName: jobName,
        Job: true,  // Mark as a job/project
        BillWithParent: false,
        Notes: `Auto-created by RLT Receipt Matcher on ${new Date().toISOString()}`
      });

      this.customerCache.set(jobName, newCustomer.Customer);
      logger.qbo('created new project/customer', { 
        name: jobName, 
        id: newCustomer.Customer.Id 
      });

      return newCustomer.Customer;
    } catch (error) {
      logger.error('Customer lookup/create failed', { jobName, error: error.message });
      return null;
    }
  }

  /**
   * Find customer/project in QuickBooks (without creating)
   * @deprecated Use findOrCreateCustomer instead
   */
  async findCustomer(jobName) {
    return this.findOrCreateCustomer(jobName);
  }

  /**
   * Find expense account by name or category
   */
  async findAccount(categoryName) {
    const searchName = categoryName || 'Job Supplies';

    // Check cache first
    if (this.accountCache.has(searchName)) {
      return this.accountCache.get(searchName);
    }

    try {
      // Search for account
      const query = `SELECT * FROM Account WHERE AccountType = 'Expense' AND Name LIKE '%${searchName}%'`;
      const response = await qboClient.makeApiCall('GET', `/query?query=${encodeURIComponent(query)}`);

      const accounts = response.QueryResponse?.Account || [];

      if (accounts.length > 0) {
        const account = accounts[0];
        this.accountCache.set(searchName, account);
        return account;
      }

      // Try broader search
      const broadQuery = "SELECT * FROM Account WHERE AccountType = 'Expense'";
      const broadResponse = await qboClient.makeApiCall('GET', `/query?query=${encodeURIComponent(broadQuery)}`);

      const allAccounts = broadResponse.QueryResponse?.Account || [];

      // Find best match - look for job supplies, materials, supplies, or cost of goods
      for (const account of allAccounts) {
        const name = account.Name.toLowerCase();
        if (name.includes('job supplies') ||
            name.includes('job') ||
            name.includes('material') ||
            name.includes('supplies') ||
            name.includes('cost of goods')) {
          this.accountCache.set(searchName, account);
          return account;
        }
      }

      // Return first expense account as fallback
      if (allAccounts.length > 0) {
        this.accountCache.set(searchName, allAccounts[0]);
        return allAccounts[0];
      }

      return null;
    } catch (error) {
      logger.error('Account lookup failed', { categoryName, error: error.message });
      return null;
    }
  }

  /**
   * Find credit card account
   */
  async findCreditCardAccount() {
    try {
      const query = "SELECT * FROM Account WHERE AccountType = 'Credit Card'";
      const response = await qboClient.makeApiCall('GET', `/query?query=${encodeURIComponent(query)}`);

      const accounts = response.QueryResponse?.Account || [];

      return accounts.length > 0 ? accounts[0] : null;
    } catch (error) {
      logger.error('Credit card account lookup failed', { error: error.message });
      return null;
    }
  }

  /**
   * Clear caches (useful for long-running processes)
   */
  clearCaches() {
    this.vendorCache.clear();
    this.customerCache.clear();
    this.accountCache.clear();
  }
}

// Singleton instance
const transactionMatcher = new TransactionMatcher();

module.exports = transactionMatcher;


