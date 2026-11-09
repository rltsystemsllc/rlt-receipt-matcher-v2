#!/usr/bin/env node
/**
 * Step 1 of the custom QuickBooks tool: READ-ONLY.
 *
 * Shows the billable card charges waiting for an invoice's customer, the same
 * list QuickBooks shows under Manage → Suggestions → Suggested transactions.
 * This step only reads; it never adds anything to the invoice. Adding the charge
 * gets built once we've seen the real shape of these records on a live invoice.
 *
 *   node scripts/qbo-billable-charges.js 5018
 *
 * Needs these environment variables (set in the cloud environment, never in code):
 *   QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REFRESH_TOKEN, QBO_REALM_ID
 * Network must allow oauth.platform.intuit.com and quickbooks.api.intuit.com.
 */

const REQUIRED_COMPANY = process.env.BILLING_AGENT_QBO_COMPANY || 'RLT';
const API = 'https://quickbooks.api.intuit.com/v3/company';
const MINOR = 75;

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

async function accessToken() {
  const basic = Buffer.from(`${need('QBO_CLIENT_ID')}:${need('QBO_CLIENT_SECRET')}`).toString('base64');
  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: need('QBO_REFRESH_TOKEN') })
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Intuit token refresh failed: ${res.status} ${j.error || ''}`);
  if (j.refresh_token && j.refresh_token !== process.env.QBO_REFRESH_TOKEN) {
    console.warn('Note: Intuit issued a new refresh token. Update QBO_REFRESH_TOKEN in the environment settings within 24 hours (value not printed).');
  }
  return j.access_token;
}

async function get(token, path) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${API}/${need('QBO_REALM_ID')}${path}${sep}minorversion=${MINOR}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`QBO ${path} → ${res.status} (intuit_tid ${res.headers.get('intuit_tid') || 'n/a'}): ${JSON.stringify(j.Fault || j).slice(0, 300)}`);
  return j;
}

const q = (token, sql) => get(token, `/query?query=${encodeURIComponent(sql)}`).then(r => r.QueryResponse || {});

async function main() {
  const doc = process.argv[2];
  if (!doc) throw new Error('Usage: node scripts/qbo-billable-charges.js <invoice number>');
  const token = await accessToken();

  const realm = need('QBO_REALM_ID');
  const company = (await get(token, `/companyinfo/${realm}`)).CompanyInfo?.CompanyName || '';
  if (!company.toLowerCase().includes(REQUIRED_COMPANY.toLowerCase())) {
    throw new Error(`Connected to "${company}", not ${REQUIRED_COMPANY}. Stopping.`);
  }

  const inv = (await q(token, `SELECT * FROM Invoice WHERE DocNumber = '${doc.replace(/'/g, '')}'`)).Invoice?.[0];
  if (!inv) throw new Error(`Invoice ${doc} not found`);
  const cust = inv.CustomerRef;
  console.log(`${company} · invoice #${doc} · ${cust.name} (${cust.value}) · total ${inv.TotalAmt}`);

  // Billable charges QuickBooks offers under Suggested transactions.
  let charges = [];
  try {
    charges = (await q(token, `SELECT * FROM ReimburseCharge WHERE CustomerRef = '${cust.value}'`)).ReimburseCharge || [];
  } catch (e) {
    console.warn(`ReimburseCharge query failed: ${e.message}`);
  }
  const open = charges.filter(c => !c.HasBeenInvoiced);
  console.log(`\nBillable charges for this customer: ${charges.length} (${open.length} not on an invoice yet)`);
  for (const c of open) {
    console.log(JSON.stringify(c, null, 2)); // full shape, so the "add" step can be built against real data
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
