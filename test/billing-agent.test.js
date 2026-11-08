const test = require('node:test');
const assert = require('node:assert');

delete process.env.ANTHROPIC_API_KEY; // force deterministic paths

const sheet = require('../src/billing-agent/sheet');
const pricing = require('../src/billing-agent/pricing');
const guardrails = require('../src/billing-agent/guardrails');
const qbo = require('../src/billing-agent/qbo');
const ai = require('../src/billing-agent/ai');
const agent = require('../src/billing-agent');

// Real header row from "RLT Daily Job Log (Form Responses)" + a Kenny column
const HEADERS = ['Timestamp', 'Date', 'Billing Status', 'Contractor / Customer Name', 'Project Name', 'Job Name',
  'Construction Phase', 'Hours Worked', 'Description of Work', 'Material Bought', 'Upload Receipt Photo',
  'Material pulled from stock / truck?', 'Urgent Billing Needed?', 'Notes to Bookkeeper:', 'Emergency Rate?',
  'Invoice #', "Kenny's Hours Worked"];

const row = o => HEADERS.map(h => o[h] ?? '');

const RATES = { bobbyStandard: 150, bobbyEmergency: 300, kenny: 95, kennyEmergency: 95, materialsMarkupPercent: 22 };

test('maps columns by header name and never reads bookkeeper notes', () => {
  const { headerMap, rows } = sheet.parseRows([HEADERS, row({
    Timestamp: '11/3/2026 18:00:00', Date: '11/3/2026', 'Job Name': 'Elite - 581', 'Hours Worked': '4',
    'Notes to Bookkeeper:': 'private message', "Kenny's Hours Worked": '3', 'Emergency Rate?': 'No',
    'Material pulled from stock / truck?': 'None', 'Urgent Billing Needed?': 'Yes'
  })]);
  assert.strictEqual(headerMap.billingStatus, 2);
  assert.strictEqual(headerMap.invoiceNumber, 15);
  assert.strictEqual(headerMap.kennyHours, 16);
  assert.strictEqual(headerMap.hours, 7);
  assert.strictEqual(headerMap.stockMaterials, 11);
  assert.strictEqual(headerMap.urgent, 12);
  const r = rows[0];
  assert.strictEqual(r.customerName, 'Elite - 581'); // falls back to Job Name
  assert.strictEqual(r.hours, 4);
  assert.strictEqual(r.kennyHours, 3);
  assert.strictEqual(r.stockMaterials, ''); // "None" → empty
  assert.strictEqual(r.urgent, true);
  assert.ok(!JSON.stringify(r).includes('private message'));
  assert.strictEqual(r.rowNumber, 2);
});

test('only unbilled rows are picked up', () => {
  const base = { timestamp: 'x', invoiceNumber: '' };
  assert.ok(sheet.isUnbilled({ ...base, billingStatus: '' }));
  assert.ok(sheet.isUnbilled({ ...base, billingStatus: 'Not Billed' }));
  assert.ok(!sheet.isUnbilled({ ...base, billingStatus: 'Billed ✅' }));
  assert.ok(!sheet.isUnbilled({ ...base, billingStatus: 'Drafting…' }));
  assert.ok(!sheet.isUnbilled({ ...base, billingStatus: 'Needs Review' }));
  assert.ok(!sheet.isUnbilled({ ...base, billingStatus: '', invoiceNumber: '1042' }));
  assert.ok(!sheet.isUnbilled({ timestamp: '', billingStatus: '', invoiceNumber: '' }));
});

test('column letters', () => {
  assert.strictEqual(sheet.colLetter(0), 'A');
  assert.strictEqual(sheet.colLetter(15), 'P');
  assert.strictEqual(sheet.colLetter(26), 'AA');
});

test('pricing: Bobby $150, emergency $300, Kenny $95, receipts +22%', () => {
  const rows = [
    { rowNumber: 2, date: '11/3/2026', hours: 4, kennyHours: 3, description: 'Rough in', emergency: false, stockMaterials: '', materialBought: '' },
    { rowNumber: 3, date: '11/4/2026', hours: 2, kennyHours: 0, description: 'Troubleshoot', emergency: true, stockMaterials: '14/2 romex 50ft', materialBought: '' }
  ];
  const expenses = [{ key: '55:1', vendor: 'CED', date: '2026-11-03', amount: 100, description: 'boxes' }];
  const p = pricing.buildLines(rows, expenses, new Map(), RATES);
  assert.strictEqual(p.totals.labor, 4 * 150 + 3 * 95 + 2 * 300);
  assert.strictEqual(p.totals.materials, 122);
  assert.strictEqual(p.totals.total, 1485 + 122);
  assert.strictEqual(p.totals.bobbyHours, 6);
  assert.strictEqual(p.totals.kennyHours, 3);
  const stock = p.lines.find(l => l.kind === 'materials_pending');
  assert.strictEqual(stock.amount, 0);
  assert.match(stock.description, /PRICE NEEDED/);
  assert.ok(p.flags.some(f => /need a price/.test(f)));
});

test('pricing: purchased material with no QBO receipt becomes a flagged $0 line', () => {
  const rows = [{ rowNumber: 2, date: '11/3/2026', hours: 1, kennyHours: 0, description: 'x', emergency: false, stockMaterials: '', materialBought: 'GFCI' }];
  const p = pricing.buildLines(rows, [], new Map(), RATES);
  assert.ok(p.lines.some(l => /COST NEEDED/.test(l.description)));
  assert.ok(p.flags.length === 1);
});

test('guardrails block low-confidence customers, big totals, bad hours', () => {
  const rows = [{ rowNumber: 2, customerName: 'Mike', hours: 14, kennyHours: 0, invoiceNumber: '' }];
  const priced = { lines: [{}], flags: [], totals: { total: 20000 } };
  const r = guardrails.checkJob({ rows, match: { customerId: '1', customerName: 'Mike W', confidence: 'medium' }, priced },
    { maxHoursPerRow: 12, maxInvoiceTotal: 10000 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.blockers.length, 3);

  const good = guardrails.checkJob({
    rows: [{ rowNumber: 2, customerName: 'Mike', hours: 4, kennyHours: 0, invoiceNumber: '' }],
    match: { customerId: '1', customerName: 'Mike W', confidence: 'high' },
    priced: { lines: [{}], flags: [], totals: { total: 600 } }
  }, { maxHoursPerRow: 12, maxInvoiceTotal: 10000 });
  assert.strictEqual(good.ok, true);
});

test('QBO allowlist: no send, delete, void, or customer create', () => {
  assert.doesNotThrow(() => qbo.assertAllowed('POST', '/invoice?minorversion=73'));
  assert.doesNotThrow(() => qbo.assertAllowed('GET', '/invoice/12/pdf'));
  assert.throws(() => qbo.assertAllowed('POST', '/invoice/12/send'));
  assert.throws(() => qbo.assertAllowed('POST', '/invoice?operation=delete'));
  assert.throws(() => qbo.assertAllowed('POST', '/invoice?operation=void'));
  assert.throws(() => qbo.assertAllowed('POST', '/customer'));
  assert.throws(() => qbo.assertAllowed('POST', '/payment'));
});

test('date conversion', () => {
  assert.strictEqual(qbo.toIsoDate('11/3/2026'), '2026-11-03');
  assert.strictEqual(qbo.toIsoDate('garbage'), null);
});

test('customer match: map tab, exact project match, and fuzzy never trusted', async () => {
  const customers = [
    { id: '10', name: 'Elite Construction', displayName: 'Elite Construction' },
    { id: '11', name: 'Elite:581', displayName: '581' },
    { id: '12', name: 'Mike Wurzel', displayName: 'Mike Wurzel' }
  ];
  const exact = await ai.matchCustomer('Elite - 581', '', customers, new Map());
  assert.deepStrictEqual([exact.customerId, exact.confidence], ['11', 'high']);

  const mapped = await ai.matchCustomer('Mikes house', '', customers, new Map([['mikes house', '12']]));
  assert.deepStrictEqual([mapped.customerId, mapped.confidence], ['12', 'high']);

  const fuzzy = await ai.matchCustomer('Wurzel', '', customers, new Map());
  assert.notStrictEqual(fuzzy.confidence, 'high');
});

test('groups rows by customer + project', () => {
  const g = agent.groupByJob([
    { customerName: 'Elite - 581', projectName: '' },
    { customerName: 'elite 581', projectName: '' },
    { customerName: 'Mike Wurzel', projectName: '' }
  ]);
  assert.strictEqual(g.length, 2);
});

test('text message has total, hours, and reply instructions', () => {
  const msg = agent.invoiceMessage('1042', { customerName: 'Elite:581' }, [{}, {}],
    { totals: { total: 1240, labor: 1100, materials: 140, bobbyHours: 6, kennyHours: 2 } }, ['Stock needs price']);
  assert.match(msg, /#1042/);
  assert.match(msg, /\$1,240\.00/);
  assert.match(msg, /Kenny 2h/);
  assert.match(msg, /OK 1042/);
  assert.match(msg, /⚠️ Stock needs price/);
});

test('real form answers: emergency label and bad hours', () => {
  const { rows } = sheet.parseRows([HEADERS,
    row({ Timestamp: 't', 'Hours Worked': '4 hours', 'Emergency Rate?': 'Same day, weekend, or holiday work @ $300/HR' }),
    row({ Timestamp: 't', 'Hours Worked': '4-8', 'Emergency Rate?': 'No' })]);
  assert.strictEqual(rows[0].hours, 4);
  assert.strictEqual(rows[0].emergency, true);
  assert.ok(isNaN(rows[1].hours));
  assert.strictEqual(rows[1].emergency, false);
});
