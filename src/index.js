/**
 * RLT Automation System
 * Main entry point
 */

require('dotenv').config();

const express = require('express');
const config = require('./config');
const logger = require('./utils/logger');
const scheduler = require('./services/scheduler');
const smsAlerts = require('./services/sms-alerts');
const bot2 = require('./bot2');
const ringcentral = require('./bot2/ringcentral');
const dataQABot = require('./services/data-qa-bot');
const groupSMS = require('./smart-receipt-bot/group-sms');
const smartReceiptBot = require('./smart-receipt-bot');

// Routes
const indexRoutes = require('./routes/index');
const authRoutes = require('./routes/auth');
const healthRoutes = require('./routes/health');
const bot2Routes = require('./routes/bot2');
const bot3Routes = require('./routes/bot3');
const licenseRoutes = require('./routes/license');
const dashboardRoutes = require('./routes/dashboard');
const executiveRoutes = require('./routes/executive');
const operationsRoutes = require('./routes/operations');
const smartReceiptRoutes = require('./routes/smart-receipt');

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
app.use('/bot3', bot3Routes);
app.use('/license', licenseRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/executive', executiveRoutes);
app.use('/operations', operationsRoutes);
app.use('/smart-receipt', smartReceiptRoutes);

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
  const bot1Errors = config.validateBot1();
  const bot2Errors = config.validateBot2();
  const bot3Errors = config.validateBot3();
  
  if (bot1Errors.length > 0) logger.warn('Bot 1 configuration warnings:', { errors: bot1Errors });
  if (bot2Errors.length > 0) logger.warn('Bot 2 configuration warnings:', { errors: bot2Errors });
  if (bot3Errors.length > 0) logger.warn('Bot 3 configuration warnings:', { errors: bot3Errors });

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
    logger.info('');
    logger.info('🟩 BOT 2 - Invoice Drafter');
    logger.info(`   Dashboard: http://localhost:${config.port}/bot2`);
    logger.info('');
    logger.info('🤖 SMART RECEIPT BOT');
    logger.info(`   Dashboard: http://localhost:${config.port}/smart-receipt`);
    logger.info('');
    logger.info('📊 EXECUTIVE SCORECARD');
    logger.info(`   Dashboard: http://localhost:${config.port}/executive`);
    logger.info('='.repeat(60));
  });

  // Start schedulers
  scheduler.start();
  bot2.start();
  smsAlerts.start();
  
  // Start Smart Receipt Bot
  smartReceiptBot.start();
  logger.info('🧾 Smart Receipt Bot initialized');
  
  // Start SMS polling for replies
  setupSMSPolling();
}

function setupSMSPolling() {
  const questionPatterns = [
    /cash/i, /bank/i, /balance/i, /money/i,
    /ar\b/i, /receivable/i, /owed/i, /owes/i,
    /revenue/i, /billed/i, /invoiced/i,
    /margin/i, /profit/i, /expense/i,
    /runway/i, /wins/i, /summary/i,
    /this week/i, /last week/i, /\?$/
  ];
  
  function isDataQuestion(text) {
    if (!text) return false;
    return questionPatterns.some(p => p.test(text));
  }
  
  ringcentral.onIncomingMessage(async (message) => {
    try {
      const text = message.text || '';
      logger.info('📱 Received SMS', { from: message.from, text: text.substring(0, 50) });
      
      if (isDataQuestion(text)) {
        logger.info('Processing Q&A question', { question: text });
        const result = await dataQABot.processQuestion(text);
        await groupSMS.send(result.response);
      } else {
        logger.info('Routing to Smart Receipt Bot', { text });
        await smartReceiptBot.handleSMSReply(message);
      }
    } catch (error) {
      logger.error('Error processing SMS', { error: error.message });
    }
  });
  
  ringcentral.startPolling(10000);
  logger.info('📱 SMS polling enabled');
}

process.on('SIGINT', async () => {
  logger.info('Shutting down...');
  scheduler.stop();
  bot2.stop();
  smsAlerts.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down...');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
});

start().catch((error) => {
  logger.error('Failed to start', { error: error.message });
  process.exit(1);
});
