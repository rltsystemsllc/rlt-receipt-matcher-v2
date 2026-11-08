/**
 * The two judgment calls the agent hands to Claude:
 *   1. Which QBO customer does a messy form name mean?
 *   2. Turn Bobby's quick notes into clean invoice line text.
 *
 * Claude never sees dollar amounts or the bookkeeper-notes column, and its output is
 * validated before use. Without ANTHROPIC_API_KEY everything falls back to plain code.
 */

const Anthropic = require('@anthropic-ai/sdk');
const cfg = require('./config');
const { normalize } = require('./sheet');
const logger = require('../utils/logger');

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new (Anthropic.default || Anthropic)();
  return client;
}

async function askJson(system, user, schema) {
  const c = getClient();
  if (!c) return null;
  const res = await c.beta.messages.create({
    model: cfg.ai.model,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: user }]
  });
  if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') {
    logger.warn('Billing Agent AI: no usable answer', { stop: res.stop_reason });
    return null;
  }
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Deterministic matching first; Claude only for the leftovers.
 * Returns { customerId, customerName, confidence: 'high'|'medium'|'low', reason }
 */
async function matchCustomer(sheetCustomer, sheetProject, customers, customerMap) {
  const key = normalize(sheetCustomer);
  const keyWithProject = normalize(`${sheetCustomer} ${sheetProject}`);

  // 1. Manual Customer Map tab always wins
  const mapped = customerMap.get(keyWithProject) || customerMap.get(key);
  if (mapped) {
    const c = customers.find(x => x.id === mapped);
    if (c) return { customerId: c.id, customerName: c.name, confidence: 'high', reason: 'Customer Map tab' };
  }

  // 2. Exact name match (unique)
  const exact = customers.filter(c => normalize(c.name) === key || normalize(c.displayName) === key ||
    (sheetProject && normalize(c.name) === keyWithProject));
  if (exact.length === 1) {
    return { customerId: exact[0].id, customerName: exact[0].name, confidence: 'high', reason: 'exact name match' };
  }

  // 3. Claude
  const list = customers.map(c => `${c.id}\t${c.name}`).join('\n');
  const answer = await askJson(
    'You match electrician job-log entries to QuickBooks customers. Pick only from the list. ' +
      'Use "high" only when the entry clearly names that customer or project; if two customers ' +
      'could fit or nothing fits, use "low" and customer_id "".',
    `Job log entry:\nCustomer/job: ${sheetCustomer}\nProject: ${sheetProject || '(none)'}\n\nQuickBooks customers (id<TAB>name):\n${list}`,
    {
      type: 'object',
      properties: {
        customer_id: { type: 'string' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        reason: { type: 'string' }
      },
      required: ['customer_id', 'confidence', 'reason'],
      additionalProperties: false
    }
  ).catch(e => {
    logger.warn('Billing Agent AI match failed', { error: e.message });
    return null;
  });

  if (answer) {
    const c = customers.find(x => x.id === answer.customer_id);
    if (c) return { customerId: c.id, customerName: c.name, confidence: answer.confidence, reason: answer.reason };
    return { customerId: null, confidence: 'low', reason: answer.reason };
  }

  // 4. No AI: loose contains-match, never trusted for auto-drafting
  const loose = customers.filter(c => {
    const n = normalize(c.name);
    return key && (n.includes(key) || key.includes(normalize(c.displayName)));
  });
  if (loose.length === 1) {
    return { customerId: loose[0].id, customerName: loose[0].name, confidence: 'medium', reason: 'partial name match' };
  }
  return { customerId: null, confidence: 'low', reason: loose.length ? 'several possible customers' : 'no similar customer' };
}

/**
 * Returns Map(rowNumber -> cleaned text). Missing/invalid output = raw text is used.
 */
async function cleanDescriptions(rows) {
  const input = rows.filter(r => r.description).map(r => ({ row: r.rowNumber, phase: r.phase, text: r.description }));
  if (!input.length) return new Map();

  const answer = await askJson(
    'Rewrite an electrician\'s quick job notes as short, professional invoice line descriptions ' +
      '(under 120 characters each). Fix spelling, keep every task mentioned, add nothing that ' +
      'isn\'t in the note, and never include prices, hours, or personal remarks.',
    JSON.stringify(input),
    {
      type: 'object',
      properties: {
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: { row: { type: 'integer' }, text: { type: 'string' } },
            required: ['row', 'text'],
            additionalProperties: false
          }
        }
      },
      required: ['lines'],
      additionalProperties: false
    }
  ).catch(e => {
    logger.warn('Billing Agent AI descriptions failed', { error: e.message });
    return null;
  });

  const out = new Map();
  if (!answer?.lines) return out;
  const wanted = new Set(input.map(i => i.row));
  for (const l of answer.lines) {
    const text = String(l.text || '').trim();
    if (wanted.has(l.row) && text && !/\$|\d+(\.\d+)?\s*(hrs?|hours)\b/i.test(text)) {
      out.set(l.row, text.slice(0, 200));
    }
  }
  return out;
}

module.exports = { matchCustomer, cleanDescriptions };
