#!/usr/bin/env node
/**
 * Mark Daily Job Log rows as billed, after Bobby has sent the invoice.
 * Writes ONLY the "Billing Status" and "Invoice #" cells of the rows given.
 * Never reads or writes any other column ("Notes to Bookkeeper" is never touched).
 *
 *   node scripts/sheet-mark-billed.js 5018 236            # dry run: shows what it would write
 *   node scripts/sheet-mark-billed.js 5018 236 237 --apply
 *
 * Needs (cloud environment settings, never in code):
 *   GOOGLE_SA_CLIENT_EMAIL   service account email (…@….iam.gserviceaccount.com)
 *   GOOGLE_SA_PRIVATE_KEY    the "private_key" value from its JSON key (one line, with \n)
 *   JOB_LOG_SHEET_ID         optional; defaults to the RLT Daily Job Log
 * Network: oauth2.googleapis.com, sheets.googleapis.com
 */

const { google } = require('googleapis');

const SHEET_ID = process.env.JOB_LOG_SHEET_ID || '1E3VWlRAPMh43ynhJkCg_TRuAUDuIEx_RxUef4UfOKT4';
const STATUS = 'Billed ✅';

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

// Accepts the key with or without its BEGIN/END lines, with real or "\n" line breaks.
function privateKey() {
  let k = need('GOOGLE_SA_PRIVATE_KEY').trim().replace(/^"|"$/g, '').replace(/\\n/g, '\n');
  if (!/BEGIN PRIVATE KEY/.test(k)) {
    const body = k.replace(/\s+/g, '');
    k = `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  }
  return k;
}

function colLetter(i) {
  let n = i + 1, s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const [invoice, ...rowArgs] = args.filter(a => a !== '--apply');
  const rows = rowArgs.map(Number);
  if (!/^\d+$/.test(invoice || '') || !rows.length || rows.some(r => !Number.isInteger(r) || r < 2)) {
    throw new Error('Usage: node scripts/sheet-mark-billed.js <invoice #> <row> [row…] [--apply]');
  }

  const auth = new google.auth.JWT({
    email: need('GOOGLE_SA_CLIENT_EMAIL'),
    key: privateKey(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties.title' });
  const tab = meta.data.sheets[0].properties.title;

  // Header row only: find the two columns by name.
  const head = (await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${tab}'!1:1` })).data.values?.[0] || [];
  const statusCol = head.findIndex(h => /billing status/i.test(h));
  const invCol = head.findIndex(h => /invoice\s*#|invoice number/i.test(h));
  const dateCol = head.findIndex(h => /^date$/i.test(String(h).trim()));
  const jobCol = head.findIndex(h => /^job name/i.test(String(h).trim()));
  if (statusCol < 0 || invCol < 0) throw new Error('Could not find the "Billing Status" and "Invoice #" columns');

  // Read just date, job, status and invoice for each row so the plan can be checked.
  const plan = [];
  for (const r of rows) {
    const get = async c => (c < 0 ? '' : (await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${tab}'!${colLetter(c)}${r}` })).data.values?.[0]?.[0] || '');
    const [date, job, status, inv] = await Promise.all([get(dateCol), get(jobCol), get(statusCol), get(invCol)]);
    if (inv && inv !== invoice) throw new Error(`Row ${r} already has invoice #${inv}. Stopping.`);
    plan.push({ r, date, job, status });
  }

  for (const p of plan) console.log(`Row ${p.r} · ${p.date} · ${p.job} · "${p.status || '(blank)'}" → "${STATUS}", Invoice # ${invoice}`);
  if (!apply) { console.log('\nDry run. Add --apply to write.'); return; }

  const data = plan.flatMap(p => [
    { range: `'${tab}'!${colLetter(statusCol)}${p.r}`, values: [[STATUS]] },
    { range: `'${tab}'!${colLetter(invCol)}${p.r}`, values: [[invoice]] }
  ]);
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { valueInputOption: 'RAW', data } });
  console.log(`\nWrote ${plan.length} row(s).`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
