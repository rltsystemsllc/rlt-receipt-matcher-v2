/**
 * Bot 3 - Google Sheets Service for Inventory Bot
 * Manages the Inventory Pull Log sheet
 */

const { google } = require('googleapis');
const fs = require('fs').promises;
const config = require('../../config');
const logger = require('../../utils/logger');

// Reuse the sheets client from Bot 2
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
        logger.info('Bot 3 Sheets: Token loaded from environment variable');
      } catch {
        logger.warn('Bot 3 Sheets: Failed to parse SHEETS_TOKEN_JSON env var');
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
    logger.info('Bot 3 Sheets: Client initialized');
    
    return sheetsClient;
  } catch (error) {
    logger.warn('Bot 3 Sheets: Token not found, needs authorization', { error: error.message });
    return null;
  }
}

/**
 * Ensure the Inventory Pull Log sheet exists
 */
async function ensureInventorySheet() {
  await initialize();
  
  if (!sheetsClient) {
    throw new Error('Google Sheets not authenticated');
  }

  const spreadsheetId = config.sheets.spreadsheetId;
  const sheetName = config.inventory.inventorySheetName;

  try {
    // Get list of sheets
    const response = await sheetsClient.spreadsheets.get({
      spreadsheetId
    });

    const sheets = response.data.sheets || [];
    const exists = sheets.some(s => s.properties.title === sheetName);

    if (!exists) {
      // Create the sheet
      await sheetsClient.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: sheetName
              }
            }
          }]
        }
      });

      // Add headers
      const headers = [
        'Timestamp',
        'Job Name',
        'Contractor/Customer Name',
        'Project Name',
        'Pulled From',
        'Raw Description',
        'Parsed Materials (JSON)',
        'Human Summary',
        'Billed?',
        'Invoice #'
      ];

      await sheetsClient.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1:J1`,
        valueInputOption: 'RAW',
        resource: {
          values: [headers]
        }
      });

      // Format header row (bold, freeze)
      await sheetsClient.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: await getSheetId(sheetName),
                  startRowIndex: 0,
                  endRowIndex: 1
                },
                cell: {
                  userEnteredFormat: {
                    textFormat: { bold: true },
                    backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 }
                  }
                },
                fields: 'userEnteredFormat(textFormat,backgroundColor)'
              }
            },
            {
              updateSheetProperties: {
                properties: {
                  sheetId: await getSheetId(sheetName),
                  gridProperties: { frozenRowCount: 1 }
                },
                fields: 'gridProperties.frozenRowCount'
              }
            }
          ]
        }
      });

      logger.info('Bot 3 Sheets: Created Inventory Pull Log sheet with headers');
    }

    return true;
  } catch (error) {
    logger.error('Bot 3 Sheets: Failed to ensure inventory sheet', { error: error.message });
    throw error;
  }
}

/**
 * Get sheet ID by name
 */
async function getSheetId(sheetName) {
  const spreadsheetId = config.sheets.spreadsheetId;
  
  const response = await sheetsClient.spreadsheets.get({
    spreadsheetId
  });

  const sheet = response.data.sheets.find(s => s.properties.title === sheetName);
  return sheet ? sheet.properties.sheetId : null;
}

/**
 * Log an inventory pull to the sheet
 */
async function logInventoryPull(data) {
  await initialize();
  await ensureInventorySheet();

  const spreadsheetId = config.sheets.spreadsheetId;
  const sheetName = config.inventory.inventorySheetName;

  const row = [
    new Date().toISOString(),                    // A - Timestamp
    data.jobName || '',                          // B - Job Name
    data.contractorName || '',                   // C - Contractor/Customer Name
    data.projectName || '',                      // D - Project Name
    data.pulledFrom || '',                       // E - Pulled From
    data.rawDescription || '',                   // F - Raw Description
    JSON.stringify(data.parsedMaterials || []),  // G - Parsed Materials (JSON)
    data.humanSummary || '',                     // H - Human Summary
    'No',                                        // I - Billed?
    ''                                           // J - Invoice #
  ];

  try {
    const response = await sheetsClient.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:J`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: {
        values: [row]
      }
    });

    const updatedRange = response.data.updates.updatedRange;
    const rowNumber = parseInt(updatedRange.match(/\d+$/)[0]);

    logger.info('Bot 3 Sheets: Logged inventory pull', { 
      jobName: data.jobName, 
      row: rowNumber 
    });

    return { 
      success: true, 
      rowNumber,
      range: updatedRange
    };
  } catch (error) {
    logger.error('Bot 3 Sheets: Failed to log inventory pull', { error: error.message });
    throw error;
  }
}

/**
 * Get recent unique job names (for job selection)
 */
async function getRecentJobs(limit = 10) {
  await initialize();
  
  if (!sheetsClient) {
    return [];
  }

  const spreadsheetId = config.sheets.spreadsheetId;
  
  try {
    // Try inventory sheet first
    const inventorySheetName = config.inventory.inventorySheetName;
    let jobNames = new Set();

    try {
      const inventoryResponse = await sheetsClient.spreadsheets.values.get({
        spreadsheetId,
        range: `${inventorySheetName}!B:B`
      });

      const values = inventoryResponse.data.values || [];
      for (let i = values.length - 1; i >= 1 && jobNames.size < limit; i--) {
        const jobName = values[i][0];
        if (jobName && jobName.trim()) {
          jobNames.add(jobName.trim());
        }
      }
    } catch (e) {
      // Sheet might not exist yet
    }

    // Also check the daily job log (Form Responses sheet)
    try {
      const dailySheetName = config.sheets.sheetName;
      const dailyResponse = await sheetsClient.spreadsheets.values.get({
        spreadsheetId,
        range: `${dailySheetName}!E:E`  // Job Name column
      });

      const values = dailyResponse.data.values || [];
      for (let i = values.length - 1; i >= 1 && jobNames.size < limit; i--) {
        const jobName = values[i][0];
        if (jobName && jobName.trim() && jobName !== 'New Project – Add Name to Notes') {
          jobNames.add(jobName.trim());
        }
      }
    } catch (e) {
      // Sheet might not exist
    }

    return Array.from(jobNames).slice(0, limit);
  } catch (error) {
    logger.error('Bot 3 Sheets: Failed to get recent jobs', { error: error.message });
    return [];
  }
}

/**
 * Get unbilled inventory for a job (used by Bot 2)
 */
async function getUnbilledInventoryForJob(jobName) {
  await initialize();
  await ensureInventorySheet();

  const spreadsheetId = config.sheets.spreadsheetId;
  const sheetName = config.inventory.inventorySheetName;
  const cols = config.inventory.inventoryColumns;

  try {
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:J`
    });

    const rows = response.data.values || [];
    const unbilled = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowJobName = row[cols.jobName] || '';
      const billed = (row[cols.billed] || '').toLowerCase();

      if (rowJobName === jobName && billed !== 'yes') {
        unbilled.push({
          rowIndex: i + 1,
          timestamp: row[cols.timestamp],
          jobName: row[cols.jobName],
          contractorName: row[cols.contractorName],
          projectName: row[cols.projectName],
          pulledFrom: row[cols.pulledFrom],
          rawDescription: row[cols.rawDescription],
          parsedMaterials: parseJSON(row[cols.parsedMaterials]),
          humanSummary: row[cols.humanSummary],
          billed: row[cols.billed],
          invoiceNumber: row[cols.invoiceNumber]
        });
      }
    }

    logger.info('Bot 3 Sheets: Found unbilled inventory', { 
      jobName, 
      count: unbilled.length 
    });

    return unbilled;
  } catch (error) {
    logger.error('Bot 3 Sheets: Failed to get unbilled inventory', { error: error.message });
    throw error;
  }
}

/**
 * Mark inventory rows as billed
 */
async function markAsBilled(jobName, invoiceNumber) {
  await initialize();

  const spreadsheetId = config.sheets.spreadsheetId;
  const sheetName = config.inventory.inventorySheetName;
  const cols = config.inventory.inventoryColumns;

  try {
    // Get all rows
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:J`
    });

    const rows = response.data.values || [];
    const updates = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowJobName = row[cols.jobName] || '';
      const billed = (row[cols.billed] || '').toLowerCase();

      if (rowJobName === jobName && billed !== 'yes') {
        const rowNum = i + 1;
        updates.push({
          range: `${sheetName}!I${rowNum}:J${rowNum}`,  // Billed? and Invoice #
          values: [['Yes', invoiceNumber || '']]
        });
      }
    }

    if (updates.length > 0) {
      await sheetsClient.spreadsheets.values.batchUpdate({
        spreadsheetId,
        resource: {
          valueInputOption: 'RAW',
          data: updates
        }
      });

      logger.info('Bot 3 Sheets: Marked inventory as billed', { 
        jobName, 
        invoiceNumber, 
        rowsUpdated: updates.length 
      });
    }

    return { success: true, rowsUpdated: updates.length };
  } catch (error) {
    logger.error('Bot 3 Sheets: Failed to mark as billed', { error: error.message });
    throw error;
  }
}

/**
 * Append materials summary to Bobby's daily submission sheet
 * This updates the "material pulled from stock/truck" column
 */
async function appendToDailySheet(jobName, summary, pulledFrom) {
  await initialize();

  const spreadsheetId = config.sheets.spreadsheetId;
  const sheetName = config.sheets.sheetName;
  const cols = config.sheets.columns;

  try {
    // Get all rows to find the latest one for this job
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:N`
    });

    const rows = response.data.values || [];
    let targetRowIndex = -1;

    // Find the most recent row for this job that's not fully billed
    for (let i = rows.length - 1; i >= 1; i--) {
      const row = rows[i];
      const rowJobName = row[cols.jobName] || '';
      const billingStatus = row[cols.billingStatus] || '';

      if (rowJobName === jobName && billingStatus !== 'Paid') {
        targetRowIndex = i + 1; // 1-indexed
        break;
      }
    }

    if (targetRowIndex === -1) {
      logger.warn('Bot 3 Sheets: No matching row found in daily sheet', { jobName });
      return { success: false, reason: 'No matching row' };
    }

    // Get current value in the materialFromStock column
    const currentValue = rows[targetRowIndex - 1][cols.materialFromStock] || '';
    
    // Format the new entry
    const date = new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
    const newEntry = `${date} – Pulled: ${summary} (From ${pulledFrom})`;
    
    // Append to existing value
    const updatedValue = currentValue 
      ? `${currentValue}\n${newEntry}` 
      : newEntry;

    // Update the cell
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!K${targetRowIndex}`,  // Column K is materialFromStock
      valueInputOption: 'RAW',
      resource: {
        values: [[updatedValue]]
      }
    });

    logger.info('Bot 3 Sheets: Appended to daily sheet', { 
      jobName, 
      row: targetRowIndex 
    });

    return { success: true, rowIndex: targetRowIndex };
  } catch (error) {
    logger.error('Bot 3 Sheets: Failed to append to daily sheet', { error: error.message });
    // Don't throw - this is a secondary operation
    return { success: false, error: error.message };
  }
}

/**
 * Get all inventory pulls (for dashboard)
 */
async function getAllInventoryPulls() {
  await initialize();
  await ensureInventorySheet();

  const spreadsheetId = config.sheets.spreadsheetId;
  const sheetName = config.inventory.inventorySheetName;
  const cols = config.inventory.inventoryColumns;

  try {
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:J`
    });

    const rows = response.data.values || [];
    const pulls = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      pulls.push({
        rowIndex: i + 1,
        timestamp: row[cols.timestamp],
        jobName: row[cols.jobName],
        contractorName: row[cols.contractorName],
        projectName: row[cols.projectName],
        pulledFrom: row[cols.pulledFrom],
        rawDescription: row[cols.rawDescription],
        parsedMaterials: parseJSON(row[cols.parsedMaterials]),
        humanSummary: row[cols.humanSummary],
        billed: row[cols.billed] || 'No',
        invoiceNumber: row[cols.invoiceNumber] || ''
      });
    }

    return pulls;
  } catch (error) {
    logger.error('Bot 3 Sheets: Failed to get all inventory pulls', { error: error.message });
    throw error;
  }
}

/**
 * Safely parse JSON
 */
function parseJSON(str) {
  try {
    return JSON.parse(str || '[]');
  } catch {
    return [];
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

module.exports = {
  initialize,
  ensureInventorySheet,
  logInventoryPull,
  getRecentJobs,
  getUnbilledInventoryForJob,
  markAsBilled,
  appendToDailySheet,
  getAllInventoryPulls,
  isAuthenticated
};





