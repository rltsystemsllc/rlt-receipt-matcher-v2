/**
 * Winston Logger Configuration
 * Centralized logging for the application
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level}: ${message}${metaStr}`;
  })
);

// Custom format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  defaultMeta: { service: 'rlt-receipt-matcher' },
  transports: [
    // Console output
    new winston.transports.Console({
      format: consoleFormat
    }),
    // File output - all logs
    new winston.transports.File({
      filename: path.join(logsDir, 'app.log'),
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // File output - errors only
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5242880,
      maxFiles: 5
    })
  ]
});

// Add receipt-specific logging
logger.receipt = (action, receiptData) => {
  logger.info(`Receipt ${action}`, {
    vendor: receiptData.vendor,
    total: receiptData.total,
    date: receiptData.date,
    job: receiptData.job
  });
};

// Add QuickBooks-specific logging
logger.qbo = (action, data) => {
  logger.info(`QuickBooks ${action}`, data);
};

// Add Gmail-specific logging
logger.gmail = (action, data) => {
  logger.info(`Gmail ${action}`, data);
};

module.exports = logger;




