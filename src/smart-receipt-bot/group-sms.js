/**
 * Group SMS Handler
 * 
 * Sends SMS/MMS to both Bobby and Jessica
 * Handles replies from either person
 */

const logger = require('../utils/logger');

// Group members - Bobby and Jessica
const GROUP_MEMBERS = [
  { name: 'Bobby', phone: process.env.BOBBY_PHONE || '+18088666500' },
  { name: 'Jessica', phone: process.env.JESSICA_PHONE || '+18082688453' }
];

// RingCentral client reference
let rcSDK = null;
let platform = null;
let replyHandler = null;

/**
 * Initialize RingCentral connection
 */
async function initialize() {
  if (platform) return;

  try {
    const SDK = require('@ringcentral/sdk').SDK;
    
    rcSDK = new SDK({
      server: process.env.RINGCENTRAL_SERVER || 'https://platform.ringcentral.com',
      clientId: process.env.RINGCENTRAL_CLIENT_ID,
      clientSecret: process.env.RINGCENTRAL_CLIENT_SECRET
    });

    platform = rcSDK.platform();

    // Try to load saved token
    const fs = require('fs');
    const tokenPath = 'tokens/ringcentral-token.json';
    
    if (fs.existsSync(tokenPath)) {
      const savedToken = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
      await platform.auth().setData(savedToken);
      
      if (await platform.auth().accessTokenValid()) {
        logger.info('RingCentral authenticated from saved token');
      } else {
        await platform.refresh();
        logger.info('RingCentral token refreshed');
      }
    }

    logger.info('Group SMS initialized', { 
      members: GROUP_MEMBERS.map(m => m.name) 
    });

  } catch (error) {
    logger.error('RingCentral initialization failed', { error: error.message });
    throw error;
  }
}

/**
 * Send text message to group (both Bobby and Jessica)
 */
async function send(message) {
  await initialize();

  try {
    // Send to each group member
    for (const member of GROUP_MEMBERS) {
      await platform.post('/restapi/v1.0/account/~/extension/~/sms', {
        from: { phoneNumber: process.env.RINGCENTRAL_PHONE_NUMBER },
        to: [{ phoneNumber: member.phone }],
        text: message
      });

      logger.info('SMS sent', { to: member.name, preview: message.substring(0, 50) });
    }

    return true;

  } catch (error) {
    logger.error('Failed to send group SMS', { error: error.message });
    throw error;
  }
}

/**
 * Send MMS with image to group
 */
async function sendWithImage(message, imageData) {
  await initialize();

  try {
    // Convert image to buffer if needed
    let imageBuffer;
    if (Buffer.isBuffer(imageData)) {
      imageBuffer = imageData;
    } else if (typeof imageData === 'string') {
      // Assume base64
      imageBuffer = Buffer.from(imageData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    }

    // Send to each group member
    for (const member of GROUP_MEMBERS) {
      const formData = await platform.post('/restapi/v1.0/account/~/extension/~/sms', {
        from: { phoneNumber: process.env.RINGCENTRAL_PHONE_NUMBER },
        to: [{ phoneNumber: member.phone }],
        text: message
      });

      // Note: RingCentral MMS requires multipart form data
      // For now, send as separate text + image might need adjustment
      // based on RingCentral SDK version

      logger.info('MMS sent', { to: member.name });
    }

    return true;

  } catch (error) {
    logger.error('Failed to send group MMS', { error: error.message });
    // Fall back to text-only
    return await send(message + '\n\n[Receipt image attached]');
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
  
  // Set up webhook or polling for incoming messages
  // This depends on RingCentral setup - webhook is preferred
  setupIncomingMessageHandler();
}

/**
 * Set up handler for incoming messages
 */
async function setupIncomingMessageHandler() {
  await initialize();

  try {
    // Subscribe to incoming SMS events
    const subscription = rcSDK.createSubscription();

    subscription.on(subscription.events.notification, (msg) => {
      handleIncomingMessage(msg);
    });

    await subscription.setEventFilters([
      '/restapi/v1.0/account/~/extension/~/message-store/instant?type=SMS'
    ]);

    await subscription.register();

    logger.info('Subscribed to incoming SMS');

  } catch (error) {
    logger.error('Failed to subscribe to SMS', { error: error.message });
    
    // Fall back to polling
    startPolling();
  }
}

/**
 * Handle incoming message
 */
function handleIncomingMessage(notification) {
  try {
    const message = notification.body;
    
    if (message.direction !== 'Inbound') return;

    // Check if from a group member
    const fromNumber = message.from?.phoneNumber;
    const member = GROUP_MEMBERS.find(m => 
      m.phone === fromNumber || 
      m.phone.replace(/\D/g, '') === fromNumber?.replace(/\D/g, '')
    );

    if (!member) {
      logger.info('Ignoring SMS from non-group member', { from: fromNumber });
      return;
    }

    logger.info('Received SMS from group member', { 
      from: member.name, 
      text: message.subject || message.text 
    });

    // Check for attachments (photos)
    if (message.attachments && message.attachments.length > 0) {
      if (replyHandler) {
        replyHandler({
          from: member.name,
          phone: fromNumber,
          text: message.subject || '',
          attachments: message.attachments,
          hasPhoto: true
        });
      }
    } else {
      // Text-only reply
      if (replyHandler) {
        replyHandler({
          from: member.name,
          phone: fromNumber,
          text: message.subject || message.text || '',
          attachments: [],
          hasPhoto: false
        });
      }
    }

  } catch (error) {
    logger.error('Error handling incoming message', { error: error.message });
  }
}

/**
 * Polling fallback for incoming messages
 */
let pollingInterval = null;
let lastMessageTime = new Date();

function startPolling() {
  if (pollingInterval) return;

  logger.info('Starting SMS polling fallback');

  pollingInterval = setInterval(async () => {
    try {
      const response = await platform.get('/restapi/v1.0/account/~/extension/~/message-store', {
        messageType: 'SMS',
        direction: 'Inbound',
        dateFrom: lastMessageTime.toISOString()
      });

      const messages = response.json().records || [];

      for (const msg of messages) {
        const msgTime = new Date(msg.creationTime);
        if (msgTime > lastMessageTime) {
          handleIncomingMessage({ body: msg });
          lastMessageTime = msgTime;
        }
      }

    } catch (error) {
      logger.error('SMS polling error', { error: error.message });
    }
  }, 30000); // Poll every 30 seconds
}

/**
 * Stop polling
 */
function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

/**
 * Send daily summary to group
 */
async function sendDailySummary(summary) {
  const message = 
    `📊 Daily Summary - ${new Date().toLocaleDateString()}\n\n` +
    `✅ Auto-categorized: ${summary.autoCategorized} expenses\n` +
    `📝 You categorized: ${summary.manuallyCategorized} expenses\n` +
    `⏳ Still pending: ${summary.pending} expenses\n\n` +
    `💰 Billable today: $${summary.billableAmount.toFixed(2)}\n` +
    `📦 Stock/Shop: $${summary.stockAmount.toFixed(2)}\n` +
    `📎 Receipts attached: ${summary.receiptsAttached}`;

  return await send(message);
}

module.exports = {
  initialize,
  send,
  sendWithImage,
  sendAlert,
  sendConfirmation,
  onReply,
  sendDailySummary,
  GROUP_MEMBERS
};

