/**
 * RingCentral SMS integration
 */
const SDK = require('@ringcentral/sdk').SDK;
const fs = require('fs').promises;
const config = require('../../config');
const logger = require('../../utils/logger');

let rcSDK = null;
let platform = null;

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
        } catch {}
      }
      if (!tokens) {
        const tokenData = await fs.readFile(config.ringcentral.tokenPath, 'utf8');
        tokens = JSON.parse(tokenData);
      }
      if (tokens) {
        await platform.auth().setData(tokens);
        if (!await platform.loggedIn()) throw new Error('Token expired');
      } else {
        throw new Error('No tokens');
      }
    } catch {
      if (config.ringcentral.jwtToken) {
        await platform.login({ jwt: config.ringcentral.jwtToken });
      } else {
        platform = null;
        return null;
      }
    }
    return platform;
  } catch (error) {
    logger.error('RingCentral init failed', { error: error.message });
    platform = null;
    return null;
  }
}

async function isAuthenticated() {
  await initialize();
  if (!platform) return false;
  try { return await platform.loggedIn(); } catch { return false; }
}

async function sendSMS(to, message) {
  const plt = await initialize();
  if (!plt) throw new Error('RingCentral not initialized');
  const response = await plt.post('/restapi/v1.0/account/~/extension/~/sms', {
    from: { phoneNumber: config.ringcentral.botPhone },
    to: [{ phoneNumber: to }],
    text: message
  });
  return await response.json();
}

async function sendGroupSMS(message) {
  const plt = await initialize();
  if (!plt) throw new Error('RingCentral not initialized');
  const recipients = [];
  if (config.notifications.bobbyPhone) recipients.push({ phoneNumber: config.notifications.bobbyPhone });
  if (config.notifications.jessicaPhone) recipients.push({ phoneNumber: config.notifications.jessicaPhone });
  if (recipients.length === 0) throw new Error('No recipients');
  const response = await plt.post('/restapi/v1.0/account/~/extension/~/sms', {
    from: { phoneNumber: config.ringcentral.botPhone },
    to: recipients,
    text: message
  });
  logger.info('Group SMS sent', { recipients: recipients.length });
  return await response.json();
}

async function sendGroupMMS(message, imageData, filename = 'receipt.jpg') {
  const plt = await initialize();
  if (!plt) throw new Error('RingCentral not initialized');
  const recipients = [];
  if (config.notifications.bobbyPhone) recipients.push({ phoneNumber: config.notifications.bobbyPhone });
  if (config.notifications.jessicaPhone) recipients.push({ phoneNumber: config.notifications.jessicaPhone });
  if (recipients.length === 0) throw new Error('No recipients');
  try {
    let imageBuffer = Buffer.isBuffer(imageData) ? imageData : Buffer.from(imageData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    let contentType = filename.endsWith('.png') ? 'image/png' : filename.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
    const FormData = require('form-data');
    const form = new FormData();
    form.append('json', JSON.stringify({ from: { phoneNumber: config.ringcentral.botPhone }, to: recipients, text: message }), { contentType: 'application/json' });
    form.append('attachment', imageBuffer, { filename, contentType });
    const response = await plt.post('/restapi/v1.0/account/~/extension/~/sms', form);
    logger.info('Group MMS sent with image');
    return await response.json();
  } catch (error) {
    logger.error('MMS failed, falling back to SMS', { error: error.message });
    return await sendGroupSMS(message + '\n\n📷 [Image could not be sent]');
  }
}

async function sendNotification(message) {
  try { await sendGroupSMS(message); return [{ success: true }]; } catch (e) { return [{ success: false, error: e.message }]; }
}

async function sendInvoiceApproval(invoice) {
  return sendNotification(`📋 INVOICE READY\n\nProject: ${invoice.projectName || 'Unknown'}\nCustomer: ${invoice.customerName || 'Unknown'}\nAmount: $${invoice.total?.toFixed(2) || '0.00'}\n\nReply YES/NO`);
}

async function sendReminder(reminder) {
  return sendNotification(`⏰ REMINDER\n\nProject: ${reminder.projectName || 'Unknown'}\nStatus: ${reminder.status || 'Pending'}`);
}

let lastProcessedMessageId = null;
let messageHandler = null;
let pollingInterval = null;

async function getIncomingSMS(sinceMinutes = 5) {
  const plt = await initialize();
  if (!plt) return [];
  try {
    const response = await plt.get('/restapi/v1.0/account/~/extension/~/message-store', {
      messageType: 'SMS', direction: 'Inbound',
      dateFrom: new Date(Date.now() - sinceMinutes * 60 * 1000).toISOString()
    });
    return (await response.json()).records || [];
  } catch { return []; }
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
        await messageHandler({ from: fromNumber, text, messageId: msg.id, attachments: msg.attachments || [] });
      }
      lastProcessedMessageId = msg.id;
    }
  } catch (error) { logger.error('Polling error', { error: error.message }); }
}

function onIncomingMessage(handler) { messageHandler = handler; }
function startPolling(intervalMs = 10000) {
  if (pollingInterval) return;
  pollingInterval = setInterval(pollForMessages, intervalMs);
  pollForMessages();
}
function stopPolling() { if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; } }

module.exports = {
  initialize, isAuthenticated, sendSMS, sendGroupSMS, sendGroupMMS, sendNotification,
  sendInvoiceApproval, sendReminder, getIncomingSMS, pollForMessages, onIncomingMessage, startPolling, stopPolling
};
