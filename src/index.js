/**
 * RLT Automation System - Main Entry Point
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

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message });
  res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

async function start() {
  const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
  
  app.listen(config.port, host, () => {
    logger.info('='.repeat(60));
    logger.info('🚀 RLT AUTOMATION SYSTEM');
    logger.info(`   Server: http://localhost:${config.port}`);
    logger.info('');
    logger.info('🤖 SMART RECEIPT BOT: /smart-receipt');
    logger.info('📊 EXECUTIVE SCORECARD: /executive');
    logger.info('🔧 OPERATIONS CENTER: /operations');
    logger.info('='.repeat(60));
  });

  scheduler.start();
  bot2.start();
  smsAlerts.start();
  
  smartReceiptBot.start();
  logger.info('🧾 Smart Receipt Bot ready (only asks about transactions from 12/1/25+)');
  
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
    return text && questionPatterns.some(p => p.test(text));
  }
  
  ringcentral.onIncomingMessage(async (message) => {
    try {
      const text = message.text || '';
      logger.info('📱 SMS received', { from: message.from, text: text.substring(0, 50) });
      
      if (isDataQuestion(text)) {
        const result = await dataQABot.processQuestion(text);
        await groupSMS.send(result.response);
      } else {
        await smartReceiptBot.handleSMSReply(message);
      }
    } catch (error) {
      logger.error('SMS processing error', { error: error.message });
    }
  });
  
  ringcentral.startPolling(10000);
  logger.info('📱 SMS polling active');
}

process.on('SIGINT', async () => {
  logger.info('Shutting down...');
  scheduler.stop();
  bot2.stop();
  smsAlerts.stop();
  process.exit(0);
});

process.on('SIGTERM', () => process.exit(0));
process.on('uncaughtException', (e) => { logger.error('Uncaught', { error: e.message }); process.exit(1); });
process.on('unhandledRejection', (r) => logger.error('Unhandled rejection', { reason: r }));

start().catch(e => { logger.error('Start failed', { error: e.message }); process.exit(1); });
