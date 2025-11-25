/**
 * Vendor Detection Configuration
 * Rules for identifying vendors from email content
 */

const vendors = {
  'home-depot': {
    name: 'Home Depot',
    displayName: 'The Home Depot',
    emailPatterns: [
      /homedepot\.com/i,
      /home\s*depot/i,
      /order@homedepot/i
    ],
    receiptType: 'pdf', // Usually PDF attachment
    qboVendorName: 'The Home Depot',
    category: 'Materials & Supplies',
    // Patterns to extract data from Home Depot receipts
    extractors: {
      total: /(?:order\s*total|grand\s*total|total)[:\s]*\$?([\d,]+\.?\d*)/i,
      date: /(?:order\s*date|date)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      orderNumber: /(?:order\s*#?|order\s*number)[:\s]*(\w+)/i,
      cardLast4: /(?:visa|mastercard|amex|discover).*?(\d{4})/i
    }
  },

  'lowes': {
    name: 'Lowes',
    displayName: "Lowe's",
    emailPatterns: [
      /lowes\.com/i,
      /lowe'?s/i,
      /receipt@lowes/i
    ],
    receiptType: 'html', // Usually HTML email body
    qboVendorName: "Lowe's",
    category: 'Materials & Supplies',
    extractors: {
      total: /(?:order\s*total|total)[:\s]*\$?([\d,]+\.?\d*)/i,
      date: /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      orderNumber: /(?:order\s*#?)[:\s]*(\d+)/i,
      cardLast4: /ending\s*in\s*(\d{4})/i
    }
  },

  'amazon': {
    name: 'Amazon',
    displayName: 'Amazon.com',
    emailPatterns: [
      /amazon\.com/i,
      /auto-confirm@amazon/i,
      /ship-confirm@amazon/i
    ],
    receiptType: 'html',
    qboVendorName: 'Amazon.com',
    category: 'Materials & Supplies',
    extractors: {
      total: /(?:order\s*total|grand\s*total)[:\s]*\$?([\d,]+\.?\d*)/i,
      date: /(?:order\s*placed|ordered\s*on)[:\s]*(\w+\s+\d{1,2},?\s*\d{4})/i,
      orderNumber: /(?:order\s*#?)[:\s]*([\d\-]+)/i,
      cardLast4: /ending\s*in\s*(\d{4})/i
    }
  },

  'ced': {
    name: 'CED',
    displayName: 'Consolidated Electrical Distributors',
    emailPatterns: [
      /ced\.com/i,
      /cedcareers/i,
      /consolidated\s*electrical/i
    ],
    receiptType: 'pdf',
    qboVendorName: 'CED',
    category: 'Electrical Supplies',
    extractors: {
      total: /(?:total|amount\s*due)[:\s]*\$?([\d,]+\.?\d*)/i,
      date: /(?:invoice\s*date|date)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      invoiceNumber: /(?:invoice\s*#?)[:\s]*(\w+)/i
    }
  },

  'ace-hardware': {
    name: 'Ace Hardware',
    displayName: 'Ace Hardware',
    emailPatterns: [
      /acehardware\.com/i,
      /ace\s*hardware/i
    ],
    receiptType: 'html',
    qboVendorName: 'Ace Hardware',
    category: 'Materials & Supplies',
    extractors: {
      total: /(?:total)[:\s]*\$?([\d,]+\.?\d*)/i,
      date: /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i
    }
  },

  'alpha-supply': {
    name: 'Alpha Supply',
    displayName: 'Alpha Supply',
    emailPatterns: [
      /alpha\s*supply/i,
      /alphasupply/i,
      /@alphasupply\./i
    ],
    receiptType: 'pdf',
    qboVendorName: 'Alpha Supply',
    category: 'Electrical Supplies',
    extractors: {
      total: /(?:total|amount\s*due|invoice\s*total)[:\s]*\$?([\d,]+\.?\d*)/i,
      date: /(?:invoice\s*date|date)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      invoiceNumber: /(?:invoice\s*#?|inv\s*#?)[:\s]*(\w+)/i,
      orderNumber: /(?:order\s*#?|P\.?O\.?)[:\s]*(\w+)/i,
      cardLast4: /(?:card|visa|mastercard|amex)[^\d]*(\d{4})/i
    }
  },

  'read-lighting': {
    name: 'Read Lighting',
    displayName: 'Read Lighting',
    emailPatterns: [
      /read\s*lighting/i,
      /readlighting/i,
      /rlt/i,
      /@readlighting\./i
    ],
    receiptType: 'pdf', // Adjust based on how receipts typically come
    qboVendorName: 'Read Lighting',
    category: 'Electrical Supplies',
    extractors: {
      total: /(?:total|amount\s*due|grand\s*total)[:\s]*\$?([\d,]+\.?\d*)/i,
      date: /(?:date|invoice\s*date)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      invoiceNumber: /(?:invoice\s*#?|inv\s*#?)[:\s]*(\w+)/i,
      orderNumber: /(?:order\s*#?|P\.?O\.?)[:\s]*(\w+)/i,
      cardLast4: /(?:card|visa|mastercard|amex)[^\d]*(\d{4})/i
    }
  }
};

/**
 * Detect vendor from email sender/subject/body
 */
function detectVendor(email) {
  const searchText = [
    email.from || '',
    email.subject || '',
    email.snippet || ''
  ].join(' ').toLowerCase();

  for (const [vendorId, vendor] of Object.entries(vendors)) {
    for (const pattern of vendor.emailPatterns) {
      if (pattern.test(searchText)) {
        return { vendorId, ...vendor };
      }
    }
  }

  return null; // Unknown vendor
}

/**
 * Get vendor by ID
 */
function getVendor(vendorId) {
  return vendors[vendorId] || null;
}

/**
 * Get all vendor names for QuickBooks matching
 */
function getAllVendorNames() {
  return Object.values(vendors).map(v => v.qboVendorName);
}

module.exports = {
  vendors,
  detectVendor,
  getVendor,
  getAllVendorNames
};


