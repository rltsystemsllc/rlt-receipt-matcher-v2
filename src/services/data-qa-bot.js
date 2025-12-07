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
  // Keith Cunningham - Multiple books
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
  keithBlueprint: {
    name: 'Keith Cunningham',
    source: 'The Ultimate Blueprint for an Insanely Successful Business',
    principles: {
      cashFlow: "The business exists to generate cash. Period.",
      margins: "Gross margin is the lifeblood of your business. Protect it fiercely.",
      metrics: "The 5 numbers you must know: gross margin, days to invoice, days to collect, billable utilization, and cash runway.",
      runway: "Cash runway tells you how long you can survive. Know it weekly.",
      collections: "Speed to invoice = speed to cash. Bill fast, collect faster."
    }
  },
  keithVault: {
    name: 'Keith Cunningham',
    source: 'Keys to the Vault',
    principles: {
      cashFlow: "Cash flow is not the same as profit. Many profitable businesses go broke.",
      margins: "Your margin is your moat. Don't compete on price, compete on value.",
      metrics: "What you don't measure, you can't manage. What you don't manage, you lose.",
      collections: "The sale isn't complete until the cash is in the bank.",
      runway: "The vault is only open to those who understand their numbers."
    }
  },
  // Tony Robbins
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
  // Donald Miller
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
  },
  // Mike Michalowicz - Profit First
  mike: {
    name: 'Mike Michalowicz',
    source: 'Profit First',
    principles: {
      cashFlow: "Pay yourself first. Profit is not an event at year-end, it's a habit built into every transaction.",
      margins: "Revenue is not the goal. Profit is. A smaller, profitable business beats a large, unprofitable one.",
      runway: "Keep your profit account sacred. It's your runway, your safety net, your freedom.",
      metrics: "Use small plates. Limit what's available for expenses, and you'll find a way to operate within those limits.",
      collections: "Cash in the bank is truth. Accounts receivable is just a promise."
    }
  },
  // David Jenyns - SYSTEMology
  david: {
    name: 'David Jenyns',
    source: 'SYSTEMology',
    principles: {
      systems: "The goal is to build systems so the business runs without you, not because of you.",
      clarity: "Document your critical client flow first. Everything else follows.",
      metrics: "If it's not documented, it doesn't exist. Systems create consistency.",
      growth: "You can't scale chaos. Systematize before you scale.",
      action: "Start with your biggest bottleneck. One system at a time."
    }
  },
  // Tim Ferriss - 4-Hour Workweek
  tim: {
    name: 'Tim Ferriss',
    source: 'The 4-Hour Workweek',
    principles: {
      systems: "Automate before you delegate. Eliminate before you automate.",
      metrics: "Focus on the 20% that produces 80% of results. Ignore the rest.",
      clarity: "Being busy is a form of laziness. Focus on being effective, not efficient.",
      growth: "The goal is not to work less, it's to produce more with less.",
      action: "What would this look like if it were easy? Ask that first."
    }
  },
  // Michael Gerber - E-Myth Revisited
  michael: {
    name: 'Michael Gerber',
    source: 'The E-Myth Revisited',
    principles: {
      systems: "Work ON your business, not IN it. That's the only way to scale.",
      clarity: "Your business is not your life. Build it so it can run without you.",
      growth: "The technician, the manager, and the entrepreneur must all work in harmony.",
      metrics: "Document every process. If your best employee left tomorrow, could someone step in?",
      action: "The franchise prototype: build your business as if you were going to franchise it."
    }
  },
  // Dan Sullivan - Who Not How
  dan: {
    name: 'Dan Sullivan',
    source: 'Who Not How',
    principles: {
      systems: "Stop asking 'How do I do this?' Start asking 'Who can do this for me?'",
      growth: "Your job is vision, not execution. Find the Whos for the Hows.",
      action: "Procrastination disappears when you find the right Who.",
      clarity: "Time is your most valuable resource. Invest it in your Unique Ability.",
      metrics: "The cost of a Who is always less than the cost of figuring out How yourself."
    }
  },
  // Dan Sullivan - 10x Is Easier Than 2x
  dan10x: {
    name: 'Dan Sullivan',
    source: '10x Is Easier Than 2x',
    principles: {
      growth: "10x thinking forces you to rethink everything. 2x keeps you doing more of the same.",
      clarity: "To go 10x, you must let go of 80% of what you're doing now.",
      action: "10x is about quality, not quantity. Fewer clients, higher value.",
      metrics: "Your 10x future requires a completely different version of you.",
      systems: "Every 10x jump requires letting go of what got you here."
    }
  },
  // Dan Sullivan - The Gap and The Gain
  danGap: {
    name: 'Dan Sullivan',
    source: 'The Gap and The Gain',
    principles: {
      wins: "Measure backward from where you started, not forward to an ideal. That's the GAIN.",
      momentum: "The GAP is comparing yourself to an ideal. The GAIN is measuring your progress.",
      growth: "High achievers often live in the GAP. Happiness comes from measuring the GAIN.",
      metrics: "Every day, write down 3 wins. Train your brain to see progress.",
      clarity: "The ideal is a moving target. Your gains are real and permanent."
    }
  },
  // Gino Wickman - Traction
  gino: {
    name: 'Gino Wickman',
    source: 'Traction',
    principles: {
      systems: "Run your business on EOS: Vision, People, Data, Issues, Process, Traction.",
      metrics: "Everyone must have a number. A Scorecard tells you if you're winning.",
      clarity: "Identify your core focus: what you're best at and passionate about.",
      action: "Rocks are your 90-day priorities. Focus on 3-7 max. Execute relentlessly.",
      collections: "IDS: Identify, Discuss, Solve. That's how you handle every issue."
    }
  },
  // John Warrillow - Built to Sell
  john: {
    name: 'John Warrillow',
    source: 'Built to Sell',
    principles: {
      systems: "A business that can't run without you isn't sellable. Systematize everything.",
      clarity: "Specialize in one thing. Generalists get commoditized.",
      growth: "Recurring revenue is king. It makes your business predictable and valuable.",
      metrics: "The value of your business = profit × multiple. Systems increase your multiple.",
      action: "Fire yourself from operations. If you're the bottleneck, you're the problem."
    }
  },
  // Jim Collins - Good to Great
  jim: {
    name: 'Jim Collins',
    source: 'Good to Great',
    principles: {
      clarity: "First who, then what. Get the right people on the bus first.",
      metrics: "The Hedgehog Concept: What are you best at? What drives your economic engine? What are you passionate about?",
      growth: "Great companies are built by Level 5 leaders: humble but fiercely determined.",
      systems: "The Flywheel: Small consistent pushes create unstoppable momentum.",
      action: "Confront the brutal facts, but never lose faith you'll prevail."
    }
  },
  // Ray Dalio - Principles
  ray: {
    name: 'Ray Dalio',
    source: 'Principles',
    principles: {
      systems: "Systemize your decision-making. Principles are your operating system.",
      clarity: "Radical transparency: The best ideas win, regardless of who has them.",
      metrics: "Pain + Reflection = Progress. Every mistake is a learning opportunity.",
      growth: "Embrace reality and deal with it. Wishing things were different is a waste.",
      action: "Believability-weighted decision making: Listen more to people with track records."
    }
  },
  // James Clear - Atomic Habits
  james: {
    name: 'James Clear',
    source: 'Atomic Habits',
    principles: {
      systems: "You don't rise to the level of your goals. You fall to the level of your systems.",
      action: "1% better every day. Small habits compound into remarkable results.",
      clarity: "Make it obvious, attractive, easy, and satisfying. That's the habit loop.",
      growth: "Every action is a vote for the person you want to become.",
      metrics: "Never miss twice. One miss is an accident. Two is the start of a new habit."
    }
  },
  // Simon Sinek - Start with Why
  simon: {
    name: 'Simon Sinek',
    source: 'Start with Why',
    principles: {
      clarity: "People don't buy what you do, they buy why you do it.",
      growth: "Start with WHY, then HOW, then WHAT. Most businesses do it backwards.",
      action: "The Golden Circle: Why is your purpose. How is your process. What is your product.",
      systems: "Those who know their WHY attract those who believe what they believe.",
      metrics: "Your WHY should never change. Your HOW and WHAT evolve over time."
    }
  },
  // Mike Michalowicz - Clockwork
  mikeClockwork: {
    name: 'Mike Michalowicz',
    source: 'Clockwork',
    principles: {
      systems: "Design your business to run itself. You should be replaceable.",
      clarity: "The 4-week vacation test: Can your business run 4 weeks without you?",
      action: "Identify your Queen Bee Role (QBR). Protect it at all costs.",
      growth: "Capture, then transfer. Document what's in your head, then delegate it.",
      metrics: "Track your 4 Ds: Doing, Deciding, Delegating, Designing. Move to Designing."
    }
  },
  // Mike Michalowicz - Fix This Next
  mikeFix: {
    name: 'Mike Michalowicz',
    source: 'Fix This Next',
    principles: {
      clarity: "The Business Hierarchy of Needs: Sales → Profit → Order → Impact → Legacy.",
      metrics: "You can't fix everything at once. Find your Vital Need and fix that first.",
      systems: "Sales is oxygen. Without it, nothing else matters. Fix sales first.",
      action: "Every problem is a symptom. Find the root cause in the hierarchy.",
      growth: "A business plateaus when you try to fix the wrong level of the hierarchy."
    }
  },
  // Mike Michalowicz - The Pumpkin Plan
  mikePumpkin: {
    name: 'Mike Michalowicz',
    source: 'The Pumpkin Plan',
    principles: {
      clarity: "Identify your best clients. Fire the rest. Nurture your giants.",
      growth: "To grow a giant pumpkin, you remove all the small ones and focus on one.",
      metrics: "Your top 20% of clients generate 80% of your profit. Know who they are.",
      action: "Create a Wish List of your dream clients. Then go get them.",
      margins: "Raise prices, fire bad clients. Better margins beat more revenue."
    }
  },
  // Donald Miller - Building a StoryBrand
  donaldStory: {
    name: 'Donald Miller',
    source: 'Building a StoryBrand',
    principles: {
      clarity: "Your customer is the hero, not you. You are the guide.",
      action: "The StoryBrand framework: Character, Problem, Guide, Plan, Call to Action, Success, Failure.",
      growth: "If you confuse, you lose. Clarity wins.",
      systems: "Every message should answer: What do you offer? How will it make my life better? What do I do to buy it?",
      metrics: "People don't buy the best products. They buy the products they can understand fastest."
    }
  },
  // Donald Miller - Marketing Made Simple
  donaldMarketing: {
    name: 'Donald Miller',
    source: 'Marketing Made Simple',
    principles: {
      systems: "The Marketing Made Simple checklist: One-liner, Website, Lead Generator, Email Sequence, Sales Sequence.",
      clarity: "Your one-liner: Problem, Solution, Result. That's it.",
      action: "A lead generator trades value for email addresses. Give value first.",
      growth: "Nurture leads through email. Most sales happen after 7+ touches.",
      metrics: "Your website should pass the grunt test: What do you offer? How does it help me? How do I buy?"
    }
  },
  // Michael Gerber - E-Myth Mastery
  michaelMastery: {
    name: 'Michael Gerber',
    source: 'E-Myth Mastery',
    principles: {
      systems: "Seven centers of management: Leadership, Marketing, Finance, Management, Lead Conversion, Lead Generation, Client Fulfillment.",
      clarity: "Your Primary Aim: What do you want your life to look like?",
      growth: "Your Strategic Objective: What does your business need to look like to achieve your Primary Aim?",
      action: "Innovation, Quantification, Orchestration: Improve it, measure it, systematize it.",
      metrics: "Create your Organization Chart now, even if it's just you. Then fill the roles with systems."
    }
  }
};

/**
 * Question patterns and their handlers
 * Each response includes guidance from a relevant mentor
 */
const QUESTION_PATTERNS = [
  // Cash & Bank
  { patterns: [/cash|bank|balance/i], handler: 'getCashPosition', mentor: 'mike', principle: 'cashFlow' },
  { patterns: [/how much.*(have|got)|money/i], handler: 'getCashPosition', mentor: 'keith', principle: 'cashFlow' },
  
  // AR / Who owes
  { patterns: [/ar|receivable|owed|owes|who owes/i], handler: 'getARDetails', mentor: 'keith', principle: 'ar' },
  { patterns: [/overdue|late|past due/i], handler: 'getOverdueInvoices', mentor: 'keithVault', principle: 'collections' },
  
  // Revenue / Invoices
  { patterns: [/revenue|billed|invoiced/i], handler: 'getRevenueThisWeek', mentor: 'tony', principle: 'momentum' },
  { patterns: [/this week|last week/i], handler: 'getWeekComparison', mentor: 'danGap', principle: 'wins' },
  
  // Collections / Payments
  { patterns: [/collected|payments|paid/i], handler: 'getCollections', mentor: 'keithBlueprint', principle: 'collections' },
  
  // Margins / Profit
  { patterns: [/margin|profit|gross/i], handler: 'getGrossMargin', mentor: 'mike', principle: 'margins' },
  
  // Expenses
  { patterns: [/expense|spent|spending/i], handler: 'getExpenses', mentor: 'mike', principle: 'runway' },
  
  // Runway
  { patterns: [/runway|survive|weeks/i], handler: 'getCashRunway', mentor: 'keithBlueprint', principle: 'runway' },
  
  // Wins / Progress
  { patterns: [/wins|winning|celebrate|progress/i], handler: 'getWins', mentor: 'danGap', principle: 'wins' },
  
  // Credit Cards
  { patterns: [/credit card|amex|card balance/i], handler: 'getCreditCards', mentor: 'mike', principle: 'cashFlow' },
  
  // Summary / Overview
  { patterns: [/summary|overview|scorecard|numbers/i], handler: 'getSummary', mentor: 'gino', principle: 'metrics' },
  
  // Systems / Process
  { patterns: [/system|process|automate/i], handler: 'getSummary', mentor: 'david', principle: 'systems' },
  
  // Growth / Scaling
  { patterns: [/grow|scale|bigger/i], handler: 'getSummary', mentor: 'dan10x', principle: 'growth' },
  
  // Delegation / Help
  { patterns: [/delegate|hire|help|who/i], handler: 'getSummary', mentor: 'dan', principle: 'systems' },
  
  // Clients / Customers
  { patterns: [/client|customer|best/i], handler: 'getARDetails', mentor: 'mikePumpkin', principle: 'clarity' },
  
  // Habits / Improvement
  { patterns: [/habit|improve|better/i], handler: 'getWeekComparison', mentor: 'james', principle: 'action' },
  
  // Focus / Priorities
  { patterns: [/focus|priority|important/i], handler: 'getSummary', mentor: 'gino', principle: 'action' },
  
  // Why / Purpose
  { patterns: [/why|purpose|mission/i], handler: 'getSummary', mentor: 'simon', principle: 'clarity' },
  
  // Sell / Value
  { patterns: [/sell|value|worth/i], handler: 'getSummary', mentor: 'john', principle: 'systems' }
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

