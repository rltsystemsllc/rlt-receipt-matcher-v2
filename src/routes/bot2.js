/**
 * Bot 2 - Invoice Drafter Routes
 * Dashboard and API for the billing automation bot
 * 
 * Features 5 Layers of Protection:
 * Layer 1: Pre-flight sanity checks
 * Layer 2: Detailed preview in approval SMS
 * Layer 3: Undo window (5-min delay)
 * Layer 4: Two-stage approval for large invoices
 * Layer 5: Daily reconciliation summary
 */

const express = require('express');
const router = express.Router();
const config = require('../config');
const bot2 = require('../bot2');
const logger = require('../utils/logger');

// Try to load AI service for status
let aiService = null;
try {
  aiService = require('../bot2/ai');
} catch (e) {
  // AI service not available
}

/**
 * Dashboard styles
 */
const styles = `
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #0f2027 50%, #203a43 100%);
      min-height: 100vh;
      margin: 0;
      padding: 20px;
      color: #e0e0e0;
    }
    .container {
      max-width: 1100px;
      margin: 0 auto;
    }
    h1 {
      color: #00d4aa;
      text-align: center;
      font-size: 2.5rem;
      margin-bottom: 10px;
      text-shadow: 0 0 20px rgba(0, 212, 170, 0.3);
    }
    .subtitle {
      text-align: center;
      color: #888;
      margin-bottom: 30px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .card {
      background: rgba(255, 255, 255, 0.05);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 24px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    }
    .card h2 {
      color: #00d4aa;
      margin-top: 0;
      font-size: 1.2rem;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .card-full { grid-column: 1 / -1; }
    .status-badge {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .status-ok { background: rgba(0, 212, 170, 0.2); color: #00d4aa; border: 1px solid #00d4aa; }
    .status-warn { background: rgba(255, 193, 7, 0.2); color: #ffc107; border: 1px solid #ffc107; }
    .status-error { background: rgba(244, 67, 54, 0.2); color: #f44336; border: 1px solid #f44336; }
    .btn {
      display: inline-block;
      padding: 12px 24px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.3s;
      margin: 5px;
    }
    .btn-primary { background: #00d4aa; color: #1a1a2e; }
    .btn-primary:hover { background: #00e4ba; transform: translateY(-2px); }
    .btn-secondary { background: rgba(255, 255, 255, 0.1); color: #e0e0e0; border: 1px solid rgba(255, 255, 255, 0.2); }
    .btn-secondary:hover { background: rgba(255, 255, 255, 0.2); }
    .stat-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    .stat-row:last-child { border-bottom: none; }
    .stat-label { color: #888; }
    .stat-value { color: #fff; font-weight: 600; }
    .config-value { color: #00d4aa; font-family: monospace; }
    .actions { text-align: center; margin-top: 20px; }
    .layer {
      display: flex;
      align-items: flex-start;
      gap: 15px;
      padding: 15px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 10px;
      margin-bottom: 10px;
    }
    .layer:last-child { margin-bottom: 0; }
    .layer-icon {
      font-size: 1.5rem;
      min-width: 40px;
      text-align: center;
    }
    .layer-content h3 {
      margin: 0 0 5px 0;
      color: #fff;
      font-size: 1rem;
    }
    .layer-content p {
      margin: 0;
      color: #888;
      font-size: 0.9rem;
      line-height: 1.4;
    }
    .weekly-stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
      text-align: center;
    }
    .weekly-stat {
      padding: 15px;
      background: rgba(0, 212, 170, 0.1);
      border-radius: 10px;
    }
    .weekly-stat-value {
      font-size: 1.8rem;
      font-weight: 700;
      color: #00d4aa;
    }
    .weekly-stat-label {
      font-size: 0.85rem;
      color: #888;
    }
    .sms-commands {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }
    .sms-cmd {
      padding: 10px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
    }
    .sms-cmd code {
      color: #00d4aa;
      font-weight: 600;
    }
    .sms-cmd span {
      color: #888;
      font-size: 0.85rem;
    }
  </style>
`;

/**
 * Bot 2 Dashboard
 */
router.get('/', async (req, res) => {
  try {
    const status = bot2.getStatus();

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Bot 2 - Invoice Drafter | RLT Automation</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        ${styles}
      </head>
      <body>
        <div class="container">
          <h1>📝 Bot 2 — Invoice Drafter</h1>
          <p class="subtitle">Protected by 5 Layers of Safeguards • Celebration Messages Enabled 🎉</p>

          <div class="grid">
            <!-- Weekly Stats -->
            <div class="card card-full">
              <h2>📊 This Week's Performance</h2>
              <div class="weekly-stats">
                <div class="weekly-stat">
                  <div class="weekly-stat-value">${status.weeklyStats?.invoicesSent || 0}</div>
                  <div class="weekly-stat-label">Invoices Sent</div>
                </div>
                <div class="weekly-stat">
                  <div class="weekly-stat-value">$${(status.weeklyStats?.totalAmount || 0).toLocaleString()}</div>
                  <div class="weekly-stat-label">Revenue Billed</div>
                </div>
                <div class="weekly-stat">
                  <div class="weekly-stat-value">$${(status.weeklyStats?.totalProfit || 0).toLocaleString()}</div>
                  <div class="weekly-stat-label">Total Profit</div>
                </div>
              </div>
            </div>

            <!-- System Status -->
            <div class="card">
              <h2>⚡ System Status</h2>
              <div class="stat-row">
                <span class="stat-label">Scheduler</span>
                <span class="status-badge ${status.schedulerRunning ? 'status-ok' : 'status-warn'}">
                  ${status.schedulerRunning ? '● Running' : '○ Stopped'}
                </span>
              </div>
              <div class="stat-row">
                <span class="stat-label">OpenAI (Smart Descriptions)</span>
                <span class="stat-value">${aiService?.isAvailable() ? '✅ Active' : '❌ Not Set'}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Pending Approvals</span>
                <span class="stat-value">${status.pendingApprovals || 0}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Google Sheets</span>
                <span class="stat-value">${status.config.spreadsheetId}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">RingCentral SMS</span>
                <span class="stat-value">${status.config.ringcentralConfigured ? '✅ Ready' : '❌ Not Set'}</span>
              </div>
            </div>

            <!-- Billing Rates -->
            <div class="card">
              <h2>💰 Billing Configuration</h2>
              <div class="stat-row">
                <span class="stat-label">Standard Labor</span>
                <span class="config-value">$${status.config.laborRateStandard}/hr</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Emergency Labor</span>
                <span class="config-value">$${status.config.laborRateEmergency}/hr</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Stock Markup</span>
                <span class="config-value">${status.config.stockMarkupPercent}%</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Undo Window</span>
                <span class="config-value">${status.config.undoWindowMinutes} min</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Large Invoice Threshold</span>
                <span class="config-value">$${status.config.largeInvoiceThreshold}</span>
              </div>
            </div>
          </div>

          <!-- 4 Protection Layers -->
          <div class="card">
            <h2>🛡️ 4 Layers of Protection</h2>
            
            <div class="layer">
              <div class="layer-icon">1️⃣</div>
              <div class="layer-content">
                <h3>Pre-Flight Sanity Checks</h3>
                <p>Flags unusual hours (>${config.safeguards.maxHoursPerDay}/day), missing materials, negative profit margins, weekend work without emergency rate.</p>
              </div>
            </div>

            <div class="layer">
              <div class="layer-icon">2️⃣</div>
              <div class="layer-content">
                <h3>Detailed Preview in SMS</h3>
                <p>Shows every line item, labor breakdown, materials from Smart Receipt Bot, profit calculation, and customer email before approval.</p>
              </div>
            </div>

            <div class="layer">
              <div class="layer-icon">3️⃣</div>
              <div class="layer-content">
                <h3>Undo Window (${config.safeguards.undoWindowMinutes} min)</h3>
                <p>After approval, invoice waits ${config.safeguards.undoWindowMinutes} minutes before sending. Reply UNDO to cancel if you spot an error.</p>
              </div>
            </div>

            <div class="layer">
              <div class="layer-icon">4️⃣</div>
              <div class="layer-content">
                <h3>Daily Reconciliation (${config.safeguards.dailyReconciliationTime})</h3>
                <p>End-of-day summary of all invoices sent. Reply OK to confirm or ISSUE to flag a problem.</p>
              </div>
            </div>
          </div>

          <!-- SMS Commands -->
          <div class="card">
            <h2>📱 SMS Commands</h2>
            <div class="sms-commands">
              <div class="sms-cmd"><code>APPROVE</code> <span>Send invoice to customer</span></div>
              <div class="sms-cmd"><code>HOLD</code> <span>Keep as draft in QBO</span></div>
              <div class="sms-cmd"><code>REVIEW</code> <span>See PDF preview (large invoices)</span></div>
              <div class="sms-cmd"><code>FIX</code> <span>Cancel and correct errors</span></div>
              <div class="sms-cmd"><code>UNDO</code> <span>Cancel send (within ${config.safeguards.undoWindowMinutes} min)</span></div>
              <div class="sms-cmd"><code>SNOOZE</code> <span>Pause reminders 24 hrs</span></div>
              <div class="sms-cmd"><code>SNOOZE 1H</code> <span>Pause for 1 hour</span></div>
              <div class="sms-cmd"><code>SNOOZE EOD</code> <span>Pause until end of day</span></div>
            </div>
          </div>

          <!-- Actions -->
          <div class="card">
            <h2>🎮 Actions</h2>
            <div class="actions">
              <button onclick="triggerRun()" class="btn btn-primary" id="runBtn">
                ▶️ Check for Urgent Billing
              </button>
              <button onclick="sendReconciliation()" class="btn btn-secondary" id="reconBtn">
                📊 Send Daily Summary Now
              </button>
              <a href="/auth/sheets" class="btn btn-secondary">🔗 Connect Sheets</a>
            </div>
            <p id="actionStatus" style="text-align: center; color: #888; margin-top: 15px;"></p>
          </div>
          
          <script>
            async function triggerRun() {
              const btn = document.getElementById('runBtn');
              const status = document.getElementById('actionStatus');
              btn.disabled = true;
              btn.textContent = '⏳ Processing...';
              
              try {
                const response = await fetch('/bot2/api/run', { method: 'POST' });
                const result = await response.json();
                
                if (result.success) {
                  btn.textContent = '✅ Complete';
                  status.innerHTML = '<span style="color: #00d4aa;">Check completed successfully</span>';
                } else {
                  btn.textContent = '❌ Error';
                  status.innerHTML = '<span style="color: #f44336;">' + (result.error || 'Unknown error') + '</span>';
                }
              } catch (error) {
                btn.textContent = '❌ Error';
                status.innerHTML = '<span style="color: #f44336;">' + error.message + '</span>';
              }
              
              setTimeout(() => {
                btn.disabled = false;
                btn.textContent = '▶️ Check for Urgent Billing';
              }, 3000);
            }

            async function sendReconciliation() {
              const btn = document.getElementById('reconBtn');
              btn.disabled = true;
              btn.textContent = '⏳ Sending...';
              
              try {
                const response = await fetch('/bot2/api/reconciliation', { method: 'POST' });
                const result = await response.json();
                
                if (result.success) {
                  btn.textContent = '✅ Sent';
                } else {
                  btn.textContent = '❌ Error';
                }
              } catch (error) {
                btn.textContent = '❌ Error';
              }
              
              setTimeout(() => {
                btn.disabled = false;
                btn.textContent = '📊 Send Daily Summary Now';
              }, 3000);
            }
          </script>

          <p style="text-align: center; margin-top: 40px; color: #666;">
            <a href="/" style="color: #00d4aa;">← Back to Main Dashboard</a> |
            <a href="/bot3" style="color: #4fc3f7;">Bot 3 - Inventory</a> |
            <a href="/smart-receipt" style="color: #ff9800;">Smart Receipt Bot</a>
          </p>
        </div>
      </body>
      </html>
    `;

    res.send(html);
  } catch (error) {
    logger.error('Bot 2 Dashboard error', { error: error.message });
    res.status(500).send(`Error loading dashboard: ${error.message}`);
  }
});

/**
 * API: Get status
 */
router.get('/api/status', (req, res) => {
  const status = bot2.getStatus();
  res.json({ success: true, status });
});

/**
 * API: Trigger manual run
 */
router.post('/api/run', async (req, res) => {
  try {
    await bot2.triggerManualRun();
    res.json({ success: true, message: 'Manual run completed' });
  } catch (error) {
    logger.error('Bot 2 manual run failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * API: Send daily reconciliation now
 */
router.post('/api/reconciliation', async (req, res) => {
  try {
    await bot2.sendDailyReconciliation();
    res.json({ success: true, message: 'Reconciliation sent' });
  } catch (error) {
    logger.error('Bot 2 reconciliation failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Webhook for incoming SMS from RingCentral
 */
router.post('/webhook/sms', async (req, res) => {
  try {
    // Handle RingCentral webhook validation
    if (req.body.validation_token) {
      res.json({ validation_token: req.body.validation_token });
      return;
    }

    // Extract SMS data
    const from = req.body.from || req.body.body?.from?.phoneNumber;
    const text = req.body.text || req.body.body?.attachments?.[0]?.content;

    if (from && text) {
      await bot2.handleSmsResponse(from, text);
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Bot 2 SMS webhook error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
