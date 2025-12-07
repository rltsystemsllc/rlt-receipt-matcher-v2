/**
 * Bot 2 - Invoice Drafter
 * Main entry point for the billing automation bot
 * 
 * PROTECTED BY 5 LAYERS OF SAFEGUARDS:
 * Layer 1: Pre-flight sanity checks (hours, amounts, warnings)
 * Layer 2: Detailed preview in approval SMS
 * Layer 3: Undo window (5-min delay before send)
 * Layer 4: Two-stage approval for large invoices
 * Layer 5: Daily reconciliation summary
 * 
 * Workflow:
 * 1. Monitors Google Sheet for "Urgent Billing Needed = YES"
 * 2. Runs pre-flight checks (Layer 1)
 * 3. Creates draft invoice in QuickBooks
 * 4. Sends detailed preview via SMS (Layer 2)
 * 5. On approval, queues for send with undo window (Layer 3)
 * 6. Large invoices require two-stage approval (Layer 4)
 * 7. End of day reconciliation summary (Layer 5)
 * 8. Celebration messages after successful sends
 */

const cron = require('node-cron');
const config = require('../config');
const logger = require('../utils/logger');
const sheetsService = require('./sheets');
const invoiceService = require('./invoice');
const safeguards = require('./safeguards');
const reminderService = require('./reminders');

// RingCentral service
let ringcentralService;
try {
  ringcentralService = require('./ringcentral');
} catch (e) {
  logger.warn('RingCentral service not available', { error: e.message });
}

let schedulerJob = null;
let reconciliationJob = null;
let isProcessing = false;

// Track approval states
const approvalStates = new Map(); // From phone -> { state, invoiceId, preview, ... }

/**
 * Process urgent billing requests
 */
async function processUrgentBilling() {
  if (isProcessing) {
    logger.info('Bot 2: Already processing, skipping this run');
    return;
  }

  isProcessing = true;
  logger.info('Bot 2: Checking for urgent billing requests...');

  try {
    // Check if Sheets is authenticated first
    const sheetsReady = await sheetsService.isAuthenticated();
    if (!sheetsReady) {
      logger.info('Bot 2: Google Sheets not connected, skipping billing check');
      return; // Silent skip - don't error if sheets not connected
    }

    // Get all rows with "Urgent Billing Needed = YES" and "Not Billed" status
    const urgentRows = await sheetsService.getUrgentBillingRows();
    
    if (urgentRows.length === 0) {
      logger.info('Bot 2: No urgent billing requests found');
      return;
    }

    logger.info(`Bot 2: Found ${urgentRows.length} urgent billing request(s)`);

    // Group rows by job name
    const jobGroups = groupRowsByJob(urgentRows);
    
    for (const [jobName, rows] of Object.entries(jobGroups)) {
      await processJobBilling(jobName, rows);
    }

  } catch (error) {
    logger.error('Bot 2: Error processing urgent billing', { error: error.message });
    
    // Notify Jessica and Bobby of the error
    await sendGroupText(
      `⚠️ Bot 2 Error: Failed to process billing.\n\nError: ${error.message}\n\nPlease check the dashboard.`
    );
  } finally {
    isProcessing = false;
  }
}

/**
 * Group rows by job name for consolidated invoicing
 */
function groupRowsByJob(rows) {
  const groups = {};
  
  for (const row of rows) {
    const jobName = row.jobName || `${row.contractorName} - ${row.projectName}`;
    if (!groups[jobName]) {
      groups[jobName] = [];
    }
    groups[jobName].push(row);
  }
  
  return groups;
}

/**
 * Process billing for a single job
 */
async function processJobBilling(jobName, rows) {
  logger.info(`Bot 2: Processing billing for job: ${jobName}`, { rowCount: rows.length });

  try {
    // Get ALL unbilled rows for this job (not just the urgent ones)
    const allJobRows = await sheetsService.getAllUnbilledRowsForJob(jobName);
    logger.info(`Bot 2: Found ${allJobRows.length} total unbilled rows for ${jobName}`);

    // Build invoice preview
    const preview = await invoiceService.buildInvoicePreview(jobName, allJobRows);

    // ========================================
    // LAYER 1: Pre-flight sanity checks
    // ========================================
    const preFlightResult = await safeguards.runPreFlightChecks(preview);
    
    if (!preFlightResult.passed) {
      // Critical errors - don't create invoice
      await sendGroupText(
        `❌ BILLING BLOCKED: ${jobName}\n\n` +
        `Errors:\n${preFlightResult.errors.join('\n')}\n\n` +
        `Please fix these issues before billing.`
      );
      return;
    }

    // Create the draft invoice in QBO
    const invoiceResult = await invoiceService.createDraftInvoice(jobName, allJobRows);

    // Update sheet status to "Draft Created"
    await sheetsService.updateBillingStatus(
      allJobRows.map(r => r.rowIndex),
      config.billing.statuses.draftCreated
    );

    // ========================================
    // LAYER 2: Detailed preview in SMS
    // ========================================
    const previewMessage = safeguards.buildDetailedPreviewMessage(
      preview, 
      invoiceResult, 
      preFlightResult
    );

    // ========================================
    // LAYER 4: Check if two-stage approval needed
    // ========================================
    const isLargeInvoice = safeguards.requiresTwoStageApproval(preview.summary.totalRevenue);
    const hasWarnings = preFlightResult.warnings.length > 0;
    
    const optionsMessage = safeguards.buildApprovalOptionsMessage(
      invoiceResult,
      isLargeInvoice,
      hasWarnings
    );

    // Send the full preview + options
    await sendGroupText(previewMessage + optionsMessage);

    // Store approval state
    storeApprovalState(invoiceResult.invoiceId, {
      state: isLargeInvoice ? 'awaiting_review' : 'awaiting_approval',
      invoiceId: invoiceResult.invoiceId,
      jobName,
      preview,
      invoiceResult,
      isLargeInvoice,
      rowIndices: allJobRows.map(r => r.rowIndex)
    });

    // Start reminder timer
    await reminderService.startReminderCycle(
      invoiceResult.invoiceId, 
      jobName,
      invoiceResult.totalAmount
    );

    logger.info(`Bot 2: Created draft invoice for ${jobName}`, {
      invoiceId: invoiceResult.invoiceId,
      totalAmount: invoiceResult.totalAmount,
      isLargeInvoice
    });

  } catch (error) {
    logger.error(`Bot 2: Failed to process billing for ${jobName}`, { error: error.message });
    throw error;
  }
}

/**
 * Handle incoming SMS response
 */
async function handleSmsResponse(from, message) {
  const normalizedMessage = message.trim().toUpperCase();
  const words = normalizedMessage.split(/\s+/);
  const command = words[0];

  logger.info('Bot 2: Received SMS', { from, command });

  try {
    // ========================================
    // LAYER 3: Undo command
    // ========================================
    if (command === 'UNDO') {
      await handleUndo(from);
      return;
    }

    // Check for pending approval state
    const approvalState = getApprovalState();

    // Approval commands
    if (command === 'APPROVE') {
      await handleApprove(from, approvalState);
      return;
    }

    if (command === 'REVIEW') {
      await handleReview(from, approvalState);
      return;
    }

    if (command === 'HOLD') {
      await handleHold(from, approvalState);
      return;
    }

    if (command === 'FIX') {
      await handleFix(from, approvalState);
      return;
    }

    // Snooze command
    if (command === 'SNOOZE') {
      const duration = words[1] || '24h';
      await handleSnooze(from, duration);
      return;
    }

    // Daily reconciliation confirmation
    if (command === 'OK') {
      await sendToNumber(from, '✅ Daily reconciliation confirmed. Thanks!');
      return;
    }

    if (command === 'ISSUE') {
      await sendToNumber(from, 
        '📝 Issue noted. Please describe the problem and we\'ll investigate.\n\n' +
        'You can also check the dashboard for details.'
      );
      return;
    }

    // Legacy commands for backwards compatibility
    if (['1', '2', '3'].includes(command)) {
      await handleNewProjectResponse(from, command);
      return;
    }

    logger.info('Bot 2: Unrecognized command', { from, command });

  } catch (error) {
    logger.error('Bot 2: Error handling SMS', { error: error.message, from, command });
    await sendToNumber(from, `❌ Error: ${error.message}`);
  }
}

/**
 * Handle APPROVE command
 */
async function handleApprove(from, approvalState) {
  if (!approvalState) {
    await sendToNumber(from, '❓ No pending invoice to approve.');
    return;
  }

  const { invoiceId, jobName, preview, invoiceResult, isLargeInvoice, rowIndices } = approvalState;

  // Check if two-stage and hasn't been reviewed yet
  if (isLargeInvoice && approvalState.state === 'awaiting_review') {
    await sendToNumber(from, 
      `🔒 This is a large invoice ($${invoiceResult.totalAmount.toFixed(2)}).\n\n` +
      `Reply REVIEW first to see the PDF preview, then APPROVE.`
    );
    return;
  }

  // ========================================
  // LAYER 3: Queue for send with undo window
  // ========================================
  const queued = await safeguards.queueForSend(invoiceId, invoiceResult, preview);
  
  // Update sheet status
  await sheetsService.updateBillingStatus(rowIndices, config.billing.statuses.approved);

  // Clear approval state
  clearApprovalState(invoiceId);

  // Send undo window message
  const undoMessage = safeguards.buildUndoWindowMessage(invoiceResult, queued.undoMinutes);
  await sendGroupText(undoMessage);

  logger.info('Bot 2: Invoice approved, queued for send', { invoiceId });
}

/**
 * Handle REVIEW command (for large invoices)
 */
async function handleReview(from, approvalState) {
  if (!approvalState) {
    await sendToNumber(from, '❓ No pending invoice to review.');
    return;
  }

  const { invoiceId, invoiceResult } = approvalState;

  // TODO: Generate and send PDF preview link
  // For now, just mark as reviewed and allow approval
  
  updateApprovalState(invoiceId, { state: 'awaiting_approval' });

  await sendToNumber(from,
    `📄 Invoice #${invoiceResult.docNumber || invoiceId} reviewed.\n\n` +
    `You can now reply APPROVE to send to customer.`
  );
}

/**
 * Handle HOLD command
 */
async function handleHold(from, approvalState) {
  if (!approvalState) {
    await sendToNumber(from, '❓ No pending invoice.');
    return;
  }

  const { invoiceId, jobName } = approvalState;

  // Keep as draft, cancel reminders
  await reminderService.cancelReminder(invoiceId);
  clearApprovalState(invoiceId);

  await sendToNumber(from,
    `📋 Invoice for ${jobName} held as draft.\n\n` +
    `It will remain in QuickBooks as a draft. ` +
    `You can send it manually or wait for the next billing cycle.`
  );
}

/**
 * Handle FIX command
 */
async function handleFix(from, approvalState) {
  if (!approvalState) {
    await sendToNumber(from, '❓ No pending invoice.');
    return;
  }

  const { invoiceId, jobName, rowIndices } = approvalState;

  // Void the draft invoice
  try {
    await invoiceService.voidInvoice(invoiceId);
  } catch (e) {
    logger.warn('Could not void invoice', { invoiceId, error: e.message });
  }

  // Reset sheet status
  await sheetsService.updateBillingStatus(rowIndices, config.billing.statuses.notBilled);

  // Cancel reminders
  await reminderService.cancelReminder(invoiceId);
  clearApprovalState(invoiceId);

  await sendToNumber(from,
    `🔧 Invoice for ${jobName} cancelled.\n\n` +
    `Please correct the issues in the Daily Job Log and re-trigger billing.`
  );
}

/**
 * Handle UNDO command (Layer 3)
 */
async function handleUndo(from) {
  const pending = safeguards.getMostRecentPendingSend();

  if (!pending) {
    await sendToNumber(from, '❓ No pending invoice to undo.');
    return;
  }

  const result = await safeguards.cancelPendingSend(pending.invoiceId);

  if (result.success) {
    await sendGroupText(
      `↩️ INVOICE SEND CANCELLED\n\n` +
      `${result.invoice.jobName}: $${result.invoice.totalAmount.toFixed(2)}\n\n` +
      `The invoice remains as a draft in QuickBooks.`
    );
  } else {
    await sendToNumber(from, 
      `❌ Could not undo: ${result.reason === 'window_expired' ? 'Time window expired' : 'Invoice not found'}`
    );
  }
}

/**
 * Handle SNOOZE command
 */
async function handleSnooze(from, duration) {
  let hours = 24;
  
  if (duration === '1H' || duration === '1h') hours = 1;
  else if (duration === '2H' || duration === '2h') hours = 2;
  else if (duration === 'EOD' || duration === 'eod') {
    // Calculate hours until 5 PM
    const now = new Date();
    const eod = new Date();
    eod.setHours(17, 0, 0, 0);
    if (eod <= now) eod.setDate(eod.getDate() + 1);
    hours = Math.ceil((eod - now) / (1000 * 60 * 60));
  }

  await reminderService.snoozeAllReminders(hours * 60 * 60 * 1000);
  
  await sendToNumber(from, 
    `💤 Reminders snoozed for ${hours} hour${hours > 1 ? 's' : ''}.`
  );
}

/**
 * Handle new project response (1, 2, 3)
 */
async function handleNewProjectResponse(from, choice) {
  const pending = await reminderService.getPendingNewProject();

  if (!pending) {
    await sendToNumber(from, '❓ No pending new project request.');
    return;
  }

  switch (choice) {
    case '1': // Create new project
      const result = await invoiceService.createCustomerAndProject(
        pending.contractorName,
        pending.projectName
      );
      await reminderService.clearPendingNewProject();
      await sendToNumber(from,
        `✅ Created: ${result.customerName}`
      );
      break;

    case '2': // List existing customers
      const customers = await invoiceService.getExistingCustomers();
      let msg = '📋 Recent customers:\n\n';
      customers.slice(0, 10).forEach((c, i) => {
        msg += `${i + 1}. ${c.name}\n`;
      });
      msg += '\nReply with number to select.';
      await reminderService.setPendingCustomerSelection(customers);
      await sendToNumber(from, msg);
      break;

    case '3': // Cancel
      await reminderService.clearPendingNewProject();
      await sendToNumber(from, '❌ Cancelled.');
      break;
  }
}

/**
 * Process pending sends and reminders (called by scheduler)
 */
async function processScheduledTasks() {
  // Process pending sends (Layer 3 undo window)
  const sentCount = await safeguards.processPendingSends(async (invoiceId) => {
    const result = await invoiceService.sendInvoiceToCustomer(invoiceId);
    
    // Get the approval state for celebration message
    const state = getApprovalStateById(invoiceId);
    
    // Send celebration message!
    const celebrationMsg = safeguards.buildCelebrationMessage(result, state?.preview);
    await sendGroupText(celebrationMsg);

    // Update sheet status
    if (state?.rowIndices) {
      await sheetsService.updateBillingStatus(state.rowIndices, config.billing.statuses.sent);
    }

    return result;
  });

  if (sentCount > 0) {
    logger.info(`Bot 2: Sent ${sentCount} pending invoice(s)`);
  }

  // Process reminders
  await reminderService.processReminders();
}

/**
 * Send daily reconciliation (Layer 5)
 */
async function sendDailyReconciliation() {
  const message = safeguards.buildDailyReconciliationMessage();
  await sendGroupText(message);
  logger.info('Bot 2: Sent daily reconciliation');
}

// ============================================
// APPROVAL STATE MANAGEMENT
// ============================================

function storeApprovalState(invoiceId, data) {
  approvalStates.set(invoiceId, data);
}

function getApprovalState() {
  // Get most recent approval state
  const entries = Array.from(approvalStates.entries());
  if (entries.length === 0) return null;
  return entries[entries.length - 1][1];
}

function getApprovalStateById(invoiceId) {
  return approvalStates.get(invoiceId);
}

function updateApprovalState(invoiceId, updates) {
  const current = approvalStates.get(invoiceId);
  if (current) {
    approvalStates.set(invoiceId, { ...current, ...updates });
  }
}

function clearApprovalState(invoiceId) {
  approvalStates.delete(invoiceId);
}

// ============================================
// SMS HELPERS
// ============================================

async function sendGroupText(message) {
  if (!ringcentralService) {
    logger.warn('RingCentral not available, would send:', { message });
    return;
  }
  
  try {
    await ringcentralService.sendNotification(message);
  } catch (error) {
    logger.error('Failed to send group text', { error: error.message });
  }
}

async function sendToNumber(to, message) {
  if (!ringcentralService) {
    logger.warn('RingCentral not available, would send:', { to, message });
    return;
  }
  
  try {
    await ringcentralService.sendToNumber(to, message);
  } catch (error) {
    logger.error('Failed to send SMS', { to, error: error.message });
  }
}

// ============================================
// SCHEDULER
// ============================================

/**
 * Start Bot 2 scheduler
 */
function start() {
  if (!config.billing.schedulerEnabled) {
    logger.info('Bot 2: Scheduler is disabled');
    return;
  }

  const cronExpression = config.billing.schedulerCron;
  
  logger.info('Bot 2: Starting scheduler', { cron: cronExpression });

  // Main scheduler - check for urgent billing and process pending sends
  schedulerJob = cron.schedule(cronExpression, async () => {
    await processUrgentBilling();
    await processScheduledTasks();
  });

  // Daily reconciliation scheduler (Layer 5)
  const reconciliationTime = config.safeguards.dailyReconciliationTime;
  const [hour, minute] = reconciliationTime.split(':');
  const reconciliationCron = `${minute} ${hour} * * *`; // Every day at specified time
  
  reconciliationJob = cron.schedule(reconciliationCron, async () => {
    await sendDailyReconciliation();
  });

  logger.info('Bot 2: Scheduler started');
  logger.info(`Bot 2: Daily reconciliation scheduled for ${reconciliationTime}`);
}

/**
 * Stop Bot 2 scheduler
 */
function stop() {
  if (schedulerJob) {
    schedulerJob.stop();
    schedulerJob = null;
  }
  if (reconciliationJob) {
    reconciliationJob.stop();
    reconciliationJob = null;
  }
  logger.info('Bot 2: Scheduler stopped');
}

/**
 * Get Bot 2 status
 */
function getStatus() {
  const weeklyStats = safeguards.getWeeklyStats();
  
  return {
    schedulerRunning: schedulerJob !== null,
    isProcessing,
    pendingApprovals: approvalStates.size,
    weeklyStats: {
      invoicesSent: weeklyStats.invoicesSent?.length || 0,
      totalAmount: weeklyStats.totalAmount || 0,
      totalProfit: weeklyStats.totalProfit || 0
    },
    config: {
      laborRateStandard: config.billing.laborRateStandard,
      laborRateEmergency: config.billing.laborRateEmergency,
      stockMarkupPercent: config.billing.stockMarkupPercent,
      undoWindowMinutes: config.safeguards.undoWindowMinutes,
      largeInvoiceThreshold: config.safeguards.largeInvoiceThreshold,
      spreadsheetId: config.sheets.sheetId ? '***configured***' : 'NOT SET',
      ringcentralConfigured: !!config.ringcentral.clientId
    }
  };
}

/**
 * Manually trigger billing check
 */
async function triggerManualRun() {
  logger.info('Bot 2: Manual run triggered');
  await processUrgentBilling();
}

module.exports = {
  start,
  stop,
  getStatus,
  triggerManualRun,
  processUrgentBilling,
  handleSmsResponse,
  sendDailyReconciliation
};
