/**
 * Google Sheets Service for Bot 2
 * Reads from the Daily Job Log and updates billing status
 */

const { google } = require('googleapis');
const fs = require('fs').promises;
const config = require('../../config');
const logger = require('../../utils/logger');

let sheetsClient = null;
let auth = null;

/**
 * Initialize Google Sheets client
 */
async function initialize() {
  if (sheetsClient) return sheetsClient;

  try {
    // Try to load token from env var (Railway) or file (local)
    let tokens;
    if (process.env.SHEETS_TOKEN_JSON) {
      try {
        tokens = JSON.parse(process.env.SHEETS_TOKEN_JSON);
        logger.info('Sheets token loaded from environment variable');
      } catch {
        logger.warn('Failed to parse SHEETS_TOKEN_JSON env var');
      }
    }
    
    if (!tokens) {
      const tokenData = await fs.readFile(config.sheets.tokenPath, 'utf8');
      tokens = JSON.parse(tokenData);
    }

    const oauth2Client = new google.auth.OAuth2(
      config.gmail.clientId,  // Reuse Gmail OAuth credentials
      config.gmail.clientSecret,
      config.gmail.redirectUri
    );

    oauth2Client.setCredentials(tokens);
    auth = oauth2Client;
    
    sheetsClient = google.sheets({ version: 'v4', auth: oauth2Client });
    logger.info('Google Sheets client initialized');
    
    return sheetsClient;
  } catch (error) {
    logger.warn('Sheets token not found, needs authorization', { error: error.message });
    return null;
  }
}

/**
 * Get all rows with "Urgent Billing Needed = YES" and "Not Billed"
 */
async function getUrgentBillingRows() {
  await initialize();
  
  if (!sheetsClient) {
    throw new Error('Google Sheets not authenticated');
  }

  const spreadsheetId = config.sheets.spreadsheetId;
  const sheetName = config.sheets.sheetName;
  const cols = config.sheets.columns;

  try {
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:N`
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) {
      return []; // Only header row or empty
    }

    const urgentRows = [];
    
    // Skip header row (index 0)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const urgentBilling = (row[cols.urgentBilling] || '').toUpperCase();
      const billingStatus = row[cols.billingStatus] || '';

      // Check if urgent AND not yet billed
      if (urgentBilling === 'YES' && 
          (billingStatus === '' || billingStatus === config.sheets.billingStatuses.notBilled)) {
        
        urgentRows.push(parseRow(row, i + 1)); // +1 for 1-indexed sheet rows
      }
    }

    logger.info('Found urgent billing rows', { count: urgentRows.length });
    return urgentRows;

  } catch (error) {
    logger.error('Failed to get urgent billing rows', { error: error.message });
    throw error;
  }
}

/**
 * Get all unbilled rows for a specific job
 */
async function getAllUnbilledRowsForJob(jobName) {
  await initialize();

  const spreadsheetId = config.sheets.spreadsheetId;
  const sheetName = config.sheets.sheetName;
  const cols = config.sheets.columns;

  try {
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:N`
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) return [];

    const jobRows = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowJobName = row[cols.jobName] || '';
      const billingStatus = row[cols.billingStatus] || '';

      // Match job name and check not already billed
      if (rowJobName === jobName && 
          (billingStatus === '' || 
           billingStatus === config.sheets.billingStatuses.notBilled)) {
        jobRows.push(parseRow(row, i + 1));
      }
    }

    logger.info(`Found unbilled rows for job ${jobName}`, { count: jobRows.length });
    return jobRows;

  } catch (error) {
    logger.error('Failed to get unbilled rows for job', { error: error.message, jobName });
    throw error;
  }
}

/**
 * Parse a sheet row into a structured object
 */
function parseRow(row, rowIndex) {
  const cols = config.sheets.columns;
  
  return {
    rowIndex,
    timestamp: row[cols.timestamp] || '',
    date: row[cols.date] || '',
    contractorName: row[cols.contractorName] || '',
    projectName: row[cols.projectName] || '',
    jobName: row[cols.jobName] || '',
    constructionPhase: row[cols.constructionPhase] || '',
    hoursWorked: parseFloat(row[cols.hoursWorked]) || 0,
    descriptionOfWork: row[cols.descriptionOfWork] || '',
    materialBought: row[cols.materialBought] || '',
    receiptPhoto: row[cols.receiptPhoto] || '',
    materialFromStock: row[cols.materialFromStock] || '',
    urgentBilling: row[cols.urgentBilling] || '',
    notesToBookkeeper: row[cols.notesToBookkeeper] || '',
    billingStatus: row[cols.billingStatus] || ''
  };
}

/**
 * Update billing status for multiple rows
 */
async function updateBillingStatus(rowIndices, newStatus) {
  await initialize();

  const spreadsheetId = config.sheets.spreadsheetId;
  const sheetName = config.sheets.sheetName;
  const statusColumn = 'N'; // Column N is Billing Status

  try {
    const requests = rowIndices.map(rowIndex => ({
      range: `${sheetName}!${statusColumn}${rowIndex}`,
      values: [[newStatus]]
    }));

    await sheetsClient.spreadsheets.values.batchUpdate({
      spreadsheetId,
      resource: {
        valueInputOption: 'RAW',
        data: requests
      }
    });

    logger.info('Updated billing status', { rows: rowIndices.length, status: newStatus });
  } catch (error) {
    logger.error('Failed to update billing status', { error: error.message });
    throw error;
  }
}

/**
 * Update billing status for all rows linked to an invoice
 */
async function updateBillingStatusByInvoice(invoiceId, newStatus) {
  // This would query our local database or storage to find rows linked to this invoice
  // For now, we'll store this mapping when we create the invoice
  logger.info('Updating billing status by invoice', { invoiceId, newStatus });
  // Implementation depends on how we track invoice-to-row mapping
}

/**
 * Get unique job names from the sheet
 */
async function getUniqueJobNames() {
  await initialize();

  const spreadsheetId = config.sheets.spreadsheetId;
  const sheetName = config.sheets.sheetName;
  const cols = config.sheets.columns;

  try {
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!E:E` // Job Name column
    });

    const values = response.data.values || [];
    const jobNames = new Set();

    // Skip header
    for (let i = 1; i < values.length; i++) {
      const jobName = values[i][0];
      if (jobName && jobName !== 'New Project – Add Name to Notes') {
        jobNames.add(jobName);
      }
    }

    return Array.from(jobNames).sort();
  } catch (error) {
    logger.error('Failed to get unique job names', { error: error.message });
    throw error;
  }
}

/**
 * Get all rows (for dashboard display)
 */
async function getAllRows() {
  await initialize();

  const spreadsheetId = config.sheets.spreadsheetId;
  const sheetName = config.sheets.sheetName;

  try {
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:N`
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) return [];

    return rows.slice(1).map((row, i) => parseRow(row, i + 2));
  } catch (error) {
    logger.error('Failed to get all rows', { error: error.message });
    throw error;
  }
}

/**
 * Check if client is authenticated
 */
async function isAuthenticated() {
  try {
    await initialize();
    return sheetsClient !== null;
  } catch {
    return false;
  }
}

/**
 * Get OAuth URL for authentication
 */
function getAuthUrl() {
  const oauth2Client = new google.auth.OAuth2(
    config.gmail.clientId,
    config.gmail.clientSecret,
    config.gmail.redirectUri  // Use same redirect URI as Gmail (registered in Google Cloud)
  );

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: config.sheets.scopes,
    prompt: 'consent',
    state: 'sheets'  // Add state to identify this is for sheets
  });
}

/**
 * Handle OAuth callback
 */
async function handleCallback(code) {
  const oauth2Client = new google.auth.OAuth2(
    config.gmail.clientId,
    config.gmail.clientSecret,
    config.gmail.redirectUri  // Use same redirect URI as Gmail
  );

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // Save tokens
  await fs.writeFile(config.sheets.tokenPath, JSON.stringify(tokens, null, 2));
  
  auth = oauth2Client;
  sheetsClient = google.sheets({ version: 'v4', auth: oauth2Client });

  logger.info('Google Sheets authenticated successfully');
  return tokens;
}

module.exports = {
  initialize,
  getUrgentBillingRows,
  getAllUnbilledRowsForJob,
  updateBillingStatus,
  updateBillingStatusByInvoice,
  getUniqueJobNames,
  getAllRows,
  isAuthenticated,
  getAuthUrl,
  handleCallback
};



