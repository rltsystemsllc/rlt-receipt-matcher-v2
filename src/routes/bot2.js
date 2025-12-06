/**
 * Bot 2 - Invoice Drafter Routes
 * Dashboard and API for the billing automation bot
 */

const express = require('express');
const router = express.Router();
const config = require('../config');
const bot2 = require('../bot2');
const logger = require('../utils/logger');

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
      max-width: 1000px;
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
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
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
          <p class="subtitle">RLT Automation System • Billing Automation</p>

          <div class="grid">
            <!-- Status Card -->
            <div class="card">
              <h2>📊 System Status</h2>
              <div class="stat-row">
                <span class="stat-label">Scheduler</span>
                <span class="status-badge ${status.schedulerRunning ? 'status-ok' : 'status-warn'}">
                  ${status.schedulerRunning ? '● Running' : '○ Stopped'}
                </span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Processing</span>
                <span class="stat-value">${status.isProcessing ? 'Yes' : 'No'}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Google Sheets</span>
                <span class="stat-value">${status.config.spreadsheetId}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">RingCentral</span>
                <span class="stat-value">${status.config.ringcentralConfigured ? '✅ Configured' : '❌ Not Set'}</span>
              </div>
            </div>

            <!-- Billing Rates -->
            <div class="card">
              <h2>💰 Billing Rates</h2>
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
            </div>
          </div>

          <!-- Actions -->
          <div class="card">
            <h2>🎮 Actions</h2>
            <div class="actions">
              <button onclick="triggerRun()" class="btn btn-primary" id="runBtn">
                ▶️ Check for Urgent Billing
              </button>
              <a href="/auth/sheets" class="btn btn-secondary">Connect Google Sheets</a>
              <a href="/auth/ringcentral" class="btn btn-secondary">Test RingCentral</a>
            </div>
            <p id="runStatus" style="text-align: center; color: #888; margin-top: 15px;"></p>
          </div>
          
          <script>
            async function triggerRun() {
              const btn = document.getElementById('runBtn');
              const status = document.getElementById('runStatus');
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
          </script>

          <!-- Workflow -->
          <div class="card">
            <h2>📋 Workflow</h2>
            <ol style="line-height: 2; color: #ccc;">
              <li>Monitor Google Sheet for "Urgent Billing Needed = YES"</li>
              <li>Consolidate all unbilled rows for that job</li>
              <li>Create draft invoice in QuickBooks</li>
              <li>Send SMS notification to Jessica & Bobby</li>
              <li>Reply APPROVE to send invoice to customer</li>
              <li>Reply SNOOZE to pause reminders for 24 hours</li>
            </ol>
          </div>

          <p style="text-align: center; margin-top: 40px; color: #666;">
            <a href="/" style="color: #00d4aa;">← Back to Main Dashboard</a> |
            <a href="/bot3" style="color: #4fc3f7;">Bot 3 - Inventory Bot</a>
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

module.exports = router;
