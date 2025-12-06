/**
 * Smart Receipt Bot Routes
 * 
 * API endpoints for the new simplified receipt categorization system
 */

const express = require('express');
const router = express.Router();
const smartReceiptBot = require('../smart-receipt-bot');
const qboMonitor = require('../smart-receipt-bot/qbo-monitor');
const groupSMS = require('../smart-receipt-bot/group-sms');
const openaiParser = require('../smart-receipt-bot/openai-parser');
const logger = require('../utils/logger');

/**
 * Dashboard for Smart Receipt Bot
 */
router.get('/', async (req, res) => {
  try {
    const summary = await qboMonitor.getDailySummary();
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Smart Receipt Bot</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #fff;
            min-height: 100vh;
            padding: 20px;
          }
          .container { max-width: 800px; margin: 0 auto; }
          h1 { 
            font-size: 2rem; 
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 10px;
          }
          .subtitle { color: #888; margin-bottom: 30px; }
          .card {
            background: rgba(255,255,255,0.05);
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 20px;
            border: 1px solid rgba(255,255,255,0.1);
          }
          .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
          }
          .stat {
            text-align: center;
            padding: 15px;
            background: rgba(255,255,255,0.03);
            border-radius: 8px;
          }
          .stat-value {
            font-size: 2rem;
            font-weight: bold;
            color: #4ade80;
          }
          .stat-value.warning { color: #fbbf24; }
          .stat-label { color: #888; font-size: 0.9rem; margin-top: 5px; }
          .btn {
            display: inline-block;
            padding: 12px 24px;
            border-radius: 8px;
            text-decoration: none;
            font-weight: 600;
            cursor: pointer;
            border: none;
            font-size: 1rem;
            margin: 5px;
          }
          .btn-primary { background: #3b82f6; color: white; }
          .btn-success { background: #22c55e; color: white; }
          .btn-warning { background: #f59e0b; color: white; }
          .btn:hover { opacity: 0.9; transform: translateY(-1px); }
          .actions { margin-top: 20px; }
          .flow {
            background: rgba(0,0,0,0.2);
            padding: 20px;
            border-radius: 8px;
            font-family: monospace;
            font-size: 0.9rem;
            white-space: pre-line;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🤖 Smart Receipt Bot</h1>
          <p class="subtitle">Automated expense categorization via SMS</p>
          
          <div class="card">
            <h2 style="margin-bottom: 15px;">📊 Today's Summary</h2>
            <div class="stats">
              <div class="stat">
                <div class="stat-value">${summary.categorized}</div>
                <div class="stat-label">Categorized</div>
              </div>
              <div class="stat">
                <div class="stat-value warning">${summary.pending}</div>
                <div class="stat-label">Pending</div>
              </div>
              <div class="stat">
                <div class="stat-value">$${summary.billableAmount.toFixed(0)}</div>
                <div class="stat-label">Billable</div>
              </div>
              <div class="stat">
                <div class="stat-value">$${summary.stockAmount.toFixed(0)}</div>
                <div class="stat-label">Stock</div>
              </div>
            </div>
          </div>

          <div class="card">
            <h2 style="margin-bottom: 15px;">⚡ Actions</h2>
            <div class="actions">
              <button class="btn btn-primary" onclick="checkNow()">🔍 Check for New Transactions</button>
              <button class="btn btn-success" onclick="sendSummary()">📱 Send Summary to Group</button>
              <button class="btn btn-warning" onclick="testSMS()">🧪 Test Group SMS</button>
            </div>
          </div>

          <div class="card">
            <h2 style="margin-bottom: 15px;">📱 How It Works</h2>
            <div class="flow">
1️⃣ Bank transaction arrives in QBO "For Review"
2️⃣ Bot finds matching receipt (Gmail or Bobby's photo)
3️⃣ OpenAI reads job name from receipt
4️⃣ If job found → Auto-categorize, confirm to group
5️⃣ If no job → Ask Bobby/Jessica via group SMS
6️⃣ Reply with job name → QBO updated
            </div>
          </div>

          <div class="card">
            <h2 style="margin-bottom: 15px;">💬 SMS Commands</h2>
            <table style="width: 100%; color: #ccc;">
              <tr><td style="padding: 5px;"><code>Wailea</code></td><td>Assign to Wailea job (billable)</td></tr>
              <tr><td style="padding: 5px;"><code>SHOP</code></td><td>Mark as stock (not billable)</td></tr>
              <tr><td style="padding: 5px;"><code>SKIP</code></td><td>Skip for now, ask later</td></tr>
              <tr><td style="padding: 5px;"><code>?</code></td><td>List recent jobs</td></tr>
              <tr><td style="padding: 5px;"><code>[Photo]</code></td><td>Send receipt photo to match</td></tr>
            </table>
          </div>
        </div>

        <script>
          async function checkNow() {
            const btn = event.target;
            btn.textContent = '⏳ Checking...';
            try {
              const res = await fetch('/smart-receipt/api/check', { method: 'POST' });
              const data = await res.json();
              alert(data.message || 'Check complete!');
            } catch (e) {
              alert('Error: ' + e.message);
            }
            btn.textContent = '🔍 Check for New Transactions';
          }

          async function sendSummary() {
            const btn = event.target;
            btn.textContent = '⏳ Sending...';
            try {
              const res = await fetch('/smart-receipt/api/summary', { method: 'POST' });
              const data = await res.json();
              alert(data.message || 'Summary sent!');
            } catch (e) {
              alert('Error: ' + e.message);
            }
            btn.textContent = '📱 Send Summary to Group';
          }

          async function testSMS() {
            try {
              const res = await fetch('/smart-receipt/api/test-sms', { method: 'POST' });
              const data = await res.json();
              alert(data.message || 'Test SMS sent!');
            } catch (e) {
              alert('Error: ' + e.message);
            }
          }
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    logger.error('Smart Receipt dashboard error', { error: error.message });
    res.status(500).send('Error loading dashboard');
  }
});

/**
 * API: Manually trigger transaction check
 */
router.post('/api/check', async (req, res) => {
  try {
    await smartReceiptBot.checkForNewTransactions();
    res.json({ success: true, message: 'Check complete' });
  } catch (error) {
    logger.error('Manual check failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * API: Send daily summary to group
 */
router.post('/api/summary', async (req, res) => {
  try {
    await smartReceiptBot.sendDailySummary();
    res.json({ success: true, message: 'Summary sent to group' });
  } catch (error) {
    logger.error('Summary send failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * API: Test group SMS
 */
router.post('/api/test-sms', async (req, res) => {
  try {
    await groupSMS.send('🧪 Test message from Smart Receipt Bot!');
    res.json({ success: true, message: 'Test SMS sent to Bobby and Jessica' });
  } catch (error) {
    logger.error('Test SMS failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * API: Test OpenAI receipt parsing
 */
router.post('/api/test-parse', async (req, res) => {
  try {
    const { imageUrl, imageBase64 } = req.body;
    
    if (!imageUrl && !imageBase64) {
      return res.status(400).json({ 
        success: false, 
        error: 'Provide imageUrl or imageBase64' 
      });
    }

    const result = await openaiParser.parseReceipt(imageBase64 || imageUrl);
    res.json({ success: true, parsed: result });

  } catch (error) {
    logger.error('Test parse failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * API: Get status
 */
router.get('/api/status', async (req, res) => {
  try {
    const summary = await qboMonitor.getDailySummary();
    
    res.json({
      success: true,
      status: 'running',
      summary,
      groupMembers: groupSMS.GROUP_MEMBERS.map(m => m.name)
    });

  } catch (error) {
    logger.error('Status check failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Webhook: Handle incoming SMS (from RingCentral)
 */
router.post('/webhook/sms', async (req, res) => {
  try {
    const message = req.body;
    
    logger.info('Received SMS webhook', { 
      from: message.from,
      hasAttachment: message.attachments?.length > 0 
    });

    if (message.attachments && message.attachments.length > 0) {
      // Photo received
      await smartReceiptBot.handleIncomingPhoto(message);
    } else {
      // Text reply
      await smartReceiptBot.handleSMSReply(message);
    }

    res.json({ success: true });

  } catch (error) {
    logger.error('SMS webhook error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

