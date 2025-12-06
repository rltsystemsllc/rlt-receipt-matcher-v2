/**
 * Dashboard Routes
 * Real-time expense tracking dashboard for Bot 1
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const receiptStore = require('../services/receipt-store');
const { client: qboClient, matcher } = require('../services/quickbooks');
const logger = require('../utils/logger');

/**
 * Serve the dashboard HTML
 */
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard-live.html'));
});

/**
 * API: Get dashboard data
 */
router.get('/api/data', async (req, res) => {
  try {
    const stats = receiptStore.getStats();
    let unassigned = receiptStore.getUnassignedReceipts();
    const jobsReady = receiptStore.getJobsReadyToInvoice();
    const recentActivity = receiptStore.getRecentActivity(10);

    // Filter: only show receipts after October 15, 2025
    const cutoffDate = new Date('2025-10-15');
    unassigned = unassigned.filter(r => {
      const receiptDate = new Date(r.date);
      return receiptDate >= cutoffDate;
    });

    // Recalculate stats for filtered receipts
    const filteredStats = {
      ...stats,
      unassignedCount: unassigned.length,
      unassignedAmount: unassigned.reduce((sum, r) => sum + (r.amount || 0), 0)
    };

    res.json({
      success: true,
      stats: filteredStats,
      unassigned,
      jobsReady,
      recentActivity
    });
  } catch (error) {
    logger.error('Dashboard data error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * API: Get single receipt with full details
 */
router.get('/api/receipt/:id', (req, res) => {
  try {
    const receipt = receiptStore.getReceipt(req.params.id);
    
    if (!receipt) {
      return res.status(404).json({ success: false, error: 'Receipt not found' });
    }

    res.json({ success: true, receipt });
  } catch (error) {
    logger.error('Get receipt error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * API: Get PDF attachment for a receipt
 */
router.get('/api/receipt/:id/pdf', async (req, res) => {
  try {
    const receipt = receiptStore.getReceipt(req.params.id);
    
    if (!receipt) {
      return res.status(404).json({ success: false, error: 'Receipt not found' });
    }

    if (!receipt.pdfAttachment) {
      return res.status(404).json({ success: false, error: 'No PDF attachment for this receipt' });
    }

    // Fetch PDF from Gmail
    const gmailFetcher = require('../services/gmail/fetcher');
    const pdfBuffer = await gmailFetcher.downloadAttachment(
      receipt.pdfAttachment.messageId,
      receipt.pdfAttachment.attachmentId
    );

    // Set headers for PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${receipt.pdfAttachment.filename || 'receipt.pdf'}"`);
    res.send(pdfBuffer);
  } catch (error) {
    logger.error('Get receipt PDF error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * API: Get available jobs from QuickBooks
 */
router.get('/api/jobs', async (req, res) => {
  try {
    // Try to get customers/projects from QuickBooks
    if (qboClient.isAuthenticated()) {
      const response = await qboClient.makeApiCall('GET', 
        '/query?query=' + encodeURIComponent('SELECT * FROM Customer WHERE Active = true MAXRESULTS 50'));
      
      const customers = response.QueryResponse?.Customer || [];
      
      res.json({
        success: true,
        jobs: customers.map(c => ({
          id: c.Id,
          name: c.DisplayName,
          isProject: c.Job || false,
          parentId: c.ParentRef?.value || null
        }))
      });
    } else {
      // Return some default jobs if QBO not connected
      res.json({
        success: true,
        jobs: [
          { id: '1', name: 'Smith Residence - Panel Upgrade', isProject: true },
          { id: '2', name: 'Jones Kitchen Remodel', isProject: true },
          { id: '3', name: '456 Oak St - Service Call', isProject: true },
          { id: '4', name: 'Wailea Residence - New Construction', isProject: true },
          { id: '5', name: 'Kihei Commercial - TI', isProject: true }
        ],
        source: 'default'
      });
    }
  } catch (error) {
    logger.error('Get jobs error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * API: Assign receipt to job
 */
router.post('/api/receipt/:id/assign', express.json(), async (req, res) => {
  try {
    const { jobName, jobId } = req.body;
    
    if (!jobName) {
      return res.status(400).json({ success: false, error: 'Job name is required' });
    }

    const receipt = receiptStore.assignToJob(req.params.id, jobName, jobId);

    // Try to update in QuickBooks if connected
    if (qboClient.isAuthenticated() && receipt.qboExpenseId) {
      try {
        // Find or create the customer/project in QBO
        const customer = await matcher.findOrCreateCustomer(jobName);
        
        if (customer) {
          logger.info('Receipt linked to QBO project', { 
            receiptId: receipt.id, 
            customerId: customer.Id 
          });
        }
      } catch (qboError) {
        logger.warn('Could not update QBO', { error: qboError.message });
      }
    }

    res.json({ success: true, receipt });
  } catch (error) {
    logger.error('Assign receipt error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * API: Unassign receipt from job
 */
router.post('/api/receipt/:id/unassign', async (req, res) => {
  try {
    const receipt = receiptStore.unassignFromJob(req.params.id);
    res.json({ success: true, receipt });
  } catch (error) {
    logger.error('Unassign receipt error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * API: Create new job (in QBO)
 */
router.post('/api/jobs', express.json(), async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({ success: false, error: 'Job name is required' });
    }

    if (qboClient.isAuthenticated()) {
      const customer = await matcher.findOrCreateCustomer(name, { project: !req.query.plain });
      
      res.json({
        success: true,
        job: {
          id: customer.Id,
          name: customer.DisplayName
        }
      });
    } else {
      res.json({
        success: true,
        job: { id: Date.now().toString(), name },
        source: 'local'
      });
    }
  } catch (error) {
    logger.error('Create job error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * API: Get receipts for a job
 */
router.get('/api/job/:jobName/receipts', (req, res) => {
  try {
    const jobName = decodeURIComponent(req.params.jobName);
    const receipts = receiptStore.getReceiptsForJob(jobName);
    
    res.json({
      success: true,
      jobName,
      receipts,
      totalAmount: receipts.reduce((sum, r) => sum + (r.amount || 0), 0)
    });
  } catch (error) {
    logger.error('Get job receipts error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * API: Re-scan receipts to capture PDF attachments
 * Since existing receipts have emailId: null due to a bug, 
 * we search Gmail directly by date and remove the processed label
 */
router.post('/api/rescan', express.json(), async (req, res) => {
  try {
    const { afterDate } = req.body;
    const cutoffDate = afterDate || '2025-10-15';
    
    logger.info('Starting PDF rescan', { afterDate: cutoffDate });

    // Step 1: Delete ALL receipts after cutoff (to ensure fresh parse with latest parser)
    const allReceipts = Array.from(receiptStore.receipts.values());
    const cutoff = new Date(cutoffDate);
    let deletedCount = 0;
    
    for (const receipt of allReceipts) {
      const receiptDate = new Date(receipt.date);
      if (receiptDate >= cutoff) {
        receiptStore.deleteReceipt(receipt.id);
        deletedCount++;
        logger.info('Deleted receipt for rescan', { id: receipt.id, date: receipt.date });
      }
    }
    receiptStore.save();
    
    logger.info('Deleted receipts without PDF', { count: deletedCount });

    // Step 2: Search Gmail for receipt emails after cutoff date and remove processed label
    const gmailFetcher = require('../services/gmail/fetcher');
    const gmailClient = require('../services/gmail/client');
    const gmail = gmailClient.getApi();
    
    // Get the processed label ID
    const labelId = await gmailFetcher.ensureProcessedLabel();
    
    // Search for emails with the processed label after the cutoff date
    const config = require('../config');
    const labelName = config.gmail.processedLabel || 'RLT-Processed';
    const searchQuery = `after:${cutoffDate.replace(/-/g, '/')} label:${labelName} (subject:receipt OR subject:invoice OR subject:"order confirmation" OR from:homedepot OR from:lowes)`;
    
    logger.info('Searching Gmail for processed emails', { query: searchQuery });
    
    const searchResponse = await gmail.users.messages.list({
      userId: 'me',
      q: searchQuery,
      maxResults: 50
    });
    
    const messages = searchResponse.data.messages || [];
    logger.info('Found processed emails to unmark', { count: messages.length });
    
    // Remove processed label from each
    let unmarkedCount = 0;
    for (const msg of messages) {
      try {
        await gmail.users.messages.modify({
          userId: 'me',
          id: msg.id,
          requestBody: {
            removeLabelIds: [labelId]
          }
        });
        unmarkedCount++;
      } catch (err) {
        logger.warn('Failed to unmark email', { messageId: msg.id, error: err.message });
      }
    }
    
    logger.info('Unmarked emails for rescan', { count: unmarkedCount });

    // Step 3: Small delay then rescan
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 4: Trigger a new scan
    const processor = require('../services/gmail/processor');
    const result = await processor.processNewEmails();

    res.json({
      success: true,
      message: `Deleted ${deletedCount} old receipts, unmarked ${unmarkedCount} emails, found ${result.receipts.length} new receipts`,
      deleted: deletedCount,
      unmarked: unmarkedCount,
      newReceipts: result.receipts.length
    });
  } catch (error) {
    logger.error('Re-scan error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * API: Sync receipts to QuickBooks Online
 * Only syncs receipts dated after the specified cutoff
 */
router.post('/api/sync-qbo', express.json(), async (req, res) => {
  try {
    const { afterDate } = req.body;
    const cutoffDate = afterDate || '2025-10-15';
    const cutoff = new Date(cutoffDate);
    
    logger.info('Starting QBO sync', { afterDate: cutoffDate });

    // Check QBO authentication (load/refresh tokens if needed)
    logger.info('Sync route: invoking qboClient.authenticate');
    const isAuth = await qboClient.authenticate();
    logger.info('QBO auth check result', { isAuthenticated: isAuth });
    
    if (!isAuth) {
      logger.warn('QBO not authenticated, returning 401');
      return res.status(401).json({ 
        success: false, 
        error: 'QuickBooks not authenticated. Please re-authenticate at /auth/quickbooks' 
      });
    }

    // Get all unassigned receipts after cutoff
    const allReceipts = receiptStore.getUnassignedReceipts();
    logger.info('Got unassigned receipts', { count: allReceipts.length });
    
    const receiptsToSync = allReceipts.filter(r => {
      const receiptDate = new Date(r.date);
      const isAfterCutoff = receiptDate >= cutoff;
      const notSynced = !r.qboSynced;
      if (isAfterCutoff && notSynced) {
        logger.info('Receipt qualifies for sync', { id: r.id, date: r.date, vendor: r.vendor });
      }
      return isAfterCutoff && notSynced;
    });

    logger.info('Receipts to sync after filter', { count: receiptsToSync.length });

    const uploader = require('../services/quickbooks/uploader');
    const { createReceipt } = require('../models/receipt');
    
    let synced = 0;
    let failed = 0;
    let skipped = 0;
    const errors = [];

    for (const storedReceipt of receiptsToSync) {
      try {
        // Convert stored format to full receipt format for uploader
        const receipt = createReceipt({
          id: storedReceipt.id,
          vendorName: storedReceipt.vendor,
          vendorDisplayName: storedReceipt.vendor,
          total: storedReceipt.amount,
          date: storedReceipt.date,
          orderNumber: storedReceipt.orderNumber,
          invoiceNumber: storedReceipt.invoiceNumber
        });

        // Sync to QBO
        await uploader.syncReceipt(receipt);
        
        // Mark as synced in store
        storedReceipt.qboSynced = true;
        storedReceipt.qboSyncedAt = new Date().toISOString();
        receiptStore.receipts.set(storedReceipt.id, storedReceipt);
        
        synced++;
        logger.info('Receipt synced to QBO', { id: storedReceipt.id, vendor: storedReceipt.vendor, amount: storedReceipt.amount });
      } catch (err) {
        failed++;
        errors.push({ id: storedReceipt.id, error: err.message });
        logger.error('Failed to sync receipt', { id: storedReceipt.id, error: err.message });
      }
    }

    // Save updated store
    receiptStore.save();

    res.json({
      success: true,
      synced,
      failed,
      skipped,
      total: receiptsToSync.length,
      errors: errors.slice(0, 5) // Show first 5 errors
    });
  } catch (error) {
    logger.error('QBO sync error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * API: Add test receipt (for development)
 */
router.post('/api/test/add-receipt', express.json(), (req, res) => {
  try {
    const testReceipt = {
      id: `TEST-${Date.now()}`,
      vendor: { name: req.body.vendor || 'Home Depot', displayName: req.body.vendor || 'Home Depot' },
      transaction: {
        total: req.body.amount || Math.floor(Math.random() * 300) + 50,
        date: req.body.date || new Date().toISOString().split('T')[0]
      },
      lineItems: req.body.lineItems || [
        { description: 'Test Item 1', quantity: 1, totalPrice: 25.99 },
        { description: 'Test Item 2', quantity: 2, totalPrice: 15.49 }
      ],
      rawContent: req.body.rawContent || `TEST RECEIPT\n\nVendor: ${req.body.vendor || 'Home Depot'}\nAmount: $${req.body.amount || '99.99'}\nDate: ${new Date().toLocaleDateString()}`
    };

    const stored = receiptStore.addReceipt(testReceipt);
    res.json({ success: true, receipt: stored });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

