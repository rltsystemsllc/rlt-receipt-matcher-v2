/**
 * RingCentral SMS Service for Bot 2
 * Sends group texts to Jessica and Bobby for notifications
 */

const SDK = require('@ringcentral/sdk').SDK;
const fs = require('fs').promises;
const config = require('../../config');
const logger = require('../../utils/logger');

let rcSDK = null;
let platform = null;

/**
 * Initialize RingCentral SDK
 */
async function initialize() {
  if (platform) return platform;

  try {
    rcSDK = new SDK({
      server: config.ringcentral.server,
      clientId: config.ringcentral.clientId,
      clientSecret: config.ringcentral.clientSecret
    });

    platform = rcSDK.platform();

    // Try to load existing token from env var (Railway) or file (local)
    try {
      let tokens;
      if (process.env.RINGCENTRAL_TOKEN_JSON) {
        try {
          tokens = JSON.parse(process.env.RINGCENTRAL_TOKEN_JSON);
          logger.info('RingCentral token loaded from environment variable');
        } catch {
          logger.warn('Failed to parse RINGCENTRAL_TOKEN_JSON env var');
        }
      }
      
      if (!tokens) {
        const tokenData = await fs.readFile(config.ringcentral.tokenPath, 'utf8');
        tokens = JSON.parse(tokenData);
      }
      
      await platform.auth().setData(tokens);
      
      // Check if token is valid
      if (!await platform.loggedIn()) {
        throw new Error('Token expired');
      }
      
      logger.info('RingCentral client initialized with saved token');
    } catch (tokenError) {
      // Need fresh authentication
      if (config.ringcentral.jwtToken) {
        // Use JWT authentication
        await platform.login({ jwt: config.ringcentral.jwtToken });
        await saveTokens();
        logger.info('RingCentral authenticated with JWT');
      } else {
        logger.warn('RingCentral needs authentication');
        return null;
      }
    }

    // Set up token refresh handler
    platform.on(platform.events.refreshSuccess, async () => {
      await saveTokens();
      logger.info('RingCentral token refreshed');
    });

    return platform;
  } catch (error) {
    logger.error('Failed to initialize RingCentral', { error: error.message });
    return null;
  }
}

/**
 * Save tokens to file
 */
async function saveTokens() {
  if (!platform) return;
  
  const tokens = await platform.auth().data();
  await fs.writeFile(config.ringcentral.tokenPath, JSON.stringify(tokens, null, 2));
}

/**
 * Send SMS to a single number
 */
async function sendToNumber(toNumber, message) {
  await initialize();
  
  if (!platform) {
    throw new Error('RingCentral not authenticated');
  }

  try {
    const response = await platform.post('/restapi/v1.0/account/~/extension/~/sms', {
      from: { phoneNumber: config.ringcentral.botPhoneNumber },
      to: [{ phoneNumber: toNumber }],
      text: message
    });

    logger.info('SMS sent', { to: toNumber, length: message.length });
    return response.json();
  } catch (error) {
    logger.error('Failed to send SMS', { error: error.message, to: toNumber });
    throw error;
  }
}

/**
 * Send SMS to both Jessica and Bobby
 */
async function sendGroupText(message) {
  await initialize();
  
  if (!platform) {
    throw new Error('RingCentral not authenticated');
  }

  const recipients = config.ringcentral.groupRecipients;
  
  try {
    const response = await platform.post('/restapi/v1.0/account/~/extension/~/sms', {
      from: { phoneNumber: config.ringcentral.botPhoneNumber },
      to: recipients.map(num => ({ phoneNumber: num })),
      text: message
    });

    logger.info('Group SMS sent', { recipients: recipients.length, length: message.length });
    return response.json();
  } catch (error) {
    logger.error('Failed to send group SMS', { error: error.message });
    throw error;
  }
}

/**
 * Send invoice notification with all details
 */
async function sendInvoiceNotification(invoiceData) {
  const { 
    jobName, 
    invoiceId,
    totalAmount,
    laborTotal,
    materialsTotal,
    totalHours,
    phases,
    rowCount
  } = invoiceData;

  const message = `📄 Bot 2: Draft invoice created!\n\n` +
    `Job: ${jobName}\n` +
    `Invoice #: ${invoiceId}\n\n` +
    `💰 Total: $${totalAmount.toFixed(2)}\n` +
    `👷 Labor: $${laborTotal.toFixed(2)} (${totalHours} hrs)\n` +
    `🔧 Materials: $${materialsTotal.toFixed(2)}\n\n` +
    `Phase(s): ${phases.join(', ')}\n` +
    `Entries: ${rowCount}\n\n` +
    `Review in QuickBooks and reply APPROVE to send.\n` +
    `Or approve manually in QBO.`;

  await sendGroupText(message);

  // Also send the summaries as separate messages if too long
  // Could attach PDFs via MMS if supported
}

/**
 * Send reminder notification
 */
async function sendReminder(type, invoiceData) {
  const { jobName, invoiceId, totalAmount, daysOld } = invoiceData;

  let emoji = '🔔';
  let urgency = '';

  switch (type) {
    case 'first':
      emoji = '🔔';
      urgency = 'Reminder';
      break;
    case 'second':
      emoji = '⚠️';
      urgency = 'Second reminder';
      break;
    case 'pastDue':
      emoji = '🚨';
      urgency = 'OVERDUE';
      break;
    case 'followUp':
      emoji = '📧';
      urgency = 'Needs Follow-Up';
      break;
  }

  const message = `${emoji} ${urgency}: Invoice draft for "${jobName}" still needs approval.\n\n` +
    `Invoice #: ${invoiceId}\n` +
    `Amount: $${totalAmount.toFixed(2)}\n` +
    `Age: ${daysOld} days\n\n` +
    `Reply APPROVE to send, or SNOOZE for 24hr.`;

  await sendGroupText(message);
}

/**
 * Send error notification
 */
async function sendErrorNotification(error, context) {
  const message = `⚠️ Bot 2 Error\n\n` +
    `Context: ${context}\n` +
    `Error: ${error.message}\n\n` +
    `Please check the dashboard at /bot2`;

  try {
    await sendGroupText(message);
  } catch (smsError) {
    logger.error('Failed to send error notification', { error: smsError.message });
  }
}

/**
 * Check if RingCentral is authenticated
 */
async function isAuthenticated() {
  try {
    await initialize();
    return platform && await platform.loggedIn();
  } catch {
    return false;
  }
}

/**
 * Get authentication instructions
 */
function getAuthInstructions() {
  return {
    step1: 'Go to https://developers.ringcentral.com/',
    step2: 'Create a new application',
    step3: 'Set App Type to "JWT auth flow"',
    step4: 'Add SMS permissions',
    step5: 'Create a JWT credential',
    step6: 'Add RINGCENTRAL_CLIENT_ID, RINGCENTRAL_CLIENT_SECRET, and RINGCENTRAL_JWT_TOKEN to .env',
    step7: 'Set RINGCENTRAL_BOT_PHONE to your dedicated bot number'
  };
}

/**
 * Set up webhook for incoming SMS (optional)
 * This allows the bot to receive SMS replies
 */
async function setupWebhook(webhookUrl) {
  await initialize();
  
  if (!platform) {
    throw new Error('RingCentral not authenticated');
  }

  try {
    // Subscribe to SMS events
    const response = await platform.post('/restapi/v1.0/subscription', {
      eventFilters: ['/restapi/v1.0/account/~/extension/~/message-store/instant?type=SMS'],
      deliveryMode: {
        transportType: 'WebHook',
        address: webhookUrl
      }
    });

    logger.info('RingCentral webhook set up', { webhookUrl });
    return response.json();
  } catch (error) {
    logger.error('Failed to set up webhook', { error: error.message });
    throw error;
  }
}

/**
 * Process incoming SMS webhook
 */
async function processIncomingWebhook(body) {
  // Handle verification request
  if (body.validation_token) {
    return { validationToken: body.validation_token };
  }

  // Process incoming SMS
  if (body.body && body.body.changes) {
    for (const change of body.body.changes) {
      if (change.type === 'SMS' && change.direction === 'Inbound') {
        const from = change.from.phoneNumber;
        const text = change.subject || '';
        
        logger.info('Received SMS', { from, text: text.substring(0, 50) });
        
        // Return the message for processing
        return { from, text };
      }
    }
  }

  return null;
}

module.exports = {
  initialize,
  sendToNumber,
  sendGroupText,
  sendInvoiceNotification,
  sendReminder,
  sendErrorNotification,
  isAuthenticated,
  getAuthInstructions,
  setupWebhook,
  processIncomingWebhook
};



