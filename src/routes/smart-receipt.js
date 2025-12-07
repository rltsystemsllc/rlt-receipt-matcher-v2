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
const dataQABot = require('../services/data-qa-bot');
const ringcentral = require('../bot2/ringcentral');
const logger = require('../utils/logger');

/**
 * Check if a message is a question for the Data Q&A Bot
 */
function isDataQuestion(text) {
  if (!text) return false;
  const questionPatterns = [
    /cash/i, /bank/i, /balance/i, /money/i,
    /ar\b/i, /receivable/i, /owed/i, /owes/i, /who owes/i,
    /overdue/i, /late/i, /past due/i,
    /revenue/i, /billed/i, /invoiced/i,
    /this week/i, /last week/i,
    /collected/i, /payments/i, /paid/i,
    /margin/i, /profit/i, /gross/i,
    /expense/i, /spent/i, /spending/i,
    /runway/i, /survive/i,
    /wins/i, /winning/i, /progress/i,
    /credit card/i, /amex/i, /card balance/i,
    /summary/i, /overview/i, /scorecard/i, /numbers/i,
    /system/i, /process/i, /automate/i,
    /grow/i, /scale/i,
    /delegate/i, /hire/i, /help/i,
    /client/i, /customer/i,
    /sales/i, /marketing/i,
    /focus/i, /priority/i,
    /why/i, /purpose/i,
    /\?$/  // Ends with question mark
  ];
  return questionPatterns.some(p => p.test(text));
}

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
            <div class="actions" style="margin-top: 10px;">
              <button class="btn btn-primary" onclick="setupWebhook()">📥 Setup SMS Webhook</button>
              <button class="btn btn-success" onclick="testQA()">❓ Test Q&A: "cash?"</button>
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
            <h2 style="margin-bottom: 15px;">📊 Ask About Your Numbers</h2>
            <table style="width: 100%; color: #ccc;">
              <tr><td style="padding: 5px;"><code>cash?</code></td><td>Bank balance + insights</td></tr>
              <tr><td style="padding: 5px;"><code>who owes me?</code></td><td>AR outstanding + top invoices</td></tr>
              <tr><td style="padding: 5px;"><code>this week?</code></td><td>Revenue vs last week</td></tr>
              <tr><td style="padding: 5px;"><code>margin?</code></td><td>Gross margin YTD</td></tr>
              <tr><td style="padding: 5px;"><code>runway?</code></td><td>Weeks of cash runway</td></tr>
              <tr><td style="padding: 5px;"><code>wins?</code></td><td>This week's wins</td></tr>
              <tr><td style="padding: 5px;"><code>summary?</code></td><td>Quick overview of everything</td></tr>
            </table>
          </div>

          <div class="card">
            <h2 style="margin-bottom: 15px;">💬 Receipt Commands</h2>
            <table style="width: 100%; color: #ccc;">
              <tr><td style="padding: 5px;"><code>Wailea</code></td><td>Assign to Wailea job (billable)</td></tr>
              <tr><td style="padding: 5px;"><code>SHOP</code></td><td>Mark as stock (not billable)</td></tr>
              <tr><td style="padding: 5px;"><code>SKIP</code></td><td>Skip for now, ask later</td></tr>
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

          async function setupWebhook() {
            const btn = event.target;
            btn.textContent = '⏳ Setting up...';
            try {
              const res = await fetch('/smart-receipt/api/setup-webhook', { method: 'POST' });
              const data = await res.json();
              if (data.success) {
                alert('✅ Webhook registered!\\n\\nURL: ' + data.webhookUrl + '\\n\\nYou can now text questions to the bot!');
              } else {
                alert('Error: ' + (data.error || 'Unknown error'));
              }
            } catch (e) {
              alert('Error: ' + e.message);
            }
            btn.textContent = '📥 Setup SMS Webhook';
          }

          async function testQA() {
            const btn = event.target;
            btn.textContent = '⏳ Asking...';
            try {
              const res = await fetch('/smart-receipt/api/ask-sms', { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: 'cash?' })
              });
              const data = await res.json();
              if (data.success) {
                alert('✅ Q&A response sent to group SMS!');
              } else {
                alert('Error: ' + (data.error || data.response || 'Unknown error'));
              }
            } catch (e) {
              alert('Error: ' + e.message);
            }
            btn.textContent = '❓ Test Q&A: "cash?"';
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
    const payload = req.body;
    
    // Handle RingCentral webhook validation
    if (payload.validation_token) {
      logger.info('RingCentral webhook validation request');
      return res.json({ validation_token: payload.validation_token });
    }
    
    // Process the webhook payload
    const message = await ringcentral.processIncomingWebhook(payload);
    
    if (!message) {
      logger.warn('Could not parse webhook payload');
      return res.json({ success: true, parsed: false });
    }
    
    const text = message.text || '';
    
    logger.info('Received SMS', { 
      from: message.from,
      text: text.substring(0, 50),
      hasAttachment: message.attachments?.length > 0 
    });

    // Check if it's a data question
    if (isDataQuestion(text)) {
      logger.info('Routing to Data Q&A Bot', { question: text });
      
      // Process with Q&A Bot
      const result = await dataQABot.processQuestion(text);
      
      // Send response back via SMS
      await groupSMS.send(result.response);
      
      return res.json({ success: true, type: 'qa', response: result.response });
    }

    // Otherwise handle as receipt/categorization flow
    if (message.attachments && message.attachments.length > 0) {
      // Photo received
      await smartReceiptBot.handleIncomingPhoto(message);
    } else if (text) {
      // Text reply for categorization
      await smartReceiptBot.handleSMSReply(message);
    }

    res.json({ success: true });

  } catch (error) {
    logger.error('SMS webhook error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * API: Register RingCentral webhook for incoming SMS
 */
router.post('/api/setup-webhook', async (req, res) => {
  try {
    // Get the base URL from request or config
    const baseUrl = req.body.baseUrl || 
                    process.env.BASE_URL || 
                    `${req.protocol}://${req.get('host')}`;
    
    const webhookUrl = `${baseUrl}/smart-receipt/webhook/sms`;
    
    logger.info('Setting up RingCentral webhook', { webhookUrl });
    
    const subscription = await ringcentral.setupWebhook(webhookUrl);
    
    res.json({ 
      success: true, 
      message: 'Webhook registered!',
      webhookUrl,
      subscriptionId: subscription.id,
      expiresAt: subscription.expirationTime
    });

  } catch (error) {
    logger.error('Failed to setup webhook', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * API: Check webhook status
 */
router.get('/api/webhook-status', async (req, res) => {
  try {
    const isAuth = await ringcentral.isAuthenticated();
    
    if (!isAuth) {
      return res.json({ 
        success: false, 
        authenticated: false,
        message: 'RingCentral not authenticated' 
      });
    }
    
    res.json({ 
      success: true, 
      authenticated: true,
      message: 'RingCentral connected. Click "Setup Webhook" if not receiving messages.'
    });

  } catch (error) {
    logger.error('Webhook status check failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * API: Test Q&A Bot via API (for testing without SMS)
 */
router.post('/api/ask', async (req, res) => {
  try {
    const { question } = req.body;
    
    if (!question) {
      return res.status(400).json({ 
        success: false, 
        error: 'Provide a question' 
      });
    }

    const result = await dataQABot.processQuestion(question);
    res.json({ success: true, ...result });

  } catch (error) {
    logger.error('Q&A API error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * API: Ask Q&A Bot and send response to group SMS
 */
router.post('/api/ask-sms', async (req, res) => {
  try {
    const { question } = req.body;
    
    if (!question) {
      return res.status(400).json({ 
        success: false, 
        error: 'Provide a question' 
      });
    }

    const result = await dataQABot.processQuestion(question);
    
    // Send to group
    await groupSMS.send(result.response);
    
    res.json({ success: true, sent: true, ...result });

  } catch (error) {
    logger.error('Q&A SMS API error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * API: Get recent transactions from QBO (for analyzing exclusions)
 */
router.get('/api/recent-transactions', async (req, res) => {
  try {
    const qboClient = require('../services/quickbooks/client');
    
    const isAuth = await qboClient.authenticate();
    if (!isAuth) {
      return res.status(401).json({ success: false, error: 'QBO not authenticated' });
    }

    // Get purchases from last 60 days
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const dateStr = sixtyDaysAgo.toISOString().split('T')[0];

    const response = await qboClient.makeApiCall('GET',
      `/query?query=${encodeURIComponent(
        `SELECT * FROM Purchase WHERE TxnDate >= '${dateStr}' ORDER BY TxnDate DESC MAXRESULTS 200`
      )}`
    );

    const purchases = response.QueryResponse?.Purchase || [];

    // Get unique vendors with counts and amounts
    const vendorStats = {};
    for (const p of purchases) {
      const vendor = p.EntityRef?.name || 'Unknown';
      const accountName = p.AccountRef?.name || '';
      const key = vendor;
      
      if (!vendorStats[key]) {
        vendorStats[key] = {
          vendor,
          accountName,
          count: 0,
          totalAmount: 0,
          hasCustomer: false,
          excluded: qboMonitor.shouldExcludeTransaction(p),
          sample: {
            date: p.TxnDate,
            amount: p.TotalAmt,
            memo: p.PrivateNote || ''
          }
        };
      }
      
      vendorStats[key].count++;
      vendorStats[key].totalAmount += p.TotalAmt;
      
      const hasCustomer = p.Line?.some(line => 
        line.AccountBasedExpenseLineDetail?.CustomerRef
      );
      if (hasCustomer) vendorStats[key].hasCustomer = true;
    }

    // Convert to array and sort by count
    const vendors = Object.values(vendorStats).sort((a, b) => b.count - a.count);

    res.json({
      success: true,
      totalTransactions: purchases.length,
      uniqueVendors: vendors.length,
      vendors,
      exclusionPatterns: qboMonitor.getExclusionPatterns()
    });

  } catch (error) {
    logger.error('Recent transactions API error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

