/**
 * Invoice Safeguards for Bot 2
 * 5 Layers of Protection Against Incorrect Billing
 * 
 * Layer 1: Pre-flight sanity checks
 * Layer 2: Detailed preview in approval SMS
 * Layer 3: Undo window (5-min delay before send)
 * Layer 4: Two-stage approval for large invoices
 * Layer 5: Daily reconciliation summary
 */

const fs = require('fs').promises;
const path = require('path');
const config = require('../../config');
const logger = require('../../utils/logger');
const sheetsService = require('../sheets');

// Storage for pending sends and daily stats
const SAFEGUARDS_STATE_FILE = './data/bot2-safeguards.json';

let state = {
  pendingSends: {},      // invoiceId -> { invoice, approvedAt, scheduledSendAt, canUndo }
  dailyStats: {          // Track daily activity for reconciliation
    date: null,
    invoicesSent: [],
    totalAmount: 0
  },
  weeklyStats: {
    weekStart: null,
    invoicesSent: [],
    totalAmount: 0,
    totalProfit: 0
  }
};

/**
 * Initialize - load state from file
 */
async function initialize() {
  try {
    const dir = path.dirname(SAFEGUARDS_STATE_FILE);
    await fs.mkdir(dir, { recursive: true });
    
    const data = await fs.readFile(SAFEGUARDS_STATE_FILE, 'utf8');
    state = JSON.parse(data);
    logger.info('Safeguards state loaded');
  } catch {
    logger.info('No existing safeguards state, starting fresh');
    await saveState();
  }
  
  // Reset daily stats if new day
  const today = new Date().toISOString().split('T')[0];
  if (state.dailyStats.date !== today) {
    state.dailyStats = {
      date: today,
      invoicesSent: [],
      totalAmount: 0
    };
    await saveState();
  }
}

/**
 * Save state to file
 */
async function saveState() {
  try {
    const dir = path.dirname(SAFEGUARDS_STATE_FILE);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(SAFEGUARDS_STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    logger.error('Failed to save safeguards state', { error: error.message });
  }
}

// ============================================
// LAYER 1: Pre-Flight Sanity Checks
// ============================================

/**
 * Run all pre-flight checks on invoice data
 * Returns { passed: boolean, warnings: string[], errors: string[] }
 */
async function runPreFlightChecks(preview) {
  const warnings = [];
  const errors = [];
  const cfg = config.safeguards;

  // Check 1: Unusually high hours in a single day
  for (const detail of preview.labor.dateDetails) {
    if (detail.hours > cfg.maxHoursPerDay) {
      warnings.push(
        `⚠️ ${detail.hours} hours on ${detail.date} exceeds typical max of ${cfg.maxHoursPerDay} hrs`
      );
    }
  }

  // Check 2: No materials on a job (might be missing receipts)
  if (preview.materials.expensesFromQBO.length === 0 && 
      preview.materials.stockFromSheet.length === 0) {
    warnings.push(
      `⚠️ No materials found - check if receipts were categorized in Smart Receipt Bot`
    );
  }

  // Check 3: Invoice amount unusually high compared to history
  try {
    const history = await sheetsService.getCustomerAverageInvoice(preview.jobName);
    if (history.invoiceCount > 0) {
      const threshold = history.averageAmount * cfg.invoiceAmountMultiplierWarning;
      if (preview.summary.totalRevenue > threshold) {
        warnings.push(
          `⚠️ Invoice $${preview.summary.totalRevenue.toFixed(0)} is ${cfg.invoiceAmountMultiplierWarning}x higher than average $${history.averageAmount.toFixed(0)}`
        );
      }
    }
  } catch (e) {
    // Ignore history check failures
  }

  // Check 4: Missing customer email
  // This would need to query QBO - will be checked at send time

  // Check 5: Negative profit margin
  if (preview.summary.profitMargin < 0) {
    warnings.push(
      `⚠️ NEGATIVE PROFIT: Losing $${Math.abs(preview.summary.profit).toFixed(2)} on this job!`
    );
  } else if (preview.summary.profitMargin < 20) {
    warnings.push(
      `⚠️ Low margin: Only ${preview.summary.profitMargin.toFixed(0)}% profit`
    );
  }

  // Check 6: Weekend work without emergency rate
  for (const detail of preview.labor.dateDetails) {
    if (detail.date) {
      const date = new Date(detail.date);
      const dayOfWeek = date.getDay();
      if (config.safeguards.emergencyRateDays.includes(dayOfWeek) && !detail.isEmergency) {
        warnings.push(
          `⚠️ Weekend work on ${detail.date} - consider emergency rate ($${config.billing.laborRateEmergency}/hr)`
        );
      }
    }
  }

  const passed = errors.length === 0;

  return { passed, warnings, errors };
}

// ============================================
// LAYER 2: Detailed Preview Message
// ============================================

/**
 * Build detailed preview SMS message
 */
function buildDetailedPreviewMessage(preview, invoiceResult, preFlightResult) {
  const { summary, labor, materials } = preview;
  
  let msg = `📋 INVOICE PREVIEW: ${preview.jobName}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Work dates
  const dates = labor.dateDetails.map(d => d.date).filter(Boolean);
  if (dates.length > 0) {
    const uniqueDates = [...new Set(dates)].sort();
    if (uniqueDates.length === 1) {
      msg += `📅 Date: ${uniqueDates[0]}\n\n`;
    } else {
      msg += `📅 Dates: ${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}\n\n`;
    }
  }

  // Labor details
  msg += `👷 LABOR (from Daily Job Log)\n`;
  for (const detail of labor.dateDetails) {
    const rateIcon = detail.isEmergency ? '⚡' : '';
    msg += `   ${detail.date}: ${detail.hours} hrs ${rateIcon}\n`;
    msg += `   └─ ${truncate(detail.description, 40)}\n`;
  }
  
  if (labor.standardHours > 0) {
    msg += `   Standard: ${labor.standardHours} hrs × $${labor.standardRate} = $${labor.standardTotal.toFixed(2)}\n`;
  }
  if (labor.emergencyHours > 0) {
    msg += `   ⚡Emergency: ${labor.emergencyHours} hrs × $${labor.emergencyRate} = $${labor.emergencyTotal.toFixed(2)}\n`;
  }
  msg += `   LABOR TOTAL: $${labor.laborTotal.toFixed(2)}\n\n`;

  // Materials from QBO
  if (materials.expensesFromQBO.length > 0) {
    msg += `🧾 MATERIALS (from Smart Receipt Bot)\n`;
    for (const exp of materials.expensesFromQBO) {
      const receipt = exp.hasReceipt ? '✓' : '';
      msg += `   ${exp.vendor}: $${exp.amount.toFixed(2)} ${receipt}\n`;
    }
    msg += `   Cost: $${materials.qboCost.toFixed(2)}\n`;
    msg += `   +${materials.markupPercent}% markup: $${materials.qboWithMarkup.toFixed(2)}\n\n`;
  }

  // Stock materials from sheet (backup)
  if (materials.stockFromSheet.length > 0) {
    msg += `📦 STOCK MATERIALS (from Daily Log)\n`;
    for (const stock of materials.stockFromSheet) {
      msg += `   • ${truncate(stock.description, 50)}\n`;
    }
    msg += `\n`;
  }

  // Summary
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💰 INVOICE TOTAL: $${summary.totalRevenue.toFixed(2)}\n`;
  msg += `   Your cost: $${summary.totalCost.toFixed(2)}\n`;
  msg += `   PROFIT: $${summary.profit.toFixed(2)} (${summary.profitMargin.toFixed(0)}%)\n`;

  // Customer email
  if (invoiceResult.customerEmail) {
    msg += `\n📧 Will send to: ${invoiceResult.customerEmail}\n`;
  } else {
    msg += `\n⚠️ NO EMAIL - Add email in QBO before sending\n`;
  }

  // Pre-flight warnings
  if (preFlightResult.warnings.length > 0) {
    msg += `\n⚠️ WARNINGS:\n`;
    for (const warning of preFlightResult.warnings) {
      msg += `${warning}\n`;
    }
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

  return msg;
}

/**
 * Build approval options message based on invoice size and flags
 */
function buildApprovalOptionsMessage(invoiceResult, isLargeInvoice, hasWarnings) {
  let msg = '';

  if (isLargeInvoice) {
    msg += `\n🔒 LARGE INVOICE - Two-stage approval required\n`;
    msg += `Reply REVIEW to see PDF preview\n`;
    msg += `Reply APPROVE to send to customer\n`;
    msg += `Reply HOLD to keep as draft\n`;
  } else if (hasWarnings) {
    msg += `\nReply APPROVE to send (review warnings above)\n`;
    msg += `Reply HOLD to keep as draft\n`;
    msg += `Reply FIX to cancel and correct\n`;
  } else {
    msg += `\nReply APPROVE to send\n`;
    msg += `Reply HOLD to keep as draft\n`;
  }

  return msg;
}

// ============================================
// LAYER 3: Undo Window
// ============================================

/**
 * Queue invoice for delayed send (undo window)
 */
async function queueForSend(invoiceId, invoiceResult, preview) {
  const undoMinutes = config.safeguards.undoWindowMinutes;
  const sendAt = Date.now() + (undoMinutes * 60 * 1000);

  state.pendingSends[invoiceId] = {
    invoice: invoiceResult,
    preview,
    approvedAt: Date.now(),
    scheduledSendAt: sendAt,
    canUndo: true
  };

  await saveState();

  logger.info('Invoice queued for delayed send', { 
    invoiceId, 
    sendAt: new Date(sendAt).toISOString() 
  });

  return {
    invoiceId,
    sendAt,
    undoMinutes
  };
}

/**
 * Process pending sends (called by scheduler)
 */
async function processPendingSends(sendCallback) {
  const now = Date.now();
  const toSend = [];

  for (const [invoiceId, pending] of Object.entries(state.pendingSends)) {
    if (pending.canUndo && now >= pending.scheduledSendAt) {
      toSend.push({ invoiceId, pending });
    }
  }

  for (const { invoiceId, pending } of toSend) {
    try {
      // Actually send the invoice
      const result = await sendCallback(invoiceId);
      
      // Move to daily stats
      await recordInvoiceSent(invoiceId, pending.invoice, pending.preview);
      
      // Remove from pending
      delete state.pendingSends[invoiceId];
      await saveState();

      logger.info('Pending invoice sent', { invoiceId });
      
    } catch (error) {
      logger.error('Failed to send pending invoice', { 
        invoiceId, 
        error: error.message 
      });
    }
  }

  return toSend.length;
}

/**
 * Cancel a pending send (undo)
 */
async function cancelPendingSend(invoiceId) {
  const pending = state.pendingSends[invoiceId];
  
  if (!pending) {
    return { success: false, reason: 'not_found' };
  }

  if (!pending.canUndo) {
    return { success: false, reason: 'already_sent' };
  }

  if (Date.now() >= pending.scheduledSendAt) {
    return { success: false, reason: 'window_expired' };
  }

  // Remove from pending
  delete state.pendingSends[invoiceId];
  await saveState();

  logger.info('Pending send cancelled (undo)', { invoiceId });

  return { 
    success: true, 
    invoice: pending.invoice 
  };
}

/**
 * Check if there's a pending send that can be undone
 */
function getMostRecentPendingSend() {
  const entries = Object.entries(state.pendingSends);
  if (entries.length === 0) return null;

  // Get most recent that can still be undone
  const now = Date.now();
  const undoable = entries
    .filter(([_, p]) => p.canUndo && now < p.scheduledSendAt)
    .sort((a, b) => b[1].approvedAt - a[1].approvedAt);

  if (undoable.length === 0) return null;

  const [invoiceId, pending] = undoable[0];
  const secondsRemaining = Math.floor((pending.scheduledSendAt - now) / 1000);

  return {
    invoiceId,
    invoice: pending.invoice,
    secondsRemaining
  };
}

// ============================================
// LAYER 4: Two-Stage Approval (DISABLED)
// ============================================

/**
 * Check if invoice requires two-stage approval
 * DISABLED per user request - all invoices use single-stage approval
 */
function requiresTwoStageApproval(totalAmount) {
  return false; // Disabled - was: totalAmount >= config.safeguards.largeInvoiceThreshold
}

// ============================================
// LAYER 5: Daily Reconciliation
// ============================================

/**
 * Record an invoice as sent for daily stats
 */
async function recordInvoiceSent(invoiceId, invoice, preview) {
  const today = new Date().toISOString().split('T')[0];
  
  // Reset if new day
  if (state.dailyStats.date !== today) {
    state.dailyStats = {
      date: today,
      invoicesSent: [],
      totalAmount: 0
    };
  }

  state.dailyStats.invoicesSent.push({
    invoiceId,
    jobName: invoice.jobName,
    amount: invoice.totalAmount,
    profit: preview?.summary?.profit || 0,
    sentAt: new Date().toISOString()
  });
  state.dailyStats.totalAmount += invoice.totalAmount;

  // Update weekly stats
  const weekStart = getWeekStart();
  if (state.weeklyStats.weekStart !== weekStart) {
    state.weeklyStats = {
      weekStart,
      invoicesSent: [],
      totalAmount: 0,
      totalProfit: 0
    };
  }

  state.weeklyStats.invoicesSent.push({
    invoiceId,
    jobName: invoice.jobName,
    amount: invoice.totalAmount,
    profit: preview?.summary?.profit || 0
  });
  state.weeklyStats.totalAmount += invoice.totalAmount;
  state.weeklyStats.totalProfit += preview?.summary?.profit || 0;

  await saveState();
}

/**
 * Build daily reconciliation message
 */
function buildDailyReconciliationMessage() {
  const stats = state.dailyStats;
  
  if (stats.invoicesSent.length === 0) {
    return `📊 DAILY SUMMARY\n\nNo invoices sent today.`;
  }

  let msg = `📊 DAILY BILLING SUMMARY\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `Invoices sent today:\n\n`;

  for (const inv of stats.invoicesSent) {
    msg += `✅ ${inv.jobName}\n`;
    msg += `   $${inv.amount.toFixed(2)}`;
    if (inv.profit > 0) {
      msg += ` (profit: $${inv.profit.toFixed(2)})`;
    }
    msg += `\n\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `TOTAL: $${stats.totalAmount.toFixed(2)}\n\n`;
  msg += `All correct? Reply OK or ISSUE if something's wrong.`;

  return msg;
}

/**
 * Get weekly stats for celebration messages
 */
function getWeeklyStats() {
  return state.weeklyStats;
}

// ============================================
// CELEBRATION MESSAGES
// ============================================

/**
 * Build celebration message after invoice sent
 */
function buildCelebrationMessage(invoice, preview) {
  const weekly = state.weeklyStats;
  
  let msg = `🎉 INVOICE SENT!\n\n`;
  msg += `${invoice.jobName}: $${invoice.totalAmount.toFixed(2)}\n`;
  
  if (preview?.summary?.profit > 0) {
    msg += `💰 Profit: $${preview.summary.profit.toFixed(2)} (${preview.summary.profitMargin.toFixed(0)}%)\n`;
  }

  msg += `\n━━━━ YOUR MOMENTUM ━━━━\n`;
  msg += `This week: ${weekly.invoicesSent.length} invoices\n`;
  msg += `Revenue: $${weekly.totalAmount.toFixed(2)}\n`;
  
  if (weekly.totalProfit > 0) {
    msg += `Profit: $${weekly.totalProfit.toFixed(2)}\n`;
  }

  // Add encouraging message based on performance
  if (weekly.invoicesSent.length >= 5) {
    msg += `\n🔥 Amazing week! Keep crushing it!`;
  } else if (weekly.invoicesSent.length >= 3) {
    msg += `\n💪 Great momentum!`;
  } else {
    msg += `\n✨ Nice work!`;
  }

  return msg;
}

/**
 * Build undo confirmation message
 */
function buildUndoWindowMessage(invoice, undoMinutes) {
  let msg = `✅ Invoice approved!\n\n`;
  msg += `${invoice.jobName}: $${invoice.totalAmount.toFixed(2)}\n\n`;
  msg += `📤 Sending to customer in ${undoMinutes} minutes...\n\n`;
  msg += `⚠️ Reply UNDO within ${undoMinutes} min to cancel`;

  return msg;
}

// ============================================
// HELPERS
// ============================================

function truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

function getWeekStart() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff));
  return monday.toISOString().split('T')[0];
}

// Initialize on module load
initialize().catch(err => logger.error('Failed to initialize safeguards', { error: err.message }));

module.exports = {
  // Layer 1: Pre-flight
  runPreFlightChecks,
  
  // Layer 2: Detailed preview
  buildDetailedPreviewMessage,
  buildApprovalOptionsMessage,
  
  // Layer 3: Undo window
  queueForSend,
  processPendingSends,
  cancelPendingSend,
  getMostRecentPendingSend,
  buildUndoWindowMessage,
  
  // Layer 4: Two-stage
  requiresTwoStageApproval,
  
  // Layer 5: Daily reconciliation
  recordInvoiceSent,
  buildDailyReconciliationMessage,
  getWeeklyStats,
  
  // Celebration
  buildCelebrationMessage,
  
  // State management
  initialize,
  saveState
};

