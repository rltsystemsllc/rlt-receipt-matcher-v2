/**
 * Harness guardrails. These run in code before anything is written to QBO.
 * A "blocker" stops the draft and flags the job for a person. A "warning" is shown to Bobby.
 */

const cfg = require('./config');

function checkJob({ rows, match, priced }, limits = cfg.guardrails) {
  const blockers = [];
  const warnings = [...priced.flags];

  if (!rows[0]?.customerName) blockers.push('No customer or job name on the form entry');

  for (const r of rows) {
    if (isNaN(r.hours) || isNaN(r.kennyHours)) blockers.push(`Row ${r.rowNumber}: hours aren't a number`);
    if (r.hours > limits.maxHoursPerRow) blockers.push(`Row ${r.rowNumber}: ${r.hours} hrs is over the ${limits.maxHoursPerRow} hr limit`);
    if (r.kennyHours > limits.maxHoursPerRow) blockers.push(`Row ${r.rowNumber}: Kenny ${r.kennyHours} hrs is over the limit`);
    if (r.invoiceNumber) blockers.push(`Row ${r.rowNumber} already has invoice #${r.invoiceNumber}`);
  }

  if (!match || !match.customerId) {
    blockers.push(`Couldn't confidently match "${rows[0]?.customerName}" to a QBO customer${match?.reason ? ` (${match.reason})` : ''}`);
  } else if (match.confidence !== 'high') {
    blockers.push(`Customer match "${match.customerName}" is only ${match.confidence} confidence — add it to the Customer Map tab`);
  }

  if (priced.totals.total > limits.maxInvoiceTotal) {
    blockers.push(`Total $${priced.totals.total.toFixed(2)} is over the $${limits.maxInvoiceTotal} auto-draft limit`);
  }
  if (priced.lines.length === 0) blockers.push('Nothing billable (no hours, no materials)');
  if (priced.totals.total === 0 && priced.lines.length > 0) warnings.push('Every line is $0 — needs pricing');

  return { blockers, warnings, ok: blockers.length === 0 };
}

module.exports = { checkJob };
