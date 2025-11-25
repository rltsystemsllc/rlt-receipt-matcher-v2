/**
 * RLT Receipt Matcher - Configuration
 * Centralized configuration loaded from environment variables
 */

require('dotenv').config();

const config = {
  // Server
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV !== 'production',

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

  // QuickBooks Online
  quickbooks: {
    clientId: process.env.QBO_CLIENT_ID,
    clientSecret: process.env.QBO_CLIENT_SECRET,
    redirectUri: process.env.QBO_REDIRECT_URI || 'http://localhost:3000/auth/quickbooks/callback',
    environment: process.env.QBO_ENVIRONMENT || 'sandbox',
    realmId: process.env.QBO_REALM_ID,
    tokenPath: './tokens/quickbooks-token.json',
    scopes: [
      'com.intuit.quickbooks.accounting'
    ]
  },

  // Scheduler
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

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'logs/app.log'
  }
};

/**
 * Validate required configuration
 */
function validateConfig() {
  const errors = [];

  if (!config.gmail.clientId) {
    errors.push('GMAIL_CLIENT_ID is required');
  }
  if (!config.gmail.clientSecret) {
    errors.push('GMAIL_CLIENT_SECRET is required');
  }
  if (!config.quickbooks.clientId) {
    errors.push('QBO_CLIENT_ID is required');
  }
  if (!config.quickbooks.clientSecret) {
    errors.push('QBO_CLIENT_SECRET is required');
  }

  return errors;
}

config.validate = validateConfig;

module.exports = config;


