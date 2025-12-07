/**
 * Google Sheets Service for Bot 2
 * Reads Daily Job Log and manages billing status
 */

const { google } = require('googleapis');
const fs = require('fs').promises;
const config = require('../../config');
const logger = require('../../utils/logger');

let sheetsClient = null;
let authClient = null;

/**
 * Initialize Google Sheets client
 */
async function initialize() {
  if (sheetsClient) return sheetsClient;

  try {
    // Try to load existing token
    let tokens;
    // Check both possible env var names for compatibility
    const envVarValue = process.env.SHEETS_TOKENS || process.env.SHEETS_TOKEN_JSON;
    if (envVarValue) {
      try {
        tokens = JSON.parse(envVarValue);
        logger.info('Sheets token loaded from environment variable');
      } catch {
        logger.warn('Failed to parse sheets token env var');
      }
    }

    if (!tokens) {
      try {
        const tokenData = await fs.readFile(config.sheets.tokenPath, 'utf8');
        tokens = JSON.parse(tokenData);
        logger.info('Sheets token loaded from file');
      } catch {
        logger.warn('No sheets token file found');
      }
    }

    if (!tokens) {
      logger.warn('Google Sheets not authenticated');
      return null;
    }

    // Create OAuth2 client
    authClient = new google.auth.OAuth2(
      config.sheets.clientId,
      config.sheets.clientSecret,
      config.sheets.redirectUri
    );
    authClient.setCredentials(tokens);

    // Set up token refresh
    authClient.on('tokens', async (newTokens) => {
      const merged = { ...tokens, ...newTokens };
      if (!process.env.RAILWAY_ENVIRONMENT_NAME) {
        await fs.writeFile(config.sheets.tokenPath, JSON.stringify(merged, null, 2));
      }
      logger.info('Sheets token refreshed');
    });

    sheetsClient = google.sheets({ version: 'v4', auth: authClient });
    logger.info('Google Sheets client initialized');
    return sheetsClient;

  } catch (error) {
    logger.error('Failed to initialize Sheets client', { error: error.message });
    return null;
  }
}

/**
 * Check if authenticated
 */
async function isAuthenticated() {
  const client = await initialize();
  return client !== null;
}

/**
 * Get all rows from Daily Job Log
 */
async function getAllRows() {
  await initialize();
  if (!sheetsClient) throw new Error('Sheets not authenticated');

  const response = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: config.sheets.sheetId,
    range: `${config.sheets.sheetName}!A:M`
  });

  const rows = response.data.values || [];
  if (rows.length <= 1) return []; // Only header row

  // Parse rows (skip header)
  return rows.slice(1).map((row, index) => parseRow(row, index + 2));
}

/**
 * Get rows with "Urgent Billing = YES" and not yet billed
 */
async function getUrgentBillingRows() {
  const allRows = await getAllRows();
  const cols = config.billing.columns;
  const statuses = config.billing.statuses;

  return allRows.filter(row => {
    const isUrgent = (row.urgentBilling || '').toUpperCase() === 'YES';
    const status = row.billingStatus || '';
    const isNotBilled = !status || status === statuses.notBilled;
    return isUrgent && isNotBilled;
  });
}

/**
 * Get all unbilled rows for a specific job
 */
async function getAllUnbilledRowsForJob(jobName) {
  const allRows = await getAllRows();
  const statuses = config.billing.statuses;

  return allRows.filter(row => {
    const rowJobName = row.jobName || `${row.contractorName} - ${row.projectName}`;
    const matchesJob = rowJobName.toLowerCase().includes(jobName.toLowerCase()) ||
                       jobName.toLowerCase().includes(rowJobName.toLowerCase());
    const status = row.billingStatus || '';
    const isNotBilled = !status || status === statuses.notBilled;
    return matchesJob && isNotBilled;
  });
}

/**
 * Parse a single row into structured data
 */
function parseRow(row, rowIndex) {
  const cols = config.billing.columns;
  
  // Parse hours (handle various formats)
  let hours = 0;
  const hoursRaw = row[cols.hoursWorked] || '';
  if (hoursRaw) {
    const parsed = parseFloat(hoursRaw.toString().replace(/[^0-9.]/g, ''));
    if (!isNaN(parsed)) hours = parsed;
  }

  // Parse date
  let dateWorked = null;
  const dateRaw = row[cols.dateWorked] || '';
  if (dateRaw) {
    dateWorked = new Date(dateRaw);
    if (isNaN(dateWorked.getTime())) dateWorked = null;
  }

  // Determine if emergency rate based on explicit column or auto-detect
  let isEmergencyRate = (row[cols.emergencyRate] || '').toUpperCase() === 'YES';
  
  // Auto-detect weekend if enabled and not explicitly set
  if (!isEmergencyRate && config.safeguards.autoDetectEmergencyRate && dateWorked) {
    const dayOfWeek = dateWorked.getDay();
    isEmergencyRate = config.safeguards.emergencyRateDays.includes(dayOfWeek);
  }

  return {
    rowIndex,
    timestamp: row[cols.timestamp] || '',
    contractorName: row[cols.contractorName] || '',
    projectName: row[cols.projectName] || '',
    jobName: `${row[cols.contractorName] || ''} - ${row[cols.projectName] || ''}`.trim(),
    dateWorked,
    dateWorkedRaw: dateRaw,
    hoursWorked: hours,
    phase: row[cols.phase] || '',
    description: row[cols.description] || '',
    stockMaterials: row[cols.stockMaterials] || '',
    purchasedMaterials: row[cols.purchasedMaterials] || '',
    urgentBilling: row[cols.urgentBilling] || '',
    emergencyRate: isEmergencyRate,
    notesToBookkeeper: row[cols.notesToBookkeeper] || '',
    billingStatus: row[cols.billingStatus] || ''
  };
}

/**
 * Update billing status for specific rows
 */
async function updateBillingStatus(rowIndices, status) {
  await initialize();
  if (!sheetsClient) throw new Error('Sheets not authenticated');

  const cols = config.billing.columns;
  const statusColumn = String.fromCharCode('A'.charCodeAt(0) + cols.billingStatus);

  const requests = rowIndices.map(rowIndex => ({
    range: `${config.sheets.sheetName}!${statusColumn}${rowIndex}`,
    values: [[status]]
  }));

  await sheetsClient.spreadsheets.values.batchUpdate({
    spreadsheetId: config.sheets.sheetId,
    resource: {
      valueInputOption: 'RAW',
      data: requests
    }
  });

  logger.info('Updated billing status', { rowIndices, status });
}

/**
 * Get recent unique job names (for suggestions)
 */
async function getRecentJobs(limit = 10) {
  const allRows = await getAllRows();
  
  // Get unique job names, most recent first
  const jobNames = new Set();
  const jobs = [];
  
  for (let i = allRows.length - 1; i >= 0 && jobs.length < limit; i--) {
    const row = allRows[i];
    const jobName = row.jobName || `${row.contractorName} - ${row.projectName}`;
    if (jobName && !jobNames.has(jobName.toLowerCase())) {
      jobNames.add(jobName.toLowerCase());
      jobs.push(jobName);
    }
  }

  return jobs;
}

/**
 * Get job history for calculating averages
 */
async function getJobHistory(jobName) {
  const allRows = await getAllRows();
  const statuses = config.billing.statuses;

  // Find all rows for this job (including billed ones)
  const jobRows = allRows.filter(row => {
    const rowJobName = row.jobName || `${row.contractorName} - ${row.projectName}`;
    return rowJobName.toLowerCase().includes(jobName.toLowerCase());
  });

  return {
    totalRows: jobRows.length,
    totalHours: jobRows.reduce((sum, r) => sum + r.hoursWorked, 0),
    billedRows: jobRows.filter(r => r.billingStatus === statuses.sent || r.billingStatus === statuses.paid).length
  };
}

/**
 * Get customer average invoice amount (for sanity checks)
 */
async function getCustomerAverageInvoice(customerName) {
  // This would ideally query QBO for historical invoices
  // For now, return a default that won't trigger warnings
  return {
    averageAmount: 2000,
    invoiceCount: 0
  };
}

module.exports = {
  initialize,
  isAuthenticated,
  getAllRows,
  getUrgentBillingRows,
  getAllUnbilledRowsForJob,
  updateBillingStatus,
  getRecentJobs,
  getJobHistory,
  getCustomerAverageInvoice
};
