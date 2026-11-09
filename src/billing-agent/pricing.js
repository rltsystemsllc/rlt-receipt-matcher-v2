/**
 * Invoice math. Plain code only — the AI never produces a dollar amount.
 */

const cfg = require('./config');

const round2 = n => Math.round(n * 100) / 100;

/**
 * Build invoice lines for one job.
 * @param rows        unbilled sheet rows for this job
 * @param expenses    QBO billable expenses for this customer not yet billed by the agent
 * @param descriptions optional Map(rowNumber -> cleaned description) from the AI
 */
function buildLines(rows, expenses = [], descriptions = new Map(), rates = cfg.rates) {
  const lines = [];
  const flags = [];
  const markup = 1 + rates.materialsMarkupPercent / 100;

  const sorted = [...rows].sort((a, b) => new Date(a.date) - new Date(b.date));

  for (const row of sorted) {
    const desc = descriptions.get(row.rowNumber) || row.description || 'Electrical work';
    const phase = row.phase ? ` (${row.phase})` : '';

    if (row.hours > 0) {
      const rate = row.emergency ? rates.bobbyEmergency : rates.bobbyStandard;
      lines.push({
        kind: 'labor',
        date: row.date,
        description: `${row.date} — ${desc}${phase}${row.emergency ? ' — EMERGENCY RATE' : ''}`,
        qty: row.hours,
        rate,
        amount: round2(row.hours * rate),
        rowNumber: row.rowNumber
      });
    }

    if (row.kennyHours > 0) {
      const rate = row.emergency ? rates.kennyEmergency : rates.kenny;
      lines.push({
        kind: 'labor',
        date: row.date,
        description: `${row.date} — Helper labor: ${desc}`,
        qty: row.kennyHours,
        rate,
        amount: round2(row.kennyHours * rate),
        rowNumber: row.rowNumber
      });
    }

    if (row.stockMaterials) {
      lines.push({
        kind: 'materials_pending',
        date: row.date,
        description: `${row.date} — Stock materials (PRICE NEEDED): ${row.stockMaterials}`,
        qty: 1,
        rate: 0,
        amount: 0,
        rowNumber: row.rowNumber
      });
      flags.push(`Stock materials on ${row.date} need a price`);
    }
  }

  // Purchased materials: real costs from QBO receipts, marked up.
  for (const e of expenses) {
    const amount = round2(e.amount * markup);
    lines.push({
      kind: 'materials',
      date: e.date,
      description: `${e.date} — Materials: ${e.vendor}${e.description ? ' — ' + e.description : ''}`,
      qty: 1,
      rate: amount,
      amount,
      expenseKey: e.key
    });
  }

  // Bobby said he bought materials but no QBO receipt is linked to this customer yet.
  const boughtRows = sorted.filter(r => r.materialBought);
  if (boughtRows.length && expenses.length === 0) {
    for (const r of boughtRows) {
      lines.push({
        kind: 'materials_pending',
        date: r.date,
        description: `${r.date} — Materials purchased (COST NEEDED — receipt not matched in QBO yet): ${r.materialBought}`,
        qty: 1,
        rate: 0,
        amount: 0,
        rowNumber: r.rowNumber
      });
    }
    flags.push(`${boughtRows.length} purchased-material entr${boughtRows.length === 1 ? 'y has' : 'ies have'} no matching QBO receipt`);
  }

  const labor = round2(lines.filter(l => l.kind === 'labor').reduce((s, l) => s + l.amount, 0));
  const materials = round2(lines.filter(l => l.kind !== 'labor').reduce((s, l) => s + l.amount, 0));

  return {
    lines,
    flags,
    totals: {
      bobbyHours: round2(rows.reduce((s, r) => s + (r.hours || 0), 0)),
      kennyHours: round2(rows.reduce((s, r) => s + (r.kennyHours || 0), 0)),
      labor,
      materials,
      total: round2(labor + materials)
    }
  };
}

module.exports = { buildLines, round2 };
