/**
 * Daily Job Log access for the Billing Agent.
 *
 * Columns are found by HEADER NAME, not position, so adding/reordering form
 * questions can't make the agent write into the wrong column.
 *
 * The "Notes to Bookkeeper" column is never read. It cannot reach the AI or an invoice.
 */

const sheetsAuth = require('../bot2/sheets');
const cfg = require('./config');
const config = require('../config');
const logger = require('../utils/logger');

// header matcher -> field name. First match wins. Order matters (more specific first).
const HEADER_RULES = [
  ['timestamp', /^timestamp$/i],
  ['date', /^date$/i],
  ['billingStatus', /billing status/i],
  ['customer', /contractor|customer name/i],
  ['project', /project name/i],
  ['jobName', /^job name/i],
  ['phase', /phase/i],
  ['kennyHours', /kenny/i],
  ['hours', /hours worked/i],
  ['description', /description of work/i],
  ['materialBought', /material bought/i],
  ['receiptPhoto', /receipt photo/i],
  ['stockMaterials', /stock|truck/i],
  ['urgent', /urgent/i],
  ['emergency', /emergency/i],
  ['invoiceNumber', /invoice\s*#|invoice number/i]
  // Deliberately absent: "Notes to Bookkeeper"
];

const EMPTY_WORDS = /^(none|no|n\/a|na|nothing|-|—)\.?$/i;
const DONE_STATUS = /billed|draft|approved|sent|paid|void|drafting|review|fix/i;

function mapHeaders(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    const text = String(h || '').trim();
    for (const [field, re] of HEADER_RULES) {
      if (map[field] === undefined && re.test(text)) {
        map[field] = i;
        break;
      }
    }
  });
  return map;
}

function clean(v) {
  const s = String(v ?? '').trim();
  return EMPTY_WORDS.test(s) ? '' : s;
}

function yes(v) {
  return /^y(es)?$/i.test(String(v ?? '').trim());
}

function parseHours(v) {
  const s = String(v ?? '').trim();
  if (!s) return 0;
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  return isNaN(n) ? NaN : n;
}

function colLetter(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Pure: turn raw sheet values into job rows. Exported for tests.
 */
function parseRows(values) {
  if (!values || values.length < 2) return { headerMap: {}, rows: [] };
  const headerMap = mapHeaders(values[0]);
  const get = (r, f) => (headerMap[f] === undefined ? '' : r[headerMap[f]]);

  const rows = values.slice(1).map((r, i) => {
    const customer = clean(get(r, 'customer'));
    const jobName = clean(get(r, 'jobName'));
    const project = clean(get(r, 'project'));
    return {
      rowNumber: i + 2, // 1-based sheet row
      timestamp: String(get(r, 'timestamp') || ''),
      date: String(get(r, 'date') || get(r, 'timestamp') || '').split(' ')[0],
      billingStatus: String(get(r, 'billingStatus') || '').trim(),
      customerName: customer || jobName,
      projectName: project,
      phase: clean(get(r, 'phase')),
      hours: parseHours(get(r, 'hours')),
      kennyHours: parseHours(get(r, 'kennyHours')),
      description: clean(get(r, 'description')),
      materialBought: clean(get(r, 'materialBought')),
      hasReceiptPhoto: !!String(get(r, 'receiptPhoto') || '').trim(),
      stockMaterials: clean(get(r, 'stockMaterials')),
      urgent: yes(get(r, 'urgent')),
      emergency: yes(get(r, 'emergency')),
      invoiceNumber: String(get(r, 'invoiceNumber') || '').trim()
    };
  });

  return { headerMap, rows };
}

function isUnbilled(row) {
  if (row.invoiceNumber) return false;
  if (!row.timestamp) return false;
  const s = row.billingStatus;
  if (!s || /^not billed$/i.test(s)) return true;
  return !DONE_STATUS.test(s);
}

async function client() {
  const c = await sheetsAuth.initialize();
  if (!c) throw new Error('Google Sheets not authenticated');
  return c;
}

async function readJobLog() {
  const sheets = await client();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.sheetId,
    range: `'${cfg.sheet.responsesTab}'`
  });
  const parsed = parseRows(res.data.values || []);
  for (const required of ['timestamp', 'billingStatus', 'invoiceNumber', 'hours']) {
    if (parsed.headerMap[required] === undefined) {
      throw new Error(`Job log is missing a "${required}" column`);
    }
  }
  return parsed;
}

/**
 * Write status (and optionally invoice #) to specific rows.
 */
async function markRows(headerMap, rowNumbers, status, invoiceNumber) {
  const sheets = await client();
  const data = [];
  for (const rn of rowNumbers) {
    data.push({ range: `'${cfg.sheet.responsesTab}'!${colLetter(headerMap.billingStatus)}${rn}`, values: [[status]] });
    if (invoiceNumber !== undefined) {
      data.push({ range: `'${cfg.sheet.responsesTab}'!${colLetter(headerMap.invoiceNumber)}${rn}`, values: [[invoiceNumber]] });
    }
  }
  if (!data.length) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: config.sheets.sheetId,
    requestBody: { valueInputOption: 'RAW', data }
  });
}

async function ensureTab(title, headers) {
  const sheets = await client();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: config.sheets.sheetId, fields: 'sheets.properties.title' });
  const exists = meta.data.sheets.some(s => s.properties.title === title);
  if (exists) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.sheets.sheetId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] }
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.sheets.sheetId,
    range: `'${title}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [headers] }
  });
}

const LOG_HEADERS = [
  'Run At', 'Mode', 'Customer (sheet)', 'QBO Customer', 'Sheet Rows', 'Bobby Hrs', 'Kenny Hrs',
  'Labor $', 'Materials $', 'Total $', 'Invoice #', 'Result', 'Flags', 'Expense Keys Billed'
];

async function appendLog(entries) {
  if (!entries.length) return;
  await ensureTab(cfg.sheet.logTab, LOG_HEADERS);
  const sheets = await client();
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.sheets.sheetId,
    range: `'${cfg.sheet.logTab}'!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: entries }
  });
}

/**
 * Expense keys (purchaseId:lineId) already put on an invoice by this agent.
 * Prevents the same receipt being billed twice.
 */
async function readBilledExpenseKeys() {
  const sheets = await client();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: config.sheets.sheetId,
      range: `'${cfg.sheet.logTab}'!K:N`
    });
    const keys = new Set();
    for (const r of (res.data.values || []).slice(1)) {
      const result = r[1] || '';
      if (!/draft created/i.test(result)) continue;
      String(r[3] || '').split(',').map(s => s.trim()).filter(Boolean).forEach(k => keys.add(k));
    }
    return keys;
  } catch {
    return new Set(); // tab doesn't exist yet
  }
}

/**
 * Optional manual mapping tab: "Sheet Name" | "QBO Customer ID".
 * Wins over every automatic match.
 */
async function readCustomerMap() {
  const sheets = await client();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: config.sheets.sheetId,
      range: `'${cfg.sheet.customerMapTab}'!A:B`
    });
    const map = new Map();
    for (const r of (res.data.values || []).slice(1)) {
      if (r[0] && r[1]) map.set(normalize(r[0]), String(r[1]).trim());
    }
    return map;
  } catch {
    return new Map();
  }
}

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

module.exports = {
  parseRows,
  isUnbilled,
  colLetter,
  normalize,
  readJobLog,
  markRows,
  appendLog,
  readBilledExpenseKeys,
  readCustomerMap
};
