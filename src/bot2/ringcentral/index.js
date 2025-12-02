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
      from: { phoneNumber: config.ringcentral.fromNumber },
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

module.exports = {
  initialize,
  isAuthenticated,
  sendSMS,
  sendNotification,
  sendInvoiceApproval,
  sendReminder
};
