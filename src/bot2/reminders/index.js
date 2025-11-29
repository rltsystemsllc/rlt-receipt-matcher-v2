/**
 * Reminder Service for Bot 2
 * Manages reminder cycles, snooze, and pending requests
 */

const fs = require('fs').promises;
const path = require('path');
const config = require('../../config');
const logger = require('../../utils/logger');

// Storage file for persistent state
const STORAGE_FILE = './data/bot2-state.json';

// In-memory state
let state = {
  activeReminders: {}, // invoiceId -> { createdAt, lastReminder, snoozedUntil, jobName, totalAmount }
  pendingNewProject: null,
  pendingCustomerSelection: null,
  undoOptions: {} // temp storage for undo actions
};

/**
 * Initialize - load state from file
 */
async function initialize() {
  try {
    // Ensure data directory exists
    const dir = path.dirname(STORAGE_FILE);
    await fs.mkdir(dir, { recursive: true });

    const data = await fs.readFile(STORAGE_FILE, 'utf8');
    state = JSON.parse(data);
    logger.info('Reminder state loaded', { reminders: Object.keys(state.activeReminders).length });
  } catch (error) {
    // File doesn't exist, use default state
    logger.info('No existing reminder state, starting fresh');
    await saveState();
  }
}

/**
 * Save state to file
 */
async function saveState() {
  try {
    const dir = path.dirname(STORAGE_FILE);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(STORAGE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    logger.error('Failed to save reminder state', { error: error.message });
  }
}

/**
 * Start reminder cycle for a new invoice
 */
async function startReminderCycle(invoiceId, jobName, totalAmount) {
  state.activeReminders[invoiceId] = {
    createdAt: Date.now(),
    lastReminder: null,
    snoozedUntil: null,
    jobName,
    totalAmount,
    status: 'pending'
  };

  await saveState();
  logger.info('Started reminder cycle', { invoiceId, jobName });
}

/**
 * Cancel reminder for an invoice (approved/sent)
 */
async function cancelReminder(invoiceId) {
  if (state.activeReminders[invoiceId]) {
    delete state.activeReminders[invoiceId];
    await saveState();
    logger.info('Cancelled reminder', { invoiceId });
  }
}

/**
 * Snooze all reminders for 24 hours
 */
async function snoozeAllReminders() {
  const snoozedUntil = Date.now() + config.billing.snoozeDuration;
  
  for (const invoiceId of Object.keys(state.activeReminders)) {
    state.activeReminders[invoiceId].snoozedUntil = snoozedUntil;
  }

  await saveState();
  logger.info('Snoozed all reminders', { until: new Date(snoozedUntil).toISOString() });
}

/**
 * Process reminders - called by scheduler
 */
async function processReminders() {
  const now = Date.now();
  const ringcentral = require('../ringcentral');
  
  for (const [invoiceId, reminder] of Object.entries(state.activeReminders)) {
    // Skip if snoozed
    if (reminder.snoozedUntil && now < reminder.snoozedUntil) {
      continue;
    }

    // Clear expired snooze
    if (reminder.snoozedUntil && now >= reminder.snoozedUntil) {
      reminder.snoozedUntil = null;
    }

    const age = now - reminder.createdAt;
    const daysOld = Math.floor(age / (24 * 60 * 60 * 1000));

    const invoiceData = {
      invoiceId,
      jobName: reminder.jobName,
      totalAmount: reminder.totalAmount,
      daysOld
    };

    try {
      // Check which reminder to send based on age
      if (age >= config.billing.reminders.followUpEmail && reminder.status !== 'followUpSent') {
        // 16 days - send follow-up email
        await ringcentral.sendReminder('followUp', invoiceData);
        reminder.status = 'followUpSent';
        reminder.lastReminder = now;
        logger.info('Sent follow-up reminder', { invoiceId });
        
      } else if (age >= config.billing.reminders.pastDueReminder && reminder.status !== 'pastDueSent') {
        // 15 days - mark as past due
        await ringcentral.sendReminder('pastDue', invoiceData);
        reminder.status = 'pastDueSent';
        reminder.lastReminder = now;
        logger.info('Sent past due reminder', { invoiceId });
        
      } else if (age >= config.billing.reminders.secondReminder && reminder.status !== 'secondSent') {
        // 7 days
        await ringcentral.sendReminder('second', invoiceData);
        reminder.status = 'secondSent';
        reminder.lastReminder = now;
        logger.info('Sent second reminder', { invoiceId });
        
      } else if (age >= config.billing.reminders.firstReminder && !reminder.lastReminder) {
        // 1 day
        await ringcentral.sendReminder('first', invoiceData);
        reminder.status = 'firstSent';
        reminder.lastReminder = now;
        logger.info('Sent first reminder', { invoiceId });
      }
    } catch (error) {
      logger.error('Failed to send reminder', { error: error.message, invoiceId });
    }
  }

  // Also check for expired new project requests
  await checkNewProjectTimeout();

  await saveState();
}

/**
 * Check for new project request timeout
 */
async function checkNewProjectTimeout() {
  if (!state.pendingNewProject) return;

  const requestedAt = new Date(state.pendingNewProject.requestedAt).getTime();
  const age = Date.now() - requestedAt;
  const timeout = config.billing.newProjectTimeout;
  const followUpInterval = config.billing.newProjectFollowUpInterval;

  if (age > timeout) {
    // Check if we should send a follow-up
    const lastFollowUp = state.pendingNewProject.lastFollowUp || requestedAt;
    const timeSinceFollowUp = Date.now() - lastFollowUp;

    if (timeSinceFollowUp >= followUpInterval) {
      const ringcentral = require('../ringcentral');
      
      try {
        await ringcentral.sendGroupText(
          `⏰ Reminder: New project request still pending!\n\n` +
          `Contractor: ${state.pendingNewProject.contractorName}\n` +
          `Project: ${state.pendingNewProject.projectName}\n\n` +
          `Reply 1 (create), 2 (existing customer), or 3 (cancel)`
        );
        
        state.pendingNewProject.lastFollowUp = Date.now();
        await saveState();
        
        logger.info('Sent new project follow-up');
      } catch (error) {
        logger.error('Failed to send new project follow-up', { error: error.message });
      }
    }
  }
}

/**
 * Store pending new project request
 */
async function storePendingNewProject(data) {
  state.pendingNewProject = data;
  await saveState();
}

/**
 * Get pending new project
 */
async function getPendingNewProject() {
  return state.pendingNewProject;
}

/**
 * Clear pending new project
 */
async function clearPendingNewProject() {
  state.pendingNewProject = null;
  await saveState();
}

/**
 * Set pending customer selection
 */
async function setPendingCustomerSelection(customers) {
  state.pendingCustomerSelection = customers;
  await saveState();
}

/**
 * Get pending customer selection
 */
async function getPendingCustomerSelection() {
  return state.pendingCustomerSelection;
}

/**
 * Clear pending customer selection
 */
async function clearPendingCustomerSelection() {
  state.pendingCustomerSelection = null;
  await saveState();
}

/**
 * Store undo option
 */
async function storeUndoOption(data, duration) {
  const expiresAt = Date.now() + duration;
  state.undoOptions[data.projectId] = {
    ...data,
    expiresAt
  };
  await saveState();
}

/**
 * Get all active reminders for dashboard
 */
function getActiveReminders() {
  const reminders = [];
  
  for (const [invoiceId, reminder] of Object.entries(state.activeReminders)) {
    const age = Date.now() - reminder.createdAt;
    const daysOld = Math.floor(age / (24 * 60 * 60 * 1000));
    
    reminders.push({
      invoiceId,
      jobName: reminder.jobName,
      totalAmount: reminder.totalAmount,
      daysOld,
      status: reminder.status,
      snoozedUntil: reminder.snoozedUntil ? new Date(reminder.snoozedUntil).toISOString() : null,
      createdAt: new Date(reminder.createdAt).toISOString()
    });
  }

  return reminders.sort((a, b) => b.daysOld - a.daysOld);
}

/**
 * Get state summary for dashboard
 */
function getStateSummary() {
  return {
    activeReminders: Object.keys(state.activeReminders).length,
    pendingNewProject: !!state.pendingNewProject,
    pendingCustomerSelection: !!state.pendingCustomerSelection
  };
}

// Initialize on module load
initialize().catch(err => logger.error('Failed to initialize reminders', { error: err.message }));

module.exports = {
  initialize,
  startReminderCycle,
  cancelReminder,
  snoozeAllReminders,
  processReminders,
  storePendingNewProject,
  getPendingNewProject,
  clearPendingNewProject,
  setPendingCustomerSelection,
  getPendingCustomerSelection,
  clearPendingCustomerSelection,
  storeUndoOption,
  getActiveReminders,
  getStateSummary
};



