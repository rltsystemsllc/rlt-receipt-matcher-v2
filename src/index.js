/**
 * RLT Receipt Matcher
 * Main entry point
 * 
 * Automated receipt processing bot that:
 * 1. Reads receipts from Gmail
 * 2. Parses vendor, amount, date, and job info
 * 3. Matches and syncs to QuickBooks Online
 */

require('dotenv').config();

const express = require('express');
const config = require('./config');
const logger = require('./utils/logger');
const scheduler = require('./services/scheduler');

// Routes
const indexRoutes = require('./routes/index');
const authRoutes = require('./routes/auth');
const healthRoutes = require('./routes/health');

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
  const configErrors = config.validate();
  if (configErrors.length > 0) {
    logger.warn('Configuration warnings:', { errors: configErrors });
    logger.info('Some features may not work until configuration is complete.');
    logger.info('Copy env.example to .env and fill in your credentials.');
  }

  // Start server
  app.listen(config.port, () => {
    logger.info('='.repeat(50));
    logger.info('RLT Receipt Matcher Started');
    logger.info('='.repeat(50));
    logger.info(`Server running on http://localhost:${config.port}`);
    logger.info(`Environment: ${config.nodeEnv}`);
    logger.info('');
    logger.info('Next steps:');
    logger.info(`  1. Visit http://localhost:${config.port}/auth/gmail to connect Gmail`);
    logger.info(`  2. Visit http://localhost:${config.port}/auth/quickbooks to connect QuickBooks`);
    logger.info(`  3. The scheduler will start processing receipts automatically`);
    logger.info('='.repeat(50));
  });

  // Start scheduler
  scheduler.start();
}

// Handle shutdown gracefully
process.on('SIGINT', async () => {
  logger.info('Shutting down...');
  scheduler.stop();
  
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


