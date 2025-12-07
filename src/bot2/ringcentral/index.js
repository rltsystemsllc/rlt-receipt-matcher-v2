/**
 * RingCentral SMS integration for Bot 2
 */
const SDK = require('@ringcentral/sdk').SDK;
const fs = require('fs').promises;
const path = require('path');
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
      
      if (tokens) {
        await platform.auth().setData(tokens);
        
        // Check if token is valid
        if (!await platform.loggedIn()) {
          throw new Error('Token expired');
        }
        
        logger.info('RingCentral client initialized with saved token');
      } else {
        throw new Error('No tokens found');
      }
    } catch (tokenError) {
      // Need fresh authentication - use JWT
      if (config.ringcentral.jwtToken) {
        logger.info('Authenticating RingCentral with JWT...');
        await platform.login({ jwt: config.ringcentral.jwtToken });
        await saveTokens();
        logger.info('RingCentral authenticated with JWT');
      } else {
        logger.warn('RingCentral needs authentication - no JWT token configured');
        platform = null;  // Reset so next call tries again
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
    platform = null;  // Reset so next call tries again
    return null;
  }
}

/**
 * Save tokens to file (made robust for Railway)
 */
async function saveTokens() {
  if (!platform) return;
  
  try {
    const tokens = await platform.auth().data();
    // Only attempt to write if not on Railway (where filesystem is ephemeral)
    if (!process.env.RAILWAY_ENVIRONMENT_NAME) {
      await fs.writeFile(config.ringcentral.tokenPath, JSON.stringify(tokens, null, 2));
      logger.info('RingCentral tokens saved to file');
    }
  } catch (error) {
    logger.warn('Failed to save RingCentral tokens (expected on ephemeral filesystems)', { error: error.message });
  }
}

/**
 * Check if authenticated
 */
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
 * Send SMS message
 */
async function sendSMS(to, message) {
  const plt = await initialize();
  if (!plt) {
    throw new Error('RingCentral not initialized');
  }

  try {
    const response = await plt.post('/restapi/v1.0/account/~/extension/~/sms', {
      from: { phoneNumber: config.ringcentral.botPhone },
      to: [{ phoneNumber: to }],
      text: message
    });

    const data = await response.json();
    logger.info('SMS sent successfully', { to, messageId: data.id });
    return data;
  } catch (error) {
    logger.error('Failed to send SMS', { to, error: error.message });
    throw error;
  }
}

/**
 * Send MMS message with image attachment
 * @param {string} to - Phone number to send to
 * @param {string} message - Text message
 * @param {Buffer|string} imageData - Image as Buffer or base64 string
 * @param {string} filename - Filename for the attachment (default: receipt.jpg)
 */
async function sendMMS(to, message, imageData, filename = 'receipt.jpg') {
  const plt = await initialize();
  if (!plt) {
    throw new Error('RingCentral not initialized');
  }

  try {
    // Convert base64 to buffer if needed
    let imageBuffer;
    if (Buffer.isBuffer(imageData)) {
      imageBuffer = imageData;
    } else if (typeof imageData === 'string') {
      // Remove data URL prefix if present
      const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
      imageBuffer = Buffer.from(base64Data, 'base64');
    } else {
      throw new Error('Invalid image data format');
    }

    // Determine content type from filename
    let contentType = 'image/jpeg';
    if (filename.endsWith('.png')) {
      contentType = 'image/png';
    } else if (filename.endsWith('.pdf')) {
      contentType = 'application/pdf';
    }

    // Create multipart form data for MMS
    const FormData = require('form-data');
    const form = new FormData();
    
    // Add JSON part with message details
    form.append('json', JSON.stringify({
      from: { phoneNumber: config.ringcentral.botPhone },
      to: [{ phoneNumber: to }],
      text: message
    }), {
      contentType: 'application/json'
    });
    
    // Add image attachment
    form.append('attachment', imageBuffer, {
      filename: filename,
      contentType: contentType
    });

    const response = await plt.post('/restapi/v1.0/account/~/extension/~/sms', form);
    const data = await response.json();
    
    logger.info('MMS sent successfully', { to, messageId: data.id, hasAttachment: true });
    return data;

  } catch (error) {
    logger.error('Failed to send MMS', { to, error: error.message });
    // Fall back to SMS without image
    logger.info('Falling back to SMS without image');
    return await sendSMS(to, message + '\n\n📷 [Image could not be sent - check email for receipt]');
  }
}

/**
 * Send notification to configured recipients
 */
async function sendNotification(message) {
  const results = [];
  
  // Send to Jessica
  if (config.notifications.jessicaPhone) {
    try {
      await sendSMS(config.notifications.jessicaPhone, message);
      results.push({ phone: config.notifications.jessicaPhone, success: true });
    } catch (error) {
      results.push({ phone: config.notifications.jessicaPhone, success: false, error: error.message });
    }
  }
  
  // Send to Bobby
  if (config.notifications.bobbyPhone) {
    try {
      await sendSMS(config.notifications.bobbyPhone, message);
      results.push({ phone: config.notifications.bobbyPhone, success: true });
    } catch (error) {
      results.push({ phone: config.notifications.bobbyPhone, success: false, error: error.message });
    }
  }
  
  return results;
}

/**
 * Send invoice approval request
 */
async function sendInvoiceApproval(invoice) {
  const message = `📋 INVOICE READY FOR APPROVAL

Project: ${invoice.projectName || 'Unknown'}
Customer: ${invoice.customerName || 'Unknown'}
Amount: $${invoice.total?.toFixed(2) || '0.00'}

Reply YES to approve or NO to reject.`;

  return sendNotification(message);
}

/**
 * Send reminder notification
 */
async function sendReminder(reminder) {
  const message = `⏰ BILLING REMINDER

Project: ${reminder.projectName || 'Unknown'}
Status: ${reminder.status || 'Pending'}
Days since completion: ${reminder.daysSinceCompletion || 'Unknown'}

Please review in the dashboard.`;

  return sendNotification(message);
}

/**
 * Setup webhook subscription for incoming SMS
 */
async function setupWebhook(webhookUrl) {
  const plt = await initialize();
  if (!plt) {
    throw new Error('RingCentral not initialized');
  }

  try {
    // First, check for existing subscriptions and remove them
    const existingResponse = await plt.get('/restapi/v1.0/subscription');
    const existing = await existingResponse.json();
    
    if (existing.records) {
      for (const sub of existing.records) {
        // Remove old webhook subscriptions
        if (sub.deliveryMode?.transportType === 'WebHook') {
          try {
            await plt.delete(`/restapi/v1.0/subscription/${sub.id}`);
            logger.info('Removed old webhook subscription', { id: sub.id });
          } catch (e) {
            logger.warn('Failed to remove old subscription', { id: sub.id, error: e.message });
          }
        }
      }
    }

    // Create new webhook subscription
    const response = await plt.post('/restapi/v1.0/subscription', {
      eventFilters: [
        '/restapi/v1.0/account/~/extension/~/message-store/instant?type=SMS'
      ],
      deliveryMode: {
        transportType: 'WebHook',
        address: webhookUrl
      },
      expiresIn: 604800 // 7 days
    });

    const data = await response.json();
    logger.info('Webhook subscription created', { 
      id: data.id, 
      webhookUrl,
      expiresAt: data.expirationTime 
    });
    
    return data;
  } catch (error) {
    logger.error('Failed to setup webhook', { error: error.message });
    throw error;
  }
}

/**
 * Process incoming webhook payload
 */
async function processIncomingWebhook(payload) {
  try {
    // Handle verification request
    if (payload.validation_token) {
      return { validation_token: payload.validation_token };
    }

    // Extract SMS message from webhook
    if (payload.body?.extensionId && payload.body?.attachments) {
      const attachment = payload.body.attachments[0];
      if (attachment?.type === 'Text') {
        return {
          from: payload.body.from?.phoneNumber,
          to: payload.body.to?.[0]?.phoneNumber,
          text: attachment.content || '',
          timestamp: payload.timestamp,
          messageId: payload.body.id
        };
      }
    }

    // Alternative format
    if (payload.from && payload.text) {
      return payload;
    }

    logger.warn('Unknown webhook payload format', { 
      hasBody: !!payload.body,
      keys: Object.keys(payload) 
    });
    return null;
  } catch (error) {
    logger.error('Error processing webhook', { error: error.message });
    return null;
  }
}

/**
 * Send SMS to a specific number
 */
async function sendToNumber(to, message) {
  return sendSMS(to, message);
}

/**
 * Track last processed message ID to avoid duplicates
 */
let lastProcessedMessageId = null;
let messageHandler = null;

/**
 * Get recent incoming SMS messages
 */
async function getIncomingSMS(sinceMinutes = 5) {
  const plt = await initialize();
  if (!plt) {
    return [];
  }

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

/**
 * Poll for new incoming SMS and process them
 */
async function pollForMessages() {
  try {
    const messages = await getIncomingSMS(2); // Check last 2 minutes
    
    for (const msg of messages) {
      // Skip if already processed
      if (lastProcessedMessageId && msg.id <= lastProcessedMessageId) {
        continue;
      }
      
      // Skip if not from Bobby or Jessica
      const fromNumber = msg.from?.phoneNumber;
      const bobbyPhone = config.notifications?.bobbyPhone?.replace(/\D/g, '');
      const jessicaPhone = config.notifications?.jessicaPhone?.replace(/\D/g, '');
      const normalizedFrom = fromNumber?.replace(/\D/g, '');
      
      if (normalizedFrom !== bobbyPhone && normalizedFrom !== jessicaPhone) {
        continue;
      }
      
      // Extract message text
      const text = msg.subject || '';
      
      if (text && messageHandler) {
        logger.info('Processing incoming SMS via polling', { 
          from: fromNumber, 
          text: text.substring(0, 50) 
        });
        
        // Call the message handler
        await messageHandler({
          from: fromNumber,
          text: text,
          messageId: msg.id,
          attachments: msg.attachments || []
        });
      }
      
      lastProcessedMessageId = msg.id;
    }
  } catch (error) {
    logger.error('SMS polling error', { error: error.message });
  }
}

/**
 * Register a handler for incoming messages
 */
function onIncomingMessage(handler) {
  messageHandler = handler;
  logger.info('Incoming SMS handler registered');
}

/**
 * Start polling for incoming messages
 */
let pollingInterval = null;

function startPolling(intervalMs = 10000) {
  if (pollingInterval) return;
  
  logger.info('📱 SMS polling started (checking every 10 seconds)');
  pollingInterval = setInterval(pollForMessages, intervalMs);
  
  // Do an immediate check
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
  sendMMS,
  sendToNumber,
  sendNotification,
  sendInvoiceApproval,
  sendReminder,
  setupWebhook,
  processIncomingWebhook,
  getIncomingSMS,
  pollForMessages,
  onIncomingMessage,
  startPolling,
  stopPolling
};
