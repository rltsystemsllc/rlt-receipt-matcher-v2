/**
 * RLT Automation System
 * Main entry point
 * 
 * Bot 1 - Receipt Processor:
 *   1. Reads receipts from Gmail
 *   2. Parses vendor, amount, date, and job info
 *   3. Matches and syncs to QuickBooks Online as billable expenses
 * 
 * Bot 2 - Invoice Drafter:
 *   1. Monitors Google Sheet for urgent billing requests
 *   2. Creates draft invoices in QuickBooks
 *   3. Sends notifications via RingCentral SMS
 *   4. Manages reminder cycles
 */

require('dotenv').config();

const express = require('express');
const config = require('./config');
const logger = require('./utils/logger');
const scheduler = require('./services/scheduler');
const bot2 = require('./bot2');

// Routes
const indexRoutes = require('./routes/index');
const authRoutes = require('./routes/auth');
const healthRoutes = require('./routes/health');
const bot2Routes = require('./routes/bot2');

// Create Express app
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, { ip: req.ip });
  next();
});

// Routes
app.use('/', indexRoutes);
app.use('/auth', authRoutes);
app.use('/health', healthRoutes);
app.use('/bot2', bot2Routes);

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({
    error: 'Internal server error',
    message: config.isDev ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Startup
async function start() {
  // Validate configuration
  const bot1Errors = config.validateBot1();
  const bot2Errors = config.validateBot2();
  
  if (bot1Errors.length > 0) {
    logger.warn('Bot 1 configuration warnings:', { errors: bot1Errors });
  }
  if (bot2Errors.length > 0) {
    logger.warn('Bot 2 configuration warnings:', { errors: bot2Errors });
  }
  
  if (bot1Errors.length > 0 || bot2Errors.length > 0) {
    logger.info('Some features may not work until configuration is complete.');
    logger.info('Copy env.example to .env and fill in your credentials.');
  }

  // Start server (bind to 0.0.0.0 for Railway/cloud deployment)
  const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
  app.listen(config.port, host, () => {
    logger.info('='.repeat(60));
    logger.info('🚀 RLT AUTOMATION SYSTEM Started');
    logger.info('='.repeat(60));
    logger.info(`Server: http://localhost:${config.port}`);
    logger.info(`Environment: ${config.nodeEnv}`);
    logger.info('');
    logger.info('🟧 BOT 1 - Receipt Processor');
    logger.info(`   Dashboard: http://localhost:${config.port}/`);
    logger.info(`   Gmail Auth: http://localhost:${config.port}/auth/gmail`);
    logger.info(`   QBO Auth: http://localhost:${config.port}/auth/quickbooks`);
    logger.info('');
    logger.info('🟩 BOT 2 - Invoice Drafter');
    logger.info(`   Dashboard: http://localhost:${config.port}/bot2`);
    logger.info(`   Sheets Auth: http://localhost:${config.port}/auth/sheets`);
    logger.info('='.repeat(60));
  });

  // Start Bot 1 scheduler (receipt processing)
  scheduler.start();
  
  // Start Bot 2 scheduler (invoice drafting)
  bot2.start();
}

// Handle shutdown gracefully
process.on('SIGINT', async () => {
  logger.info('Shutting down...');
  scheduler.stop();
  bot2.stop();
  
  // Cleanup OCR worker if initialized
  try {
    const imageParser = require('./parsers/image');
    await imageParser.terminate();
  } catch {
    // Ignore if not initialized
  }
  
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down...');
  scheduler.stop();
  bot2.stop();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason });
});

// Start the application
start().catch((error) => {
  logger.error('Failed to start', { error: error.message });
  process.exit(1);
});


