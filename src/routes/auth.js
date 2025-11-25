/**
 * OAuth Authentication Routes
 */

const express = require('express');
const router = express.Router();
const { client: gmailClient } = require('../services/gmail');
const { client: qboClient } = require('../services/quickbooks');
const logger = require('../utils/logger');

/**
 * Gmail OAuth - Start
 */
router.get('/gmail', (req, res) => {
  try {
    const authUrl = gmailClient.getAuthUrl();
    res.redirect(authUrl);
  } catch (error) {
    logger.error('Gmail auth start failed', { error: error.message });
    res.status(500).send(`
      <h1>Gmail Auth Error</h1>
      <p>${error.message}</p>
      <p>Make sure GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET are configured.</p>
      <a href="/">Back to Dashboard</a>
    `);
  }
});

/**
 * Gmail OAuth - Callback
 */
router.get('/gmail/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    logger.error('Gmail auth denied', { error });
    return res.status(400).send(`
      <h1>Gmail Auth Denied</h1>
      <p>${error}</p>
      <a href="/">Back to Dashboard</a>
    `);
  }

  if (!code) {
    return res.status(400).send(`
      <h1>Gmail Auth Error</h1>
      <p>No authorization code received</p>
      <a href="/">Back to Dashboard</a>
    `);
  }

  try {
    await gmailClient.handleCallback(code);

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
          <h1>Gmail Connected!</h1>
          <p>Your Gmail account is now connected.</p>
          <a href="/">Back to Dashboard</a>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    logger.error('Gmail auth callback failed', { error: error.message });
    res.status(500).send(`
      <h1>Gmail Auth Error</h1>
      <p>${error.message}</p>
      <a href="/">Back to Dashboard</a>
    `);
  }
});

/**
 * QuickBooks OAuth - Start
 */
router.get('/quickbooks', (req, res) => {
  try {
    const authUrl = qboClient.getAuthUrl();
    res.redirect(authUrl);
  } catch (error) {
    logger.error('QuickBooks auth start failed', { error: error.message });
    res.status(500).send(`
      <h1>QuickBooks Auth Error</h1>
      <p>${error.message}</p>
      <p>Make sure QBO_CLIENT_ID and QBO_CLIENT_SECRET are configured.</p>
      <a href="/">Back to Dashboard</a>
    `);
  }
});

/**
 * QuickBooks OAuth - Callback
 */
router.get('/quickbooks/callback', async (req, res) => {
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


