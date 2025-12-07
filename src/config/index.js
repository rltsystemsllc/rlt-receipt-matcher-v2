/**
 * Application Configuration
 * Centralizes all environment variables and settings
 */

require('dotenv').config();

const config = {
  // Server
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV !== 'production',

  // Gmail API
  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID,
    clientSecret: process.env.GMAIL_CLIENT_SECRET,
    redirectUri: process.env.GMAIL_REDIRECT_URI || 'http://localhost:3000/auth/gmail/callback',
    userEmail: process.env.GMAIL_USER_EMAIL || 'rltsystemsllc@gmail.com',
    processedLabel: process.env.GMAIL_PROCESSED_LABEL || 'RLT-Processed',
    tokenPath: 'tokens/gmail-token.json'
  },

  // QuickBooks Online
  quickbooks: {
    clientId: process.env.QBO_CLIENT_ID,
    clientSecret: process.env.QBO_CLIENT_SECRET,
    redirectUri: process.env.QBO_REDIRECT_URI || 'http://localhost:3000/auth/quickbooks/callback',
    environment: process.env.QBO_ENVIRONMENT || 'sandbox',
    realmId: process.env.QBO_REALM_ID,
    expenseAccount: process.env.QBO_EXPENSE_ACCOUNT || 'Job Supplies',
    tokenPath: 'tokens/quickbooks-token.json'
  },

  // Google Sheets (Bot 2)
  sheets: {
    clientId: process.env.GMAIL_CLIENT_ID,
    clientSecret: process.env.GMAIL_CLIENT_SECRET,
    redirectUri: process.env.SHEETS_REDIRECT_URI || 'http://localhost:3000/auth/sheets/callback',
    sheetId: process.env.GOOGLE_SHEET_ID,
    sheetName: process.env.GOOGLE_SHEET_NAME || 'Form Responses 1',
    inventorySheetName: process.env.INVENTORY_SHEET_NAME || 'Inventory Pull Log',
    driveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
    tokenPath: 'tokens/sheets-token.json'
  },

  // RingCentral (Bot 2 & 3)
  ringcentral: {
    clientId: process.env.RINGCENTRAL_CLIENT_ID,
    clientSecret: process.env.RINGCENTRAL_CLIENT_SECRET,
    server: process.env.RINGCENTRAL_SERVER || 'https://platform.ringcentral.com',
    jwtToken: process.env.RINGCENTRAL_JWT_TOKEN,
    botPhone: process.env.RINGCENTRAL_BOT_PHONE,
    tokenPath: 'tokens/ringcentral-token.json'
  },

  // Notification recipients
  notifications: {
    jessicaPhone: process.env.JESSICA_PHONE || '+18082688453',
    bobbyPhone: process.env.BOBBY_PHONE || '+18088666500'
  },

  // Billing rates (Bot 2)
  billing: {
    laborRateStandard: parseFloat(process.env.LABOR_RATE_STANDARD) || 150,
    laborRateEmergency: parseFloat(process.env.LABOR_RATE_EMERGENCY) || 300,
    stockMarkupPercent: parseFloat(process.env.STOCK_MARKUP_PERCENT) || 22
  },

  // Scheduler (Bot 1)
  scheduler: {
    cron: process.env.SCHEDULER_CRON || '*/5 * * * *',
    enabled: process.env.SCHEDULER_ENABLED !== 'false'
  },

  // Bot 2 Scheduler
  bot2Scheduler: {
    cron: process.env.BOT2_SCHEDULER_CRON || '*/5 * * * *',
    enabled: process.env.BOT2_SCHEDULER_ENABLED !== 'false'
  },

  // Billing config (Bot 2 uses this)
  billing: {
    laborRateStandard: parseFloat(process.env.LABOR_RATE_STANDARD) || 150,
    laborRateEmergency: parseFloat(process.env.LABOR_RATE_EMERGENCY) || 300,
    stockMarkupPercent: parseFloat(process.env.STOCK_MARKUP_PERCENT) || 22,
    schedulerCron: process.env.BOT2_SCHEDULER_CRON || '*/5 * * * *',
    schedulerEnabled: process.env.BOT2_SCHEDULER_ENABLED !== 'false',
    
    // Column mappings for Daily Job Log (0-indexed)
    columns: {
      timestamp: 0,           // A - Timestamp
      contractorName: 1,      // B - Contractor/Customer Name
      projectName: 2,         // C - Project Name
      dateWorked: 3,          // D - Date of Work
      hoursWorked: 4,         // E - Hours Worked
      phase: 5,               // F - Phase (Rough/Trim/Service)
      description: 6,         // G - Description of Work
      stockMaterials: 7,      // H - Stock Materials Used (backup)
      purchasedMaterials: 8,  // I - Purchased Materials (backup)
      urgentBilling: 9,       // J - Urgent Billing Needed
      emergencyRate: 10,      // K - Emergency Rate
      notesToBookkeeper: 11,  // L - Notes to Bookkeeper
      billingStatus: 12       // M - Billing Status (Bot updates this)
    },
    
    // Billing status values
    statuses: {
      notBilled: 'Not Billed',
      draftCreated: 'Draft Created',
      pendingApproval: 'Pending Approval',
      approved: 'Approved',
      sent: 'Sent to Customer',
      paid: 'Paid'
    }
  },

  // Invoice Safeguards (Bot 2 Protection Layers)
  safeguards: {
    // Layer 1: Pre-flight sanity checks
    maxHoursPerDay: parseFloat(process.env.MAX_HOURS_PER_DAY) || 12,
    minExpectedMaterials: parseFloat(process.env.MIN_EXPECTED_MATERIALS) || 0,
    invoiceAmountMultiplierWarning: parseFloat(process.env.INVOICE_AMOUNT_MULTIPLIER) || 2.0,
    
    // Layer 3: Undo window
    undoWindowMinutes: parseInt(process.env.UNDO_WINDOW_MINUTES) || 5,
    
    // Layer 4: Two-stage approval threshold
    largeInvoiceThreshold: parseFloat(process.env.LARGE_INVOICE_THRESHOLD) || 2500,
    
    // Layer 5: Daily reconciliation
    dailyReconciliationTime: process.env.DAILY_RECONCILIATION_TIME || '17:00', // 5 PM
    
    // Emergency rate auto-detection
    autoDetectEmergencyRate: process.env.AUTO_DETECT_EMERGENCY_RATE !== 'false',
    emergencyRateDays: [0, 6], // Sunday = 0, Saturday = 6
  },

  // Inventory config (Bot 3 uses this)
  inventory: {
    triggerPhrases: ['inventory', 'inv', 'pull', 'stock', 'materials', 'start']
  },

  // Receipt processing
  receipt: {
    defaultExpenseAccountId: process.env.DEFAULT_EXPENSE_ACCOUNT_ID,
    defaultCreditCardAccountId: process.env.DEFAULT_CREDIT_CARD_ACCOUNT_ID,
    enableOcr: process.env.ENABLE_OCR !== 'false'
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'logs/app.log'
  }
};

/**
 * Validate Bot 1 configuration
 */
config.validateBot1 = function() {
  const errors = [];
  
  if (!this.gmail.clientId) errors.push('GMAIL_CLIENT_ID not set');
  if (!this.gmail.clientSecret) errors.push('GMAIL_CLIENT_SECRET not set');
  if (!this.quickbooks.clientId) errors.push('QBO_CLIENT_ID not set');
  if (!this.quickbooks.clientSecret) errors.push('QBO_CLIENT_SECRET not set');
  
  return errors;
};

/**
 * Validate Bot 2 configuration
 */
config.validateBot2 = function() {
  const errors = [];
  
  if (!this.sheets.sheetId) errors.push('GOOGLE_SHEET_ID not set');
  if (!this.ringcentral.clientId) errors.push('RINGCENTRAL_CLIENT_ID not set');
  if (!this.ringcentral.jwtToken) errors.push('RINGCENTRAL_JWT_TOKEN not set');
  
  return errors;
};

/**
 * Validate Bot 3 configuration
 */
config.validateBot3 = function() {
  const errors = [];
  
  if (!this.sheets.sheetId) errors.push('GOOGLE_SHEET_ID not set');
  if (!this.ringcentral.clientId) errors.push('RINGCENTRAL_CLIENT_ID not set');
  
  return errors;
};

module.exports = config;
