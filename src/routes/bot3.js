/**
 * Bot 3 - Inventory Bot Dashboard Routes
 * Provides web interface for monitoring and controlling Bot 3
 */

const express = require('express');
const router = express.Router();
const config = require('../config');
const bot3 = require('../bot3');
const sheetsService = require('../bot3/sheets');
const conversationService = require('../bot3/conversation');
const ringcentralService = require('../bot2/ringcentral');
const logger = require('../utils/logger');

/**
 * Dashboard styles (reuse Bot 2 styles with Bot 3 accent color)
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
      max-width: 1200px;
      margin: 0 auto;
    }
    h1 {
      color: #4fc3f7;
      text-align: center;
      font-size: 2.5rem;
      margin-bottom: 10px;
      text-shadow: 0 0 20px rgba(79, 195, 247, 0.3);
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
      color: #4fc3f7;
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
    .status-ok { background: rgba(79, 195, 247, 0.2); color: #4fc3f7; border: 1px solid #4fc3f7; }
    .status-warn { background: rgba(255, 193, 7, 0.2); color: #ffc107; border: 1px solid #ffc107; }
    .status-error { background: rgba(244, 67, 54, 0.2); color: #f44336; border: 1px solid #f44336; }
    .status-billed { background: rgba(76, 175, 80, 0.2); color: #4caf50; border: 1px solid #4caf50; }
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
    .btn-primary { background: #4fc3f7; color: #1a1a2e; }
    .btn-primary:hover { background: #81d4fa; transform: translateY(-2px); }
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
    .pull-item {
      background: rgba(255, 255, 255, 0.03);
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 10px;
      border-left: 3px solid #4fc3f7;
    }
    .pull-item.billed { border-left-color: #4caf50; opacity: 0.7; }
    .pull-job { font-weight: 600; color: #fff; }
    .pull-details { font-size: 0.9rem; color: #888; margin-top: 5px; }
    .pull-materials { font-size: 0.85rem; color: #4fc3f7; margin-top: 8px; }
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
    th { color: #4fc3f7; font-size: 0.85rem; text-transform: uppercase; }
    .config-item {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
    }
    .config-label { color: #888; }
    .config-value { color: #4fc3f7; font-family: monospace; }
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
      color: #4fc3f7;
    }
    .trigger-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }
    .trigger-phrase {
      background: rgba(79, 195, 247, 0.2);
      padding: 4px 12px;
      border-radius: 15px;
      font-size: 0.85rem;
      color: #4fc3f7;
    }
    .conversation-item {
      background: rgba(255, 255, 255, 0.03);
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 8px;
    }
    .conversation-phone { font-weight: 600; color: #fff; }
    .conversation-step { 
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.8rem;
      background: rgba(79, 195, 247, 0.2);
      color: #4fc3f7;
      margin-left: 10px;
    }
    .qr-section {
      text-align: center;
      padding: 20px;
    }
    .qr-code {
      background: white;
      padding: 20px;
      border-radius: 12px;
      display: inline-block;
      margin: 10px 0;
    }
    .nfc-instruction {
      background: rgba(79, 195, 247, 0.1);
      padding: 15px;
      border-radius: 8px;
      border: 1px dashed #4fc3f7;
      margin-top: 15px;
    }
  </style>
`;

/**
 * Main dashboard
 */
router.get('/', async (req, res) => {
  try {
    const status = bot3.getStatus();
    const conversations = conversationService.getAllConversations();
    const sheetsAuth = await sheetsService.isAuthenticated();
    const rcAuth = await ringcentralService.isAuthenticated();

    // Get recent inventory pulls
    let recentPulls = [];
    try {
      const allPulls = await sheetsService.getAllInventoryPulls();
      recentPulls = allPulls.slice(-10).reverse();
    } catch (e) {
      // Sheet might not exist yet
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Bot 3 - Inventory Bot | RLT Automation</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        ${styles}
      </head>
      <body>
        <div class="container">
          <h1>📦 Bot 3 — Inventory Bot</h1>
          <p class="subtitle">RLT Automation System • Material Tracking</p>

          <div class="grid">
            <!-- Status Card -->
            <div class="card">
              <h2><span class="icon">📊</span> System Status</h2>
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
                <span class="stat-label">Active Conversations</span>
                <span class="stat-value">${status.activeConversations}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Inventory Sheet</span>
                <span class="stat-value">${status.config.inventorySheetName}</span>
              </div>
            </div>

            <!-- Trigger Phrases -->
            <div class="card">
              <h2><span class="icon">💬</span> Trigger Phrases</h2>
              <p style="color: #888; font-size: 0.9rem;">Text any of these to start logging inventory:</p>
              <div class="trigger-list">
                ${config.inventory.triggerPhrases.map(p => 
                  `<span class="trigger-phrase">"${p}"</span>`
                ).join('')}
              </div>
              <p style="color: #666; font-size: 0.85rem; margin-top: 15px;">
                Or tap an NFC tag / scan a QR code to auto-open the text conversation.
              </p>
            </div>
          </div>

          <!-- Active Conversations -->
          <div class="card">
            <h2><span class="icon">🗣️</span> Active Conversations (${conversations.length})</h2>
            ${conversations.length === 0 ? 
              '<div class="empty-state">No active conversations</div>' :
              conversations.map(c => `
                <div class="conversation-item">
                  <span class="conversation-phone">${maskPhone(c.phoneNumber)}</span>
                  <span class="conversation-step">${c.step}</span>
                  ${c.jobName ? `<br><small style="color: #888;">Job: ${c.jobName}</small>` : ''}
                </div>
              `).join('')
            }
          </div>

          <!-- Recent Inventory Pulls -->
          <div class="card">
            <h2><span class="icon">📋</span> Recent Inventory Pulls</h2>
            ${recentPulls.length === 0 ? 
              '<div class="empty-state">No inventory pulls logged yet</div>' :
              recentPulls.map(p => `
                <div class="pull-item ${p.billed === 'Yes' ? 'billed' : ''}">
                  <div class="pull-job">${p.jobName || 'Unknown Job'}</div>
                  <div class="pull-details">
                    ${new Date(p.timestamp).toLocaleString()} • From: ${p.pulledFrom}
                    ${p.billed === 'Yes' ? ' • ✅ Billed' : ' • ⏳ Unbilled'}
                  </div>
                  <div class="pull-materials">${p.humanSummary}</div>
                </div>
              `).join('')
            }
            ${recentPulls.length > 0 ? `
              <div class="actions">
                <a href="/bot3/inventory" class="btn btn-secondary">View All Inventory</a>
              </div>
            ` : ''}
          </div>

          <!-- SMS Webhook -->
          <div class="card">
            <h2><span class="icon">📱</span> SMS Webhook Configuration</h2>
            <p>Configure this webhook URL in RingCentral to receive SMS messages:</p>
            <div class="webhook-url">
              ${req.protocol}://${req.get('host')}/bot3/webhook/sms
            </div>
            <p style="color: #888; font-size: 0.85rem; margin-top: 10px;">
              This same webhook handles Bot 2 and Bot 3 messages. The system will route to the appropriate bot.
            </p>
          </div>

          <!-- QR Code Section -->
          <div class="card">
            <h2><span class="icon">📲</span> Quick Access</h2>
            <div class="nfc-instruction">
              <strong>NFC Tag Setup:</strong><br>
              Program NFC tags with this SMS URL:<br>
              <code style="color: #4fc3f7;">sms:${config.ringcentral.botPhoneNumber || '+1XXXXXXXXXX'}?body=inventory</code>
            </div>
            <div class="nfc-instruction" style="margin-top: 10px;">
              <strong>QR Code:</strong><br>
              Generate a QR code that opens a text message to the bot number with "inventory" pre-filled.
            </div>
          </div>

          <!-- Connection Setup -->
          ${(!sheetsAuth || !rcAuth) ? `
            <div class="card">
              <h2><span class="icon">🔧</span> Setup Required</h2>
              ${!sheetsAuth ? `
                <p>Google Sheets needs to be connected to log inventory.</p>
                <a href="/auth/sheets" class="btn btn-primary">Connect Google Sheets</a>
              ` : ''}
              ${!rcAuth ? `
                <p>RingCentral needs to be configured for SMS messaging.</p>
                <p>Ensure these are in your .env file:</p>
                <ul>
                  <li>RINGCENTRAL_CLIENT_ID</li>
                  <li>RINGCENTRAL_CLIENT_SECRET</li>
                  <li>RINGCENTRAL_JWT_TOKEN</li>
                  <li>RINGCENTRAL_BOT_PHONE</li>
                </ul>
              ` : ''}
            </div>
          ` : ''}

          <p style="text-align: center; margin-top: 40px; color: #666;">
            <a href="/" style="color: #4fc3f7;">← Back to Main Dashboard</a> |
            <a href="/bot2" style="color: #00d4aa;">Bot 2 - Invoice Drafter</a>
          </p>
        </div>
      </body>
      </html>
    `;

    res.send(html);
  } catch (error) {
    logger.error('Bot 3 Dashboard error', { error: error.message });
    res.status(500).send(`Error loading dashboard: ${error.message}`);
  }
});

/**
 * View all inventory pulls
 */
router.get('/inventory', async (req, res) => {
  try {
    const pulls = await sheetsService.getAllInventoryPulls();

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Inventory Log | Bot 3</title>
        ${styles}
        <style>
          table { font-size: 0.85rem; }
          td { max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>📦 Inventory Pull Log</h1>
          <p class="subtitle"><a href="/bot3" style="color: #4fc3f7;">← Back to Dashboard</a></p>

          <div class="card" style="overflow-x: auto;">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Job</th>
                  <th>Pulled From</th>
                  <th>Materials</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${pulls.slice().reverse().map(p => `
                  <tr>
                    <td>${new Date(p.timestamp).toLocaleDateString()}</td>
                    <td>${p.jobName || '-'}</td>
                    <td>${p.pulledFrom}</td>
                    <td title="${p.humanSummary}">${p.humanSummary}</td>
                    <td>
                      <span class="status-badge ${p.billed === 'Yes' ? 'status-billed' : 'status-warn'}">
                        ${p.billed === 'Yes' ? `✅ Billed (${p.invoiceNumber})` : '⏳ Unbilled'}
                      </span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            ${pulls.length === 0 ? '<div class="empty-state">No inventory pulls logged yet</div>' : ''}
            <p style="color: #888; margin-top: 15px;">Total: ${pulls.length} entries</p>
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
          <h1>❌ Error Loading Inventory</h1>
          <p>${error.message}</p>
          <p>Make sure Google Sheets is connected: <a href="/auth/sheets" class="btn btn-primary">Connect</a></p>
          <p><a href="/bot3">← Back to Dashboard</a></p>
        </div>
      </body>
      </html>
    `);
  }
});

/**
 * SMS Webhook endpoint
 * Handles incoming SMS and routes to Bot 2 or Bot 3
 */
router.post('/webhook/sms', async (req, res) => {
  try {
    // Handle RingCentral verification
    if (req.body.validation_token) {
      return res.json({ validation_token: req.body.validation_token });
    }

    const result = await ringcentralService.processIncomingWebhook(req.body);
    
    if (result && result.from && result.text) {
      const message = result.text.trim();
      
      // Check if this is an inventory bot trigger
      if (bot3.isInventoryTrigger(message)) {
        logger.info('Bot 3: Routing to Inventory Bot', { from: result.from });
        await bot3.handleIncomingSms(result.from, result.text);
      } else {
        // Check if there's an active Bot 3 conversation
        const conversationService = require('../bot3/conversation');
        const activeConv = conversationService.getConversation(result.from);
        
        if (activeConv && activeConv.step !== 'complete') {
          // Continue Bot 3 conversation
          logger.info('Bot 3: Continuing conversation', { from: result.from, step: activeConv.step });
          await bot3.handleIncomingSms(result.from, result.text);
        } else {
          // Route to Bot 2
          logger.info('Bot 2: Routing to Invoice Bot', { from: result.from });
          const bot2 = require('../bot2');
          await bot2.handleSmsResponse(result.from, result.text);
        }
      }
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
    const status = bot3.getStatus();
    const conversations = conversationService.getAllConversations();
    
    res.json({
      success: true,
      status,
      activeConversations: conversations
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * API: Get inventory for a job
 */
router.get('/api/inventory/:jobName', async (req, res) => {
  try {
    const jobName = decodeURIComponent(req.params.jobName);
    const inventory = await sheetsService.getUnbilledInventoryForJob(jobName);
    
    res.json({
      success: true,
      jobName,
      inventory,
      count: inventory.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * API: Mark inventory as billed
 */
router.post('/api/inventory/:jobName/billed', async (req, res) => {
  try {
    const jobName = decodeURIComponent(req.params.jobName);
    const { invoiceNumber } = req.body;
    
    const result = await sheetsService.markAsBilled(jobName, invoiceNumber);
    
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Test endpoint - simulate SMS
 */
router.post('/test/sms', async (req, res) => {
  try {
    const { from, message } = req.body;
    
    if (!from || !message) {
      return res.status(400).json({ error: 'from and message required' });
    }

    await bot3.handleIncomingSms(from, message);
    
    res.json({ success: true, message: 'Test SMS processed' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Mask phone number for display
 */
function maskPhone(phone) {
  if (!phone) return '***';
  if (phone.length < 6) return '***';
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

module.exports = router;

