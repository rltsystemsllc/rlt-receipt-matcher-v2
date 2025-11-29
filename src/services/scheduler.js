/**
 * Job Scheduler
 * Runs the receipt processing pipeline on a schedule
 */

const cron = require('node-cron');
const config = require('../config');
const logger = require('../utils/logger');
const { client: gmailClient, processor: gmailProcessor } = require('./gmail');
const { client: qboClient, uploader } = require('./quickbooks');

class Scheduler {
  constructor() {
    this.job = null;
    this.isRunning = false;
    this.lastRun = null;
    this.stats = {
      totalRuns: 0,
      totalProcessed: 0,
      totalSynced: 0,
      totalErrors: 0
    };
  }

  /**
   * Start the scheduler
   */
  start() {
    if (this.job) {
      logger.warn('Scheduler already running');
      return;
    }

    if (!config.scheduler.enabled) {
      logger.info('Scheduler is disabled in configuration');
      return;
    }

    // Validate cron expression
    if (!cron.validate(config.scheduler.cron)) {
      logger.error('Invalid cron expression', { cron: config.scheduler.cron });
      return;
    }

    this.job = cron.schedule(config.scheduler.cron, async () => {
      await this.runPipeline();
    });

    logger.info('Scheduler started', { cron: config.scheduler.cron });

    // Run immediately on start
    this.runPipeline();
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (this.job) {
      this.job.stop();
      this.job = null;
      logger.info('Scheduler stopped');
    }
  }

  /**
   * Run the processing pipeline once
   */
  async runPipeline() {
    if (this.isRunning) {
      logger.warn('Pipeline already running, skipping this cycle');
      return;
    }

    this.isRunning = true;
    this.lastRun = new Date();
    this.stats.totalRuns++;

    logger.info('=== Starting receipt processing pipeline ===');

    try {
      // Step 1: Authenticate services
      const gmailAuth = await gmailClient.authenticate();
      const qboAuth = await qboClient.authenticate();

      if (!gmailAuth) {
        logger.error('Gmail not authenticated. Please visit /auth/gmail');
        return;
      }

      if (!qboAuth) {
        logger.error('QuickBooks not authenticated. Please visit /auth/quickbooks');
        return;
      }

      // Step 2: Fetch and process new emails
      const result = await gmailProcessor.processNewEmails();

      logger.info(`Processed ${result.processed} emails, extracted ${result.receipts.length} receipts`);
      this.stats.totalProcessed += result.receipts.length;

      if (result.receipts.length === 0) {
        logger.info('No new receipts to sync');
        return;
      }

      // Step 3: Sync receipts to QuickBooks
      for (const receipt of result.receipts) {
        try {
          await uploader.syncReceipt(receipt);
          this.stats.totalSynced++;
        } catch (error) {
          this.stats.totalErrors++;
          logger.error('Failed to sync receipt', {
            receiptId: receipt.id,
            vendor: receipt.vendor.name,
            error: error.message
          });
        }
      }

      logger.info('=== Pipeline complete ===', {
        processed: result.receipts.length,
        synced: this.stats.totalSynced,
        errors: this.stats.totalErrors
      });

    } catch (error) {
      logger.error('Pipeline failed', { error: error.message });
      this.stats.totalErrors++;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      running: this.job !== null,
      processing: this.isRunning,
      lastRun: this.lastRun,
      cron: config.scheduler.cron,
      stats: this.stats
    };
  }

  /**
   * Trigger a manual run
   */
  async triggerRun() {
    logger.info('Manual pipeline run triggered');
    await this.runPipeline();
  }
}

// Singleton instance
const scheduler = new Scheduler();

module.exports = scheduler;




