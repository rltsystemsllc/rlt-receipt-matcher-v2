/**
 * Bot 2 - Invoice Drafter
 * Main entry point for the billing automation bot
 * 
 * Workflow:
 * 1. Monitors Google Sheet for "Urgent Billing Needed = YES"
 * 2. Consolidates all unbilled rows for that job
 * 3. Creates draft invoice in QuickBooks
 * 4. Sends notification via RingCentral SMS
 * 5. Manages reminder cycles
 */

const config = require('../config');
const logger = require('../utils/logger');
const sheetsService = require('./sheets');
const ringcentralService = require('./ringcentral');
const invoiceService = require('./invoice');
const reminderService = require('./reminders');
const cron = require('node-cron');

let schedulerJob = null;
let isProcessing = false;

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
    try {
      await ringcentralService.sendGroupText(
        `⚠️ Bot 2 Error: Failed to process billing.\n\nError: ${error.message}\n\nPlease check the dashboard.`
      );
    } catch (smsError) {
      logger.error('Bot 2: Failed to send error notification', { error: smsError.message });
    }
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
    // Check if this is a new project request
    const isNewProject = rows.some(r => 
      r.jobName === 'New Project – Add Name to Notes' || 
      !r.jobName
    );

    if (isNewProject) {
      await handleNewProjectRequest(rows[0]);
      return;
    }

    // Get ALL unbilled rows for this job (not just the urgent ones)
    const allJobRows = await sheetsService.getAllUnbilledRowsForJob(jobName);
    logger.info(`Bot 2: Found ${allJobRows.length} total unbilled rows for ${jobName}`);

    // Create the draft invoice
    const result = await invoiceService.createDraftInvoice(jobName, allJobRows);

    // Update sheet status to "Draft Generated"
    await sheetsService.updateBillingStatus(
      allJobRows.map(r => r.rowIndex),
      config.sheets.billingStatuses.draftGenerated
    );

    // Send notification to Jessica and Bobby
    await ringcentralService.sendInvoiceNotification(result);

    // Start reminder timer
    await reminderService.startReminderCycle(result.invoiceId, jobName);

    logger.info(`Bot 2: Successfully created draft invoice for ${jobName}`, {
      invoiceId: result.invoiceId,
      totalAmount: result.totalAmount
    });

  } catch (error) {
    logger.error(`Bot 2: Failed to process billing for ${jobName}`, { error: error.message });
    throw error;
  }
}

/**
 * Handle new project request via SMS
 */
async function handleNewProjectRequest(row) {
  const contractorName = row.contractorName;
  const projectName = row.projectName;

  logger.info('Bot 2: New project request detected', { contractorName, projectName });

  // Send SMS asking to create new project
  const message = `🆕 Bot 2: New project request submitted.\n\n` +
    `Contractor/Customer: ${contractorName}\n` +
    `Project Name: ${projectName}\n\n` +
    `Should I create a new QuickBooks Project?\n\n` +
    `Reply:\n` +
    `1 – Yes, create new project\n` +
    `2 – Assign to existing customer\n` +
    `3 – Cancel`;

  await ringcentralService.sendGroupText(message);

  // Store pending request for response handling
  await reminderService.storePendingNewProject({
    contractorName,
    projectName,
    rowIndex: row.rowIndex,
    requestedAt: new Date().toISOString()
  });

  logger.info('Bot 2: Sent new project request to Jessica and Bobby');
}

/**
 * Handle incoming SMS response
 */
async function handleSmsResponse(from, message) {
  const normalizedMessage = message.trim().toUpperCase();

  // Check for snooze command
  if (normalizedMessage === 'SNOOZE') {
    await reminderService.snoozeAllReminders();
    await ringcentralService.sendToNumber(from, 
      '💤 Got it! All reminders snoozed for 24 hours.'
    );
    return;
  }

  // Check for approval command
  if (normalizedMessage === 'APPROVE' || normalizedMessage.startsWith('APPROVE ')) {
    const invoiceId = normalizedMessage.split(' ')[1];
    await handleInvoiceApproval(from, invoiceId);
    return;
  }

  // Check for new project response (1, 2, or 3)
  if (['1', '2', '3'].includes(normalizedMessage)) {
    await handleNewProjectResponse(from, normalizedMessage);
    return;
  }

  // Check for customer selection (numeric response after choosing option 2)
  if (/^\d+$/.test(normalizedMessage)) {
    await handleCustomerSelection(from, parseInt(normalizedMessage));
    return;
  }

  logger.info('Bot 2: Unrecognized SMS response', { from, message });
}

/**
 * Handle invoice approval via SMS
 */
async function handleInvoiceApproval(from, invoiceId) {
  try {
    logger.info('Bot 2: Processing invoice approval', { from, invoiceId });

    // Send the invoice to customer
    const result = await invoiceService.sendInvoiceToCustomer(invoiceId);

    // Stop reminders
    await reminderService.cancelReminder(invoiceId);

    // Update sheet status
    await sheetsService.updateBillingStatusByInvoice(
      invoiceId,
      config.sheets.billingStatuses.sentToCustomer
    );

    // Confirm to user
    await ringcentralService.sendToNumber(from,
      `✅ Invoice sent to customer!\n\nJob: ${result.jobName}\nAmount: $${result.totalAmount.toFixed(2)}\nSent to: ${result.customerEmail}`
    );

  } catch (error) {
    logger.error('Bot 2: Failed to approve invoice', { error: error.message });
    await ringcentralService.sendToNumber(from,
      `❌ Failed to send invoice: ${error.message}`
    );
  }
}

/**
 * Handle new project response
 */
async function handleNewProjectResponse(from, choice) {
  const pending = await reminderService.getPendingNewProject();

  if (!pending) {
    await ringcentralService.sendToNumber(from,
      '❓ No pending new project request found.'
    );
    return;
  }

  switch (choice) {
    case '1': // Create new project
      await createNewQBOProject(pending, from);
      break;

    case '2': // Assign to existing customer
      const customers = await invoiceService.getExistingCustomers();
      let customerList = '📋 Select customer:\n\n';
      customers.slice(0, 10).forEach((c, i) => {
        customerList += `${i + 1}. ${c.DisplayName}\n`;
      });
      customerList += '\nReply with the number.';
      
      await ringcentralService.sendToNumber(from, customerList);
      await reminderService.setPendingCustomerSelection(customers);
      break;

    case '3': // Cancel
      await reminderService.clearPendingNewProject();
      await ringcentralService.sendToNumber(from,
        '❌ New project request cancelled.'
      );
      break;
  }
}

/**
 * Create new QuickBooks project
 */
async function createNewQBOProject(pending, from) {
  try {
    const result = await invoiceService.createCustomerAndProject(
      pending.contractorName,
      pending.projectName
    );

    await reminderService.clearPendingNewProject();

    await ringcentralService.sendToNumber(from,
      `✅ Created new project!\n\n` +
      `Customer: ${result.customerName}\n` +
      `Project: ${result.projectName}\n\n` +
      `Reply UNDO within 1 hour to cancel.`
    );

    // Store undo option
    await reminderService.storeUndoOption(result, 60 * 60 * 1000);

  } catch (error) {
    logger.error('Bot 2: Failed to create project', { error: error.message });
    await ringcentralService.sendToNumber(from,
      `❌ Failed to create project: ${error.message}`
    );
  }
}

/**
 * Handle customer selection for existing customer
 */
async function handleCustomerSelection(from, selection) {
  const customers = await reminderService.getPendingCustomerSelection();
  const pending = await reminderService.getPendingNewProject();

  if (!customers || !pending) {
    await ringcentralService.sendToNumber(from,
      '❓ No pending selection found.'
    );
    return;
  }

  const selectedCustomer = customers[selection - 1];
  if (!selectedCustomer) {
    await ringcentralService.sendToNumber(from,
      '❌ Invalid selection. Please try again.'
    );
    return;
  }

  try {
    const result = await invoiceService.createProjectUnderCustomer(
      selectedCustomer.Id,
      pending.projectName
    );

    await reminderService.clearPendingNewProject();
    await reminderService.clearPendingCustomerSelection();

    await ringcentralService.sendToNumber(from,
      `✅ Created project under existing customer!\n\n` +
      `Customer: ${selectedCustomer.DisplayName}\n` +
      `Project: ${pending.projectName}`
    );

  } catch (error) {
    logger.error('Bot 2: Failed to create project under customer', { error: error.message });
    await ringcentralService.sendToNumber(from,
      `❌ Failed: ${error.message}`
    );
  }
}

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

  schedulerJob = cron.schedule(cronExpression, async () => {
    await processUrgentBilling();
    await reminderService.processReminders();
  });

  logger.info('Bot 2: Scheduler started');
}

/**
 * Stop Bot 2 scheduler
 */
function stop() {
  if (schedulerJob) {
    schedulerJob.stop();
    schedulerJob = null;
    logger.info('Bot 2: Scheduler stopped');
  }
}

/**
 * Get Bot 2 status
 */
function getStatus() {
  return {
    schedulerRunning: schedulerJob !== null,
    isProcessing,
    config: {
      laborRateStandard: config.billing.laborRateStandard,
      laborRateEmergency: config.billing.laborRateEmergency,
      stockMarkupPercent: config.billing.stockMarkupPercent,
      spreadsheetId: config.sheets.spreadsheetId ? '***configured***' : 'NOT SET',
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
  handleSmsResponse
};



