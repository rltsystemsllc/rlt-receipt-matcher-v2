/**
 * Receipt Matcher
 * 
 * Matches receipts (from Gmail or photos) to bank transactions in QBO
 * Uses vendor name, amount, and date for matching
 */

const logger = require('../utils/logger');
const qboMonitor = require('./qbo-monitor');

// Store receipts waiting for transaction match
const pendingReceipts = new Map();

/**
 * Find a matching receipt for a bank transaction
 */
async function findMatchingReceipt(transaction) {
  try {
    const { vendor, amount, date } = transaction;
    
    // Generate match keys
    const keys = generateMatchKeys(vendor, amount, date);

    // Check pending receipts for a match
    for (const key of keys) {
      if (pendingReceipts.has(key)) {
        const receipt = pendingReceipts.get(key);
        pendingReceipts.delete(key); // Remove from pending
        
        logger.info('Matched receipt to transaction', {
          vendor,
          amount,
          date
        });
        
        return receipt;
      }
    }

    // No match in pending - try to fetch from Gmail
    const gmailReceipt = await fetchReceiptFromGmail(vendor, amount, date);
    
    return gmailReceipt;

  } catch (error) {
    logger.error('Error finding matching receipt', { error: error.message });
    return null;
  }
}

/**
 * Find a matching bank transaction for a receipt
 */
async function findMatchingTransaction(receiptData) {
  try {
    const { vendor, amount, date } = receiptData;
    
    // Search QBO for matching transaction
    const transaction = await qboMonitor.findTransaction(vendor, amount, date);
    
    if (transaction) {
      logger.info('Matched transaction to receipt', {
        vendor,
        amount,
        date,
        txnId: transaction.id
      });
    }
    
    return transaction;

  } catch (error) {
    logger.error('Error finding matching transaction', { error: error.message });
    return null;
  }
}

/**
 * Store a receipt for later matching
 */
function storeReceipt(receiptData) {
  const { vendor, amount, date, imageData, pdfData, parsed } = receiptData;
  
  const keys = generateMatchKeys(vendor, amount, date);
  const receipt = {
    vendor,
    amount,
    date,
    imageData,
    pdfData,
    parsed,
    storedAt: new Date()
  };
  
  // Store under all match keys
  for (const key of keys) {
    pendingReceipts.set(key, receipt);
  }
  
  logger.info('Stored receipt for matching', { vendor, amount, date });
  
  return receipt;
}

/**
 * Generate match keys for vendor/amount/date combinations
 * Handles variations in vendor names and date tolerance
 */
function generateMatchKeys(vendor, amount, date) {
  const keys = [];
  const normalizedVendor = normalizeVendorName(vendor);
  const amountStr = parseFloat(amount).toFixed(2);
  
  // Parse date
  const d = new Date(date);
  
  // Keys for exact date and ±2 days
  for (let offset = -2; offset <= 2; offset++) {
    const checkDate = new Date(d);
    checkDate.setDate(checkDate.getDate() + offset);
    const dateStr = checkDate.toISOString().split('T')[0];
    
    keys.push(`${normalizedVendor}-${amountStr}-${dateStr}`);
  }
  
  return keys;
}

/**
 * Normalize vendor name for matching
 */
function normalizeVendorName(vendor) {
  if (!vendor) return 'unknown';
  
  return vendor
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') // Remove special chars
    .replace(/inc$|llc$|corp$/, '') // Remove suffixes
    .trim();
}

/**
 * Fetch receipt from Gmail by vendor/amount/date
 */
async function fetchReceiptFromGmail(vendor, amount, date) {
  try {
    const gmailClient = require('../services/gmail/client');
    const gmail = gmailClient.getApi();
    
    if (!gmail) {
      logger.warn('Gmail not connected');
      return null;
    }

    // Build search query
    const dateObj = new Date(date);
    const afterDate = new Date(dateObj);
    afterDate.setDate(afterDate.getDate() - 3);
    const beforeDate = new Date(dateObj);
    beforeDate.setDate(beforeDate.getDate() + 3);
    
    const searchQuery = `from:${vendor} OR subject:${vendor} after:${afterDate.toISOString().split('T')[0]} before:${beforeDate.toISOString().split('T')[0]}`;
    
    const searchResponse = await gmail.users.messages.list({
      userId: 'me',
      q: searchQuery,
      maxResults: 5
    });
    
    const messages = searchResponse.data.messages || [];
    
    if (messages.length === 0) {
      return null;
    }
    
    // Get the first message with attachments
    for (const msg of messages) {
      const fullMessage = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id
      });
      
      const parts = fullMessage.data.payload?.parts || [];
      
      for (const part of parts) {
        if (part.filename && (part.filename.endsWith('.pdf') || part.filename.match(/\.(jpg|jpeg|png)$/i))) {
          // Download attachment
          const attachment = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: msg.id,
            id: part.body.attachmentId
          });
          
          const data = attachment.data.data;
          const buffer = Buffer.from(data, 'base64');
          
          return {
            filename: part.filename,
            messageId: msg.id,
            attachmentId: part.body.attachmentId,
            pdfData: buffer,
            imageData: buffer, // Will work for images, need conversion for PDF
            contentType: part.mimeType
          };
        }
      }
    }
    
    return null;

  } catch (error) {
    logger.error('Error fetching receipt from Gmail', { error: error.message });
    return null;
  }
}

/**
 * Get pending receipts count
 */
function getPendingCount() {
  return pendingReceipts.size;
}

/**
 * Clear old pending receipts (older than 7 days)
 */
function cleanupOldReceipts() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  let cleaned = 0;
  
  for (const [key, receipt] of pendingReceipts.entries()) {
    if (receipt.storedAt < sevenDaysAgo) {
      pendingReceipts.delete(key);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    logger.info('Cleaned up old pending receipts', { count: cleaned });
  }
  
  return cleaned;
}

module.exports = {
  findMatchingReceipt,
  findMatchingTransaction,
  storeReceipt,
  getPendingCount,
  cleanupOldReceipts
};



