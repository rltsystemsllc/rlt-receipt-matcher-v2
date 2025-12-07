/**
 * RingCentral SMS integration for Bot 2
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
      
      if (tokens) {
        await platform.auth().setData(tokens);
        if (!await platform.loggedIn()) {
          throw new Error('Token expired');
        }
        logger.info('RingCentral client initialized with saved token');
      } else {
        throw new Error('No tokens found');
      }
    } catch (tokenError) {
      if (config.ringcentral.jwtToken) {
        logger.info('Authenticating RingCentral with JWT...');
        await platform.login({ jwt: config.ringcentral.jwtToken });
        await saveTokens();
        logger.info('RingCentral authenticated with JWT');
      } else {
        logger.warn('RingCentral needs authentication - no JWT token configured');
        platform = null;
        return null;
      }
    }

    platform.on(platform.events.refreshSuccess, async () => {
      await saveTokens();
      logger.info('RingCentral token refreshed');
    });

    return platform;
  } catch (error) {
    logger.error('Failed to initialize RingCentral', { error: error.message });
    platform = null;
    return null;
  }
}

async function saveTokens() {
  if (!platform) return;
  try {
    const tokens = await platform.auth().data();
    if (!process.env.RAILWAY_ENVIRONMENT_NAME) {
      await fs.writeFile(config.ringcentral.tokenPath, JSON.stringify(tokens, null, 2));
      logger.info('RingCentral tokens saved to file');
    }
  } catch (error) {
    logger.warn('Failed to save RingCentral tokens', { error: error.message });
  }
}

async function isAuthenticated() {
  await initialize();
  if (!platform) return false;
  try {
    return await platform.loggedIn();
  } catch {
    return false;
  }
}

/**
 * Send SMS to a single recipient
 */
async function sendSMS(to, message) {
  const plt = await initialize();
  if (!plt) throw new Error('RingCentral not initialized');

  try {
    const response = await plt.post('/restapi/v1.0/account/~/extension/~/sms', {
      from: { phoneNumber: config.ringcentral.botPhone },
      to: [{ phoneNumber: to }],
      text: message
    });
    const data = await response.json();
    logger.info('SMS sent', { to, messageId: data.id });
    return data;
  } catch (error) {
    logger.error('Failed to send SMS', { to, error: error.message });
    throw error;
  }
}

/**
 * Send SMS to GROUP CHAT (Bobby + Jessica in ONE conversation)
 */
async function sendGroupSMS(message) {
  const plt = await initialize();
  if (!plt) throw new Error('RingCentral not initialized');

  const recipients = [];
  if (config.notifications.bobbyPhone) {
    recipients.push({ phoneNumber: config.notifications.bobbyPhone });
  }
  if (config.notifications.jessicaPhone) {
    recipients.push({ phoneNumber: config.notifications.jessicaPhone });
  }
  if (recipients.length === 0) throw new Error('No recipients configured');

  try {
    const response = await plt.post('/restapi/v1.0/account/~/extension/~/sms', {
      from: { phoneNumber: config.ringcentral.botPhone },
      to: recipients,
      text: message
    });
    const data = await response.json();
    logger.info('Group SMS sent', { recipients: recipients.length, messageId: data.id });
    return data;
  } catch (error) {
    logger.error('Failed to send group SMS', { error: error.message });
    throw error;
  }
}

/**
 * Send MMS with image to GROUP CHAT (Bobby + Jessica in ONE conversation)
 */
async function sendGroupMMS(message, imageData, filename = 'receipt.jpg') {
  const plt = await initialize();
  if (!plt) throw new Error('RingCentral not initialized');

  const recipients = [];
  if (config.notifications.bobbyPhone) {
    recipients.push({ phoneNumber: config.notifications.bobbyPhone });
  }
  if (config.notifications.jessicaPhone) {
    recipients.push({ phoneNumber: config.notifications.jessicaPhone });
  }
  if (recipients.length === 0) throw new Error('No recipients configured');

  try {
    let imageBuffer;
    if (Buffer.isBuffer(imageData)) {
      imageBuffer = imageData;
    } else if (typeof imageData === 'string') {
      const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
      imageBuffer = Buffer.from(base64Data, 'base64');
    } else {
      throw new Error('Invalid image data');
    }

    let contentType = 'image/jpeg';
    if (filename.endsWith('.png')) contentType = 'image/png';
    if (filename.endsWith('.pdf')) contentType = 'application/pdf';

    const FormData = require('form-data');
    const form = new FormData();
    
    form.append('json', JSON.stringify({
      from: { phoneNumber: config.ringcentral.botPhone },
      to: recipients,
      text: message
    }), { contentType: 'application/json' });
    
    form.append('attachment', imageBuffer, { filename, contentType });

    const response = await plt.post('/restapi/v1.0/account/~/extension/~/sms', form);
    const data = await response.json();
    logger.info('Group MMS sent', { recipients: recipients.length, messageId: data.id });
    return data;
  } catch (error) {
    logger.error('Failed to send group MMS', { error: error.message });
    return await sendGroupSMS(message + '\n\n📷 [Image could not be sent]');
  }
}

async function sendNotification(message) {
  return sendGroupSMS(message).then(() => [{ success: true }]).catch(e => [{ success: false, error: e.message }]);
}

async function sendInvoiceApproval(invoice) {
  const message = `📋 INVOICE READY FOR APPROVAL\n\nProject: ${invoice.projectName || 'Unknown'}\nCustomer: ${invoice.customerName || 'Unknown'}\nAmount: $${invoice.total?.toFixed(2) || '0.00'}\n\nReply YES to approve or NO to reject.`;
  return sendNotification(message);
}

async function sendReminder(reminder) {
  const message = `⏰ BILLING REMINDER\n\nProject: ${reminder.projectName || 'Unknown'}\nStatus: ${reminder.status || 'Pending'}\nDays since completion: ${reminder.daysSinceCompletion || 'Unknown'}\n\nPlease review in the dashboard.`;
  return sendNotification(message);
}

// Polling
let lastProcessedMessageId = null;
let messageHandler = null;
let pollingInterval = null;

async function getIncomingSMS(sinceMinutes = 5) {
  const plt = await initialize();
  if (!plt) return [];
  try {
    const response = await plt.get('/restapi/v1.0/account/~/extension/~/message-store', {
      messageType: 'SMS',
      direction: 'Inbound',
      dateFrom: new Date(Date.now() - sinceMinutes * 60 * 1000).toISOString()
    });
    const data = await response.json();
    return data.records || [];
  } catch (error) {
    logger.error('Failed to get incoming SMS', { error: error.message });
    return [];
  }
}

async function pollForMessages() {
  try {
    const messages = await getIncomingSMS(2);
    for (const msg of messages) {
      if (lastProcessedMessageId && msg.id <= lastProcessedMessageId) continue;
      
      const fromNumber = msg.from?.phoneNumber;
      const bobbyPhone = config.notifications?.bobbyPhone?.replace(/\D/g, '');
      const jessicaPhone = config.notifications?.jessicaPhone?.replace(/\D/g, '');
      const normalizedFrom = fromNumber?.replace(/\D/g, '');
      
      if (normalizedFrom !== bobbyPhone && normalizedFrom !== jessicaPhone) continue;
      
      const text = msg.subject || '';
      if (text && messageHandler) {
        logger.info('Processing incoming SMS', { from: fromNumber, text: text.substring(0, 50) });
        await messageHandler({ from: fromNumber, text, messageId: msg.id, attachments: msg.attachments || [] });
      }
      lastProcessedMessageId = msg.id;
    }
  } catch (error) {
    logger.error('SMS polling error', { error: error.message });
  }
}

function onIncomingMessage(handler) {
  messageHandler = handler;
  logger.info('Incoming SMS handler registered');
}

function startPolling(intervalMs = 10000) {
  if (pollingInterval) return;
  logger.info('📱 SMS polling started');
  pollingInterval = setInterval(pollForMessages, intervalMs);
  pollForMessages();
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    logger.info('SMS polling stopped');
  }
}

module.exports = {
  initialize,
  isAuthenticated,
  sendSMS,
  sendGroupSMS,
  sendGroupMMS,
  sendNotification,
  sendInvoiceApproval,
  sendReminder,
  getIncomingSMS,
  pollForMessages,
  onIncomingMessage,
  startPolling,
  stopPolling
};
