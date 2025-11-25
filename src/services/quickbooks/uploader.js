/**
 * QuickBooks Uploader
 * Creates expenses, bills, and uploads attachments to QuickBooks
 */

const qboClient = require('./client');
const matcher = require('./matcher');
const { updateSyncStatus, addProcessingNote } = require('../../models/receipt');
const logger = require('../../utils/logger');

class QuickBooksUploader {
  /**
   * Sync a receipt to QuickBooks
   */
  async syncReceipt(receipt) {
    try {
      // Find or create vendor
      const vendorName = receipt.vendor.qboVendorName || receipt.vendor.displayName || receipt.vendor.name;
      const vendor = await matcher.findOrCreateVendor(vendorName);

      if (vendor) {
        receipt.vendor.qboVendorId = vendor.Id;
      }

      // Find customer/project if job specified
      if (receipt.job.name) {
        const customer = await matcher.findCustomer(receipt.job.name);
        if (customer) {
          receipt.job.qboCustomerId = customer.Id;
        }
      }

      // Find expense account
      const account = await matcher.findAccount(receipt.category.name);
      if (account) {
        receipt.category.qboAccountId = account.Id;
      }

      // Try to find matching credit card transaction
      const matchingTxn = await matcher.findMatchingTransaction(receipt);

      if (matchingTxn) {
        // Update existing transaction with receipt details
        await this.updateTransaction(receipt, matchingTxn);
        updateSyncStatus(receipt, 'matched', { transactionId: matchingTxn.Id });
        addProcessingNote(receipt, `Matched to existing transaction #${matchingTxn.Id}`);
      } else {
        // Create new expense
        const expense = await this.createExpense(receipt);
        updateSyncStatus(receipt, 'synced', { expenseId: expense.Id });
        addProcessingNote(receipt, `Created new expense #${expense.Id}`);
      }

      // Upload attachment if present
      if (receipt.attachments.length > 0) {
        await this.uploadAttachment(receipt);
      }

      logger.receipt('synced to QuickBooks', receipt);
      return receipt;
    } catch (error) {
      logger.error('Receipt sync failed', {
        receiptId: receipt.id,
        error: error.message
      });

      updateSyncStatus(receipt, 'error', { error: error.message });
      throw error;
    }
  }

  /**
   * Create a new expense/purchase in QuickBooks
   */
  async createExpense(receipt) {
    // Get credit card account
    const ccAccount = await matcher.findCreditCardAccount();

    const expensePayload = {
      PaymentType: 'CreditCard',
      AccountRef: ccAccount ? { value: ccAccount.Id } : undefined,
      TxnDate: receipt.transaction.date,
      TotalAmt: receipt.transaction.total,
      EntityRef: receipt.vendor.qboVendorId ? {
        value: receipt.vendor.qboVendorId,
        type: 'Vendor'
      } : undefined,
      Line: this.buildLineItems(receipt),
      PrivateNote: `Imported by RLT Receipt Matcher - ${receipt.id}`
    };

    try {
      const response = await qboClient.makeApiCall('POST', '/purchase', expensePayload);

      logger.qbo('created expense', {
        id: response.Purchase.Id,
        total: response.Purchase.TotalAmt
      });

      return response.Purchase;
    } catch (error) {
      logger.error('Failed to create expense', { error: error.message });
      throw error;
    }
  }

  /**
   * Create a bill in QuickBooks (for account purchases)
   */
  async createBill(receipt) {
    const billPayload = {
      VendorRef: receipt.vendor.qboVendorId ? {
        value: receipt.vendor.qboVendorId
      } : undefined,
      TxnDate: receipt.transaction.date,
      DueDate: receipt.transaction.date, // Same day for simplicity
      Line: this.buildBillLineItems(receipt),
      PrivateNote: `Imported by RLT Receipt Matcher - ${receipt.id}`
    };

    try {
      const response = await qboClient.makeApiCall('POST', '/bill', billPayload);

      logger.qbo('created bill', {
        id: response.Bill.Id,
        total: response.Bill.TotalAmt
      });

      return response.Bill;
    } catch (error) {
      logger.error('Failed to create bill', { error: error.message });
      throw error;
    }
  }

  /**
   * Update an existing transaction with receipt details
   */
  async updateTransaction(receipt, transaction) {
    // Build updated line items with billable/customer info
    const updatedLines = transaction.Line.map((line, index) => {
      const updatedLine = { ...line };

      // Add customer reference for billable
      if (receipt.category.isBillable && receipt.job.qboCustomerId) {
        if (line.AccountBasedExpenseLineDetail) {
          updatedLine.AccountBasedExpenseLineDetail = {
            ...line.AccountBasedExpenseLineDetail,
            CustomerRef: { value: receipt.job.qboCustomerId },
            BillableStatus: 'Billable'
          };
        }
      }

      return updatedLine;
    });

    const updatePayload = {
      ...transaction,
      Line: updatedLines,
      EntityRef: receipt.vendor.qboVendorId ? {
        value: receipt.vendor.qboVendorId,
        type: 'Vendor'
      } : transaction.EntityRef,
      PrivateNote: `${transaction.PrivateNote || ''}\nMatched by RLT Receipt Matcher - ${receipt.id}`.trim()
    };

    try {
      const response = await qboClient.makeApiCall('POST', '/purchase', updatePayload);

      logger.qbo('updated transaction', {
        id: response.Purchase.Id
      });

      return response.Purchase;
    } catch (error) {
      logger.error('Failed to update transaction', { error: error.message });
      throw error;
    }
  }

  /**
   * Build line items for expense
   */
  buildLineItems(receipt) {
    if (receipt.lineItems.length > 0) {
      return receipt.lineItems.map(item => ({
        DetailType: 'AccountBasedExpenseLineDetail',
        Amount: item.totalPrice || item.unitPrice * (item.quantity || 1),
        Description: item.description,
        AccountBasedExpenseLineDetail: {
          AccountRef: receipt.category.qboAccountId ? {
            value: receipt.category.qboAccountId
          } : undefined,
          BillableStatus: receipt.category.isBillable ? 'Billable' : 'NotBillable',
          CustomerRef: receipt.job.qboCustomerId ? {
            value: receipt.job.qboCustomerId
          } : undefined
        }
      }));
    }

    // Single line item for total
    return [{
      DetailType: 'AccountBasedExpenseLineDetail',
      Amount: receipt.transaction.total,
      Description: `${receipt.vendor.displayName || receipt.vendor.name} - ${receipt.transaction.date}`,
      AccountBasedExpenseLineDetail: {
        AccountRef: receipt.category.qboAccountId ? {
          value: receipt.category.qboAccountId
        } : undefined,
        BillableStatus: receipt.category.isBillable ? 'Billable' : 'NotBillable',
        CustomerRef: receipt.job.qboCustomerId ? {
          value: receipt.job.qboCustomerId
        } : undefined
      }
    }];
  }

  /**
   * Build line items for bill
   */
  buildBillLineItems(receipt) {
    if (receipt.lineItems.length > 0) {
      return receipt.lineItems.map(item => ({
        DetailType: 'AccountBasedExpenseLineDetail',
        Amount: item.totalPrice || item.unitPrice * (item.quantity || 1),
        Description: item.description,
        AccountBasedExpenseLineDetail: {
          AccountRef: receipt.category.qboAccountId ? {
            value: receipt.category.qboAccountId
          } : undefined,
          BillableStatus: receipt.category.isBillable ? 'Billable' : 'NotBillable',
          CustomerRef: receipt.job.qboCustomerId ? {
            value: receipt.job.qboCustomerId
          } : undefined
        }
      }));
    }

    return [{
      DetailType: 'AccountBasedExpenseLineDetail',
      Amount: receipt.transaction.total,
      Description: `${receipt.vendor.displayName || receipt.vendor.name}`,
      AccountBasedExpenseLineDetail: {
        AccountRef: receipt.category.qboAccountId ? {
          value: receipt.category.qboAccountId
        } : undefined,
        BillableStatus: receipt.category.isBillable ? 'Billable' : 'NotBillable',
        CustomerRef: receipt.job.qboCustomerId ? {
          value: receipt.job.qboCustomerId
        } : undefined
      }
    }];
  }

  /**
   * Upload receipt attachment to QuickBooks
   */
  async uploadAttachment(receipt) {
    const attachment = receipt.attachments[0]; // Use first attachment

    if (!attachment || !attachment.data) {
      return null;
    }

    try {
      // Get the entity to attach to
      const entityType = receipt.qboSync.expenseId ? 'Purchase' : 'Bill';
      const entityId = receipt.qboSync.expenseId || receipt.qboSync.billId;

      if (!entityId) {
        logger.warn('No entity ID for attachment upload');
        return null;
      }

      // Note: Attachment upload requires multipart form data
      // This is a placeholder - actual implementation would need
      // proper multipart handling
      logger.qbo('attachment upload prepared', {
        filename: attachment.filename,
        entityType,
        entityId
      });

      // In production, you would use:
      // const response = await qboClient.makeApiCall('POST', '/upload', formData);

      addProcessingNote(receipt, `Attachment ${attachment.filename} ready for upload`);

      return true;
    } catch (error) {
      logger.error('Attachment upload failed', { error: error.message });
      return null;
    }
  }

  /**
   * Create vendor credit (for returns)
   */
  async createVendorCredit(receipt) {
    const creditPayload = {
      VendorRef: receipt.vendor.qboVendorId ? {
        value: receipt.vendor.qboVendorId
      } : undefined,
      TxnDate: receipt.transaction.date,
      Line: this.buildBillLineItems(receipt),
      PrivateNote: `Vendor credit imported by RLT Receipt Matcher - ${receipt.id}`
    };

    try {
      const response = await qboClient.makeApiCall('POST', '/vendorcredit', creditPayload);

      logger.qbo('created vendor credit', {
        id: response.VendorCredit.Id,
        total: response.VendorCredit.TotalAmt
      });

      return response.VendorCredit;
    } catch (error) {
      logger.error('Failed to create vendor credit', { error: error.message });
      throw error;
    }
  }
}

// Singleton instance
const uploader = new QuickBooksUploader();

module.exports = uploader;


