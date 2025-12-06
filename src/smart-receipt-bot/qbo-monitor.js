/**
 * QBO Monitor
 * 
 * Monitors QuickBooks Online for:
 * - Uncategorized transactions in "For Review"
 * - New bank feed transactions
 * - Transactions without customer/job assigned
 */

const qboClient = require('../services/quickbooks/client');
const logger = require('../utils/logger');

// Track which transactions we've already processed
const processedTransactions = new Set();
let lastCheckTime = null;

/**
 * Get uncategorized transactions from QBO
 * These are transactions that:
 * - Don't have a CustomerRef (no job assigned)
 * - Are recent (within last 30 days)
 */
async function getUncategorizedTransactions() {
  try {
    // Ensure authenticated
    const isAuth = await qboClient.authenticate();
    if (!isAuth) {
      throw new Error('QuickBooks not authenticated');
    }

    // Query for purchases without CustomerRef in the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateStr = thirtyDaysAgo.toISOString().split('T')[0];

    // Get all recent purchases
    const response = await qboClient.makeApiCall('GET',
      `/query?query=${encodeURIComponent(
        `SELECT * FROM Purchase WHERE TxnDate >= '${dateStr}' MAXRESULTS 100`
      )}`
    );

    const allPurchases = response.QueryResponse?.Purchase || [];

    // Filter to only uncategorized (no CustomerRef on any line)
    const uncategorized = allPurchases.filter(purchase => {
      // Skip if already processed
      if (processedTransactions.has(purchase.Id)) {
        return false;
      }

      // Check if any line has a CustomerRef
      const hasCustomer = purchase.Line?.some(line => 
        line.AccountBasedExpenseLineDetail?.CustomerRef
      );

      return !hasCustomer;
    });

    logger.info('Found uncategorized transactions', { 
      total: allPurchases.length,
      uncategorized: uncategorized.length 
    });

    // Transform to simpler format
    return uncategorized.map(p => ({
      id: p.Id,
      syncToken: p.SyncToken,
      vendor: p.EntityRef?.name || 'Unknown Vendor',
      vendorId: p.EntityRef?.value,
      amount: p.TotalAmt,
      date: p.TxnDate,
      memo: p.PrivateNote || '',
      paymentType: p.PaymentType,
      accountRef: p.AccountRef,
      lines: p.Line,
      raw: p
    }));

  } catch (error) {
    logger.error('Failed to get uncategorized transactions', { error: error.message });
    throw error;
  }
}

/**
 * Mark a transaction as processed (so we don't ask about it again)
 */
function markProcessed(transactionId) {
  processedTransactions.add(transactionId);
}

/**
 * Clear processed cache (for testing or reset)
 */
function clearProcessedCache() {
  processedTransactions.clear();
}

/**
 * Get daily summary statistics
 */
async function getDailySummary() {
  try {
    const isAuth = await qboClient.authenticate();
    if (!isAuth) {
      throw new Error('QuickBooks not authenticated');
    }

    const today = new Date().toISOString().split('T')[0];

    // Get today's purchases
    const response = await qboClient.makeApiCall('GET',
      `/query?query=${encodeURIComponent(
        `SELECT * FROM Purchase WHERE TxnDate = '${today}'`
      )}`
    );

    const purchases = response.QueryResponse?.Purchase || [];

    let categorized = 0;
    let categorizedAmount = 0;
    let pending = 0;
    let pendingAmount = 0;
    let billableAmount = 0;
    let stockAmount = 0;

    for (const p of purchases) {
      const hasCustomer = p.Line?.some(line => 
        line.AccountBasedExpenseLineDetail?.CustomerRef
      );

      if (hasCustomer) {
        categorized++;
        categorizedAmount += p.TotalAmt;
        
        // Check if billable
        const isBillable = p.Line?.some(line =>
          line.AccountBasedExpenseLineDetail?.BillableStatus === 'Billable'
        );
        
        if (isBillable) {
          billableAmount += p.TotalAmt;
        } else {
          stockAmount += p.TotalAmt;
        }
      } else {
        pending++;
        pendingAmount += p.TotalAmt;
      }
    }

    return {
      categorized,
      categorizedAmount,
      pending,
      pendingAmount,
      billableAmount,
      stockAmount,
      total: purchases.length,
      totalAmount: purchases.reduce((sum, p) => sum + p.TotalAmt, 0)
    };

  } catch (error) {
    logger.error('Failed to get daily summary', { error: error.message });
    return {
      categorized: 0,
      categorizedAmount: 0,
      pending: 0,
      pendingAmount: 0,
      billableAmount: 0,
      stockAmount: 0,
      total: 0,
      totalAmount: 0
    };
  }
}

/**
 * Get transaction by ID
 */
async function getTransaction(transactionId) {
  try {
    const response = await qboClient.makeApiCall('GET',
      `/purchase/${transactionId}`
    );
    return response.Purchase;
  } catch (error) {
    logger.error('Failed to get transaction', { transactionId, error: error.message });
    return null;
  }
}

/**
 * Check if transaction exists for a given vendor/amount/date
 */
async function findTransaction(vendor, amount, date) {
  try {
    const isAuth = await qboClient.authenticate();
    if (!isAuth) return null;

    // Search within ±2 days of the date
    const startDate = new Date(date);
    startDate.setDate(startDate.getDate() - 2);
    const endDate = new Date(date);
    endDate.setDate(endDate.getDate() + 2);

    const response = await qboClient.makeApiCall('GET',
      `/query?query=${encodeURIComponent(
        `SELECT * FROM Purchase WHERE TxnDate >= '${startDate.toISOString().split('T')[0]}' AND TxnDate <= '${endDate.toISOString().split('T')[0]}'`
      )}`
    );

    const purchases = response.QueryResponse?.Purchase || [];

    // Find matching by amount (within $0.01) and vendor name
    const match = purchases.find(p => {
      const amountMatch = Math.abs(p.TotalAmt - amount) < 0.02;
      const vendorMatch = p.EntityRef?.name?.toLowerCase().includes(vendor.toLowerCase()) ||
                          vendor.toLowerCase().includes(p.EntityRef?.name?.toLowerCase() || '');
      return amountMatch && vendorMatch;
    });

    return match ? {
      id: match.Id,
      syncToken: match.SyncToken,
      vendor: match.EntityRef?.name,
      amount: match.TotalAmt,
      date: match.TxnDate,
      raw: match
    } : null;

  } catch (error) {
    logger.error('Failed to find transaction', { error: error.message });
    return null;
  }
}

module.exports = {
  getUncategorizedTransactions,
  markProcessed,
  clearProcessedCache,
  getDailySummary,
  getTransaction,
  findTransaction
};

