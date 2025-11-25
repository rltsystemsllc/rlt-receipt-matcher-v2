/**
 * Health Check Route
 */

const express = require('express');
const router = express.Router();
const { client: gmailClient } = require('../services/gmail');
const { client: qboClient } = require('../services/quickbooks');
const scheduler = require('../services/scheduler');

/**
 * Health check endpoint
 */
router.get('/', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      gmail: {
        connected: gmailClient.checkAuth()
      },
      quickbooks: {
        connected: qboClient.checkAuth()
      },
      scheduler: {
        running: scheduler.getStatus().running
      }
    }
  };

  // Determine overall status - services may not be connected yet but app is healthy
  const allServicesOk = health.services.gmail.connected && 
                        health.services.quickbooks.connected;

  health.status = allServicesOk ? 'ok' : 'degraded';

  // Always return 200 for healthcheck - the app is running, even if services aren't authenticated yet
  res.status(200).json(health);
});

/**
 * Detailed health check
 */
router.get('/detailed', async (req, res) => {
  const status = scheduler.getStatus();

  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    services: {
      gmail: {
        connected: gmailClient.checkAuth(),
        message: gmailClient.checkAuth() ? 'Connected' : 'Not authenticated'
      },
      quickbooks: {
        connected: qboClient.checkAuth(),
        companyId: qboClient.getCompanyId(),
        message: qboClient.checkAuth() ? 'Connected' : 'Not authenticated'
      },
      scheduler: {
        running: status.running,
        processing: status.processing,
        cron: status.cron,
        lastRun: status.lastRun,
        stats: status.stats
      }
    }
  };

  res.json(health);
});

module.exports = router;


