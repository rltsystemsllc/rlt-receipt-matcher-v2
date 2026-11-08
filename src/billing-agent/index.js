/**
 * RLT Billing Agent
 *
 * Daily Job Log (Google Form → Sheet) → QBO DRAFT invoices → picture text to Bobby.
 *
 * Flow per run:
 *   read unbilled rows → group by job → match QBO customer → price (code) →
 *   guardrails → [dry_run: log only] / [draft: create draft, mark rows, text picture]
 *
 * State lives in the Sheet (Billing Status + Invoice # columns, and the log tab),
 * so a restart never loses or repeats work.
 */

const cron = require('node-cron');
const cfg = require('./config');
const sheet = require('./sheet');
const qbo = require('./qbo');
const ai = require('./ai');
const pricing = require('./pricing');
const guardrails = require('./guardrails');
const notify = require('./notify');
const logger = require('../utils/logger');

let running = false;
let lastRun = null;
const jobs = [];

function groupByJob(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${sheet.normalize(r.customerName)}|${sheet.normalize(r.projectName)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.values()];
}

function sinceDate(rows) {
  const times = rows.map(r => new Date(r.date).getTime()).filter(t => !isNaN(t));
  const min = times.length ? Math.min(...times) : Date.now();
  return new Date(min - 7 * 86400000).toISOString().slice(0, 10);
}

const money = n => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function invoiceMessage(docNumber, match, rows, priced, warnings) {
  const t = priced.totals;
  const who = [`Bobby ${t.bobbyHours}h`];
  if (t.kennyHours) who.push(`Kenny ${t.kennyHours}h`);
  return [
    `📄 DRAFT INVOICE #${docNumber}`,
    match.customerName,
    `${money(t.total)}  (Labor ${money(t.labor)} · Materials ${money(t.materials)})`,
    `${who.join(' · ')} · ${rows.length} log entr${rows.length === 1 ? 'y' : 'ies'}`,
    ...warnings.map(w => `⚠️ ${w}`),
    '',
    `Reply OK ${docNumber} to approve, or FIX ${docNumber} + what's wrong.`,
    'Not sent to the customer — it stays a draft in QBO.'
  ].join('\n');
}

/**
 * @param {object} opts
 * @param {'dry_run'|'draft'} opts.mode
 * @param {boolean} opts.urgentOnly  only jobs with an "Urgent Billing Needed = Yes" row
 */
async function run({ mode = cfg.mode, urgentOnly = false } = {}) {
  if (running) return { skipped: 'already running' };
  running = true;
  const startedAt = new Date().toISOString();
  const results = [];

  try {
    const { headerMap, rows } = await sheet.readJobLog();
    let groups = groupByJob(rows.filter(sheet.isUnbilled));
    if (urgentOnly) groups = groups.filter(g => g.some(r => r.urgent));
    if (!groups.length) {
      lastRun = { startedAt, mode, urgentOnly, jobs: 0 };
      return { mode, jobs: [] };
    }

    if (headerMap.kennyHours === undefined) {
      logger.warn('Billing Agent: no "Kenny" hours column on the form — Kenny hours will not be billed');
    }

    await qbo.connect();
    const companyName = await qbo.verifyCompany();
    const [customers, customerMap, billedKeys, laborItemId, materialsItemId] = await Promise.all([
      qbo.listCustomers(),
      sheet.readCustomerMap(),
      sheet.readBilledExpenseKeys(),
      qbo.findItemId(cfg.qbo.laborItemName),
      qbo.findItemId(cfg.qbo.materialsItemName)
    ]);

    const logEntries = [];
    const blockedForText = [];

    for (const jobRows of groups) {
      const first = jobRows[0];
      const rowNumbers = jobRows.map(r => r.rowNumber);
      const label = [first.customerName, first.projectName].filter(Boolean).join(' — ') || '(no name)';

      const match = await ai.matchCustomer(first.customerName, first.projectName, customers, customerMap);
      const expenses = match.customerId
        ? await qbo.getBillableExpenses(match.customerId, sinceDate(jobRows), billedKeys)
        : [];
      const descriptions = await ai.cleanDescriptions(jobRows);
      const priced = pricing.buildLines(jobRows, expenses, descriptions);
      const check = guardrails.checkJob({ rows: jobRows, match, priced });

      const base = [
        startedAt, mode, label, match.customerName || '', rowNumbers.join(','),
        priced.totals.bobbyHours, priced.totals.kennyHours,
        priced.totals.labor, priced.totals.materials, priced.totals.total
      ];
      const flagText = [...check.blockers.map(b => `BLOCKED: ${b}`), ...check.warnings].join(' | ');

      if (mode === 'dry_run') {
        logEntries.push([...base, '', check.ok ? 'DRY RUN — would draft' : 'DRY RUN — blocked', flagText, '']);
        results.push({ job: label, ok: check.ok, totals: priced.totals, lines: priced.lines, blockers: check.blockers, warnings: check.warnings });
        continue;
      }

      if (!check.ok) {
        await sheet.markRows(headerMap, rowNumbers, cfg.statuses.needsReview);
        logEntries.push([...base, '', 'Needs Review', flagText, '']);
        blockedForText.push(`• ${label}: ${check.blockers[0]}`);
        results.push({ job: label, ok: false, blockers: check.blockers });
        continue;
      }

      // Lock rows first so a crash mid-way can't produce a duplicate invoice next run.
      await sheet.markRows(headerMap, rowNumbers, cfg.statuses.drafting);
      let invoice;
      try {
        invoice = await qbo.createDraftInvoice({
          customerId: match.customerId,
          lines: priced.lines,
          laborItemId,
          materialsItemId,
          memo: `Drafted by RLT Billing Agent ${startedAt}. Job log rows: ${rowNumbers.join(', ')}`
        });
      } catch (e) {
        await sheet.markRows(headerMap, rowNumbers, cfg.statuses.needsReview);
        logEntries.push([...base, '', 'Error', `QBO error: ${e.message}`, '']);
        blockedForText.push(`• ${label}: QBO error — ${e.message}`);
        results.push({ job: label, ok: false, error: e.message });
        continue;
      }

      const expenseKeys = priced.lines.filter(l => l.expenseKey).map(l => l.expenseKey);
      expenseKeys.forEach(k => billedKeys.add(k));
      await sheet.markRows(headerMap, rowNumbers, cfg.statuses.draftCreated, invoice.docNumber);
      logEntries.push([...base, invoice.docNumber, 'Draft Created', flagText, expenseKeys.join(',')]);
      results.push({ job: label, ok: true, invoice, totals: priced.totals, warnings: check.warnings });

      try {
        const pdf = await qbo.getInvoicePdf(invoice.id);
        await notify.textInvoiceImage(invoiceMessage(invoice.docNumber, match, jobRows, priced, check.warnings), pdf, invoice.docNumber);
      } catch (e) {
        logger.error('Billing Agent: could not text invoice', { error: e.message, doc: invoice.docNumber });
      }
    }

    await sheet.appendLog(logEntries);

    if (blockedForText.length && mode === 'draft') {
      await notify.text(`🛑 Billing Agent couldn't draft ${blockedForText.length} job(s):\n${blockedForText.join('\n')}\n\nRows marked "Needs Review" in the job log.`)
        .catch(e => logger.error('Billing Agent: summary text failed', { error: e.message }));
    }

    lastRun = { startedAt, mode, urgentOnly, company: companyName, jobs: results.length, drafted: results.filter(r => r.invoice).length };
    return { mode, company: companyName, jobs: results };
  } catch (e) {
    logger.error('Billing Agent run failed', { error: e.message });
    lastRun = { startedAt, mode, urgentOnly, error: e.message };
    throw e;
  } finally {
    running = false;
  }
}

const REPLY = /^\s*(ok|okay|yes|approve|approved|fix)\s*#?\s*(\d+)\b\s*(.*)$/is;

/**
 * Handle Bobby's "OK 1042" / "FIX 1042 wrong customer" texts.
 * Returns true if the message was a billing reply (so other bots skip it).
 */
async function handleReply(msg) {
  const m = String(msg.text || '').match(REPLY);
  if (!m) return false;
  const [, verb, docNumber, note] = m;

  const { headerMap, rows } = await sheet.readJobLog();
  const matched = rows.filter(r => r.invoiceNumber === docNumber);
  if (!matched.length) return false; // not one of ours — let other bots handle it

  const rowNumbers = matched.map(r => r.rowNumber);
  const isFix = /^fix$/i.test(verb);
  const status = isFix ? cfg.statuses.needsFix : cfg.statuses.approved;
  await sheet.markRows(headerMap, rowNumbers, status, docNumber);
  await sheet.appendLog([[new Date().toISOString(), 'reply', '', '', rowNumbers.join(','), '', '', '', '', '', docNumber, status, note.trim(), '']]);
  await notify.text(isFix
    ? `📝 #${docNumber} marked Needs Fix${note.trim() ? `: ${note.trim()}` : ''}`
    : `✅ #${docNumber} approved. Ready to send from QBO.`);
  return true;
}

function start() {
  if (!cfg.enabled) {
    logger.info('Billing Agent disabled (set BILLING_AGENT_ENABLED=true)');
    return;
  }
  const opts = { timezone: cfg.timezone };
  const safe = urgentOnly => () => run({ urgentOnly }).catch(() => {});
  // Urgent checks only in draft mode: in dry_run they'd re-log the same job every 15 min.
  if (cfg.mode === 'draft') jobs.push(cron.schedule(cfg.urgentCron, safe(true), opts));
  jobs.push(cron.schedule(cfg.weeklyCron, safe(false), opts));
  logger.info(`🧮 Billing Agent started in ${cfg.mode} mode`);
}

function stop() {
  jobs.splice(0).forEach(j => j.stop());
}

function status() {
  return { enabled: cfg.enabled, mode: cfg.mode, running, lastRun };
}

module.exports = { run, handleReply, start, stop, status, groupByJob, invoiceMessage };
