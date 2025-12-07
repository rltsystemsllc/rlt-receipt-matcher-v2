/**
 * Operations Center Dashboard
 * Technical status, logs, and troubleshooting for all bots
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const qboClient = require('../services/quickbooks/client');
const gmailClient = require('../services/gmail/client');
const logger = require('../utils/logger');
const config = require('../config');

/**
 * Serve the Operations Dashboard HTML
 */
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'operations-dashboard.html'));
});

/**
 * Get system status for all integrations and bots
 */
router.get('/api/status', async (req, res) => {
  try {
    const [qboStatus, gmailStatus, rcStatus, sheetsStatus] = await Promise.all([
      checkQBOStatus(),
      checkGmailStatus(),
      checkRingCentralStatus(),
      checkSheetsStatus()
    ]);

    const bots = [
      {
        id: 'bot1',
        name: 'Receipt Processor',
        description: 'Fetches receipts from Gmail, parses, syncs to QBO',
        status: gmailStatus.connected && qboStatus.connected ? 'running' : 'warning',
        lastRun: getLastRunTime('bot1'),
        stats: await getBot1Stats()
      },
      {
        id: 'bot2',
        name: 'Invoice Drafter',
        description: 'Monitors Daily Job Log, creates draft invoices',
        status: sheetsStatus.connected && qboStatus.connected ? 'running' : 'warning',
        lastRun: getLastRunTime('bot2'),
        stats: await getBot2Stats()
      },
      {
        id: 'bot3',
        name: 'Inventory Manager',
        description: 'Tracks materials, sends low-stock alerts',
        status: sheetsStatus.connected ? 'running' : 'warning',
        lastRun: getLastRunTime('bot3'),
        stats: await getBot3Stats()
      }
    ];

    res.json({
      timestamp: new Date().toISOString(),
      integrations: {
        quickbooks: qboStatus,
        gmail: gmailStatus,
        ringcentral: rcStatus,
        googleSheets: sheetsStatus
      },
      bots,
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        nodeVersion: process.version
      }
    });
  } catch (error) {
    logger.error('Failed to get operations status', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Manually trigger a bot run
 */
router.post('/api/trigger/:botId', async (req, res) => {
  const { botId } = req.params;
  
  try {
    let result = { triggered: true };
    switch (botId) {
      case 'bot1':
        const scheduler = require('../services/scheduler');
        await scheduler.runNow();
        break;
      case 'bot2':
        const bot2 = require('../bot2');
        await bot2.checkForUrgentJobs();
        break;
      case 'bot3':
        const bot3 = require('../bot3');
        await bot3.checkInventory();
        break;
      default:
        return res.status(400).json({ error: 'Unknown bot ID' });
    }
    
    res.json({ success: true, message: `${botId} triggered` });
  } catch (error) {
    logger.error('Failed to trigger bot', { botId, error: error.message });
    res.status(500).json({ error: error.message });
  }
});

async function checkQBOStatus() {
  try {
    const isAuth = await qboClient.isAuthenticated();
    return {
      connected: isAuth,
      companyId: qboClient.getCompanyId() || null,
      environment: config.quickbooks?.environment || 'production'
    };
  } catch (error) {
    return { connected: false, error: error.message };
  }
}

async function checkGmailStatus() {
  try {
    const isAuth = await gmailClient.isAuthenticated();
    return { connected: isAuth, email: 'rltsystemsllc@gmail.com' };
  } catch (error) {
    return { connected: false, error: error.message };
  }
}

async function checkRingCentralStatus() {
  const hasConfig = !!(config.ringcentral?.clientId);
  return { connected: hasConfig, botPhone: config.ringcentral?.botPhone || null };
}

async function checkSheetsStatus() {
  const hasConfig = !!(config.google?.sheetsId);
  return { connected: hasConfig };
}

function getLastRunTime(botId) {
  try {
    const stateFile = path.join(__dirname, '../../data', `${botId}-state.json`);
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      return state.lastRun || null;
    }
  } catch (e) {}
  return null;
}

async function getBot1Stats() {
  try {
    const file = path.join(__dirname, '../../data/receipts.json');
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const receipts = data.receipts || [];
      return {
        total: receipts.length,
        pendingSync: receipts.filter(r => !r.qboSync?.synced).length
      };
    }
  } catch (e) {}
  return { total: 0, pendingSync: 0 };
}

async function getBot2Stats() {
  try {
    const file = path.join(__dirname, '../../data/bot2-state.json');
    if (fs.existsSync(file)) {
      const state = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { invoicesDrafted: state.invoicesDrafted || 0 };
    }
  } catch (e) {}
  return { invoicesDrafted: 0 };
}

async function getBot3Stats() {
  try {
    const file = path.join(__dirname, '../../data/bot3-state.json');
    if (fs.existsSync(file)) {
      const state = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { itemsTracked: state.itemsTracked || 0 };
    }
  } catch (e) {}
  return { itemsTracked: 0 };
}

module.exports = router;
