#!/usr/bin/env node
/**
 * Add or change ONE labor (Services) line on a draft invoice, keeping every other line,
 * including linked card charges, exactly as it is. (The QuickBooks connector can't do this
 * safely on invoices with linked charges: it rewrites all lines and drops the links.)
 *
 *   node scripts/qbo-labor-line.js 5019 --add 450 "Electrical labor: …"          # dry run
 *   node scripts/qbo-labor-line.js 5011 --set 1 4650 "Electrical labor: …"       # change line Id 1
 *   … --apply                                                                     # write
 *
 * Safety: refuses invoices that were emailed/printed or have a payment. Labor lines use the
 * "Services" item (Id 1) and are taxable. After writing, it re-reads the invoice; if the other
 * lines or links changed, it restores the original lines.
 * Needs QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REFRESH_TOKEN, QBO_REALM_ID; run with
 * NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt in the cloud.
 */

const API = 'https://quickbooks.api.intuit.com/v3/company';
const MINOR = 75;
const need = n => { const v = process.env[n]; if (!v) throw new Error(`Missing environment variable ${n}`); return v; };

async function token() {
  const basic = Buffer.from(`${need('QBO_CLIENT_ID')}:${need('QBO_CLIENT_SECRET')}`).toString('base64');
  const r = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: need('QBO_REFRESH_TOKEN') })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Intuit token refresh failed: ${r.status} ${j.error || ''}`);
  if (j.refresh_token && j.refresh_token !== process.env.QBO_REFRESH_TOKEN) console.warn('Note: Intuit issued a new refresh token. Update QBO_REFRESH_TOKEN within 24 hours (not printed).');
  return j.access_token;
}

async function call(t, method, path, body) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`${API}/${need('QBO_REALM_ID')}${path}${sep}minorversion=${MINOR}`, {
    method, headers: { Authorization: `Bearer ${t}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`QBO ${method} ${path} → ${r.status} (intuit_tid ${r.headers.get('intuit_tid') || 'n/a'}): ${JSON.stringify(j.Fault || j).slice(0, 300)}`);
  return j;
}

const realLines = inv => (inv.Line || []).filter(l => l.DetailType !== 'SubTotalLineDetail');
const sig = l => JSON.stringify([l.Id, l.Amount, l.DetailType, (l.LinkedTxn || []).map(t => t.TxnId)]);
const show = inv => realLines(inv).map(l => `  ${String(l.Id).padStart(3)}  ${String(l.Amount).padStart(9)}  ${(l.Description || '').split('\n')[0].slice(0, 70)}${l.LinkedTxn?.length ? '  [card charge]' : ''}`).join('\n') + `\n  Total ${inv.TotalAmt}`;

async function main() {
  const a = process.argv.slice(2), apply = a.includes('--apply');
  const doc = a[0], mode = a[1];
  let lineId = null, amount, desc;
  if (mode === '--add' || mode === '--add-materials') [amount, desc] = [Number(a[2]), a[3]];
  else if (mode === '--set') [lineId, amount, desc] = [a[2], Number(a[3]), a[4]];
  else if (mode === '--drop') [lineId, amount, desc] = [a[2], 1, 'drop'];
  if (!/^\d+$/.test(doc || '') || !['--add', '--add-materials', '--set', '--drop'].includes(mode) || !(amount > 0) || !desc) {
    throw new Error('Usage: qbo-labor-line.js <invoice #> --add|--add-materials <amount> "<description>" | --set <lineId> <amount> "<description>" | --drop <lineId> [--apply]');
  }
  const t = await token();
  const company = (await call(t, 'GET', `/companyinfo/${need('QBO_REALM_ID')}`)).CompanyInfo?.CompanyName || '';
  if (!/rlt/i.test(company)) throw new Error(`Connected to "${company}", not RLT. Stopping.`);
  const inv = (await call(t, 'GET', `/query?query=${encodeURIComponent(`SELECT * FROM Invoice WHERE DocNumber = '${doc}'`)}`)).QueryResponse?.Invoice?.[0];
  if (!inv) throw new Error(`Invoice ${doc} not found`);
  if (['EmailSent'].includes(inv.EmailStatus) || inv.PrintStatus === 'PrintComplete' || (inv.LinkedTxn || []).some(x => x.TxnType === 'Payment')) throw new Error(`#${doc} was sent, printed or paid. Stopping.`);

  const original = realLines(inv);
  // Services (Id 1) for labor; Materials (Id 1010000001) for items from stock.
  const itemId = mode === '--add-materials' ? '1010000001' : '1';
  const labor = { Amount: amount, Description: desc, DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: 1, UnitPrice: amount, TaxCodeRef: { value: 'TAX' } } };
  let lines;
  if (lineId) {
    if (!original.some(l => l.Id === lineId && l.SalesItemLineDetail && !(l.LinkedTxn || []).length)) throw new Error(`Line ${lineId} isn't a plain item line on #${doc}`);
    lines = mode === '--drop' ? original.filter(l => l.Id !== lineId) : original.map(l => (l.Id === lineId ? { ...labor, Id: lineId } : l));
  } else lines = [...original, labor];

  const what = mode === '--drop' ? `take off line ${lineId}` : `${lineId ? `set line ${lineId}` : 'add a line'} → ${itemId === '1' ? 'Services' : 'Materials'} $${amount.toFixed(2)}, taxable`;
  console.log(`${company} · #${doc} · ${inv.CustomerRef.name}\nBefore:\n${show(inv)}\n\nPlan: ${what}`);
  if (!apply) return console.log('\nDry run. Add --apply to write.');

  const fresh = (await call(t, 'GET', `/invoice/${inv.Id}`)).Invoice;
  await call(t, 'POST', '/invoice', { Id: fresh.Id, SyncToken: fresh.SyncToken, sparse: true, Line: lines, LinkedTxn: inv.LinkedTxn || [] });
  const after = (await call(t, 'GET', `/invoice/${inv.Id}`)).Invoice;
  const keep = original.filter(l => l.Id !== lineId).map(sig).sort().join();
  const now = realLines(after).filter(l => l.Id !== lineId && !(l.SalesItemLineDetail && l.Amount === amount && l.Description === desc)).map(sig).sort().join();
  if (keep !== now) {
    const f2 = (await call(t, 'GET', `/invoice/${inv.Id}`)).Invoice;
    await call(t, 'POST', '/invoice', { Id: f2.Id, SyncToken: f2.SyncToken, sparse: true, Line: original, LinkedTxn: inv.LinkedTxn || [] });
    throw new Error('Other lines changed unexpectedly, so the original lines were restored.');
  }
  console.log(`\nAfter:\n${show(after)}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
