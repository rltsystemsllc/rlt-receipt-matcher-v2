/**
 * Smart Receipt Bot
 * 
 * A simple, robust receipt categorization system that:
 * 1. Monitors QBO "For Review" transactions
 * 2. Matches receipts from Gmail to bank transactions
 * 3. Uses OpenAI Vision to extract job names from receipts
 * 4. Sends group SMS to Bobby + Jessica for confirmation/input
 * 5. Updates QBO with job + billable + taxable + receipt attachment
 */

const qboMonitor = require('./qbo-monitor');
const receiptMatcher = require('./receipt-matcher');
const openaiParser = require('./openai-parser');
const groupSMS = require('./group-sms');
const qboUpdater = require('./qbo-updater');
const logger = require('../utils/logger');

class SmartReceiptBot {
  constructor() {
    this.pendingTransactions = new Map(); // Transactions waiting for job assignment
    this.pendingReceipts = new Map();     // Receipts waiting for bank transaction match
    this.isRunning = false;
  }

  /**
   * Start the bot
   */
  async start() {
    if (this.isRunning) {
      logger.info('Smart Receipt Bot already running');
      return;
    }

    this.isRunning = true;
    logger.info('🤖 Smart Receipt Bot starting...');

    // Set up SMS reply handler
    groupSMS.onReply(this.handleSMSReply.bind(this));

    // Initial check
    await this.checkForNewTransactions();

    logger.info('✅ Smart Receipt Bot started');
  }

  /**
   * Main loop - check for new transactions in QBO "For Review"
   */
  async checkForNewTransactions() {
    try {
      logger.info('Checking QBO for uncategorized transactions...');
      
      // Get uncategorized transactions from QBO
      const transactions = await qboMonitor.getUncategorizedTransactions();
      logger.info(`Found ${transactions.length} uncategorized transactions`);

      for (const txn of transactions) {
        await this.processTransaction(txn);
      }

    } catch (error) {
      logger.error('Error checking transactions', { error: error.message });
      await groupSMS.sendAlert(`⚠️ Bot error: ${error.message}`);
    }
  }

  /**
   * Process a single transaction
   */
  async processTransaction(txn) {
    try {
      const txnKey = `${txn.vendor}-${txn.amount}-${txn.date}`;
      
      // Skip if already pending
      if (this.pendingTransactions.has(txn.id)) {
        return;
      }

      logger.info('Processing transaction', { 
        vendor: txn.vendor, 
        amount: txn.amount, 
        date: txn.date 
      });

      // Try to find matching receipt
      const receipt = await receiptMatcher.findMatchingReceipt(txn);

      if (receipt) {
        // Parse receipt with OpenAI Vision
        const parsed = await openaiParser.parseReceipt(receipt.imageData);
        
        if (parsed.jobName) {
          // Job found on receipt - auto-categorize!
          await this.autoCategorize(txn, receipt, parsed);
        } else {
          // No job on receipt - ask Bobby/Jessica
          await this.askForJob(txn, receipt, parsed);
        }
      } else {
        // No receipt found - ask for job (text only, no image)
        await this.askForJobNoReceipt(txn);
      }

    } catch (error) {
      logger.error('Error processing transaction', { 
        txnId: txn.id, 
        error: error.message 
      });
    }
  }

  /**
   * Auto-categorize when job is found on receipt
   */
  async autoCategorize(txn, receipt, parsed) {
    try {
      // Match job name to QBO customer
      const customer = await qboUpdater.findOrCreateCustomer(parsed.jobName);

      // Update transaction in QBO
      await qboUpdater.updateTransaction(txn.id, {
        customerId: customer.Id,
        customerName: customer.DisplayName,
        billable: true,
        taxable: true
      });

      // Attach receipt to transaction
      if (receipt.pdfData) {
        await qboUpdater.attachReceipt(txn.id, receipt.pdfData, receipt.filename);
      }

      // Send confirmation to group
      await groupSMS.send(
        `✅ ${txn.vendor} $${txn.amount} → ${customer.DisplayName} (billable + taxable)`
      );

      logger.info('Auto-categorized transaction', { 
        txnId: txn.id, 
        job: customer.DisplayName 
      });

    } catch (error) {
      logger.error('Auto-categorize failed', { error: error.message });
      // Fall back to asking
      await this.askForJob(txn, receipt, parsed);
    }
  }

  /**
   * Ask Bobby/Jessica for job assignment (with receipt image)
   */
  async askForJob(txn, receipt, parsed) {
    // Store pending transaction
    this.pendingTransactions.set(txn.id, { txn, receipt, parsed });

    // Send MMS with receipt image
    await groupSMS.sendWithImage(
      `🧾 ${txn.vendor} $${txn.amount} - ${txn.date}\n` +
      `No job found on receipt.\n\n` +
      `Reply with job name or SHOP for stock`,
      receipt.imageData
    );

    logger.info('Asked for job assignment', { txnId: txn.id });
  }

  /**
   * Ask for job when no receipt is available
   */
  async askForJobNoReceipt(txn) {
    // Store pending transaction
    this.pendingTransactions.set(txn.id, { txn, receipt: null, parsed: null });

    // Send text-only message
    await groupSMS.send(
      `🧾 ${txn.vendor} $${txn.amount} - ${txn.date}\n` +
      `No receipt found.\n\n` +
      `Reply with job name or SHOP for stock`
    );

    logger.info('Asked for job (no receipt)', { txnId: txn.id });
  }

  /**
   * Handle SMS reply from Bobby or Jessica
   */
  async handleSMSReply(message) {
    try {
      const text = message.text.trim();
      const from = message.from;

      logger.info('Received SMS reply', { from, text });

      // Find the most recent pending transaction
      const pending = this.getOldestPendingTransaction();
      
      if (!pending) {
        await groupSMS.send('No pending transactions to categorize.');
        return;
      }

      const { txn, receipt } = pending;
      
      // Handle special commands
      if (text.toUpperCase() === 'SHOP' || text.toUpperCase() === 'STOCK') {
        await this.categorizeAsStock(txn, receipt);
      } else if (text.toUpperCase() === 'SKIP') {
        await this.skipTransaction(txn);
      } else if (text === '?') {
        await this.sendRecentJobs();
      } else {
        // Treat as job name
        await this.categorizeWithJob(txn, receipt, text);
      }

      // Remove from pending
      this.pendingTransactions.delete(txn.id);

    } catch (error) {
      logger.error('Error handling SMS reply', { error: error.message });
      await groupSMS.send(`❌ Error: ${error.message}`);
    }
  }

  /**
   * Categorize transaction with job name
   */
  async categorizeWithJob(txn, receipt, jobName) {
    try {
      // Match job name to QBO customer
      const customer = await qboUpdater.findOrCreateCustomer(jobName);

      // Update transaction in QBO
      await qboUpdater.updateTransaction(txn.id, {
        customerId: customer.Id,
        customerName: customer.DisplayName,
        billable: true,
        taxable: true
      });

      // Attach receipt if available
      if (receipt?.pdfData) {
        await qboUpdater.attachReceipt(txn.id, receipt.pdfData, receipt.filename);
      }

      // Confirm
      await groupSMS.send(
        `✅ ${txn.vendor} $${txn.amount} → ${customer.DisplayName} (billable + taxable)`
      );

    } catch (error) {
      logger.error('Categorize with job failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Categorize as stock/shop (not billable)
   */
  async categorizeAsStock(txn, receipt) {
    try {
      // Update transaction in QBO (no customer, not billable)
      await qboUpdater.updateTransaction(txn.id, {
        customerId: null,
        billable: false,
        taxable: true,
        memo: 'Stock/Shop supplies'
      });

      // Attach receipt if available
      if (receipt?.pdfData) {
        await qboUpdater.attachReceipt(txn.id, receipt.pdfData, receipt.filename);
      }

      // Confirm
      await groupSMS.send(
        `✅ ${txn.vendor} $${txn.amount} → Stock (not billable)`
      );

    } catch (error) {
      logger.error('Categorize as stock failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Skip transaction (leave for later)
   */
  async skipTransaction(txn) {
    await groupSMS.send(
      `⏭️ Skipped ${txn.vendor} $${txn.amount} - will ask again later`
    );
  }

  /**
   * Send list of recent jobs for reference
   */
  async sendRecentJobs() {
    const jobs = await qboUpdater.getRecentJobs(5);
    const jobList = jobs.map((j, i) => `${i + 1}. ${j.name}`).join('\n');
    
    await groupSMS.send(
      `📋 Recent jobs:\n${jobList}\n\nReply with job name`
    );
  }

  /**
   * Get oldest pending transaction
   */
  getOldestPendingTransaction() {
    const entries = Array.from(this.pendingTransactions.entries());
    if (entries.length === 0) return null;
    return entries[0][1]; // Return first (oldest) entry
  }

  /**
   * Send daily summary
   */
  async sendDailySummary() {
    try {
      const summary = await qboMonitor.getDailySummary();
      
      await groupSMS.send(
        `📊 Daily Summary - ${new Date().toLocaleDateString()}\n\n` +
        `✅ Categorized: ${summary.categorized} ($${summary.categorizedAmount.toFixed(2)})\n` +
        `⏳ Pending: ${summary.pending} ($${summary.pendingAmount.toFixed(2)})\n\n` +
        `💰 Billable: $${summary.billableAmount.toFixed(2)}\n` +
        `📦 Stock: $${summary.stockAmount.toFixed(2)}`
      );

    } catch (error) {
      logger.error('Daily summary failed', { error: error.message });
    }
  }

  /**
   * Handle incoming photo from Bobby/Jessica
   */
  async handleIncomingPhoto(message) {
    try {
      const imageData = message.attachments[0];
      const from = message.from;

      logger.info('Received receipt photo', { from });

      // Parse with OpenAI
      const parsed = await openaiParser.parseReceipt(imageData);

      // Try to match to bank transaction
      const matchedTxn = await receiptMatcher.findMatchingTransaction({
        vendor: parsed.vendor,
        amount: parsed.amount,
        date: parsed.date
      });

      if (matchedTxn) {
        if (parsed.jobName) {
          // Auto-categorize
          await this.autoCategorize(matchedTxn, { imageData, pdfData: imageData }, parsed);
        } else {
          // Ask for job
          await groupSMS.send(
            `🧾 Got it! ${parsed.vendor} $${parsed.amount}\n` +
            `Matched to card transaction.\n` +
            `What job?`
          );
          this.pendingTransactions.set(matchedTxn.id, { 
            txn: matchedTxn, 
            receipt: { imageData, pdfData: imageData },
            parsed 
          });
        }
      } else {
        // Store receipt for later matching
        this.pendingReceipts.set(`${parsed.vendor}-${parsed.amount}-${parsed.date}`, {
          imageData,
          parsed,
          receivedAt: new Date()
        });

        await groupSMS.send(
          `🧾 Got it! ${parsed.vendor} $${parsed.amount}\n` +
          `I'll match this when the card transaction comes through.`
        );
      }

    } catch (error) {
      logger.error('Error handling incoming photo', { error: error.message });
      await groupSMS.send(`❌ Couldn't read that receipt. Try again?`);
    }
  }
}

// Singleton
const smartReceiptBot = new SmartReceiptBot();

module.exports = smartReceiptBot;

