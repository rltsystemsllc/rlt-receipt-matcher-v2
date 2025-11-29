/**
 * Bot 2 - Invoice Drafter Dashboard Routes
 * Provides web interface for monitoring and controlling Bot 2
 */

const express = require('express');
const router = express.Router();
const config = require('../config');
const bot2 = require('../bot2');
const sheetsService = require('../bot2/sheets');
const ringcentralService = require('../bot2/ringcentral');
const reminderService = require('../bot2/reminders');
const logger = require('../utils/logger');

/**
 * Dashboard styles
 */
const styles = `
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      min-height: 100vh;
      margin: 0;
      padding: 20px;
      color: #e0e0e0;
    }
    .container {
      max-width: 1200px;
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
      grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
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
    .card h2 .icon { font-size: 1.4rem; }
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
    .btn-primary:hover { background: #00f7c6; transform: translateY(-2px); }
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
    .reminder-item {
      background: rgba(255, 255, 255, 0.03);
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 10px;
      border-left: 3px solid #00d4aa;
    }
    .reminder-item.urgent { border-left-color: #ffc107; }
    .reminder-item.overdue { border-left-color: #f44336; }
    .reminder-job { font-weight: 600; color: #fff; }
    .reminder-details { font-size: 0.9rem; color: #888; margin-top: 5px; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 15px;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    th { color: #00d4aa; font-size: 0.85rem; text-transform: uppercase; }
    .config-item {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
    }
    .config-label { color: #888; }
    .config-value { color: #00d4aa; font-family: monospace; }
    .actions { text-align: center; margin-top: 20px; }
    .empty-state {
      text-align: center;
      color: #666;
      padding: 30px;
    }
    .webhook-url {
      background: rgba(0, 0, 0, 0.3);
      padding: 10px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 0.85rem;
      word-break: break-all;
      color: #00d4aa;
    }
  </style>
`;

/**
 * Main dashboard
 */
router.get('/', async (req, res) => {
  try {
    const status = bot2.getStatus();
    const reminders = reminderService.getActiveReminders();
    const stateSummary = reminderService.getStateSummary();
    const sheetsAuth = await sheetsService.isAuthenticated();
    const rcAuth = await ringcentralService.isAuthenticated();

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
          <h1>🤖 Bot 2 — Invoice Drafter</h1>
          <p class="subtitle">RLT Automation System • Billing & Invoicing</p>

          <div class="grid">
            <!-- Status Card -->
            <div class="card">
              <h2><span class="icon">📊</span> System Status</h2>
              <div class="stat-row">
                <span class="stat-label">Scheduler</span>
                <span class="status-badge ${status.schedulerRunning ? 'status-ok' : 'status-warn'}">
                  ${status.schedulerRunning ? '🟢 Running' : '🟡 Stopped'}
                </span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Google Sheets</span>
                <span class="status-badge ${sheetsAuth ? 'status-ok' : 'status-error'}">
                  ${sheetsAuth ? '✅ Connected' : '❌ Not Connected'}
                </span>
              </div>
              <div class="stat-row">
                <span class="stat-label">RingCentral</span>
                <span class="status-badge ${rcAuth ? 'status-ok' : 'status-error'}">
                  ${rcAuth ? '✅ Connected' : '❌ Not Connected'}
                </span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Active Reminders</span>
                <span class="stat-value">${stateSummary.activeReminders}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Pending New Project</span>
                <span class="stat-value">${stateSummary.pendingNewProject ? '⏳ Yes' : 'No'}</span>
              </div>
            </div>

            <!-- Configuration Card -->
            <div class="card">
              <h2><span class="icon">⚙️</span> Configuration</h2>
              <div class="config-item">
                <span class="config-label">Standard Rate</span>
                <span class="config-value">$${status.config.laborRateStandard}/hr</span>
              </div>
              <div class="config-item">
                <span class="config-label">Emergency Rate</span>
                <span class="config-value">$${status.config.laborRateEmergency}/hr</span>
              </div>
              <div class="config-item">
                <span class="config-label">Stock Markup</span>
                <span class="config-value">${status.config.stockMarkupPercent}%</span>
              </div>
              <div class="config-item">
                <span class="config-label">Sheet ID</span>
                <span class="config-value">${status.config.spreadsheetId}</span>
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="card">
            <h2><span class="icon">🎬</span> Actions</h2>
            <div class="actions">
              <form action="/bot2/run" method="POST" style="display: inline;">
                <button type="submit" class="btn btn-primary">▶️ Run Billing Check Now</button>
              </form>
              <a href="/bot2/reminders" class="btn btn-secondary">📋 View All Reminders</a>
              <a href="/bot2/sheet-data" class="btn btn-secondary">📊 View Sheet Data</a>
              ${!sheetsAuth ? `<a href="/auth/sheets" class="btn btn-secondary">🔗 Connect Google Sheets</a>` : ''}
            </div>
          </div>

          <!-- Active Reminders -->
          <div class="card">
            <h2><span class="icon">🔔</span> Active Reminders (${reminders.length})</h2>
            ${reminders.length === 0 ? 
              '<div class="empty-state">No active reminders. All invoices approved! 🎉</div>' :
              reminders.slice(0, 5).map(r => `
                <div class="reminder-item ${r.daysOld >= 15 ? 'overdue' : r.daysOld >= 7 ? 'urgent' : ''}">
                  <div class="reminder-job">${r.jobName}</div>
                  <div class="reminder-details">
                    Invoice #${r.invoiceId} • $${r.totalAmount.toFixed(2)} • ${r.daysOld} days old
                    ${r.snoozedUntil ? ' • 💤 Snoozed' : ''}
                  </div>
                </div>
              `).join('')
            }
            ${reminders.length > 5 ? `<a href="/bot2/reminders" class="btn btn-secondary">View all ${reminders.length} reminders</a>` : ''}
          </div>

          <!-- Connection Setup -->
          ${(!sheetsAuth || !rcAuth) ? `
            <div class="card">
              <h2><span class="icon">🔧</span> Setup Required</h2>
              ${!sheetsAuth ? `
                <p>Google Sheets needs to be connected to read the Daily Job Log.</p>
                <a href="/auth/sheets" class="btn btn-primary">Connect Google Sheets</a>
              ` : ''}
              ${!rcAuth ? `
                <p>RingCentral needs to be configured for SMS notifications.</p>
                <p>Add these to your .env file:</p>
                <ul>
                  <li>RINGCENTRAL_CLIENT_ID</li>
                  <li>RINGCENTRAL_CLIENT_SECRET</li>
                  <li>RINGCENTRAL_JWT_TOKEN</li>
                  <li>RINGCENTRAL_BOT_PHONE</li>
                </ul>
              ` : ''}
            </div>
          ` : ''}

          <!-- SMS Webhook -->
          <div class="card">
            <h2><span class="icon">📱</span> SMS Webhook (for replies)</h2>
            <p>To receive SMS replies, configure this webhook in RingCentral:</p>
            <div class="webhook-url">
              ${req.protocol}://${req.get('host')}/bot2/webhook/sms
            </div>
            <p style="color: #888; font-size: 0.85rem; margin-top: 10px;">
              This allows the bot to process APPROVE, SNOOZE, and new project responses.
            </p>
          </div>

          <p style="text-align: center; margin-top: 40px; color: #666;">
            <a href="/" style="color: #00d4aa;">← Back to Main Dashboard</a>
          </p>
        </div>
      </body>
      </html>
    `;

    res.send(html);
  } catch (error) {
    logger.error('Dashboard error', { error: error.message });
    res.status(500).send(`Error loading dashboard: ${error.message}`);
  }
});

/**
 * Manual run trigger
 */
router.post('/run', async (req, res) => {
  try {
    await bot2.triggerManualRun();
    res.redirect('/bot2?run=success');
  } catch (error) {
    logger.error('Manual run failed', { error: error.message });
    res.redirect('/bot2?run=error');
  }
});

/**
 * View all reminders
 */
router.get('/reminders', async (req, res) => {
  const reminders = reminderService.getActiveReminders();

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Reminders | Bot 2</title>
      ${styles}
    </head>
    <body>
      <div class="container">
        <h1>🔔 Active Reminders</h1>
        <p class="subtitle"><a href="/bot2" style="color: #00d4aa;">← Back to Dashboard</a></p>

        <div class="card">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Invoice</th>
                <th>Amount</th>
                <th>Age</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${reminders.map(r => `
                <tr>
                  <td>${r.jobName}</td>
                  <td>#${r.invoiceId}</td>
                  <td>$${r.totalAmount.toFixed(2)}</td>
                  <td>${r.daysOld} days</td>
                  <td>
                    <span class="status-badge ${r.daysOld >= 15 ? 'status-error' : r.daysOld >= 7 ? 'status-warn' : 'status-ok'}">
                      ${r.status}${r.snoozedUntil ? ' (snoozed)' : ''}
                    </span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          ${reminders.length === 0 ? '<div class="empty-state">No active reminders!</div>' : ''}
        </div>
      </div>
    </body>
    </html>
  `;

  res.send(html);
});

/**
 * View sheet data
 */
router.get('/sheet-data', async (req, res) => {
  try {
    const rows = await sheetsService.getAllRows();

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Sheet Data | Bot 2</title>
        ${styles}
        <style>
          table { font-size: 0.85rem; }
          td { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>📊 Daily Job Log Data</h1>
          <p class="subtitle"><a href="/bot2" style="color: #00d4aa;">← Back to Dashboard</a></p>

          <div class="card" style="overflow-x: auto;">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Date</th>
                  <th>Job</th>
                  <th>Phase</th>
                  <th>Hours</th>
                  <th>Urgent</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${rows.slice(-50).reverse().map(r => `
                  <tr>
                    <td>${r.rowIndex}</td>
                    <td>${r.date}</td>
                    <td>${r.jobName || r.projectName || '-'}</td>
                    <td>${r.constructionPhase}</td>
                    <td>${r.hoursWorked}</td>
                    <td>${r.urgentBilling === 'YES' ? '⚡ YES' : '-'}</td>
                    <td>
                      <span class="status-badge ${r.billingStatus === 'Paid' ? 'status-ok' : r.billingStatus === 'Draft Generated' ? 'status-warn' : ''}">
                        ${r.billingStatus || 'Not Billed'}
                      </span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            <p style="color: #888; margin-top: 15px;">Showing last 50 entries (newest first)</p>
          </div>
        </div>
      </body>
      </html>
    `;

    res.send(html);
  } catch (error) {
    res.send(`
      <!DOCTYPE html>
      <html><head><title>Error</title>${styles}</head>
      <body>
        <div class="container">
          <h1>❌ Error Loading Sheet Data</h1>
          <p>${error.message}</p>
          <p>Make sure Google Sheets is connected: <a href="/auth/sheets" class="btn btn-primary">Connect</a></p>
          <p><a href="/bot2">← Back to Dashboard</a></p>
        </div>
      </body>
      </html>
    `);
  }
});

/**
 * SMS Webhook endpoint
 */
router.post('/webhook/sms', async (req, res) => {
  try {
    // Handle RingCentral verification
    if (req.body.validation_token) {
      return res.json({ validation_token: req.body.validation_token });
    }

    const result = await ringcentralService.processIncomingWebhook(req.body);
    
    if (result && result.from && result.text) {
      await bot2.handleSmsResponse(result.from, result.text);
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('SMS webhook error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * API: Get status
 */
router.get('/api/status', async (req, res) => {
  try {
    const status = bot2.getStatus();
    const reminders = reminderService.getActiveReminders();
    
    res.json({
      success: true,
      status,
      reminders: reminders.length,
      activeReminders: reminders.slice(0, 10)
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;



