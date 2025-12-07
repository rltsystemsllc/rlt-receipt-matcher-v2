/**
 * Executive Scorecard Dashboard
 * CEO/CFO view with Keith Cunningham's metrics and Tony Robbins' momentum tracking
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const qboClient = require('../services/quickbooks/client');
const logger = require('../utils/logger');

/**
 * Serve the Executive Dashboard HTML
 */
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'executive-dashboard.html'));
});

/**
 * Get Executive Scorecard Data
 */
router.get('/api/scorecard', async (req, res) => {
  try {
    const isAuth = await qboClient.isAuthenticated();
    
    if (!isAuth) {
      logger.warn('QBO not authenticated, using mock data');
      return res.json({
        authenticated: false,
        message: 'QuickBooks not connected',
        data: getMockData()
      });
    }

    // Fetch real data from QBO
    const data = await getQBOData();
    
    res.json({
      authenticated: true,
      data,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get scorecard data', { error: error.message });
    res.json({
      authenticated: false,
      error: error.message,
      data: getMockData()
    });
  }
});

/**
 * Fetch real data from QuickBooks Online
 */
async function getQBOData() {
  const companyId = qboClient.getCompanyId();
  
  // Get date ranges
  const now = new Date();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60 * 1000);
  const twoWeeksAgoStr = twoWeeksAgo.toISOString().split('T')[0];
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
  const ninetyDaysAgoStr = ninetyDaysAgo.toISOString().split('T')[0];
  
  // Fetch all data in parallel for speed
  const [
    allBankAccounts,
    creditCardAccounts,
    openInvoices,
    openBills,
    recentPayments,
    allInvoices,
    recentExpenses,
    last90DaysInvoices,
    last90DaysExpenses
  ] = await Promise.all([
    queryQBO(companyId, "SELECT * FROM Account WHERE AccountType = 'Bank' AND Active = true"),
    queryQBO(companyId, "SELECT * FROM Account WHERE AccountType = 'Credit Card' AND Active = true"),
    queryQBO(companyId, "SELECT * FROM Invoice WHERE Balance > '0'"),
    queryQBO(companyId, "SELECT * FROM Bill WHERE Balance > '0'"),
    queryQBO(companyId, "SELECT * FROM Payment ORDER BY TxnDate DESC MAXRESULTS 100"),
    queryQBO(companyId, `SELECT * FROM Invoice WHERE TxnDate >= '${twoWeeksAgoStr}'`),
    queryQBO(companyId, `SELECT * FROM Purchase WHERE TxnDate >= '${twoWeeksAgoStr}'`),
    queryQBO(companyId, `SELECT * FROM Invoice WHERE TxnDate >= '${ninetyDaysAgoStr}'`),
    queryQBO(companyId, `SELECT * FROM Purchase WHERE TxnDate >= '${ninetyDaysAgoStr}'`)
  ]);
  
  // Filter bank accounts - only include Checking and Savings (exclude lines of credit)
  const bankAccounts = (allBankAccounts || []).filter(a => {
    const name = (a.Name || '').toLowerCase();
    const subType = (a.AccountSubType || '').toLowerCase();
    
    // Explicitly exclude lines of credit
    if (name.includes('line of credit') || name.includes('loc') || 
        subType.includes('lineofcredit') || subType.includes('line')) {
      logger.info('Excluding account from bank balance', { name: a.Name, subType: a.AccountSubType, balance: a.CurrentBalance });
      return false;
    }
    
    // Include checking, savings, money market
    const isRealCash = subType.includes('checking') || 
                       subType.includes('savings') || 
                       subType.includes('money');
    
    // If balance is very negative (< -$10k), likely a credit line - exclude
    const balance = parseFloat(a.CurrentBalance) || 0;
    if (balance < -10000) {
      logger.info('Excluding large negative balance account', { name: a.Name, balance });
      return false;
    }
    
    return isRealCash || balance >= 0;
  });
  
  // Calculate cash position
  const bankBalance = bankAccounts.reduce((sum, a) => sum + (parseFloat(a.CurrentBalance) || 0), 0);
  const arTotal = (openInvoices || []).reduce((sum, i) => sum + (parseFloat(i.Balance) || 0), 0);
  const apTotal = (openBills || []).reduce((sum, b) => sum + (parseFloat(b.Balance) || 0), 0);
  
  // Calculate credit card balances
  const creditCards = (creditCardAccounts || []).map(cc => ({
    name: cc.Name || 'Credit Card',
    balance: Math.abs(parseFloat(cc.CurrentBalance) || 0),
    limit: 15000 // Would need to be stored separately
  }));
  
  // Calculate AR aging
  const arAging = calculateARaging(openInvoices || []);
  
  // Calculate Keith's metrics with real data
  const keithMetrics = calculateKeithMetrics({
    arAging,
    recentPayments: recentPayments || [],
    openInvoices: openInvoices || [],
    last90DaysInvoices: last90DaysInvoices || [],
    last90DaysExpenses: last90DaysExpenses || [],
    bankBalance
  });
  
  // Calculate Tony's momentum with invoices and expenses
  const tonyMetrics = calculateTonyMetrics(allInvoices || [], recentPayments || [], recentExpenses || []);
  
  // Generate cash forecast
  const cashForecast = generateCashForecast(bankBalance, arAging, apTotal);
  
  // Generate alerts
  const alerts = generateAlerts(arAging, bankBalance);
  
  // Log what accounts we're including
  logger.info('Bank accounts summary', {
    total: (allBankAccounts || []).length,
    filtered: bankAccounts.length,
    balance: bankBalance,
    accounts: bankAccounts.map(a => ({ name: a.Name, subType: a.AccountSubType, balance: a.CurrentBalance }))
  });
  
  return {
    cashPosition: {
      bankBalance,
      arTotal,
      apTotal,
      netCash: bankBalance + arTotal - apTotal
    },
    creditCards,
    keithMetrics,
    tonyMetrics,
    arAging,
    cashForecast,
    alerts,
    recentActivity: formatRecentActivity(openInvoices || [], recentPayments || [])
  };
}

/**
 * Query QBO with error handling
 */
async function queryQBO(companyId, query) {
  try {
    const response = await qboClient.query(companyId, query);
    return response?.QueryResponse?.[Object.keys(response?.QueryResponse || {})[0]] || [];
  } catch (error) {
    logger.error('QBO query failed', { query, error: error.message });
    return [];
  }
}

/**
 * Calculate AR Aging buckets
 */
function calculateARaging(invoices) {
  const now = new Date();
  let current = 0, days1to30 = 0, days31to60 = 0, days61to90 = 0, over90 = 0;
  const overdueInvoices = [];
  
  (invoices || []).forEach(inv => {
    const dueDate = new Date(inv.DueDate);
    const daysOld = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));
    const balance = parseFloat(inv.Balance) || 0;
    
    if (daysOld <= 0) current += balance;
    else if (daysOld <= 30) days1to30 += balance;
    else if (daysOld <= 60) days31to60 += balance;
    else if (daysOld <= 90) days61to90 += balance;
    else over90 += balance;
    
    if (daysOld > 7 && balance > 0) {
      overdueInvoices.push({
        customer: inv.CustomerRef?.name || 'Customer',
        amount: balance,
        daysOld
      });
    }
  });
  
  return {
    current,
    days1to30,
    days31to60,
    days61to90,
    over90,
    total: current + days1to30 + days31to60 + days61to90 + over90,
    overdueInvoices: overdueInvoices.sort((a, b) => b.daysOld - a.daysOld).slice(0, 5)
  };
}

/**
 * Calculate Keith Cunningham's 5 Key Metrics
 */
function calculateKeithMetrics({ arAging, recentPayments, openInvoices, last90DaysInvoices, last90DaysExpenses, bankBalance }) {
  // 1. GROSS MARGIN - Calculate from last 90 days invoices vs expenses
  const totalRevenue = (last90DaysInvoices || []).reduce((sum, inv) => sum + (parseFloat(inv.TotalAmt) || 0), 0);
  const totalExpenses = (last90DaysExpenses || []).reduce((sum, exp) => sum + (parseFloat(exp.TotalAmt) || 0), 0);
  
  // Gross margin = (Revenue - Material Costs) / Revenue
  // For service business, estimate materials at ~30% of expenses (rest is labor overhead)
  const estimatedMaterialCost = totalExpenses * 0.5; // Adjust based on actual mix
  const grossMargin = totalRevenue > 0 
    ? ((totalRevenue - estimatedMaterialCost) / totalRevenue * 100) 
    : 50;
  
  // 2. DAYS TO INVOICE - Calculate average days from invoice create to payment
  // Using payment data to see how quickly invoices are created after work
  const daysToInvoice = 1.5; // Would need job completion dates - placeholder for now
  
  // 3. DAYS TO COLLECT - Calculate from paid invoices in last 90 days
  let totalCollectionDays = 0, paidInvoiceCount = 0;
  (last90DaysInvoices || []).forEach(inv => {
    const balance = parseFloat(inv.Balance) || 0;
    if (balance === 0) { // Invoice is paid
      const created = new Date(inv.MetaData?.CreateTime || inv.TxnDate);
      const paid = new Date(inv.MetaData?.LastUpdatedTime);
      const days = Math.max(0, (paid - created) / (1000 * 60 * 60 * 24));
      if (days < 365) { // Sanity check
        totalCollectionDays += days;
        paidInvoiceCount++;
      }
    }
  });
  const avgDaysToCollect = paidInvoiceCount > 0 ? Math.round(totalCollectionDays / paidInvoiceCount) : 18;
  
  // 4. BILLABLE UTILIZATION - Would need time tracking, estimate from revenue vs capacity
  // Assuming 40 hrs/week @ $150/hr = $6000/week max capacity
  const weeksIn90Days = 13;
  const maxCapacity = 6000 * weeksIn90Days; // $78,000 max
  const billableUtil = Math.min(100, Math.round((totalRevenue / maxCapacity) * 100));
  
  // 5. CASH RUNWAY - Bank balance / weekly average expenses
  const weeklyExpenses = totalExpenses / weeksIn90Days;
  const cashRunwayWeeks = weeklyExpenses > 0 ? Math.floor(bankBalance / weeklyExpenses) : 8;
  
  logger.info('Keith metrics calculated', {
    totalRevenue,
    totalExpenses,
    grossMargin: grossMargin.toFixed(1),
    avgDaysToCollect,
    billableUtil,
    cashRunwayWeeks,
    weeklyExpenses: weeklyExpenses.toFixed(0)
  });
  
  return {
    grossMargin: { 
      value: grossMargin.toFixed(1), 
      target: 40, 
      status: grossMargin >= 40 ? 'good' : grossMargin >= 30 ? 'warning' : 'bad' 
    },
    daysToInvoice: { 
      value: daysToInvoice.toString(), 
      target: 3, 
      status: daysToInvoice <= 3 ? 'good' : daysToInvoice <= 7 ? 'warning' : 'bad' 
    },
    daysToCollect: { 
      value: avgDaysToCollect.toString(), 
      target: 14, 
      status: avgDaysToCollect <= 14 ? 'good' : avgDaysToCollect <= 21 ? 'warning' : 'bad' 
    },
    billableUtil: { 
      value: billableUtil, 
      target: 75, 
      status: billableUtil >= 75 ? 'good' : billableUtil >= 60 ? 'warning' : 'bad' 
    },
    cashRunway: { 
      value: cashRunwayWeeks > 8 ? '8+' : cashRunwayWeeks.toString(), 
      target: 6, 
      status: cashRunwayWeeks >= 6 ? 'good' : cashRunwayWeeks >= 4 ? 'warning' : 'bad' 
    }
  };
}

/**
 * Calculate Tony Robbins' Momentum Metrics
 */
function calculateTonyMetrics(invoices, payments, expenses) {
  const now = new Date();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);
  
  // This week's invoices (revenue billed)
  const thisWeekInvoices = (invoices || []).filter(i => 
    new Date(i.TxnDate || i.MetaData?.CreateTime) >= weekAgo
  );
  const thisWeekRevenue = thisWeekInvoices.reduce((sum, i) => sum + (parseFloat(i.TotalAmt) || 0), 0);
  
  // Last week's invoices
  const lastWeekInvoices = (invoices || []).filter(i => {
    const date = new Date(i.TxnDate || i.MetaData?.CreateTime);
    return date >= twoWeeksAgo && date < weekAgo;
  });
  const lastWeekRevenue = lastWeekInvoices.reduce((sum, i) => sum + (parseFloat(i.TotalAmt) || 0), 0);
  
  // This week's payments collected
  const thisWeekPayments = (payments || []).filter(p => 
    new Date(p.TxnDate) >= weekAgo
  );
  const thisWeekCollected = thisWeekPayments.reduce((sum, p) => sum + (parseFloat(p.TotalAmt) || 0), 0);
  
  // Last week's payments
  const lastWeekPayments = (payments || []).filter(p => {
    const date = new Date(p.TxnDate);
    return date >= twoWeeksAgo && date < weekAgo;
  });
  const lastWeekCollected = lastWeekPayments.reduce((sum, p) => sum + (parseFloat(p.TotalAmt) || 0), 0);
  
  // This week's expenses
  const thisWeekExpenses = (expenses || []).filter(e => 
    new Date(e.TxnDate) >= weekAgo
  );
  const thisWeekExpenseTotal = thisWeekExpenses.reduce((sum, e) => sum + (parseFloat(e.TotalAmt) || 0), 0);
  
  // Last week's expenses
  const lastWeekExpenses = (expenses || []).filter(e => {
    const date = new Date(e.TxnDate);
    return date >= twoWeeksAgo && date < weekAgo;
  });
  const lastWeekExpenseTotal = lastWeekExpenses.reduce((sum, e) => sum + (parseFloat(e.TotalAmt) || 0), 0);
  
  // Calculate changes
  const revenueChange = lastWeekRevenue > 0 
    ? ((thisWeekRevenue - lastWeekRevenue) / lastWeekRevenue * 100) 
    : (thisWeekRevenue > 0 ? 100 : 0);
  
  const collectedChange = lastWeekCollected > 0
    ? ((thisWeekCollected - lastWeekCollected) / lastWeekCollected * 100)
    : (thisWeekCollected > 0 ? 100 : 0);
    
  const expenseChange = lastWeekExpenseTotal > 0
    ? ((thisWeekExpenseTotal - lastWeekExpenseTotal) / lastWeekExpenseTotal * 100)
    : 0;
  
  // Momentum score based on revenue and collections
  let momentumScore = 50;
  if (revenueChange > 20 || collectedChange > 20) momentumScore = 90;
  else if (revenueChange > 10 || collectedChange > 10) momentumScore = 80;
  else if (revenueChange > 0 || collectedChange > 0) momentumScore = 70;
  else if (revenueChange > -10) momentumScore = 50;
  else momentumScore = 30;
  
  // Generate wins
  const wins = [];
  if (thisWeekInvoices.length > 0) wins.push(`${thisWeekInvoices.length} invoice${thisWeekInvoices.length > 1 ? 's' : ''} sent`);
  if (thisWeekRevenue > 0) wins.push(`$${thisWeekRevenue.toLocaleString()} billed`);
  if (thisWeekCollected > 0) wins.push(`$${thisWeekCollected.toLocaleString()} collected`);
  if (thisWeekPayments.length > 0) wins.push(`${thisWeekPayments.length} payment${thisWeekPayments.length > 1 ? 's' : ''} received`);
  
  return {
    thisWeek: { 
      revenue: thisWeekRevenue, 
      collected: thisWeekCollected,
      expenses: thisWeekExpenseTotal,
      invoiceCount: thisWeekInvoices.length, 
      jobsCompleted: thisWeekInvoices.length 
    },
    lastWeek: { 
      revenue: lastWeekRevenue, 
      collected: lastWeekCollected,
      expenses: lastWeekExpenseTotal,
      invoiceCount: lastWeekInvoices.length 
    },
    revenueChange: Math.round(revenueChange * 10) / 10,
    collectedChange: Math.round(collectedChange * 10) / 10,
    expenseChange: Math.round(expenseChange * 10) / 10,
    momentumScore,
    momentumLabel: momentumScore >= 70 ? 'STRONG 💪' : momentumScore >= 50 ? 'STEADY' : 'NEEDS ATTENTION ⚠️',
    wins: wins.length > 0 ? wins : ['Keep pushing!']
  };
}

/**
 * Generate 13-week cash forecast
 */
function generateCashForecast(currentCash, arAging, apTotal) {
  const weeks = [];
  let runningCash = currentCash;
  const weeklyAR = arAging.total / 4; // Assume AR collected over 4 weeks
  const weeklyExpenses = 3500; // Would calculate from actuals
  
  for (let i = 0; i < 13; i++) {
    const income = i < 4 ? weeklyAR : weeklyAR * 0.7;
    runningCash = runningCash + income - weeklyExpenses;
    
    weeks.push({
      week: i + 1,
      projected: Math.round(runningCash),
      status: runningCash > 15000 ? 'good' : runningCash > 5000 ? 'warning' : 'danger'
    });
  }
  
  return weeks;
}

/**
 * Generate alerts from data
 */
function generateAlerts(arAging, bankBalance) {
  const alerts = [];
  
  // Overdue invoice alerts
  (arAging.overdueInvoices || []).slice(0, 3).forEach(inv => {
    alerts.push({
      type: inv.daysOld > 30 ? 'danger' : 'warning',
      title: `Invoice ${inv.daysOld} Days Overdue`,
      description: `${inv.customer} - $${inv.amount.toLocaleString()}`,
      action: 'Follow Up'
    });
  });
  
  // Low cash warning
  if (bankBalance < 10000) {
    alerts.push({
      type: 'danger',
      title: 'Low Cash Balance',
      description: `Bank balance is $${bankBalance.toLocaleString()}`,
      action: 'Review'
    });
  }
  
  return alerts;
}

/**
 * Format recent activity
 */
function formatRecentActivity(invoices, payments) {
  const activity = [];
  
  (invoices || []).slice(0, 3).forEach(inv => {
    activity.push({
      type: 'invoice',
      description: `Invoice to ${inv.CustomerRef?.name || 'Customer'}`,
      amount: parseFloat(inv.TotalAmt) || 0,
      date: inv.TxnDate || inv.MetaData?.CreateTime
    });
  });
  
  (payments || []).slice(0, 3).forEach(p => {
    activity.push({
      type: 'payment',
      description: `Payment from ${p.CustomerRef?.name || 'Customer'}`,
      amount: parseFloat(p.TotalAmt) || 0,
      date: p.TxnDate
    });
  });
  
  return activity.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
}

/**
 * Mock data for dashboard preview
 */
function getMockData() {
  return {
    cashPosition: {
      bankBalance: 34200,
      arTotal: 12400,
      apTotal: 4800,
      netCash: 41800
    },
    creditCards: [
      { name: 'American Express', balance: 3247.82, limit: 15000 },
      { name: 'Bank of Hawaii', balance: 1892.45, limit: 10000 }
    ],
    keithMetrics: {
      grossMargin: { value: '42.5', target: 40, status: 'good' },
      daysToInvoice: { value: '1.2', target: 3, status: 'good' },
      daysToCollect: { value: '18', target: 14, status: 'warning' },
      billableUtil: { value: 78, target: 75, status: 'good' },
      cashRunway: { value: '8+', target: 6, status: 'good' }
    },
    tonyMetrics: {
      thisWeek: { revenue: 8400, invoiceCount: 3, jobsCompleted: 3 },
      lastWeek: { revenue: 7200, invoiceCount: 2 },
      revenueChange: 16.7,
      momentumScore: 80,
      momentumLabel: 'STRONG 💪',
      wins: ['3 jobs completed', '$8,400 billed', '2 new projects started']
    },
    arAging: {
      current: 4200,
      days1to30: 5400,
      days31to60: 1800,
      days61to90: 800,
      over90: 200,
      total: 12400,
      overdueInvoices: [
        { customer: 'Johnson Residence', amount: 4500, daysOld: 18 },
        { customer: 'Smith Panel Upgrade', amount: 2100, daysOld: 12 }
      ]
    },
    apTotal: 4800,
    cashForecast: Array.from({ length: 13 }, (_, i) => ({
      week: i + 1,
      projected: 34200 + (i * 1200) - (i * 800),
      status: i < 10 ? 'good' : 'warning'
    })),
    recentActivity: [
      { type: 'invoice', description: 'Invoice to Wailea Residence', amount: 4200, date: new Date().toISOString() },
      { type: 'expense', description: 'Home Depot - Materials', amount: 248, date: new Date().toISOString() },
      { type: 'invoice', description: 'Invoice to Smith Panel', amount: 2100, date: new Date().toISOString() }
    ],
    alerts: [
      { type: 'danger', title: 'Invoice 18 Days Overdue', description: 'Johnson Residence - $4,500', action: 'Follow Up' },
      { type: 'warning', title: '2 Receipts Need Jobs', description: 'Check SMS for assignment', action: 'View' }
    ]
  };
}

module.exports = router;

