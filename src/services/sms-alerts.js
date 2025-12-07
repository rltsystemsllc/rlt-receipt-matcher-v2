/**
 * SMS Alerts Service
 * Sends scheduled text messages to Bobby & Jessica
 * 
 * ⚠️ RULE: ALL DATA MUST COME FROM REAL QBO - NO MOCK DATA
 * 
 * - Monday 7am: Weekly Scorecard
 * - Friday 4pm: Wins Summary
 */

const config = require('../config');
const logger = require('../utils/logger');
const qboClient = require('./quickbooks/client');

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
 * 
 * ⚠️ USES ONLY REAL QBO DATA
 */
async function sendMondayScorecard() {
  try {
    // Get REAL scorecard data from QBO
    const data = await getRealScoreCardData();
    
    if (!data) {
      logger.error('Cannot send Monday scorecard - QBO not connected');
      return { success: false, error: 'QBO not connected' };
    }
    
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

${data.alerts.length > 0 ? `⚠️ Needs attention:\n${data.alerts.map(a => `• ${a}`).join('\n')}` : '✅ All clear!'}

Have a great week! 💪
(Data: QBO ${new Date().toLocaleDateString()})
    `.trim();
    
    const results = await sendToGroup(message);
    logger.info('Monday scorecard sent with REAL data', { results });
    
    return { success: true, results };
  } catch (error) {
    logger.error('Failed to send Monday scorecard', { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Friday Wins Summary
 * Sent at 4pm Hawaii time every Friday
 * 
 * ⚠️ USES ONLY REAL QBO DATA
 */
async function sendFridayWins() {
  try {
    const data = await getRealWeeklyWinsData();
    
    if (!data) {
      logger.error('Cannot send Friday wins - QBO not connected');
      return { success: false, error: 'QBO not connected' };
    }
    
    const winsText = data.wins.length > 0 
      ? data.wins.map(w => `✅ ${w}`).join('\n')
      : '• Keep pushing - next week is your week!';
    
    const message = `
🎉 Happy Friday! Here's what you crushed this week:

${winsText}

📊 Week Summary:
• Revenue: ${formatCurrency(data.weekRevenue)}
• Collected: ${formatCurrency(data.weekCollected)}
• Invoices Sent: ${data.invoicesSent}

💰 Cash Position: ${formatCurrency(data.netCash)}
📈 Momentum: ${data.momentumScore}/100 - ${data.momentumLabel}

Enjoy your weekend! 🌴
(Data: QBO ${new Date().toLocaleDateString()})
    `.trim();
    
    const results = await sendToGroup(message);
    logger.info('Friday wins sent with REAL data', { results });
    
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
 * Get REAL scorecard data from QBO
 * ⚠️ NO MOCK DATA - Returns null if QBO not connected
 */
async function getRealScoreCardData() {
  try {
    // Authenticate with QBO
    const isAuth = await qboClient.isAuthenticated();
    if (!isAuth) {
      const authenticated = await qboClient.authenticate();
      if (!authenticated) {
        logger.error('QBO not authenticated for scorecard');
        return null;
      }
    }
    
    // Fetch REAL data from QBO
    const now = new Date();
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const weekAgoStr = weekAgo.toISOString().split('T')[0];
    
    const [
      bankAccounts,
      creditCardAccounts,
      openInvoices,
      lastWeekInvoices,
      profitLoss
    ] = await Promise.all([
      queryQBO("SELECT * FROM Account WHERE AccountType = 'Bank' AND Active = true"),
      queryQBO("SELECT * FROM Account WHERE AccountType = 'Credit Card' AND Active = true"),
      queryQBO("SELECT * FROM Invoice WHERE Balance > '0'"),
      queryQBO(`SELECT * FROM Invoice WHERE TxnDate >= '${weekAgoStr}'`),
      fetchProfitLoss()
    ]);
    
    // Calculate REAL values
    const bankBalance = filterBankAccounts(bankAccounts).reduce(
      (sum, a) => sum + (parseFloat(a.CurrentBalance) || 0), 0
    );
    
    const arTotal = (openInvoices || []).reduce(
      (sum, i) => sum + (parseFloat(i.Balance) || 0), 0
    );
    
    const creditCardTotal = (creditCardAccounts || []).reduce(
      (sum, cc) => sum + Math.abs(parseFloat(cc.CurrentBalance) || 0), 0
    );
    
    const lastWeekRevenue = (lastWeekInvoices || []).reduce(
      (sum, i) => sum + (parseFloat(i.TotalAmt) || 0), 0
    );
    
    // Calculate alerts from REAL data
    const alerts = [];
    const overdueInvoices = (openInvoices || []).filter(inv => {
      const dueDate = new Date(inv.DueDate);
      const daysOld = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));
      return daysOld > 30;
    });
    
    if (overdueInvoices.length > 0) {
      alerts.push(`${overdueInvoices.length} invoice(s) over 30 days old`);
    }
    
    if (bankBalance < 10000) {
      alerts.push(`Low cash balance: ${formatCurrency(bankBalance)}`);
    }
    
    // Calculate days to collect from REAL paid invoices
    let daysToCollect = 0;
    const paidInvoices = (lastWeekInvoices || []).filter(i => parseFloat(i.Balance) === 0);
    if (paidInvoices.length > 0) {
      let totalDays = 0;
      for (const inv of paidInvoices) {
        const created = new Date(inv.TxnDate);
        const paid = new Date(inv.MetaData?.LastUpdatedTime);
        totalDays += Math.floor((paid - created) / (1000 * 60 * 60 * 24));
      }
      daysToCollect = Math.round(totalDays / paidInvoices.length);
    }
    
    // Cash runway from REAL expenses
    const expenses90Days = await queryQBO(
      `SELECT * FROM Purchase WHERE TxnDate >= '${new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}'`
    );
    const totalExpenses = (expenses90Days || []).reduce(
      (sum, e) => sum + (parseFloat(e.TotalAmt) || 0), 0
    );
    const weeklyExpenses = totalExpenses / 13;
    const cashRunway = weeklyExpenses > 0 ? Math.floor(bankBalance / weeklyExpenses) : 99;
    
    logger.info('Scorecard data fetched from REAL QBO', {
      bankBalance,
      arTotal,
      creditCardTotal,
      lastWeekRevenue
    });
    
    return {
      netCash: bankBalance + arTotal,
      bankBalance,
      lastWeekRevenue,
      arTotal,
      creditCardTotal,
      grossMargin: profitLoss?.grossMargin?.toFixed(1) || '0',
      daysToCollect: daysToCollect || 'N/A',
      cashRunway: cashRunway > 12 ? '12+' : cashRunway.toString(),
      alerts
    };
    
  } catch (error) {
    logger.error('Failed to get REAL scorecard data', { error: error.message });
    return null;
  }
}

/**
 * Get REAL weekly wins data from QBO
 * ⚠️ NO MOCK DATA - Returns null if QBO not connected
 */
async function getRealWeeklyWinsData() {
  try {
    const isAuth = await qboClient.isAuthenticated();
    if (!isAuth) {
      const authenticated = await qboClient.authenticate();
      if (!authenticated) {
        logger.error('QBO not authenticated for weekly wins');
        return null;
      }
    }
    
    const now = new Date();
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const weekAgoStr = weekAgo.toISOString().split('T')[0];
    
    const [
      bankAccounts,
      openInvoices,
      thisWeekInvoices,
      thisWeekPayments
    ] = await Promise.all([
      queryQBO("SELECT * FROM Account WHERE AccountType = 'Bank' AND Active = true"),
      queryQBO("SELECT * FROM Invoice WHERE Balance > '0'"),
      queryQBO(`SELECT * FROM Invoice WHERE TxnDate >= '${weekAgoStr}'`),
      queryQBO(`SELECT * FROM Payment WHERE TxnDate >= '${weekAgoStr}'`)
    ]);
    
    const bankBalance = filterBankAccounts(bankAccounts).reduce(
      (sum, a) => sum + (parseFloat(a.CurrentBalance) || 0), 0
    );
    
    const arTotal = (openInvoices || []).reduce(
      (sum, i) => sum + (parseFloat(i.Balance) || 0), 0
    );
    
    const weekRevenue = (thisWeekInvoices || []).reduce(
      (sum, i) => sum + (parseFloat(i.TotalAmt) || 0), 0
    );
    
    const weekCollected = (thisWeekPayments || []).reduce(
      (sum, p) => sum + (parseFloat(p.TotalAmt) || 0), 0
    );
    
    // Generate REAL wins
    const wins = [];
    
    if ((thisWeekInvoices || []).length > 0) {
      wins.push(`${thisWeekInvoices.length} invoice(s) sent`);
    }
    
    if (weekRevenue > 0) {
      wins.push(`${formatCurrency(weekRevenue)} billed`);
    }
    
    if (weekCollected > 0) {
      wins.push(`${formatCurrency(weekCollected)} collected`);
    }
    
    if ((thisWeekPayments || []).length > 0) {
      wins.push(`${thisWeekPayments.length} payment(s) received`);
    }
    
    // Calculate momentum
    let momentumScore = 50;
    if (weekCollected > 5000 || weekRevenue > 5000) momentumScore = 90;
    else if (weekCollected > 2000 || weekRevenue > 2000) momentumScore = 80;
    else if (weekRevenue > 0 || weekCollected > 0) momentumScore = 70;
    
    logger.info('Weekly wins data fetched from REAL QBO', {
      weekRevenue,
      weekCollected,
      invoicesSent: (thisWeekInvoices || []).length
    });
    
    return {
      wins,
      weekRevenue,
      weekCollected,
      invoicesSent: (thisWeekInvoices || []).length,
      jobsCompleted: (thisWeekInvoices || []).length,
      netCash: bankBalance + arTotal,
      momentumScore,
      momentumLabel: momentumScore >= 70 ? 'STRONG 💪' : momentumScore >= 50 ? 'STEADY' : 'NEEDS ATTENTION ⚠️'
    };
    
  } catch (error) {
    logger.error('Failed to get REAL weekly wins data', { error: error.message });
    return null;
  }
}

/**
 * Query QBO with error handling
 */
async function queryQBO(query) {
  try {
    const response = await qboClient.query(query);
    const keys = Object.keys(response?.QueryResponse || {});
    return response?.QueryResponse?.[keys[0]] || [];
  } catch (error) {
    logger.error('QBO query failed in SMS alerts', { error: error.message });
    return [];
  }
}

/**
 * Fetch P&L from QBO
 */
async function fetchProfitLoss() {
  try {
    const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    
    const report = await qboClient.getReport('ProfitAndLoss', {
      start_date: yearStart,
      end_date: today,
      accounting_method: 'Accrual'
    });
    
    // Parse gross margin from report
    let totalIncome = 0;
    let grossProfit = 0;
    
    const rows = report?.Rows?.Row || [];
    for (const section of rows) {
      const header = section.Header?.ColData?.[0]?.value || '';
      const summary = section.Summary?.ColData?.[1]?.value;
      
      if (header === 'Income' || section.group === 'Income') {
        totalIncome = parseFloat(summary) || 0;
      }
      if (header === 'Gross Profit') {
        grossProfit = parseFloat(summary) || 0;
      }
    }
    
    return {
      grossMargin: totalIncome > 0 ? (grossProfit / totalIncome * 100) : 0
    };
  } catch (error) {
    logger.error('Failed to fetch P&L', { error: error.message });
    return null;
  }
}

/**
 * Filter bank accounts to exclude lines of credit
 */
function filterBankAccounts(accounts) {
  return (accounts || []).filter(a => {
    const name = (a.Name || '').toLowerCase();
    const subType = (a.AccountSubType || '').toLowerCase();
    if (name.includes('line of credit') || name.includes('loc') || 
        subType.includes('lineofcredit')) return false;
    const balance = parseFloat(a.CurrentBalance) || 0;
    if (balance < -10000) return false;
    return true;
  });
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
  
  logger.info('📱 SMS Alerts scheduler started (REAL DATA ONLY)');
  
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
