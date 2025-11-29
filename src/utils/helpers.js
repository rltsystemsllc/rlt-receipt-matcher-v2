/**
 * Utility Helper Functions
 */

const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');

dayjs.extend(customParseFormat);

/**
 * Parse various date formats into standardized YYYY-MM-DD
 */
function parseDate(dateStr) {
  if (!dateStr) return null;

  // Common date formats to try
  const formats = [
    'MM/DD/YYYY',
    'M/D/YYYY',
    'MM-DD-YYYY',
    'M-D-YYYY',
    'YYYY-MM-DD',
    'MMM D, YYYY',
    'MMMM D, YYYY',
    'MM/DD/YY',
    'M/D/YY'
  ];

  for (const format of formats) {
    const parsed = dayjs(dateStr, format, true);
    if (parsed.isValid()) {
      return parsed.format('YYYY-MM-DD');
    }
  }

  // Try native parsing as fallback
  const native = dayjs(dateStr);
  if (native.isValid()) {
    return native.format('YYYY-MM-DD');
  }

  return null;
}

/**
 * Parse currency string to number
 */
function parseCurrency(str) {
  if (!str) return null;
  if (typeof str === 'number') return str;

  // Remove currency symbols and commas, then parse
  const cleaned = str.replace(/[$,\s]/g, '');
  const num = parseFloat(cleaned);

  return isNaN(num) ? null : num;
}

/**
 * Extract last 4 digits of credit card
 */
function extractCardLast4(str) {
  if (!str) return null;

  // Look for common patterns
  const patterns = [
    /ending\s*in\s*(\d{4})/i,
    /\*+(\d{4})/,
    /x+(\d{4})/i,
    /(\d{4})$/
  ];

  for (const pattern of patterns) {
    const match = str.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Clean and normalize vendor name
 */
function normalizeVendorName(name) {
  if (!name) return null;

  return name
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s\-']/g, '');
}

/**
 * Extract job name from email subject or body
 * Looks for patterns like "Job: Kitchen Remodel" or "Project: Smith House"
 */
function extractJobName(text) {
  if (!text) return null;

  const patterns = [
    /(?:job|project|customer)[:\s]+([^\n\r,]+)/i,
    /(?:for|re)[:\s]+([^\n\r,]+(?:remodel|renovation|install|repair|house|home))/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Generate a unique receipt ID
 */
function generateReceiptId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `RLT-${timestamp}-${random}`.toUpperCase();
}

/**
 * Safely parse JSON with fallback
 */
function safeJsonParse(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

/**
 * Sleep/delay helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
async function retry(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 30000
  } = options;

  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries - 1) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

module.exports = {
  parseDate,
  parseCurrency,
  extractCardLast4,
  normalizeVendorName,
  extractJobName,
  generateReceiptId,
  safeJsonParse,
  sleep,
  retry
};




