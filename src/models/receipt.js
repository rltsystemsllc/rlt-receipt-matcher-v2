/**
 * Receipt Data Model
 * Standardized receipt structure used throughout the application
 */

const { generateReceiptId } = require('../utils/helpers');

/**
 * Create a new standardized receipt object
 */
function createReceipt(data = {}) {
  return {
    // Unique identifier
    id: data.id || generateReceiptId(),

    // Source information
    source: {
      type: data.sourceType || 'email', // 'email', 'manual'
      emailId: data.emailId || null,
      emailSubject: data.emailSubject || null,
      attachmentName: data.attachmentName || null,
      receivedAt: data.receivedAt || new Date().toISOString()
    },

    // Vendor information
    vendor: {
      id: data.vendorId || null,
      name: data.vendorName || null,
      displayName: data.vendorDisplayName || null,
      qboVendorId: data.qboVendorId || null
    },

    // Transaction details
    transaction: {
      date: data.date || null,
      total: data.total || null,
      subtotal: data.subtotal || null,
      tax: data.tax || null,
      shipping: data.shipping || null,
      discount: data.discount || null
    },

    // Payment information
    payment: {
      method: data.paymentMethod || null,
      cardType: data.cardType || null,
      cardLast4: data.cardLast4 || null
    },

    // Order/Invoice details
    reference: {
      orderNumber: data.orderNumber || null,
      invoiceNumber: data.invoiceNumber || null,
      poNumber: data.poNumber || null
    },

    // Job/Project assignment
    job: {
      name: data.jobName || null,
      qboCustomerId: data.qboCustomerId || null,
      qboProjectId: data.qboProjectId || null
    },

    // Line items
    lineItems: data.lineItems || [],

    // QuickBooks sync status
    qboSync: {
      status: 'pending', // 'pending', 'matched', 'synced', 'error'
      transactionId: null,
      expenseId: null,
      billId: null,
      syncedAt: null,
      error: null
    },

    // Category/Account assignment
    category: {
      name: data.categoryName || 'Materials & Supplies',
      qboAccountId: data.qboAccountId || null,
      isBillable: data.isBillable !== false, // Default true
      isTaxable: data.isTaxable !== false    // Default true
    },

    // Attachments
    attachments: [],

    // Processing metadata
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      processingNotes: [],
      confidence: data.confidence || null
    }
  };
}

/**
 * Add a line item to a receipt
 */
function addLineItem(receipt, item) {
  receipt.lineItems.push({
    description: item.description || null,
    sku: item.sku || null,
    quantity: item.quantity || 1,
    unitPrice: item.unitPrice || null,
    totalPrice: item.totalPrice || null,
    category: item.category || null
  });

  receipt.metadata.updatedAt = new Date().toISOString();
  return receipt;
}

/**
 * Add an attachment to a receipt
 */
function addAttachment(receipt, attachment) {
  receipt.attachments.push({
    type: attachment.type || 'pdf', // 'pdf', 'image', 'html'
    filename: attachment.filename || null,
    mimeType: attachment.mimeType || null,
    data: attachment.data || null, // Base64 encoded
    size: attachment.size || null
  });

  receipt.metadata.updatedAt = new Date().toISOString();
  return receipt;
}

/**
 * Update QBO sync status
 */
function updateSyncStatus(receipt, status, details = {}) {
  receipt.qboSync = {
    ...receipt.qboSync,
    status,
    ...details,
    syncedAt: status === 'synced' ? new Date().toISOString() : receipt.qboSync.syncedAt
  };

  receipt.metadata.updatedAt = new Date().toISOString();
  return receipt;
}

/**
 * Add a processing note
 */
function addProcessingNote(receipt, note) {
  receipt.metadata.processingNotes.push({
    timestamp: new Date().toISOString(),
    message: note
  });

  receipt.metadata.updatedAt = new Date().toISOString();
  return receipt;
}

/**
 * Validate a receipt has minimum required data
 */
function validateReceipt(receipt) {
  const errors = [];

  if (!receipt.vendor.name) {
    errors.push('Vendor name is required');
  }

  if (!receipt.transaction.total) {
    errors.push('Transaction total is required');
  }

  if (!receipt.transaction.date) {
    errors.push('Transaction date is required');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Convert receipt to QuickBooks expense payload
 */
function toQboExpensePayload(receipt) {
  return {
    PaymentType: 'CreditCard',
    AccountRef: {
      value: receipt.category.qboAccountId
    },
    EntityRef: receipt.vendor.qboVendorId ? {
      value: receipt.vendor.qboVendorId,
      type: 'Vendor'
    } : undefined,
    TxnDate: receipt.transaction.date,
    TotalAmt: receipt.transaction.total,
    Line: receipt.lineItems.length > 0 
      ? receipt.lineItems.map(item => ({
          DetailType: 'AccountBasedExpenseLineDetail',
          Amount: item.totalPrice || item.unitPrice,
          Description: item.description,
          AccountBasedExpenseLineDetail: {
            AccountRef: {
              value: receipt.category.qboAccountId
            },
            BillableStatus: receipt.category.isBillable ? 'Billable' : 'NotBillable',
            TaxCodeRef: receipt.category.isTaxable ? { value: 'TAX' } : { value: 'NON' },
            CustomerRef: receipt.job.qboCustomerId ? {
              value: receipt.job.qboCustomerId
            } : undefined
          }
        }))
      : [{
          DetailType: 'AccountBasedExpenseLineDetail',
          Amount: receipt.transaction.total,
          Description: `${receipt.vendor.displayName || receipt.vendor.name} - ${receipt.transaction.date}`,
          AccountBasedExpenseLineDetail: {
            AccountRef: {
              value: receipt.category.qboAccountId
            },
            BillableStatus: receipt.category.isBillable ? 'Billable' : 'NotBillable',
            CustomerRef: receipt.job.qboCustomerId ? {
              value: receipt.job.qboCustomerId
            } : undefined
          }
        }]
  };
}

module.exports = {
  createReceipt,
  addLineItem,
  addAttachment,
  updateSyncStatus,
  addProcessingNote,
  validateReceipt,
  toQboExpensePayload
};


