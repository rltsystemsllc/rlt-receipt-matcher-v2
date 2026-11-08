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

/**
 * Create a DRAFT invoice. EmailStatus NotSet = QBO will not email it.
 */
async function createDraftInvoice({ customerId, lines, laborItemId, materialsItemId, memo }) {
  const Line = lines.map((l, i) => {
    const itemId = l.kind === 'labor' ? laborItemId : materialsItemId;
    const detail = { Qty: l.qty, UnitPrice: l.rate };
    if (itemId) detail.ItemRef = { value: itemId };
    const iso = toIsoDate(l.date);
    if (iso) detail.ServiceDate = iso;
    return {
      LineNum: i + 1,
      Description: l.description.slice(0, 4000),
      Amount: l.amount,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: detail
    };
  });

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
  getInvoicePdf,
  toIsoDate
};
