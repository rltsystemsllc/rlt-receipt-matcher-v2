/**
 * Authentication Routes
 * Handles OAuth flows for Gmail, QuickBooks, Google Sheets, and RingCentral
 */

const express = require('express');
const router = express.Router();
const config = require('../config');
const logger = require('../utils/logger');

// Service clients
const gmailClient = require('../services/gmail/client');
const qboClient = require('../services/quickbooks/client');

/**
 * Gmail OAuth
 */
router.get('/gmail', (req, res) => {
  try {
    const authUrl = gmailClient.getAuthUrl();
    res.redirect(authUrl);
  } catch (error) {
    logger.error('Failed to generate Gmail auth URL', { error: error.message });
    res.status(500).send('Failed to start Gmail authentication');
  }
});

router.get('/gmail/callback', async (req, res) => {
  try {
    const { code } = req.query;
    
    if (!code) {
      return res.status(400).send('No authorization code provided');
    }
    
    await gmailClient.handleCallback(code);
    
    res.send(`
      <html>
        <head><title>Gmail Connected</title></head>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h1 style="color: #4CAF50;">✓ Gmail Connected Successfully!</h1>
          <p>You can now close this window and return to the dashboard.</p>
          <a href="/" style="color: #1976D2;">Go to Dashboard</a>
        </body>
      </html>
    `);
  } catch (error) {
    logger.error('Gmail OAuth callback failed', { error: error.message });
    res.status(500).send(`Gmail authentication failed: ${error.message}`);
  }
});

/**
 * QuickBooks OAuth
 */
router.get('/quickbooks', (req, res) => {
  try {
    const authUrl = qboClient.getAuthUrl();
    res.redirect(authUrl);
  } catch (error) {
    logger.error('Failed to generate QuickBooks auth URL', { error: error.message });
    res.status(500).send('Failed to start QuickBooks authentication');
  }
});

router.get('/quickbooks/callback', async (req, res) => {
  try {
    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    
    await qboClient.handleCallback(fullUrl);
    
    res.send(`
      <html>
        <head><title>QuickBooks Connected</title></head>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h1 style="color: #4CAF50;">✓ QuickBooks Connected Successfully!</h1>
          <p>Company ID: ${qboClient.getCompanyId()}</p>
          <p>You can now close this window and return to the dashboard.</p>
          <a href="/" style="color: #1976D2;">Go to Dashboard</a>
        </body>
      </html>
    `);
  } catch (error) {
    logger.error('QuickBooks OAuth callback failed', { error: error.message });
    res.status(500).send(`QuickBooks authentication failed: ${error.message}`);
  }
});

// Support legacy/default QuickBooks redirect (/callback)
router.get('/callback', async (req, res) => {
  try {
    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    
    await qboClient.handleCallback(fullUrl);
    
    res.send(`
      <html>
        <head><title>QuickBooks Connected</title></head>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h1 style="color: #4CAF50;">✓ QuickBooks Connected Successfully!</h1>
          <p>Company ID: ${qboClient.getCompanyId()}</p>
          <p>You can now close this window and return to the dashboard.</p>
          <a href="/" style="color: #1976D2;">Go to Dashboard</a>
        </body>
      </html>
    `);
  } catch (error) {
    logger.error('QuickBooks OAuth callback failed', { error: error.message });
    res.status(500).send(`QuickBooks authentication failed: ${error.message}`);
  }
});

/**
 * Google Sheets OAuth (uses same credentials as Gmail)
 */
router.get('/sheets', (req, res) => {
  try {
    const authUrl = gmailClient.getAuthUrl([
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file'
    ]);
    res.redirect(authUrl);
  } catch (error) {
    logger.error('Failed to generate Sheets auth URL', { error: error.message });
    res.status(500).send('Failed to start Google Sheets authentication');
  }
});

router.get('/sheets/callback', async (req, res) => {
  try {
    const { code } = req.query;
    
    if (!code) {
      return res.status(400).send('No authorization code provided');
    }
    
    // Use Gmail client but save to sheets token file
    await gmailClient.handleCallback(code, 'tokens/sheets-token.json');
    
    res.send(`
      <html>
        <head><title>Google Sheets Connected</title></head>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h1 style="color: #4CAF50;">✓ Google Sheets Connected Successfully!</h1>
          <p>You can now close this window and return to the dashboard.</p>
          <a href="/bot2" style="color: #1976D2;">Go to Bot 2 Dashboard</a>
        </body>
      </html>
    `);
  } catch (error) {
    logger.error('Sheets OAuth callback failed', { error: error.message });
    res.status(500).send(`Google Sheets authentication failed: ${error.message}`);
  }
});

/**
 * RingCentral OAuth
 */
router.get('/ringcentral', async (req, res) => {
  try {
    // RingCentral uses JWT auth, not OAuth flow
    // This endpoint just tests the connection
    const rc = require('../bot2/ringcentral');
    const connected = await rc.initialize();
    
    if (connected) {
      res.send(`
        <html>
          <head><title>RingCentral Connected</title></head>
          <body style="font-family: sans-serif; padding: 40px; text-align: center;">
            <h1 style="color: #4CAF50;">✓ RingCentral Connected!</h1>
            <p>JWT authentication is working.</p>
            <a href="/bot2" style="color: #1976D2;">Go to Bot 2 Dashboard</a>
          </body>
        </html>
      `);
    } else {
      res.status(500).send('RingCentral connection failed. Check JWT token in .env');
    }
  } catch (error) {
    logger.error('RingCentral connection test failed', { error: error.message });
    res.status(500).send(`RingCentral connection failed: ${error.message}`);
  }
});

/**
 * Status endpoint - check all auth states
 */
router.get('/status', async (req, res) => {
  const status = {
    gmail: {
      authenticated: gmailClient.isAuthenticated(),
      ...gmailClient.getStatus()
    },
    quickbooks: {
      authenticated: qboClient.isAuthenticated(),
      ...qboClient.getStatus()
    }
  };
  
  res.json(status);
});

module.exports = router;
