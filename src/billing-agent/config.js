/**
 * Billing Agent configuration.
 * Everything that changes money or behavior is an env var with a safe default.
 */

const num = (v, d) => (v === undefined || v === '' || isNaN(parseFloat(v)) ? d : parseFloat(v));

module.exports = {
  enabled: process.env.BILLING_AGENT_ENABLED === 'true',

  // dry_run: writes proposed invoices to the log tab only (no QBO writes, no texts to Bobby)
  // draft:   creates DRAFT invoices in QBO + texts Bobby a picture of each one
  mode: process.env.BILLING_AGENT_MODE === 'draft' ? 'draft' : 'dry_run',

  // Hard stop: QBO company name must contain this text, or the agent refuses to write.
  // Protects against billing RLT work into the Read Lighting company file.
  requiredCompanyName: process.env.BILLING_AGENT_QBO_COMPANY || 'RLT',

  timezone: 'Pacific/Honolulu',
  // Urgent rows: checked often. Everything else: weekly sweep (Fri 3pm HST).
  urgentCron: process.env.BILLING_AGENT_URGENT_CRON || '*/15 * * * *',
  weeklyCron: process.env.BILLING_AGENT_WEEKLY_CRON || '0 15 * * 5',

  rates: {
    bobbyStandard: num(process.env.LABOR_RATE_STANDARD, 150),
    bobbyEmergency: num(process.env.LABOR_RATE_EMERGENCY, 300),
    kenny: num(process.env.KENNY_RATE, 95),
    kennyEmergency: num(process.env.KENNY_EMERGENCY_RATE, num(process.env.KENNY_RATE, 95)),
    materialsMarkupPercent: num(process.env.STOCK_MARKUP_PERCENT, 22)
  },

  guardrails: {
    maxHoursPerRow: num(process.env.BILLING_AGENT_MAX_HOURS_PER_ROW, 12),
    maxInvoiceTotal: num(process.env.BILLING_AGENT_MAX_INVOICE, 10000)
  },

  sheet: {
    responsesTab: process.env.GOOGLE_SHEET_NAME || 'Form Responses 1',
    logTab: process.env.BILLING_AGENT_LOG_TAB || 'Billing Agent Log',
    customerMapTab: process.env.BILLING_AGENT_CUSTOMER_MAP_TAB || 'Customer Map'
  },

  qbo: {
    laborItemName: process.env.BILLING_AGENT_LABOR_ITEM || 'Labor',
    materialsItemName: process.env.BILLING_AGENT_MATERIALS_ITEM || 'Materials'
  },

  ai: {
    model: process.env.BILLING_AGENT_MODEL || 'claude-opus-5-5'
  },

  statuses: {
    drafting: 'Drafting…',
    draftCreated: 'Draft Created',
    approved: 'Approved by Bobby',
    needsFix: 'Needs Fix',
    needsReview: 'Needs Review'
  }
};
