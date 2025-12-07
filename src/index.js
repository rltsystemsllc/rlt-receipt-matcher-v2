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
  logger.error('Error', { error: err.message });
  res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

async function start() {
  const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
  
  app.listen(config.port, host, () => {
    logger.info('🚀 RLT AUTOMATION SYSTEM');
    logger.info(`   http://localhost:${config.port}`);
    logger.info('   /smart-receipt - Smart Receipt Bot');
    logger.info('   /executive - Executive Scorecard');
  });

  scheduler.start();
  bot2.start();
  smsAlerts.start();
  smartReceiptBot.start();
  
  // SMS polling for replies
  ringcentral.onIncomingMessage(async (msg) => {
    try {
      const text = msg.text || '';
      logger.info('📱 SMS', { from: msg.from, text: text.substring(0, 30) });
      
      const qaPatterns = [/cash/i, /bank/i, /ar\b/i, /margin/i, /runway/i, /wins/i, /summary/i, /\?$/];
      if (qaPatterns.some(p => p.test(text))) {
        const result = await dataQABot.processQuestion(text);
        await groupSMS.send(result.response);
      } else {
        await smartReceiptBot.handleSMSReply(msg);
      }
    } catch (e) {
      logger.error('SMS error', { error: e.message });
    }
  });
  ringcentral.startPolling(10000);
  
  logger.info('🧾 Smart Receipt Bot ready (12/1/25+ only)');
}

process.on('SIGINT', () => { scheduler.stop(); bot2.stop(); smsAlerts.stop(); process.exit(0); });
process.on('SIGTERM', () => process.exit(0));
process.on('uncaughtException', (e) => { logger.error('Uncaught', { error: e.message }); process.exit(1); });

start().catch(e => { logger.error('Start failed', { error: e.message }); process.exit(1); });
