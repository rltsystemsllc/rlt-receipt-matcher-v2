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
      return res.json({
        authenticated: false,
        message: 'QuickBooks not connected',
        data: getMockData()
      });
    }

    // For now, return mock data while we build out QBO integration
    const data = getMockData();
    
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

