#!/usr/bin/env node
/**
 * Create a project (sub-customer) under an existing QuickBooks customer, copying how an
 * existing sibling project is set up (e.g. "Royal Mauian 216" under South Maui Remodel LLC).
 *
 *   node scripts/qbo-new-project.js "Royal Mauian 216" "Menehune Shores 422"          # dry run
 *   node scripts/qbo-new-project.js "Royal Mauian 216" "Menehune Shores 422" --apply
 *
 * Refuses if a customer with the new name already exists. Only creates; never edits or deletes.
 * Needs the QBO_* environment variables; in the cloud run with
 * NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt
 */

const API = 'https://quickbooks.api.intuit.com/v3/company';
const need = n => { const v = process.env[n]; if (!v) throw new Error(`Missing environment variable ${n}`); return v; };
const q = s => s.replace(/'/g, "\\'");

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

async function main() {
  const [sibling, name] = process.argv.slice(2).filter(a => a !== '--apply');
  const apply = process.argv.includes('--apply');
  if (!sibling || !name) throw new Error('Usage: qbo-new-project.js "<existing project>" "<new project name>" [--apply]');
  const t = await token();
  const company = (await call(t, 'GET', `/companyinfo/${need('QBO_REALM_ID')}`)).CompanyInfo?.CompanyName || '';
  if (!/rlt/i.test(company)) throw new Error(`Connected to "${company}", not RLT. Stopping.`);

  const find = async n => (await call(t, 'GET', `/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${q(n)}'`)}`)).QueryResponse?.Customer?.[0];
  const sib = await find(sibling);
  if (!sib) throw new Error(`"${sibling}" not found`);
  if (!sib.Job || !sib.ParentRef) throw new Error(`"${sibling}" isn't a project under a customer`);
  if (await find(name)) throw new Error(`A customer named "${name}" already exists. Stopping.`);

  const body = {
    DisplayName: name, CompanyName: sib.CompanyName, Job: true, ParentRef: { value: sib.ParentRef.value },
    BillWithParent: !!sib.BillWithParent,
    ...(sib.PrimaryEmailAddr ? { PrimaryEmailAddr: sib.PrimaryEmailAddr } : {}),
    ...(sib.BillAddr ? { BillAddr: { Line1: sib.BillAddr.Line1, City: sib.BillAddr.City, CountrySubDivisionCode: sib.BillAddr.CountrySubDivisionCode, PostalCode: sib.BillAddr.PostalCode } } : {}),
    ...(sib.SalesTermRef ? { SalesTermRef: sib.SalesTermRef } : {})
  };
  console.log(`${company}\nCopying setup from "${sibling}" (parent ${sib.ParentRef.name || sib.ParentRef.value}).\nPlan: create project "${name}" · bill with parent: ${body.BillWithParent} · email: ${body.PrimaryEmailAddr?.Address || 'none'}`);
  if (!apply) return console.log('\nDry run. Add --apply to create.');
  const c = (await call(t, 'POST', '/customer', body)).Customer;
  console.log(`\nCreated: ${c.FullyQualifiedName} (Id ${c.Id})`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
