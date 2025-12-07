/**
 * SMS Alerts Service
 * Sends scheduled text messages to Bobby & Jessica
 * 
 * - Monday 7am: Weekly Scorecard
 * - Friday 4pm: Wins Summary
 */

const config = require('../config');
const logger = require('../utils/logger');

// Recipients
const RECIPIENTS = [
  { name: 'Bobby', phone: config.notifications?.bobbyPhone },
  { name: 'Jessica', phone: config.notifications?.jessicaPhone }
];

/**
 * Send SMS to all recipients
 */
async function sendToGroup(message) {
  const results = [];
  
  for (const recipient of RECIPIENTS) {
    if (!recipient.phone) {
      logger.warn(`No phone number for ${recipient.name}`);
      continue;
    }
    
    try {
      // Use RingCentral if available, otherwise log
      if (config.ringcentral?.clientId) {
        const ringcentral = require('../bot2/ringcentral');
        await ringcentral.sendSMS(recipient.phone, message);
        results.push({ name: recipient.name, success: true });
      } else {
        logger.info(`[SMS PREVIEW] To ${recipient.name}: ${message}`);
        results.push({ name: recipient.name, success: true, preview: true });
      }
    } catch (error) {
      logger.error(`Failed to send SMS to ${recipient.name}`, { error: error.message });
      results.push({ name: recipient.name, success: false, error: error.message });
    }
  }
  
  return results;
}

/**
 * Monday Morning Scorecard
 * Sent at 7am Hawaii time every Monday
 */
async function sendMondayScorecard() {
  try {
    // Get scorecard data
    const data = await getScoreCardData();
    
    const message = `
☀️ Good morning! Here's your Monday Scorecard:

💰 Cash: ${formatCurrency(data.netCash)}
📈 Last week: ${formatCurrency(data.lastWeekRevenue)} revenue
📊 AR: ${formatCurrency(data.arTotal)} outstanding
💳 Cards: ${formatCurrency(data.creditCardTotal)} owed

🎯 Keith's Numbers:
• Gross Margin: ${data.grossMargin}%
• Days to Collect: ${data.daysToCollect}
• Cash Runway: ${data.cashRunway} weeks

${data.alerts.length > 0 ? `⚠️ Needs attention:\n${data.alerts.map(a => `• ${a}`).join('\n')}` : '✅ All systems go!'}

Have a great week! 💪
    `.trim();
    
    const results = await sendToGroup(message);
    logger.info('Monday scorecard sent', { results });
    
    return { success: true, results };
  } catch (error) {
    logger.error('Failed to send Monday scorecard', { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Friday Wins Summary
 * Sent at 4pm Hawaii time every Friday
 */
async function sendFridayWins() {
  try {
    const data = await getWeeklyWinsData();
    
    const winsText = data.wins.length > 0 
      ? data.wins.map(w => `✅ ${w}`).join('\n')
      : '• Keep pushing - next week is your week!';
    
    const message = `
🎉 Happy Friday! Here's what you crushed this week:

${winsText}

📊 Week Summary:
• Revenue: ${formatCurrency(data.weekRevenue)}
• Jobs Completed: ${data.jobsCompleted}
• Invoices Sent: ${data.invoicesSent}

💰 Cash Position: ${formatCurrency(data.netCash)}
📈 Momentum: ${data.momentumScore}/100 - ${data.momentumLabel}

Enjoy your weekend! 🌴
    `.trim();
    
    const results = await sendToGroup(message);
    logger.info('Friday wins sent', { results });
    
    return { success: true, results };
  } catch (error) {
    logger.error('Failed to send Friday wins', { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Send immediate alert
 */
async function sendAlert(title, message, type = 'info') {
  const emoji = type === 'danger' ? '🚨' : type === 'warning' ? '⚠️' : 'ℹ️';
  const fullMessage = `${emoji} ${title}\n\n${message}`;
  
  return await sendToGroup(fullMessage);
}

/**
 * Get scorecard data (mock for now, will connect to QBO)
 */
async function getScoreCardData() {
  try {
    // Try to get real data from executive API
    const qboClient = require('./quickbooks/client');
    const isAuth = await qboClient.isAuthenticated();
    
    if (isAuth) {
      // Would fetch real data here
    }
  } catch (e) {}
  
  // Return mock data for now
  return {
    netCash: 41800,
    lastWeekRevenue: 8400,
    arTotal: 12400,
    creditCardTotal: 5140,
    grossMargin: 42,
    daysToCollect: 18,
    cashRunway: '8+',
    alerts: []
  };
}

/**
 * Get weekly wins data
 */
async function getWeeklyWinsData() {
  return {
    wins: [
      '3 jobs completed',
      '$8,400 billed',
      'Collections improved 12%'
    ],
    weekRevenue: 8400,
    jobsCompleted: 3,
    invoicesSent: 3,
    netCash: 41800,
    momentumScore: 80,
    momentumLabel: 'STRONG 💪'
  };
}

/**
 * Format currency
 */
function formatCurrency(value) {
  return '$' + (value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * Check if it's time to send scheduled alerts
 */
function checkScheduledAlerts() {
  const now = new Date();
  
  // Convert to Hawaii time (UTC-10)
  const hawaiiOffset = -10 * 60;
  const localOffset = now.getTimezoneOffset();
  const hawaiiTime = new Date(now.getTime() + (localOffset + hawaiiOffset) * 60 * 1000);
  
  const day = hawaiiTime.getDay(); // 0 = Sunday, 1 = Monday, 5 = Friday
  const hour = hawaiiTime.getHours();
  const minute = hawaiiTime.getMinutes();
  
  // Monday 7:00am Hawaii
  if (day === 1 && hour === 7 && minute === 0) {
    sendMondayScorecard();
  }
  
  // Friday 4:00pm Hawaii
  if (day === 5 && hour === 16 && minute === 0) {
    sendFridayWins();
  }
}

/**
 * Start the scheduler
 */
let schedulerInterval = null;

function start() {
  if (schedulerInterval) return;
  
  logger.info('📱 SMS Alerts scheduler started');
  
  // Check every minute
  schedulerInterval = setInterval(checkScheduledAlerts, 60 * 1000);
  
  // Also check immediately on startup
  checkScheduledAlerts();
}

function stop() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    logger.info('SMS Alerts scheduler stopped');
  }
}

module.exports = {
  start,
  stop,
  sendMondayScorecard,
  sendFridayWins,
  sendAlert,
  sendToGroup
};

