#!/usr/bin/env node
/**
 * Create a NEW draft invoice made only of a customer's open billable card charges
 * (materials-only invoices, e.g. Elite: Mike). Lines are linked and taxable, the same
 * shape scripts/qbo-add-billable-charges.js writes, so each charge is marked invoiced.
 *
 *   node scripts/qbo-invoice-from-charges.js <customerId> <chargeId> [chargeId…] [--project "Mike"] [--due-days 15]   # dry run
 *   … --apply
 *
 * Safety: refuses charges that are already invoiced or belong to another customer. Never sends.
 * After creating, it re-reads the charges; if any is not marked invoiced it says so loudly.
 */

const API = 'https://quickbooks.api.intuit.com/v3/company';
const GET_RATE = 0.04712;
const need = n => { const v = process.env[n]; if (!v) throw new Error(`Missing environment variable ${n}`); return v; };
const round2 = n => Math.round(n * 100) / 100;

async function token() {
  const basic = Buffer.from(`${need('QBO_CLIENT_ID')}:${need('QBO_CLIENT_SECRET')}`).toString('base64');
  const r = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: need('QBO_REFRESH_TOKEN') })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Intuit token refresh failed: ${r.status} ${j.error || ''}`);
  return j.access_token;
}

async function call(t, method, path, body) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`${API}/${need('QBO_REALM_ID')}${path}${sep}minorversion=75`, {
    method, headers: { Authorization: `Bearer ${t}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`QBO ${method} ${path} → ${r.status} (intuit_tid ${r.headers.get('intuit_tid') || 'n/a'}): ${JSON.stringify(j.Fault || j).slice(0, 300)}`);
  return j;
}

function chargeLines(charge) {
  return charge.Line.map(l => {
    const d = l.ReimburseLineDetail || {};
    return {
      Description: l.Description, Amount: l.Amount, DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        ServiceDate: charge.TxnDate,
        MarkupInfo: { PercentBased: true, Percent: d.MarkupInfo?.Percent, Value: l.Amount, MarkUpIncomeAccountRef: d.ItemAccountRef },
        ItemAccountRef: d.ItemAccountRef, TaxCodeRef: { value: 'TAX' }
      },
      LinkedTxn: [{ TxnId: charge.Id, TxnType: 'ReimburseCharge', TxnLineId: l.Id }]
    };
  });
}

async function main() {
  const a = process.argv.slice(2), apply = a.includes('--apply');
  const opt = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const project = opt('--project'), dueDays = Number(opt('--due-days') || 0);
  const pos = a.filter((x, i) => !x.startsWith('--') && !['--project', '--due-days'].includes(a[i - 1]));
  const [customerId, ...chargeIds] = pos;
  if (!customerId || !chargeIds.length) throw new Error('Usage: qbo-invoice-from-charges.js <customerId> <chargeId…> [--project "Name"] [--due-days N] [--apply]');

  const t = await token();
  const company = (await call(t, 'GET', `/companyinfo/${need('QBO_REALM_ID')}`)).CompanyInfo?.CompanyName || '';
  if (!/rlt/i.test(company)) throw new Error(`Connected to "${company}", not RLT. Stopping.`);
  const cust = (await call(t, 'GET', `/customer/${customerId}`)).Customer;

  const charges = [];
  for (const id of chargeIds) {
    const c = (await call(t, 'GET', `/query?query=${encodeURIComponent(`SELECT * FROM ReimburseCharge WHERE Id = '${id}'`)}`)).QueryResponse?.ReimburseCharge?.[0];
    if (!c) throw new Error(`Charge ${id} not found`);
    if (c.HasBeenInvoiced) throw new Error(`Charge ${id} is already on an invoice. Stopping.`);
    if (c.CustomerRef.value !== customerId) throw new Error(`Charge ${id} belongs to ${c.CustomerRef.name}, not ${cust.FullyQualifiedName}. Stopping.`);
    charges.push(c);
  }
  const subtotal = round2(charges.reduce((s, c) => s + c.Amount, 0));
  const total = round2(subtotal + round2(subtotal * GET_RATE));
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + dueDays * 86400000).toISOString().slice(0, 10);
  console.log(`${company}\nNew invoice for ${cust.FullyQualifiedName}${project ? ` · Project Name "${project}"` : ''} · due ${due}`);
  for (const c of charges) console.log(`  charge ${c.Id} ${c.TxnDate} $${c.Amount}  ${(c.PrivateNote || '').slice(0, 60)}`);
  console.log(`  Expected: subtotal $${subtotal.toFixed(2)} · total about $${total.toFixed(2)} with GET`);
  if (!apply) return console.log('\nDry run. Add --apply to create.');

  // The company uses custom invoice numbers, so the API doesn't number new invoices: take the next 5000-series number.
  const recent = (await call(t, 'GET', `/query?query=${encodeURIComponent("SELECT DocNumber FROM Invoice WHERE TxnDate >= '2026-06-01' MAXRESULTS 1000")}`)).QueryResponse?.Invoice || [];
  const nums = recent.map(i => Number(i.DocNumber)).filter(n => n >= 5000 && n < 6000);
  const docNumber = String(Math.max(5000, ...nums) + 1);
  const body = {
    DocNumber: docNumber,
    CustomerRef: { value: customerId }, TxnDate: today, DueDate: due, EmailStatus: 'NotSet',
    Line: charges.flatMap(chargeLines),
    LinkedTxn: charges.map(c => ({ TxnId: c.Id, TxnType: 'ReimburseCharge' })),
    ...(project ? { CustomField: [{ DefinitionId: '1', Name: 'Project Name', Type: 'StringType', StringValue: project }] } : {})
  };
  const inv = (await call(t, 'POST', '/invoice', body)).Invoice;
  console.log(`\nCreated #${inv.DocNumber} (Id ${inv.Id}) · total $${inv.TotalAmt}`);
  for (const c of charges) {
    const now = (await call(t, 'GET', `/query?query=${encodeURIComponent(`SELECT * FROM ReimburseCharge WHERE Id = '${c.Id}'`)}`)).QueryResponse.ReimburseCharge[0];
    console.log(`  charge ${c.Id} invoiced: ${now.HasBeenInvoiced}${now.HasBeenInvoiced ? '' : '  <-- NOT MARKED: check before sending'}`);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
