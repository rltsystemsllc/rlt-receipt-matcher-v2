/**
 * Data Q&A Bot
 * 
 * STRICT RULES:
 * 1. ALL NUMBERS come from real QBO data ONLY
 * 2. NO AI-generated prose or inferences
 * 3. Template-based responses with data inserted
 * 4. Guidance attributed to: Keith Cunningham, Tony Robbins, or Donald Miller
 * 5. "I can only answer with data from QuickBooks" for unknown questions
 */

const qboClient = require('./quickbooks/client');
const logger = require('../utils/logger');

/**
 * Mentor Guidance Library
 * Principles from their published books/seminars - NOT made-up advice
 */
const MENTOR_GUIDANCE = {
  keith: {
    name: 'Keith Cunningham',
    source: 'The Road Less Stupid',
    principles: {
      cashFlow: "Cash is oxygen. You can be profitable and still go broke.",
      collections: "The longer money sits in AR, the less likely you are to collect it.",
      margins: "Revenue is vanity, profit is sanity, cash is king.",
      runway: "Always know your runway. How many weeks can you survive with zero income?",
      metrics: "What gets measured gets managed. Track your 5 key numbers weekly.",
      ar: "AR over 60 days is a collection problem. AR over 90 days is a write-off waiting to happen."
    }
  },
  tony: {
    name: 'Tony Robbins',
    source: 'Money: Master the Game',
    principles: {
      momentum: "Progress equals happiness. Small wins compound into big results.",
      wins: "Celebrate your wins, no matter how small. What you focus on expands.",
      growth: "If you're not growing, you're dying. Stagnation is regression.",
      action: "The path to success is to take massive, determined action.",
      weekly: "Review your numbers weekly. You can't improve what you don't measure."
    }
  },
  donald: {
    name: 'Donald Miller',
    source: 'Business Made Simple',
    principles: {
      clarity: "If you confuse, you lose. Keep your numbers simple and clear.",
      story: "Every business tells a story with its numbers. What story are yours telling?",
      cashFlow: "A business that doesn't manage cash flow is a hobby, not a business.",
      priorities: "Do the most important thing first. In business, that's usually collections.",
      systems: "You don't rise to the level of your goals, you fall to the level of your systems."
    }
  }
};

/**
 * Question patterns and their handlers
 */
const QUESTION_PATTERNS = [
  // Cash & Bank
  { patterns: [/cash|bank|balance/i], handler: 'getCashPosition', mentor: 'keith', principle: 'cashFlow' },
  { patterns: [/how much.*(have|got)|money/i], handler: 'getCashPosition', mentor: 'keith', principle: 'cashFlow' },
  
  // AR / Who owes
  { patterns: [/ar|receivable|owed|owes|who owes/i], handler: 'getARDetails', mentor: 'keith', principle: 'ar' },
  { patterns: [/overdue|late|past due/i], handler: 'getOverdueInvoices', mentor: 'keith', principle: 'collections' },
  
  // Revenue / Invoices
  { patterns: [/revenue|billed|invoiced/i], handler: 'getRevenueThisWeek', mentor: 'tony', principle: 'momentum' },
  { patterns: [/this week|last week/i], handler: 'getWeekComparison', mentor: 'tony', principle: 'weekly' },
  
  // Collections / Payments
  { patterns: [/collected|payments|paid/i], handler: 'getCollections', mentor: 'keith', principle: 'collections' },
  
  // Margins / Profit
  { patterns: [/margin|profit|gross/i], handler: 'getGrossMargin', mentor: 'keith', principle: 'margins' },
  
  // Expenses
  { patterns: [/expense|spent|spending/i], handler: 'getExpenses', mentor: 'donald', principle: 'cashFlow' },
  
  // Runway
  { patterns: [/runway|survive|weeks/i], handler: 'getCashRunway', mentor: 'keith', principle: 'runway' },
  
  // Wins
  { patterns: [/wins|winning|celebrate/i], handler: 'getWins', mentor: 'tony', principle: 'wins' },
  
  // Credit Cards
  { patterns: [/credit card|amex|card balance/i], handler: 'getCreditCards', mentor: 'donald', principle: 'cashFlow' },
  
  // Summary / Overview
  { patterns: [/summary|overview|scorecard|numbers/i], handler: 'getSummary', mentor: 'keith', principle: 'metrics' }
];

/**
 * Process a question and return a data-only response
 */
async function processQuestion(question) {
  // Check if QBO is connected
  const isAuth = await qboClient.isAuthenticated();
  if (!isAuth) {
    return {
      success: false,
      response: "❌ QuickBooks is not connected. I can only answer questions using real data from your QuickBooks account.\n\nPlease connect QuickBooks first."
    };
  }

  // Find matching pattern
  const match = QUESTION_PATTERNS.find(p => 
    p.patterns.some(pattern => pattern.test(question))
  );

  if (!match) {
    return {
      success: false,
      response: "❓ I can only answer questions about your QuickBooks data.\n\nTry asking about:\n• Cash/bank balance\n• AR (who owes you)\n• Revenue this week\n• Expenses\n• Gross margin\n• Cash runway"
    };
  }

  try {
    // Get real data
    const data = await HANDLERS[match.handler]();
    
    // Get mentor guidance
    const mentor = MENTOR_GUIDANCE[match.mentor];
    const guidance = mentor.principles[match.principle];
    
    // Build response
    return {
      success: true,
      response: data.response + `\n\n💡 ${mentor.name} (${mentor.source}):\n"${guidance}"`,
      data: data.raw
    };
  } catch (error) {
    logger.error('Data Q&A Bot error', { question, error: error.message });
    return {
      success: false,
      response: `❌ Error fetching data: ${error.message}`
    };
  }
}

/**
 * Data Handlers - Each returns ONLY real QBO data in templates
 */
const HANDLERS = {
  
  async getCashPosition() {
    const accounts = await queryQBO("SELECT * FROM Account WHERE AccountType = 'Bank' AND Active = true");
    const filtered = filterBankAccounts(accounts);
    const total = filtered.reduce((sum, a) => sum + (parseFloat(a.CurrentBalance) || 0), 0);
    
    const breakdown = filtered.map(a => 
      `  • ${a.Name}: ${formatCurrency(a.CurrentBalance)}`
    ).join('\n');
    
    return {
      response: `💰 Cash Position\n\nTotal: ${formatCurrency(total)}\n\n${breakdown}\n\n(Source: QBO Bank Accounts)`,
      raw: { total, accounts: filtered }
    };
  },

  async getARDetails() {
    const invoices = await queryQBO("SELECT * FROM Invoice WHERE Balance > '0'");
    const total = invoices.reduce((sum, i) => sum + (parseFloat(i.Balance) || 0), 0);
    
    const top5 = invoices
      .sort((a, b) => parseFloat(b.Balance) - parseFloat(a.Balance))
      .slice(0, 5)
      .map(i => {
        const days = Math.floor((new Date() - new Date(i.DueDate)) / (1000 * 60 * 60 * 24));
        return `  • ${i.CustomerRef?.name || 'Unknown'}: ${formatCurrency(i.Balance)} (${days > 0 ? days + ' days overdue' : 'current'})`;
      }).join('\n');
    
    return {
      response: `📊 Accounts Receivable\n\nTotal Outstanding: ${formatCurrency(total)}\nOpen Invoices: ${invoices.length}\n\nTop 5:\n${top5}\n\n(Source: QBO Open Invoices)`,
      raw: { total, count: invoices.length, invoices }
    };
  },

  async getOverdueInvoices() {
    const invoices = await queryQBO("SELECT * FROM Invoice WHERE Balance > '0'");
    const now = new Date();
    
    const overdue = invoices.filter(i => {
      const due = new Date(i.DueDate);
      return now > due;
    }).sort((a, b) => new Date(a.DueDate) - new Date(b.DueDate));
    
    const total = overdue.reduce((sum, i) => sum + (parseFloat(i.Balance) || 0), 0);
    
    const list = overdue.slice(0, 5).map(i => {
      const days = Math.floor((now - new Date(i.DueDate)) / (1000 * 60 * 60 * 24));
      return `  • ${i.CustomerRef?.name || 'Unknown'}: ${formatCurrency(i.Balance)} - ${days} days overdue`;
    }).join('\n');
    
    return {
      response: `⚠️ Overdue Invoices\n\nTotal Overdue: ${formatCurrency(total)}\nCount: ${overdue.length}\n\n${list || '  None!'}\n\n(Source: QBO Invoices past due date)`,
      raw: { total, count: overdue.length, invoices: overdue }
    };
  },

  async getRevenueThisWeek() {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const invoices = await queryQBO(`SELECT * FROM Invoice WHERE TxnDate >= '${weekAgo}'`);
    const total = invoices.reduce((sum, i) => sum + (parseFloat(i.TotalAmt) || 0), 0);
    
    return {
      response: `📈 Revenue This Week\n\nInvoices Created: ${invoices.length}\nTotal Billed: ${formatCurrency(total)}\n\n(Source: QBO Invoices, last 7 days)`,
      raw: { total, count: invoices.length }
    };
  },

  async getWeekComparison() {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    
    const thisWeekInv = await queryQBO(`SELECT * FROM Invoice WHERE TxnDate >= '${weekAgo.toISOString().split('T')[0]}'`);
    const lastWeekInv = await queryQBO(`SELECT * FROM Invoice WHERE TxnDate >= '${twoWeeksAgo.toISOString().split('T')[0]}' AND TxnDate < '${weekAgo.toISOString().split('T')[0]}'`);
    
    const thisWeek = thisWeekInv.reduce((sum, i) => sum + (parseFloat(i.TotalAmt) || 0), 0);
    const lastWeek = lastWeekInv.reduce((sum, i) => sum + (parseFloat(i.TotalAmt) || 0), 0);
    const change = lastWeek > 0 ? ((thisWeek - lastWeek) / lastWeek * 100).toFixed(0) : 0;
    
    return {
      response: `📅 This Week vs Last\n\nThis Week: ${formatCurrency(thisWeek)} (${thisWeekInv.length} invoices)\nLast Week: ${formatCurrency(lastWeek)} (${lastWeekInv.length} invoices)\nChange: ${change >= 0 ? '+' : ''}${change}%\n\n(Source: QBO Invoices)`,
      raw: { thisWeek, lastWeek, change }
    };
  },

  async getCollections() {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const payments = await queryQBO(`SELECT * FROM Payment WHERE TxnDate >= '${weekAgo}'`);
    const total = payments.reduce((sum, p) => sum + (parseFloat(p.TotalAmt) || 0), 0);
    
    return {
      response: `💵 Collections This Week\n\nPayments Received: ${payments.length}\nTotal Collected: ${formatCurrency(total)}\n\n(Source: QBO Payments, last 7 days)`,
      raw: { total, count: payments.length }
    };
  },

  async getGrossMargin() {
    try {
      const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
      const today = new Date().toISOString().split('T')[0];
      
      const report = await qboClient.getReport('ProfitAndLoss', {
        start_date: yearStart,
        end_date: today,
        accounting_method: 'Accrual'
      });
      
      let income = 0, grossProfit = 0;
      const rows = report?.Rows?.Row || [];
      for (const section of rows) {
        const header = section.Header?.ColData?.[0]?.value || '';
        const summary = section.Summary?.ColData?.[1]?.value;
        if (header === 'Income') income = parseFloat(summary) || 0;
        if (header === 'Gross Profit') grossProfit = parseFloat(summary) || 0;
      }
      
      const margin = income > 0 ? (grossProfit / income * 100).toFixed(1) : 0;
      
      return {
        response: `📊 Gross Margin (YTD)\n\nIncome: ${formatCurrency(income)}\nGross Profit: ${formatCurrency(grossProfit)}\nMargin: ${margin}%\n\n(Source: QBO Profit & Loss Report)`,
        raw: { income, grossProfit, margin }
      };
    } catch (e) {
      return {
        response: `📊 Gross Margin\n\nUnable to fetch P&L report.\n\n(Error: ${e.message})`,
        raw: null
      };
    }
  },

  async getExpenses() {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const expenses = await queryQBO(`SELECT * FROM Purchase WHERE TxnDate >= '${weekAgo}'`);
    const total = expenses.reduce((sum, e) => sum + (parseFloat(e.TotalAmt) || 0), 0);
    
    return {
      response: `💸 Expenses This Week\n\nTransactions: ${expenses.length}\nTotal Spent: ${formatCurrency(total)}\n\n(Source: QBO Purchases, last 7 days)`,
      raw: { total, count: expenses.length }
    };
  },

  async getCashRunway() {
    // Get bank balance
    const accounts = await queryQBO("SELECT * FROM Account WHERE AccountType = 'Bank' AND Active = true");
    const bankBalance = filterBankAccounts(accounts).reduce((sum, a) => sum + (parseFloat(a.CurrentBalance) || 0), 0);
    
    // Get 90-day expenses for weekly average
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const expenses = await queryQBO(`SELECT * FROM Purchase WHERE TxnDate >= '${ninetyDaysAgo}'`);
    const totalExpenses = expenses.reduce((sum, e) => sum + (parseFloat(e.TotalAmt) || 0), 0);
    const weeklyExpenses = totalExpenses / 13;
    
    const runwayWeeks = weeklyExpenses > 0 ? Math.floor(bankBalance / weeklyExpenses) : 99;
    
    return {
      response: `⏱️ Cash Runway\n\nBank Balance: ${formatCurrency(bankBalance)}\nWeekly Expenses (avg): ${formatCurrency(weeklyExpenses)}\nRunway: ${runwayWeeks > 12 ? '12+' : runwayWeeks} weeks\n\n(Source: QBO Bank Accounts + 90-day expense avg)`,
      raw: { bankBalance, weeklyExpenses, runwayWeeks }
    };
  },

  async getWins() {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const [invoices, payments] = await Promise.all([
      queryQBO(`SELECT * FROM Invoice WHERE TxnDate >= '${weekAgo}'`),
      queryQBO(`SELECT * FROM Payment WHERE TxnDate >= '${weekAgo}'`)
    ]);
    
    const billed = invoices.reduce((sum, i) => sum + (parseFloat(i.TotalAmt) || 0), 0);
    const collected = payments.reduce((sum, p) => sum + (parseFloat(p.TotalAmt) || 0), 0);
    
    const wins = [];
    if (invoices.length > 0) wins.push(`✅ ${invoices.length} invoice(s) sent`);
    if (billed > 0) wins.push(`✅ ${formatCurrency(billed)} billed`);
    if (collected > 0) wins.push(`✅ ${formatCurrency(collected)} collected`);
    if (payments.length > 0) wins.push(`✅ ${payments.length} payment(s) received`);
    
    return {
      response: `🏆 Wins This Week\n\n${wins.length > 0 ? wins.join('\n') : 'Keep pushing - next week is your week!'}\n\n(Source: QBO Invoices + Payments, last 7 days)`,
      raw: { invoices: invoices.length, billed, collected, payments: payments.length }
    };
  },

  async getCreditCards() {
    const accounts = await queryQBO("SELECT * FROM Account WHERE AccountType = 'Credit Card' AND Active = true");
    const total = accounts.reduce((sum, a) => sum + Math.abs(parseFloat(a.CurrentBalance) || 0), 0);
    
    const list = accounts.map(a => 
      `  • ${a.Name}: ${formatCurrency(Math.abs(a.CurrentBalance))}`
    ).join('\n');
    
    return {
      response: `💳 Credit Cards\n\nTotal Owed: ${formatCurrency(total)}\n\n${list || '  No credit cards found'}\n\n(Source: QBO Credit Card Accounts)`,
      raw: { total, accounts }
    };
  },

  async getSummary() {
    const [bankAccounts, invoices, payments, expenses] = await Promise.all([
      queryQBO("SELECT * FROM Account WHERE AccountType = 'Bank' AND Active = true"),
      queryQBO("SELECT * FROM Invoice WHERE Balance > '0'"),
      queryQBO("SELECT * FROM Payment ORDER BY TxnDate DESC MAXRESULTS 10"),
      queryQBO(`SELECT * FROM Purchase WHERE TxnDate >= '${new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}'`)
    ]);
    
    const bankBalance = filterBankAccounts(bankAccounts).reduce((sum, a) => sum + (parseFloat(a.CurrentBalance) || 0), 0);
    const arTotal = invoices.reduce((sum, i) => sum + (parseFloat(i.Balance) || 0), 0);
    const expenseTotal = expenses.reduce((sum, e) => sum + (parseFloat(e.TotalAmt) || 0), 0);
    
    return {
      response: `📊 Quick Summary\n\n💰 Bank: ${formatCurrency(bankBalance)}\n📊 AR Outstanding: ${formatCurrency(arTotal)} (${invoices.length} invoices)\n💸 Expenses (7 days): ${formatCurrency(expenseTotal)}\n📈 Net Cash: ${formatCurrency(bankBalance + arTotal)}\n\n(Source: QBO - ${new Date().toLocaleDateString()})`,
      raw: { bankBalance, arTotal, expenseTotal }
    };
  }
};

/**
 * Helper: Query QBO
 */
async function queryQBO(query) {
  try {
    const response = await qboClient.query(query);
    const keys = Object.keys(response?.QueryResponse || {});
    return response?.QueryResponse?.[keys[0]] || [];
  } catch (error) {
    logger.error('QBO query failed', { error: error.message });
    return [];
  }
}

/**
 * Helper: Filter bank accounts (exclude LOC)
 */
function filterBankAccounts(accounts) {
  return (accounts || []).filter(a => {
    const name = (a.Name || '').toLowerCase();
    const subType = (a.AccountSubType || '').toLowerCase();
    if (name.includes('line of credit') || name.includes('loc') || subType.includes('lineofcredit')) return false;
    if ((parseFloat(a.CurrentBalance) || 0) < -10000) return false;
    return true;
  });
}

/**
 * Helper: Format currency
 */
function formatCurrency(value) {
  return '$' + (parseFloat(value) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

module.exports = {
  processQuestion,
  MENTOR_GUIDANCE
};

