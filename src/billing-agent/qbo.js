/**
 * QuickBooks access for the Billing Agent.
 *
 * The agent can ONLY do what's on the allowlist below: read, create an invoice, fetch its PDF.
 * There is no send, email, delete, void, or customer-create path in this file.
 */

const qboClient = require('../services/quickbooks/client');
const cfg = require('./config');
const logger = require('../utils/logger');

const ALLOWED = [
  ['GET', /^\/companyinfo\/\d+$/],
  ['GET', /^\/query\?/],
  ['POST', /^\/invoice\?minorversion=\d+$/],
  ['GET', /^\/invoice\/\d+\/pdf$/]
];

function assertAllowed(method, path) {
  if (!ALLOWED.some(([m, re]) => m === method && re.test(path))) {
    throw new Error(`Billing Agent blocked QBO call: ${method} ${path}`);
  }
}

async function call(method, path, body) {
  assertAllowed(method, path);
  return qboClient.makeApiCall(method, path, body);
}

async function query(sql) {
  const res = await call('GET', `/query?query=${encodeURIComponent(sql)}`);
  return res.QueryResponse || {};
}

async function connect() {
  const ok = await qboClient.authenticate();
  if (!ok) throw new Error('QuickBooks not authenticated');
}

/**
 * Refuse to run against the wrong company file.
 */
async function verifyCompany() {
  const realm = qboClient.getCompanyId ? qboClient.getCompanyId() : qboClient.companyId;
  const res = await call('GET', `/companyinfo/${realm}`);
  const name = res.CompanyInfo?.CompanyName || '';
  if (!name.toLowerCase().includes(cfg.requiredCompanyName.toLowerCase())) {
    throw new Error(`Connected QBO company is "${name}", expected one containing "${cfg.requiredCompanyName}". Refusing to bill.`);
  }
  return name;
}

async function listCustomers() {
  const out = [];
  let start = 1;
  for (;;) {
    const r = await query(`SELECT * FROM Customer WHERE Active = true STARTPOSITION ${start} MAXRESULTS 1000`);
    const batch = r.Customer || [];
    out.push(...batch.map(c => ({
      id: c.Id,
      name: c.FullyQualifiedName || c.DisplayName,
      displayName: c.DisplayName,
      isProject: !!c.Job || !!c.IsProject
    })));
    if (batch.length < 1000) break;
    start += 1000;
  }
  return out;
}

async function findItemId(name) {
  if (!name) return null;
  const safe = name.replace(/'/g, "\\'");
  const r = await query(`SELECT Id, Name FROM Item WHERE Name = '${safe}'`);
  return r.Item?.[0]?.Id || null;
}

/**
 * Billable expense lines assigned to this customer that the agent hasn't billed yet.
 */
async function getBillableExpenses(customerId, sinceDate, alreadyBilled) {
  const r = await query(`SELECT * FROM Purchase WHERE TxnDate >= '${sinceDate}' MAXRESULTS 1000`);
  const out = [];
  for (const p of r.Purchase || []) {
    for (const line of p.Line || []) {
      const d = line.AccountBasedExpenseLineDetail || line.ItemBasedExpenseLineDetail;
      if (!d || d.CustomerRef?.value !== customerId || d.BillableStatus !== 'Billable') continue;
      const key = `${p.Id}:${line.Id}`;
      if (alreadyBilled.has(key)) continue;
      out.push({
        key,
        vendor: p.EntityRef?.name || 'Supplier',
        date: p.TxnDate,
        amount: line.Amount,
        description: line.Description || ''
      });
    }
  }
  return out;
}

// Rule (Jessica, lessons l18): billable receipt charges are TAXABLE (Hawaii GET).
// Every materials line, and every line of a linked ReimburseCharge (cost line AND
// markup line), must carry TaxCodeRef "TAX". QuickBooks stores charges as "NON"
// (e.g. ReimburseCharge 3212), so the agent sets TAX itself and blocks if it's missing.
const TAXABLE = 'TAX';
const MATERIAL_KINDS = new Set(['materials', 'materials_pending']);

/** Invoice Line[] for QBO from the agent's priced lines. Pure, so it can be tested. */
function buildInvoiceLines(lines, { laborItemId, materialsItemId } = {}) {
  return lines.map((l, i) => {
    const itemId = l.kind === 'labor' ? laborItemId : materialsItemId;
    const detail = { Qty: l.qty, UnitPrice: l.rate };
    if (itemId) detail.ItemRef = { value: itemId };
    const iso = toIsoDate(l.date);
    if (iso) detail.ServiceDate = iso;
    if (MATERIAL_KINDS.has(l.kind)) detail.TaxCodeRef = { value: TAXABLE };
    return {
      LineNum: i + 1,
      Description: l.description.slice(0, 4000),
      Amount: l.amount,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: detail
    };
  });
}

/** True if this QBO invoice line comes from a billable charge (ReimburseCharge). */
function isBillableChargeLine(line) {
  return line.DetailType === 'ReimburseLineDetail' ||
    (line.LinkedTxn || []).some(t => t.TxnType === 'ReimburseCharge');
}

/**
 * Blocks a draft if any billable-charge or materials line isn't taxable.
 * @param Line      QBO invoice lines
 * @param agentLines optional agent lines (same order) so materials lines can be identified
 * @returns list of problems (empty = OK)
 */
function untaxedBillableLines(Line, agentLines = []) {
  const problems = [];
  Line.forEach((line, i) => {
    const mustTax = isBillableChargeLine(line) || MATERIAL_KINDS.has(agentLines[i]?.kind);
    if (!mustTax) return;
    const detail = line.SalesItemLineDetail || line.ReimburseLineDetail || {};
    const code = detail.TaxCodeRef?.value;
    if (code !== TAXABLE) {
      problems.push(`Line ${line.LineNum ?? i + 1} ("${(line.Description || '').slice(0, 60)}") is ${code || 'missing a tax code'}, must be TAX`);
    }
  });
  return problems;
}

/**
 * Create a DRAFT invoice. EmailStatus NotSet = QBO will not email it.
 */
async function createDraftInvoice({ customerId, lines, laborItemId, materialsItemId, memo }) {
  const Line = buildInvoiceLines(lines, { laborItemId, materialsItemId });
  const untaxed = untaxedBillableLines(Line, lines);
  if (untaxed.length) throw new Error(`Billing Agent blocked draft: billable charges must be taxable. ${untaxed.join('; ')}`);

  const res = await call('POST', '/invoice?minorversion=73', {
    CustomerRef: { value: customerId },
    Line,
    EmailStatus: 'NotSet',
    PrivateNote: memo
  });
  const inv = res.Invoice;
  logger.info('Billing Agent: draft invoice created', { id: inv.Id, doc: inv.DocNumber, total: inv.TotalAmt });
  return { id: inv.Id, docNumber: inv.DocNumber || inv.Id, total: inv.TotalAmt };
}

/**
 * Invoice PDF as a Buffer. makeApiCall only speaks JSON, so this fetch is done here.
 */
async function getInvoicePdf(invoiceId) {
  const path = `/invoice/${invoiceId}/pdf`;
  assertAllowed('GET', path);
  if (!qboClient.oauthClient.isAccessTokenValid()) await qboClient.refreshToken();
  const url = `${qboClient.baseUrl}/${qboClient.companyId}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${qboClient.oauthClient.getToken().access_token}`,
      Accept: 'application/pdf'
    }
  });
  if (!res.ok) throw new Error(`QBO PDF fetch failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function toIsoDate(s) {
  const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

module.exports = {
  assertAllowed,
  connect,
  verifyCompany,
  listCustomers,
  findItemId,
  getBillableExpenses,
  createDraftInvoice,
  buildInvoiceLines,
  isBillableChargeLine,
  untaxedBillableLines,
  getInvoicePdf,
  toIsoDate
};
