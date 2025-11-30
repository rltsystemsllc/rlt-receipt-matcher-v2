/**
 * RLT Automation System - Configuration
 * Bot 1: Receipt Processor (Gmail → QBO Expenses)
 * Bot 2: Invoice Drafter (Google Sheet → QBO Invoices + RingCentral SMS)
 * Bot 3: Inventory Bot (RingCentral SMS → Google Sheets Inventory Log)
 */

require('dotenv').config();

const config = {
  // Server
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV !== 'production',

  // =============================================
  // BOT 1 - RECEIPT PROCESSOR (Existing)
  // =============================================
  
  // Gmail API
  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID,
    clientSecret: process.env.GMAIL_CLIENT_SECRET,
    redirectUri: process.env.GMAIL_REDIRECT_URI || 'http://localhost:3000/auth/gmail/callback',
    userEmail: process.env.GMAIL_USER_EMAIL,
    processedLabel: process.env.GMAIL_PROCESSED_LABEL || 'RLT-Processed',
    tokenPath: './tokens/gmail-token.json',
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.labels'
    ]
  },

  // QuickBooks Online (Shared by Bot 1 & Bot 2)
  quickbooks: {
    clientId: process.env.QBO_CLIENT_ID,
    clientSecret: process.env.QBO_CLIENT_SECRET,
    redirectUri: process.env.QBO_REDIRECT_URI || 'http://localhost:3000/auth/quickbooks/callback',
    environment: process.env.QBO_ENVIRONMENT || 'sandbox',
    realmId: process.env.QBO_REALM_ID,
    tokenPath: './tokens/quickbooks-token.json',
    scopes: [
      'com.intuit.quickbooks.accounting'
    ],
    // Default accounts for expenses
    defaultExpenseAccountName: process.env.QBO_EXPENSE_ACCOUNT || 'Job Supplies',
    defaultExpenseAccountId: process.env.DEFAULT_EXPENSE_ACCOUNT_ID
  },

  // Bot 1 Scheduler
  scheduler: {
    cron: process.env.SCHEDULER_CRON || '*/5 * * * *',
    enabled: process.env.SCHEDULER_ENABLED !== 'false'
  },

  // Receipt Processing
  processing: {
    defaultExpenseAccountId: process.env.DEFAULT_EXPENSE_ACCOUNT_ID,
    defaultCreditCardAccountId: process.env.DEFAULT_CREDIT_CARD_ACCOUNT_ID,
    enableOcr: process.env.ENABLE_OCR !== 'false',
    tempDir: './temp',
    downloadsDir: './downloads'
  },

  // =============================================
  // BOT 2 - INVOICE DRAFTER (New)
  // =============================================

  // Google Sheets API (For Daily Job Log)
  sheets: {
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    sheetName: process.env.GOOGLE_SHEET_NAME || 'Form Responses 1',
    tokenPath: './tokens/sheets-token.json',
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly'
    ],
    // Column mappings (0-indexed, will be used for reading)
    columns: {
      timestamp: 0,          // A - Timestamp
      date: 1,               // B - Date
      contractorName: 2,     // C - Contractor/Customer Name (new project only)
      projectName: 3,        // D - Project Name (new project only)
      jobName: 4,            // E - Job Name (existing project)
      constructionPhase: 5,  // F - Construction Phase
      hoursWorked: 6,        // G - Hours Worked
      descriptionOfWork: 7,  // H - Description of Work
      materialBought: 8,     // I - Material Bought
      receiptPhoto: 9,       // J - Upload Receipt Photo
      materialFromStock: 10, // K - Material Pulled From Stock/Truck
      urgentBilling: 11,     // L - Urgent Billing Needed
      notesToBookkeeper: 12, // M - Notes to Bookkeeper
      billingStatus: 13,     // N - Billing Status
      emergencyRate: 14      // O - Emergency Rate (same-day/weekend) - checkbox
    },
    // Billing status values
    billingStatuses: {
      notBilled: 'Not Billed',
      draftGenerated: 'Draft Generated',
      sentToCustomer: 'Sent to Customer',
      followUpNeeded: 'Follow-Up Needed',
      paid: 'Paid',
      pastDue: 'Past Due'
    }
  },

  // RingCentral SMS API
  ringcentral: {
    clientId: process.env.RINGCENTRAL_CLIENT_ID,
    clientSecret: process.env.RINGCENTRAL_CLIENT_SECRET,
    server: process.env.RINGCENTRAL_SERVER || 'https://platform.ringcentral.com',
    jwtToken: process.env.RINGCENTRAL_JWT_TOKEN,
    botPhoneNumber: process.env.RINGCENTRAL_BOT_PHONE,
    tokenPath: './tokens/ringcentral-token.json',
    // Recipients for notifications
    recipients: {
      jessica: process.env.JESSICA_PHONE || '+18082688453',
      bobby: process.env.BOBBY_PHONE || '+18088666500'
    },
    // Group both for all notifications
    groupRecipients: ['+18082688453', '+18088666500']
  },

  // Bot 2 Billing Configuration
  billing: {
    // Labor rates
    laborRateStandard: parseFloat(process.env.LABOR_RATE_STANDARD) || 150,
    laborRateEmergency: parseFloat(process.env.LABOR_RATE_EMERGENCY) || 300,
    
    // Stock materials markup
    stockMarkupPercent: parseFloat(process.env.STOCK_MARKUP_PERCENT) || 22,
    
    // Construction phases
    constructionPhases: ['DIRT Work', 'Rough In', 'Finish', 'Service Call'],
    
    // Scheduler (same as Bot 1 - every 5 mins)
    schedulerCron: process.env.BOT2_SCHEDULER_CRON || '*/5 * * * *',
    schedulerEnabled: process.env.BOT2_SCHEDULER_ENABLED !== 'false',
    
    // Reminder intervals (in milliseconds)
    reminders: {
      firstReminder: 24 * 60 * 60 * 1000,      // 1 day
      secondReminder: 7 * 24 * 60 * 60 * 1000,  // 7 days
      pastDueReminder: 15 * 24 * 60 * 60 * 1000, // 15 days
      followUpEmail: 16 * 24 * 60 * 60 * 1000    // 16 days
    },
    
    // New project response timeout
    newProjectTimeout: 60 * 60 * 1000,          // 1 hour
    newProjectFollowUpInterval: 6 * 60 * 60 * 1000, // 4x per day = every 6 hours
    
    // Snooze duration
    snoozeDuration: 24 * 60 * 60 * 1000,        // 24 hours
    
    // Invoice memo
    invoiceMemo: 'Thank you for choosing RLT Electrical!\nQuestions? Call us at (808) 866-6500 or reply to this email.'
  },

  // =============================================
  // BOT 3 - INVENTORY BOT (New)
  // =============================================

  inventory: {
    // Inventory Pull Log sheet configuration
    inventorySheetName: process.env.INVENTORY_SHEET_NAME || 'Inventory Pull Log',
    
    // Column mappings for Inventory Pull Log (0-indexed)
    inventoryColumns: {
      timestamp: 0,          // A - Timestamp (auto)
      jobName: 1,            // B - Job Name
      contractorName: 2,     // C - Contractor/Customer Name
      projectName: 3,        // D - Project Name
      pulledFrom: 4,         // E - Pulled From (Container/Truck/Both)
      rawDescription: 5,     // F - Raw Description
      parsedMaterials: 6,    // G - Parsed Materials (JSON)
      humanSummary: 7,       // H - Human Summary
      billed: 8,             // I - Billed? (Yes/No)
      invoiceNumber: 9       // J - Invoice #
    },
    
    // Pull locations
    pullLocations: {
      container: 'Container',
      truck: 'Truck',
      both: 'Container+Truck'
    },
    
    // Trigger phrases to start inventory flow
    triggerPhrases: ['inventory', 'inventory start', 'start', 'pull', 'pulling'],
    
    // Conversation timeout (30 minutes)
    conversationTimeout: 30 * 60 * 1000,
    
    // State file path
    statePath: './data/bot3-state.json'
  },

  // PDF Generation
  pdf: {
    outputDir: './generated-pdfs',
    companyName: 'RLT Electrical',
    companyPhone: '(808) 866-6500',
    companyEmail: 'rltsystemsllc@gmail.com'
  },

  // Google Drive (for storing screenshots, PDFs)
  drive: {
    folderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
    enabled: !!process.env.GOOGLE_DRIVE_FOLDER_ID
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'logs/app.log'
  }
};

/**
 * Validate required configuration for Bot 1
 */
function validateBot1Config() {
  const errors = [];

  if (!config.gmail.clientId) {
    errors.push('GMAIL_CLIENT_ID is required for Bot 1');
  }
  if (!config.gmail.clientSecret) {
    errors.push('GMAIL_CLIENT_SECRET is required for Bot 1');
  }
  if (!config.quickbooks.clientId) {
    errors.push('QBO_CLIENT_ID is required');
  }
  if (!config.quickbooks.clientSecret) {
    errors.push('QBO_CLIENT_SECRET is required');
  }

  return errors;
}

/**
 * Validate required configuration for Bot 2
 */
function validateBot2Config() {
  const errors = [];

  if (!config.sheets.spreadsheetId) {
    errors.push('GOOGLE_SHEET_ID is required for Bot 2');
  }
  if (!config.ringcentral.clientId) {
    errors.push('RINGCENTRAL_CLIENT_ID is required for Bot 2');
  }
  if (!config.ringcentral.clientSecret) {
    errors.push('RINGCENTRAL_CLIENT_SECRET is required for Bot 2');
  }
  if (!config.quickbooks.clientId) {
    errors.push('QBO_CLIENT_ID is required');
  }
  if (!config.quickbooks.clientSecret) {
    errors.push('QBO_CLIENT_SECRET is required');
  }

  return errors;
}

/**
 * Validate required configuration for Bot 3
 */
function validateBot3Config() {
  const errors = [];

  if (!config.sheets.spreadsheetId) {
    errors.push('GOOGLE_SHEET_ID is required for Bot 3');
  }
  if (!config.ringcentral.clientId) {
    errors.push('RINGCENTRAL_CLIENT_ID is required for Bot 3');
  }
  if (!config.ringcentral.clientSecret) {
    errors.push('RINGCENTRAL_CLIENT_SECRET is required for Bot 3');
  }
  if (!config.ringcentral.botPhoneNumber) {
    errors.push('RINGCENTRAL_BOT_PHONE is required for Bot 3');
  }

  return errors;
}

/**
 * Validate all configuration
 */
function validateConfig() {
  return [...validateBot1Config(), ...validateBot2Config(), ...validateBot3Config()];
}

config.validate = validateConfig;
config.validateBot1 = validateBot1Config;
config.validateBot2 = validateBot2Config;
config.validateBot3 = validateBot3Config;

module.exports = config;


