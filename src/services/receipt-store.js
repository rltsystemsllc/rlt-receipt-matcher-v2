/**
 * Receipt Store Service
 * Tracks processed receipts and their job assignments
 * Persists to local JSON file for simplicity
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DATA_FILE = path.join(process.cwd(), 'data', 'receipts.json');

class ReceiptStore {
  constructor() {
    this.receipts = new Map();
    this.load();
  }

  /**
   * Load receipts from file
   */
  load() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        this.receipts = new Map(Object.entries(data.receipts || {}));
        logger.info('Receipt store loaded', { count: this.receipts.size });
      }
    } catch (error) {
      logger.error('Failed to load receipt store', { error: error.message });
      this.receipts = new Map();
    }
  }

  /**
   * Save receipts to file
   */
  save() {
    try {
      const dir = path.dirname(DATA_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = {
        receipts: Object.fromEntries(this.receipts),
        lastUpdated: new Date().toISOString()
      };

      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Failed to save receipt store', { error: error.message });
    }
  }

  /**
   * Add a processed receipt
   */
  addReceipt(receipt) {
    const id = receipt.id || `RLT-${Date.now()}`;
    
    const storedReceipt = {
      id,
      vendor: receipt.vendor?.name || receipt.vendor?.displayName || 'Unknown',
      vendorId: receipt.vendor?.vendorId || null,
      amount: receipt.transaction?.total || 0,
      date: receipt.transaction?.date || new Date().toISOString().split('T')[0],
      emailId: receipt.source?.emailId || receipt.emailId || null,
      emailSubject: receipt.source?.emailSubject || receipt.emailSubject || null,
      orderNumber: receipt.reference?.orderNumber || null,
      invoiceNumber: receipt.reference?.invoiceNumber || null,
      lineItems: receipt.lineItems || [],
      rawContent: receipt.rawContent || this.formatReceiptContent(receipt),
      attachments: receipt.attachments || [],
      pdfAttachment: receipt.pdfAttachment || null, // { messageId, attachmentId, filename }
      jobId: null,
      jobName: null,
      qboExpenseId: receipt.qboSync?.expenseId || null,
      status: 'unassigned', // unassigned, assigned, synced
      processedAt: new Date().toISOString(),
      assignedAt: null
    };

    this.receipts.set(id, storedReceipt);
    this.save();

    logger.info('Receipt added to store', { id, vendor: storedReceipt.vendor, amount: storedReceipt.amount });
    return storedReceipt;
  }

  /**
   * Format receipt content for display
   */
  formatReceiptContent(receipt) {
    const lines = [];
    const vendor = receipt.vendor?.displayName || receipt.vendor?.name || 'VENDOR';
    
    lines.push(vendor.toUpperCase());
    lines.push('');
    lines.push(`Date: ${receipt.transaction?.date || 'N/A'}`);
    if (receipt.reference?.orderNumber) {
      lines.push(`Order #: ${receipt.reference.orderNumber}`);
    }
    if (receipt.reference?.invoiceNumber) {
      lines.push(`Invoice #: ${receipt.reference.invoiceNumber}`);
    }
    lines.push('');
    lines.push('-'.repeat(40));
    
    if (receipt.lineItems && receipt.lineItems.length > 0) {
      for (const item of receipt.lineItems) {
        const qty = item.quantity || 1;
        const desc = item.description || 'Item';
        const price = item.totalPrice || item.unitPrice || 0;
        lines.push(`${qty} ${desc.substring(0, 25).padEnd(25)} $${price.toFixed(2)}`);
      }
      lines.push('-'.repeat(40));
    }
    
    if (receipt.transaction?.subtotal) {
      lines.push(`SUBTOTAL${' '.repeat(24)}$${receipt.transaction.subtotal.toFixed(2)}`);
    }
    if (receipt.transaction?.tax) {
      lines.push(`TAX${' '.repeat(29)}$${receipt.transaction.tax.toFixed(2)}`);
    }
    lines.push('-'.repeat(40));
    lines.push(`TOTAL${' '.repeat(27)}$${(receipt.transaction?.total || 0).toFixed(2)}`);
    
    if (receipt.payment?.cardLast4) {
      lines.push('');
      lines.push(`${receipt.payment.method || 'CARD'} ****${receipt.payment.cardLast4}`);
    }
    
    return lines.join('\n');
  }

  /**
   * Get a receipt by ID
   */
  getReceipt(id) {
    return this.receipts.get(id) || null;
  }

  /**
   * Get all unassigned receipts
   */
  getUnassignedReceipts() {
    return Array.from(this.receipts.values())
      .filter(r => r.status === 'unassigned')
      .sort((a, b) => new Date(b.processedAt) - new Date(a.processedAt));
  }

  /**
   * Get all receipts for a job
   */
  getReceiptsForJob(jobName) {
    return Array.from(this.receipts.values())
      .filter(r => r.jobName === jobName)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  /**
   * Assign receipt to a job
   */
  assignToJob(receiptId, jobName, jobId = null) {
    const receipt = this.receipts.get(receiptId);
    if (!receipt) {
      throw new Error('Receipt not found');
    }

    receipt.jobName = jobName;
    receipt.jobId = jobId;
    receipt.status = 'assigned';
    receipt.assignedAt = new Date().toISOString();

    this.receipts.set(receiptId, receipt);
    this.save();

    logger.info('Receipt assigned to job', { receiptId, jobName });
    return receipt;
  }

  /**
   * Unassign receipt from job
   */
  unassignFromJob(receiptId) {
    const receipt = this.receipts.get(receiptId);
    if (!receipt) {
      throw new Error('Receipt not found');
    }

    receipt.jobName = null;
    receipt.jobId = null;
    receipt.status = 'unassigned';
    receipt.assignedAt = null;

    this.receipts.set(receiptId, receipt);
    this.save();

    logger.info('Receipt unassigned from job', { receiptId });
    return receipt;
  }

  /**
   * Get jobs with assigned receipts (ready to invoice)
   */
  getJobsReadyToInvoice() {
    const jobMap = new Map();

    for (const receipt of this.receipts.values()) {
      if (receipt.status === 'assigned' && receipt.jobName) {
        if (!jobMap.has(receipt.jobName)) {
          jobMap.set(receipt.jobName, {
            jobName: receipt.jobName,
            jobId: receipt.jobId,
            receipts: [],
            totalAmount: 0,
            expenseCount: 0
          });
        }

        const job = jobMap.get(receipt.jobName);
        job.receipts.push(receipt);
        job.totalAmount += receipt.amount || 0;
        job.expenseCount++;
      }
    }

    return Array.from(jobMap.values())
      .sort((a, b) => b.totalAmount - a.totalAmount);
  }

  /**
   * Get dashboard stats
   */
  getStats() {
    const all = Array.from(this.receipts.values());
    const unassigned = all.filter(r => r.status === 'unassigned');
    const assigned = all.filter(r => r.status === 'assigned');
    
    // This week
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const thisWeek = all.filter(r => new Date(r.processedAt) >= weekAgo);

    return {
      totalReceipts: all.length,
      unassignedCount: unassigned.length,
      unassignedAmount: unassigned.reduce((sum, r) => sum + (r.amount || 0), 0),
      assignedCount: assigned.length,
      assignedAmount: assigned.reduce((sum, r) => sum + (r.amount || 0), 0),
      thisWeekCount: thisWeek.length,
      thisWeekAmount: thisWeek.reduce((sum, r) => sum + (r.amount || 0), 0),
      jobsReadyCount: this.getJobsReadyToInvoice().length,
      jobsReadyAmount: assigned.reduce((sum, r) => sum + (r.amount || 0), 0)
    };
  }

  /**
   * Get recent activity
   */
  getRecentActivity(limit = 10) {
    return Array.from(this.receipts.values())
      .sort((a, b) => new Date(b.processedAt) - new Date(a.processedAt))
      .slice(0, limit)
      .map(r => ({
        id: r.id,
        type: r.status === 'assigned' ? 'assigned' : 'receipt',
        vendor: r.vendor,
        amount: r.amount,
        jobName: r.jobName,
        timestamp: r.assignedAt || r.processedAt
      }));
  }

  /**
   * Delete a receipt
   */
  deleteReceipt(id) {
    const deleted = this.receipts.delete(id);
    if (deleted) {
      this.save();
      logger.info('Receipt deleted', { id });
    }
    return deleted;
  }

  /**
   * Clear all receipts (for testing)
   */
  clear() {
    this.receipts.clear();
    this.save();
  }
}

// Singleton instance
const receiptStore = new ReceiptStore();

module.exports = receiptStore;

