/**
 * Group SMS Handler
 * 
 * Sends SMS/MMS to both Bobby and Jessica
 * Handles replies from either person
 * 
 * Uses the existing Bot 2 RingCentral service for authentication
 */

const ringcentralService = require('../bot2/ringcentral');
const config = require('../config');
const logger = require('../utils/logger');

// Group members - Bobby and Jessica
const GROUP_MEMBERS = [
  { name: 'Bobby', phone: config.notifications.bobbyPhone },
  { name: 'Jessica', phone: config.notifications.jessicaPhone }
];

// Reply handler
let replyHandler = null;

/**
 * Send text message to group (both Bobby and Jessica)
 */
async function send(message) {
  try {
    const results = [];
    
    // Send to each group member using existing RingCentral service
    for (const member of GROUP_MEMBERS) {
      try {
        await ringcentralService.sendSMS(member.phone, message);
        results.push({ name: member.name, success: true });
        logger.info('SMS sent to group member', { to: member.name, preview: message.substring(0, 50) });
      } catch (error) {
        results.push({ name: member.name, success: false, error: error.message });
        logger.error('Failed to send SMS to group member', { to: member.name, error: error.message });
      }
    }

    // Return true if at least one message was sent
    return results.some(r => r.success);

  } catch (error) {
    logger.error('Failed to send group SMS', { error: error.message });
    throw error;
  }
}

/**
 * Send MMS with image to group
 * Note: Falls back to text if MMS fails
 */
async function sendWithImage(message, imageData) {
  try {
    // For now, send as text with note about attachment
    // Full MMS support requires multipart form data handling
    return await send(message + '\n\n📷 [Receipt image attached in email]');

  } catch (error) {
    logger.error('Failed to send group MMS', { error: error.message });
    // Fall back to text-only
    return await send(message);
  }
}

/**
 * Send alert (prefixed with ⚠️)
 */
async function sendAlert(message) {
  return await send(`⚠️ ${message}`);
}

/**
 * Send confirmation (prefixed with ✅)
 */
async function sendConfirmation(message) {
  return await send(`✅ ${message}`);
}

/**
 * Register handler for incoming SMS replies
 */
function onReply(handler) {
  replyHandler = handler;
  logger.info('Group SMS reply handler registered');
}

/**
 * Process incoming SMS from webhook
 * Called by the smart-receipt routes webhook handler
 */
function processIncomingMessage(message) {
  try {
    const fromNumber = message.from;
    
    // Check if from a group member
    const member = GROUP_MEMBERS.find(m => 
      m.phone === fromNumber || 
      m.phone.replace(/\D/g, '') === fromNumber?.replace(/\D/g, '')
    );

    if (!member) {
      logger.info('Ignoring SMS from non-group member', { from: fromNumber });
      return null;
    }

    logger.info('Received SMS from group member', { 
      from: member.name, 
      text: message.text?.substring(0, 50)
    });

    // Call reply handler if registered
    if (replyHandler) {
      replyHandler({
        from: member.name,
        phone: fromNumber,
        text: message.text || '',
        attachments: message.attachments || [],
        hasPhoto: (message.attachments || []).length > 0
      });
    }

    return {
      member,
      text: message.text,
      hasPhoto: (message.attachments || []).length > 0
    };

  } catch (error) {
    logger.error('Error processing incoming message', { error: error.message });
    return null;
  }
}

/**
 * Send daily summary to group
 */
async function sendDailySummary(summary) {
  const message = 
    `📊 Daily Summary - ${new Date().toLocaleDateString()}\n\n` +
    `✅ Auto-categorized: ${summary.autoCategorized || 0} expenses\n` +
    `📝 You categorized: ${summary.manuallyCategorized || 0} expenses\n` +
    `⏳ Still pending: ${summary.pending || 0} expenses\n\n` +
    `💰 Billable today: $${(summary.billableAmount || 0).toFixed(2)}\n` +
    `📦 Stock/Shop: $${(summary.stockAmount || 0).toFixed(2)}\n` +
    `📎 Receipts attached: ${summary.receiptsAttached || 0}`;

  return await send(message);
}

/**
 * Check if RingCentral is authenticated
 */
async function isReady() {
  return await ringcentralService.isAuthenticated();
}

module.exports = {
  send,
  sendWithImage,
  sendAlert,
  sendConfirmation,
  onReply,
  processIncomingMessage,
  sendDailySummary,
  isReady,
  GROUP_MEMBERS
};
