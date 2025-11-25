/**
 * Main Routes
 */

const express = require('express');
const router = express.Router();
const scheduler = require('../services/scheduler');
const { client: qboClient } = require('../services/quickbooks');
const logger = require('../utils/logger');

/**
 * Home route - Dashboard
 */
router.get('/', (req, res) => {
  const status = scheduler.getStatus();

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>RLT Receipt Matcher</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          max-width: 800px;
          margin: 50px auto;
          padding: 20px;
          background: #f5f5f5;
        }
        .card {
          background: white;
          border-radius: 12px;
          padding: 24px;
          margin-bottom: 20px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        h1 {
          color: #2d3748;
          margin-top: 0;
        }
        h2 {
          color: #4a5568;
          margin-top: 0;
        }
        .status {
          display: inline-block;
          padding: 4px 12px;
          border-radius: 20px;
          font-size: 14px;
          font-weight: 500;
        }
        .status.running { background: #c6f6d5; color: #276749; }
        .status.stopped { background: #fed7d7; color: #c53030; }
        .btn {
          display: inline-block;
          padding: 12px 24px;
          border-radius: 8px;
          text-decoration: none;
          font-weight: 500;
          margin-right: 10px;
          margin-bottom: 10px;
        }
        .btn-primary { background: #4299e1; color: white; }
        .btn-secondary { background: #edf2f7; color: #4a5568; }
        .btn-success { background: #48bb78; color: white; }
        .stats {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-top: 20px;
        }
        .stat {
          text-align: center;
          padding: 16px;
          background: #f7fafc;
          border-radius: 8px;
        }
        .stat-value {
          font-size: 32px;
          font-weight: bold;
          color: #2d3748;
        }
        .stat-label {
          color: #718096;
          font-size: 14px;
        }
        pre {
          background: #2d3748;
          color: #e2e8f0;
          padding: 16px;
          border-radius: 8px;
          overflow-x: auto;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>⚡ RLT Receipt Matcher</h1>
        <p>Automated receipt processing for QuickBooks Online</p>
        
        <div style="margin: 20px 0;">
          <span class="status ${status.running ? 'running' : 'stopped'}">
            ${status.running ? '● Running' : '○ Stopped'}
          </span>
          ${status.processing ? '<span class="status running" style="margin-left: 10px;">Processing...</span>' : ''}
        </div>
        
        <div class="stats">
          <div class="stat">
            <div class="stat-value">${status.stats.totalRuns}</div>
            <div class="stat-label">Total Runs</div>
          </div>
          <div class="stat">
            <div class="stat-value">${status.stats.totalProcessed}</div>
            <div class="stat-label">Processed</div>
          </div>
          <div class="stat">
            <div class="stat-value">${status.stats.totalSynced}</div>
            <div class="stat-label">Synced</div>
          </div>
          <div class="stat">
            <div class="stat-value">${status.stats.totalErrors}</div>
            <div class="stat-label">Errors</div>
          </div>
        </div>
        
        ${status.lastRun ? `<p style="margin-top: 20px; color: #718096;">Last run: ${status.lastRun.toLocaleString()}</p>` : ''}
      </div>
      
      <div class="card">
        <h2>🔐 Authentication</h2>
        <a href="/auth/gmail" class="btn btn-primary">Connect Gmail</a>
        <a href="/auth/quickbooks" class="btn btn-primary">Connect QuickBooks</a>
      </div>
      
      <div class="card">
        <h2>🎮 Controls</h2>
        <a href="/api/run" class="btn btn-success">Run Now</a>
        <a href="/api/status" class="btn btn-secondary">API Status</a>
        <a href="/health" class="btn btn-secondary">Health Check</a>
      </div>
      
      <div class="card">
        <h2>📋 Schedule</h2>
        <pre>Cron: ${status.cron}</pre>
        <p style="color: #718096;">Default: Every 5 minutes</p>
      </div>
    </body>
    </html>
  `);
});

/**
 * API Status
 */
router.get('/api/status', (req, res) => {
  const status = scheduler.getStatus();
  res.json({
    status: 'ok',
    scheduler: status,
    version: '1.0.0'
  });
});

/**
 * Trigger manual run
 */
router.get('/api/run', async (req, res) => {
  try {
    // Don't await - let it run in background
    scheduler.triggerRun();
    res.json({
      success: true,
      message: 'Pipeline run started'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * QuickBooks OAuth Callback (at /callback to match Intuit's configured redirect URI)
 */
router.get('/callback', async (req, res) => {
  const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

  if (req.query.error) {
    logger.error('QuickBooks auth denied', { error: req.query.error });
    return res.status(400).send(`
      <h1>QuickBooks Auth Denied</h1>
      <p>${req.query.error}</p>
      <a href="/">Back to Dashboard</a>
    `);
  }

  try {
    await qboClient.handleCallback(fullUrl);

    res.send(`
      <html>
      <head>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: #f5f5f5;
          }
          .card {
            background: white;
            padding: 40px;
            border-radius: 12px;
            text-align: center;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          }
          .success { color: #48bb78; font-size: 48px; }
          h1 { color: #2d3748; }
          a {
            display: inline-block;
            margin-top: 20px;
            padding: 12px 24px;
            background: #4299e1;
            color: white;
            text-decoration: none;
            border-radius: 8px;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="success">✓</div>
          <h1>QuickBooks Connected!</h1>
          <p>Your QuickBooks Online account is now connected.</p>
          <p>Company ID: ${qboClient.getCompanyId()}</p>
          <a href="/">Back to Dashboard</a>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    logger.error('QuickBooks auth callback failed', { error: error.message });
    res.status(500).send(`
      <h1>QuickBooks Auth Error</h1>
      <p>${error.message}</p>
      <a href="/">Back to Dashboard</a>
    `);
  }
});

module.exports = router;


