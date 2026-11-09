#!/usr/bin/env node
/**
 * STATUS (2026-11-09): WORKS. Tested on #5018: charge 3212 added, taxable, totals exact,
 * charge marked invoiced. Key: link the charge on the invoice itself (Invoice.LinkedTxn) as well
 * as on each line, and use the charge's own accounts (no ItemRef), as QuickBooks does.
 *
 * Step 2 of the custom QuickBooks tool: add a customer's open billable charges
 * (ReimburseCharge, the "Suggested transactions" list) to ONE draft invoice, taxable.
 *
 *   node scripts/qbo-add-billable-charges.js 5018            # dry run (default): reads and shows the plan
 *   node scripts/qbo-add-billable-charges.js 5018 --apply    # writes: one sparse update of that invoice
 *   ... --charge 3212                                         # only this charge (default: all open charges)
 *   ... --expect-total 1126.92                                # stop and roll back if the new total differs
 *
 * Safety:
 *   - Company must be RLT Systems (BILLING_AGENT_QBO_COMPANY overrides the match text).
 *   - Refuses an invoice that was emailed/printed or has a payment, and charges already invoiced.
 *   - The only write is POST /invoice (sparse update) on that one invoice. Never sends, voids, deletes.
 *   - Sparse update replaces the whole Line array, so existing lines go back unchanged with their Ids.
 *   - After the write it re-reads the invoice and the charges. If lines, link, or totals are off,
 *     it puts the invoice back to its original lines and exits non-zero.
 *
 * Env: QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REFRESH_TOKEN, QBO_REALM_ID (never printed).
 */

const REQUIRED_COMPANY = process.env.BILLING_AGENT_QBO_COMPANY || 'RLT Systems';
const API = 'https://quickbooks.api.intuit.com/v3/company';
const MINOR = 75;
const GET_RATE = 0.04712; // Hawaii GET, Maui (4.166% + 0.546% surcharge)

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

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

async function call(token, method, path, body) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${API}/${need('QBO_REALM_ID')}${path}${sep}minorversion=${MINOR}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await res.json();
  if (!res.ok) {
    const err = new Error(`QBO ${method} ${path.split('?')[0]} → ${res.status} (intuit_tid ${res.headers.get('intuit_tid') || 'n/a'}): ${JSON.stringify(j.Fault || j).slice(0, 500)}`);
    err.fault = j.Fault;
    throw err;
  }
  return j;
}

const query = (token, sql) => call(token, 'GET', `/query?query=${encodeURIComponent(sql)}`).then(r => r.QueryResponse || {});

const readInvoice = async (token, doc) =>
  (await query(token, `SELECT * FROM Invoice WHERE DocNumber = '${String(doc).replace(/'/g, '')}'`)).Invoice?.[0];

const readCharges = async (token, customerId) =>
  (await query(token, `SELECT * FROM ReimburseCharge WHERE CustomerRef = '${customerId}'`)).ReimburseCharge || [];

/** Existing item lines, exactly as QuickBooks returned them (Ids kept). Subtotal lines are left out. */
const itemLines = inv => (inv.Line || []).filter(l => l.DetailType !== 'SubTotalLineDetail');

/**
 * New invoice lines for one charge: a copy of each charge line (cost and markup), linked to the
 * charge line by TxnLineId (QBO requires it) and set taxable.
 */
function chargeLines(charge) {
  // Same shape QuickBooks itself writes when a charge is added from Suggested transactions
  // (seen on #5006, #5011, #5012): no ItemRef, the charge line's own account and markup info.
  return charge.Line.map(l => {
    const d = l.ReimburseLineDetail || {};
    return {
      Description: l.Description,
      Amount: l.Amount,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        ServiceDate: charge.TxnDate,
        MarkupInfo: { PercentBased: true, Percent: d.MarkupInfo?.Percent, Value: l.Amount, MarkUpIncomeAccountRef: d.ItemAccountRef },
        ItemAccountRef: d.ItemAccountRef,
        TaxCodeRef: { value: 'TAX' }
      },
      LinkedTxn: [{ TxnId: charge.Id, TxnType: 'ReimburseCharge', TxnLineId: l.Id }]
    };
  });
}

/** What the invoice should total afterwards. */
function expectedTotals(inv, charges) {
  const subtotal = round2(itemLines(inv).reduce((s, l) => s + l.Amount, 0) + charges.reduce((s, c) => s + c.Amount, 0));
  const taxable = round2(itemLines(inv).filter(l => (l.SalesItemLineDetail || l.ReimburseLineDetail)?.TaxCodeRef?.value === 'TAX')
    .reduce((s, l) => s + l.Amount, 0) + charges.reduce((s, c) => s + c.Amount, 0));
  const rates = (inv.TxnTaxDetail?.TaxLine || []).map(t => t.TaxLineDetail?.TaxPercent / 100).filter(Boolean);
  // QBO rounds once on the combined rate (4.166% + 0.546% = 4.712%), not per rate part (#5015: 298.22, not 298.23).
  const rate = rates.length ? rates.reduce((s, r) => s + r, 0) : GET_RATE;
  const tax = round2(taxable * rate);
  return { subtotal, tax, total: round2(subtotal + tax) };
}

function refuseReasons(inv) {
  const out = [];
  if (inv.EmailStatus === 'EmailSent') out.push('invoice was already emailed');
  if (inv.PrintStatus === 'PrintComplete') out.push('invoice was already printed');
  if (round2(inv.Balance) !== round2(inv.TotalAmt)) out.push('invoice has a payment applied');
  if ((inv.LinkedTxn || []).some(t => t.TxnType === 'Payment')) out.push('invoice is linked to a payment');
  return out;
}

const showLines = inv => itemLines(inv).map(l =>
  `   ${String(l.Id || 'new').padStart(4)}  ${l.DetailType.padEnd(20)} ${String(l.Amount).padStart(9)}  ${((l.SalesItemLineDetail || l.ReimburseLineDetail)?.TaxCodeRef?.value || '-').padEnd(4)} ${(l.Description || '').split('\n')[0].slice(0, 60)}${l.LinkedTxn?.length ? `  [linked ${l.LinkedTxn.map(t => t.TxnType + ' ' + t.TxnId).join(', ')}]` : ''}`
).join('\n');

const summary = inv => `subtotal ${round2(itemLines(inv).reduce((s, l) => s + l.Amount, 0))}, tax ${inv.TxnTaxDetail?.TotalTax ?? 0}, total ${inv.TotalAmt}`;

async function sparseLines(token, invoiceId, lines, extra = {}) {
  const fresh = (await call(token, 'GET', `/invoice/${invoiceId}`)).Invoice; // latest SyncToken before every write
  return (await call(token, 'POST', '/invoice', { Id: fresh.Id, SyncToken: fresh.SyncToken, sparse: true, Line: lines, ...extra })).Invoice;
}

async function main() {
  const args = process.argv.slice(2);
  const doc = args.find(a => /^\d+$/.test(a));
  const apply = args.includes('--apply');
  const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const onlyCharge = flag('--charge');
  const expectTotal = flag('--expect-total') ? Number(flag('--expect-total')) : undefined;
  if (!doc) throw new Error('Usage: node scripts/qbo-add-billable-charges.js <invoice number> [--charge <id>] [--expect-total <amount>] [--apply]');

  const token = await accessToken();
  const realm = need('QBO_REALM_ID');
  const company = (await call(token, 'GET', `/companyinfo/${realm}`)).CompanyInfo?.CompanyName || '';
  if (!company.toLowerCase().includes(REQUIRED_COMPANY.toLowerCase())) throw new Error(`Connected to "${company}", not ${REQUIRED_COMPANY}. Stopping.`);

  const inv = await readInvoice(token, doc);
  if (!inv) throw new Error(`Invoice ${doc} not found`);
  console.log(`${company} · invoice #${doc} (Id ${inv.Id}, SyncToken ${inv.SyncToken}) · ${inv.CustomerRef.name} · ${summary(inv)}`);
  console.log(showLines(inv));

  const refuse = refuseReasons(inv);
  if (refuse.length) throw new Error(`Refusing: ${refuse.join('; ')}.`);

  const all = await readCharges(token, inv.CustomerRef.value);
  if (onlyCharge && !all.some(c => c.Id === onlyCharge)) throw new Error(`Charge ${onlyCharge} not found for ${inv.CustomerRef.name}`);
  const invoiced = all.filter(c => c.HasBeenInvoiced && (!onlyCharge || c.Id === onlyCharge));
  if (onlyCharge && invoiced.length) throw new Error(`Refusing: charge ${onlyCharge} is already invoiced.`);
  const charges = all.filter(c => !c.HasBeenInvoiced && (!onlyCharge || c.Id === onlyCharge));
  const alreadyLinked = new Set(itemLines(inv).flatMap(l => (l.LinkedTxn || []).map(t => t.TxnId)));
  const todo = charges.filter(c => !alreadyLinked.has(c.Id));
  if (!todo.length) { console.log('\nNo open billable charges to add. Nothing to do.'); return; }

  const exp = expectedTotals(inv, todo);
  console.log(`\nCharges to add (taxable):`);
  for (const c of todo) console.log(`   ReimburseCharge ${c.Id}  ${c.TxnDate}  ${c.Amount}  ${c.Line.map(l => l.Amount).join(' + ')}  ${c.PrivateNote || ''}`);
  console.log(`Expected after: subtotal ${exp.subtotal}, tax ${exp.tax}, total ${exp.total}`);
  if (expectTotal !== undefined && round2(expectTotal) !== exp.total) throw new Error(`Expected total ${exp.total} does not match --expect-total ${expectTotal}. Stopping before any write.`);

  if (!apply) { console.log('\nDry run. Nothing written. Add --apply to update the invoice.'); return; }

  const original = itemLines(inv);
  const newLines = [...original, ...todo.flatMap(chargeLines)];
  let after;
  try {
    // Invoice-level link too: past invoices carry each charge in Invoice.LinkedTxn.
    const linked = [...(inv.LinkedTxn || []), ...todo.map(c => ({ TxnId: c.Id, TxnType: 'ReimburseCharge' }))];
    await sparseLines(token, inv.Id, newLines, { LinkedTxn: linked });
    after = await readInvoice(token, doc);
  } catch (e) {
    console.error(`Write rejected, invoice unchanged: ${e.message}`);
    process.exit(1);
  }

  // Verify: original lines intact, one line per charge line, all linked and taxable, totals exact, charges invoiced.
  const problems = [];
  const afterLines = itemLines(after);
  for (const o of original) {
    const a = afterLines.find(l => l.Id === o.Id);
    if (!a || a.Amount !== o.Amount) problems.push(`existing line ${o.Id} changed or missing`);
  }
  const added = afterLines.filter(l => !original.some(o => o.Id === l.Id));
  const wantCount = todo.reduce((n, c) => n + c.Line.length, 0);
  if (added.length !== wantCount) problems.push(`expected ${wantCount} new lines, found ${added.length}`);
  for (const l of added) {
    if ((l.SalesItemLineDetail || l.ReimburseLineDetail)?.TaxCodeRef?.value !== 'TAX') problems.push(`new line ${l.Id} is not taxable`);
  }
  const subtotal = round2(afterLines.reduce((s, l) => s + l.Amount, 0));
  const tax = round2(after.TxnTaxDetail?.TotalTax ?? 0);
  if (subtotal !== exp.subtotal) problems.push(`subtotal ${subtotal} ≠ ${exp.subtotal}`);
  if (tax !== exp.tax) problems.push(`tax ${tax} ≠ ${exp.tax}`);
  if (round2(after.TotalAmt) !== exp.total) problems.push(`total ${after.TotalAmt} ≠ ${exp.total}`);
  // The charge's HasBeenInvoiced flag can lag the invoice write; read each charge directly, retrying.
  const chargesAfter = [];
  for (const c of todo) {
    let ch;
    for (let i = 0; i < 6; i++) {
      ch = (await call(token, 'GET', `/reimbursecharge/${c.Id}`)).ReimburseCharge;
      if (ch?.HasBeenInvoiced) break;
      await new Promise(r => setTimeout(r, 5000));
    }
    chargesAfter.push(ch);
    if (!ch?.HasBeenInvoiced) problems.push(`charge ${c.Id} not marked invoiced (${JSON.stringify({ HasBeenInvoiced: ch?.HasBeenInvoiced, LinkedTxn: ch?.LinkedTxn, SyncToken: ch?.SyncToken })})`);
  }

  console.log(`\nAfter: invoice #${doc} · SyncToken ${after.SyncToken} · ${summary(after)}`);
  console.log(showLines(after));
  for (const c of todo) console.log(`   ReimburseCharge ${c.Id} HasBeenInvoiced=${!!chargesAfter.find(x => x.Id === c.Id)?.HasBeenInvoiced}`);

  if (problems.length) {
    console.error(`\nCheck failed: ${problems.join('; ')}. Putting invoice #${doc} back to its original lines.`);
    await sparseLines(token, inv.Id, original, { LinkedTxn: inv.LinkedTxn || [] });
    const back = await readInvoice(token, doc);
    console.error(`Restored: ${summary(back)} (was total ${inv.TotalAmt})`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });

module.exports = { chargeLines, expectedTotals, refuseReasons, itemLines };
