/**
 * Billing Agent endpoints. All require header  x-billing-agent-token: $BILLING_AGENT_TOKEN
 * (disabled entirely if BILLING_AGENT_TOKEN is not set).
 *
 *   GET  /billing-agent/status
 *   POST /billing-agent/run            body: { "mode": "dry_run" | "draft", "urgentOnly": false }
 */
const express = require('express');
const crypto = require('crypto');
const billingAgent = require('../billing-agent');

const router = express.Router();

router.use((req, res, next) => {
  const expected = process.env.BILLING_AGENT_TOKEN;
  const got = req.get('x-billing-agent-token') || '';
  if (!expected) return res.status(404).json({ error: 'Not found' });
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

router.get('/status', (req, res) => res.json(billingAgent.status()));

router.post('/run', async (req, res) => {
  const mode = req.body?.mode === 'draft' ? 'draft' : 'dry_run';
  try {
    const result = await billingAgent.run({ mode, urgentOnly: !!req.body?.urgentOnly });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
