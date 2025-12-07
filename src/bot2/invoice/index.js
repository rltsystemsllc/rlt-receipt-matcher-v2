/**
 * Invoice Service for Bot 2
 * Creates draft invoices in QuickBooks and manages sending
 */

const qboClient = require('../../services/quickbooks/client');
const qboUpdater = require('../../smart-receipt-bot/qbo-updater');
const config = require('../../config');
const logger = require('../../utils/logger');

/**
 * Get billable expenses from QBO for a job
 * This pulls expenses that Smart Receipt Bot has categorized
 */
async function getBillableExpensesForJob(jobName) {
  try {
    const isAuth = await qboClient.authenticate();
    if (!isAuth) {
      logger.warn('QBO not authenticated, cannot fetch billable expenses');
      return [];
    }

    // Find the customer/job in QBO
    const customer = await qboUpdater.findOrCreateCustomer(jobName);
    if (!customer) {
      logger.warn('Customer not found in QBO', { jobName });
      return [];
    }

    // Query for billable purchases assigned to this customer
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 60);
    const dateStr = thirtyDaysAgo.toISOString().split('T')[0];

    const response = await qboClient.makeApiCall('GET',
      `/query?query=${encodeURIComponent(
        `SELECT * FROM Purchase WHERE TxnDate >= '${dateStr}' MAXRESULTS 200`
      )}`
    );

    const allPurchases = response.QueryResponse?.Purchase || [];

    // Filter to billable expenses for this customer
    const billableExpenses = [];
    
    for (const purchase of allPurchases) {
      for (const line of purchase.Line || []) {
        const detail = line.AccountBasedExpenseLineDetail;
        if (detail?.CustomerRef?.value === customer.Id &&
            detail?.BillableStatus === 'Billable') {
          billableExpenses.push({
            purchaseId: purchase.Id,
            vendor: purchase.EntityRef?.name || 'Unknown',
            date: purchase.TxnDate,
            amount: line.Amount,
            description: line.Description || `${purchase.EntityRef?.name || 'Purchase'} - ${purchase.TxnDate}`,
            hasReceipt: !!purchase.LinkedTxn?.length // Rough check for attachments
          });
        }
      }
    }

    logger.info('Found billable expenses for job', { 
      jobName, 
      count: billableExpenses.length,
      total: billableExpenses.reduce((sum, e) => sum + e.amount, 0)
    });

    return billableExpenses;

  } catch (error) {
    logger.error('Failed to get billable expenses', { error: error.message, jobName });
    return [];
  }
}

/**
 * Calculate labor costs from sheet rows
 */
function calculateLabor(rows) {
  const standardRate = config.billing.laborRateStandard;
  const emergencyRate = config.billing.laborRateEmergency;

  let standardHours = 0;
  let emergencyHours = 0;
  const descriptions = [];
  const phases = new Set();
  const dateDetails = [];

  for (const row of rows) {
    const hours = row.hoursWorked || 0;
    
    if (row.emergencyRate) {
      emergencyHours += hours;
    } else {
      standardHours += hours;
    }

    if (row.description) {
      descriptions.push({
        date: row.dateWorkedRaw || 'Unknown date',
        description: row.description,
        hours,
        isEmergency: row.emergencyRate
      });
    }

    if (row.phase) {
      phases.add(row.phase);
    }

    dateDetails.push({
      date: row.dateWorkedRaw || 'Unknown',
      hours,
      description: row.description || 'Work performed',
      isEmergency: row.emergencyRate
    });
  }

  const standardTotal = standardHours * standardRate;
  const emergencyTotal = emergencyHours * emergencyRate;

  return {
    standardHours,
    emergencyHours,
    totalHours: standardHours + emergencyHours,
    standardRate,
    emergencyRate,
    standardTotal,
    emergencyTotal,
    laborTotal: standardTotal + emergencyTotal,
    descriptions,
    phases: Array.from(phases),
    dateDetails
  };
}

/**
 * Calculate materials from sheet rows (backup) + QBO billable expenses
 */
function calculateMaterials(rows, billableExpenses) {
  const markup = config.billing.stockMarkupPercent / 100;

  // Stock materials from sheet (backup entry)
  const stockFromSheet = [];
  for (const row of rows) {
    if (row.stockMaterials && row.stockMaterials.trim()) {
      stockFromSheet.push({
        source: 'sheet',
        description: row.stockMaterials,
        date: row.dateWorkedRaw
      });
    }
    if (row.purchasedMaterials && row.purchasedMaterials.trim()) {
      stockFromSheet.push({
        source: 'sheet',
        description: row.purchasedMaterials,
        date: row.dateWorkedRaw
      });
    }
  }

  // Billable expenses from QBO (Smart Receipt Bot)
  const expensesFromQBO = billableExpenses.map(exp => ({
    source: 'qbo',
    vendor: exp.vendor,
    amount: exp.amount,
    date: exp.date,
    description: exp.description,
    hasReceipt: exp.hasReceipt
  }));

  const qboTotal = expensesFromQBO.reduce((sum, e) => sum + e.amount, 0);
  const qboWithMarkup = qboTotal * (1 + markup);

  return {
    stockFromSheet,
    expensesFromQBO,
    qboCost: qboTotal,
    qboWithMarkup,
    markupPercent: config.billing.stockMarkupPercent
  };
}

/**
 * Build invoice preview data
 */
async function buildInvoicePreview(jobName, rows) {
  // Get billable expenses from QBO
  const billableExpenses = await getBillableExpensesForJob(jobName);
  
  // Calculate labor
  const labor = calculateLabor(rows);
  
  // Calculate materials
  const materials = calculateMaterials(rows, billableExpenses);
  
  // Calculate totals
  const laborRevenue = labor.laborTotal;
  const materialsRevenue = materials.qboWithMarkup;
  const totalRevenue = laborRevenue + materialsRevenue;
  const totalCost = materials.qboCost;
  const profit = totalRevenue - totalCost;
  const profitMargin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;

  return {
    jobName,
    rows,
    labor,
    materials,
    summary: {
      laborRevenue,
      materialsRevenue,
      totalRevenue,
      totalCost,
      profit,
      profitMargin,
      rowCount: rows.length,
      hasEmergencyRate: labor.emergencyHours > 0
    }
  };
}

/**
 * Create draft invoice in QuickBooks
 */
async function createDraftInvoice(jobName, rows) {
  const isAuth = await qboClient.authenticate();
  if (!isAuth) {
    throw new Error('QuickBooks not authenticated');
  }

  // Build preview first
  const preview = await buildInvoicePreview(jobName, rows);
  
  // Find or create customer
  const customer = await qboUpdater.findOrCreateCustomer(jobName);

  // Build line items
  const lines = [];
  let lineNum = 1;

  // Standard labor line
  if (preview.labor.standardHours > 0) {
    const laborDesc = buildLaborDescription(preview.labor, false);
    lines.push({
      Id: String(lineNum),
      LineNum: lineNum,
      Description: laborDesc,
      Amount: preview.labor.standardTotal,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        Qty: preview.labor.standardHours,
        UnitPrice: preview.labor.standardRate
      }
    });
    lineNum++;
  }

  // Emergency labor line
  if (preview.labor.emergencyHours > 0) {
    const laborDesc = buildLaborDescription(preview.labor, true);
    lines.push({
      Id: String(lineNum),
      LineNum: lineNum,
      Description: laborDesc,
      Amount: preview.labor.emergencyTotal,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        Qty: preview.labor.emergencyHours,
        UnitPrice: preview.labor.emergencyRate
      }
    });
    lineNum++;
  }

  // Materials line (billable expenses with markup)
  if (preview.materials.qboWithMarkup > 0) {
    const materialsDesc = buildMaterialsDescription(preview.materials);
    lines.push({
      Id: String(lineNum),
      LineNum: lineNum,
      Description: materialsDesc,
      Amount: preview.materials.qboWithMarkup,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        Qty: 1,
        UnitPrice: preview.materials.qboWithMarkup
      }
    });
    lineNum++;
  }

  // Create the invoice in QBO
  const invoiceData = {
    CustomerRef: {
      value: customer.Id,
      name: customer.DisplayName
    },
    Line: lines,
    PrivateNote: `Created by RLT Bot 2 on ${new Date().toISOString()}`
  };

  const response = await qboClient.makeApiCall('POST', '/invoice', invoiceData);
  const invoice = response.Invoice;

  logger.info('Created draft invoice', {
    invoiceId: invoice.Id,
    jobName,
    amount: invoice.TotalAmt
  });

  return {
    invoiceId: invoice.Id,
    docNumber: invoice.DocNumber,
    jobName,
    customerName: customer.DisplayName,
    customerEmail: customer.PrimaryEmailAddr?.Address,
    totalAmount: invoice.TotalAmt,
    preview
  };
}

/**
 * Build labor description for invoice line
 */
function buildLaborDescription(labor, isEmergency) {
  const rate = isEmergency ? labor.emergencyRate : labor.standardRate;
  const hours = isEmergency ? labor.emergencyHours : labor.standardHours;
  const rateType = isEmergency ? 'Emergency Rate (Same-Day/Weekend)' : 'Standard Rate';
  
  let desc = `LABOR — ${rateType} ($${rate}/hr)\n`;
  
  if (labor.phases.length > 0) {
    desc += `Phase(s): ${labor.phases.join(', ')}\n`;
  }
  
  desc += '\nWork Performed:\n';
  
  for (const detail of labor.dateDetails) {
    if ((isEmergency && detail.isEmergency) || (!isEmergency && !detail.isEmergency)) {
      desc += `• ${detail.date}: ${detail.hours} hrs - ${detail.description}\n`;
    }
  }

  return desc.trim();
}

/**
 * Build materials description for invoice line
 */
function buildMaterialsDescription(materials) {
  let desc = `MATERIALS & SUPPLIES (+${materials.markupPercent}% markup)\n\n`;
  
  for (const exp of materials.expensesFromQBO) {
    const receiptNote = exp.hasReceipt ? ' ✓' : '';
    desc += `• ${exp.vendor} (${exp.date}): $${exp.amount.toFixed(2)}${receiptNote}\n`;
  }
  
  desc += `\nSubtotal: $${materials.qboCost.toFixed(2)}`;
  desc += `\nWith ${materials.markupPercent}% markup: $${materials.qboWithMarkup.toFixed(2)}`;

  return desc.trim();
}

/**
 * Send invoice to customer
 */
async function sendInvoiceToCustomer(invoiceId) {
  const isAuth = await qboClient.authenticate();
  if (!isAuth) {
    throw new Error('QuickBooks not authenticated');
  }

  // Get the invoice first
  const getResponse = await qboClient.makeApiCall('GET', `/invoice/${invoiceId}`);
  const invoice = getResponse.Invoice;

  if (!invoice) {
    throw new Error(`Invoice ${invoiceId} not found`);
  }

  // Send the invoice
  const sendResponse = await qboClient.makeApiCall('POST', 
    `/invoice/${invoiceId}/send`
  );

  logger.info('Invoice sent to customer', {
    invoiceId,
    customerEmail: invoice.BillEmail?.Address
  });

  return {
    invoiceId,
    jobName: invoice.CustomerRef?.name,
    totalAmount: invoice.TotalAmt,
    customerEmail: invoice.BillEmail?.Address,
    sentAt: new Date().toISOString()
  };
}

/**
 * Get existing customers for selection
 */
async function getExistingCustomers() {
  return await qboUpdater.getRecentJobs(20);
}

/**
 * Create customer and project
 */
async function createCustomerAndProject(contractorName, projectName) {
  const displayName = `${contractorName} - ${projectName}`;
  const customer = await qboUpdater.findOrCreateCustomer(displayName);
  
  return {
    customerId: customer.Id,
    customerName: customer.DisplayName,
    projectName
  };
}

/**
 * Create project under existing customer
 */
async function createProjectUnderCustomer(customerId, projectName) {
  // For now, just create a new customer with the project name
  // Full parent-child relationship would require more complex QBO setup
  const customer = await qboUpdater.findOrCreateCustomer(projectName);
  
  return {
    customerId: customer.Id,
    customerName: customer.DisplayName,
    projectName
  };
}

/**
 * Get invoice by ID
 */
async function getInvoice(invoiceId) {
  const isAuth = await qboClient.authenticate();
  if (!isAuth) return null;

  try {
    const response = await qboClient.makeApiCall('GET', `/invoice/${invoiceId}`);
    return response.Invoice;
  } catch (error) {
    logger.error('Failed to get invoice', { invoiceId, error: error.message });
    return null;
  }
}

/**
 * Delete/void an invoice (for undo functionality)
 */
async function voidInvoice(invoiceId) {
  const isAuth = await qboClient.authenticate();
  if (!isAuth) {
    throw new Error('QuickBooks not authenticated');
  }

  // Get current invoice
  const invoice = await getInvoice(invoiceId);
  if (!invoice) {
    throw new Error(`Invoice ${invoiceId} not found`);
  }

  // Void the invoice
  const voidData = {
    ...invoice,
    SyncToken: invoice.SyncToken
  };

  const response = await qboClient.makeApiCall('POST', 
    `/invoice/${invoiceId}?operation=void`,
    voidData
  );

  logger.info('Invoice voided', { invoiceId });
  return response.Invoice;
}

module.exports = {
  getBillableExpensesForJob,
  calculateLabor,
  calculateMaterials,
  buildInvoicePreview,
  createDraftInvoice,
  sendInvoiceToCustomer,
  getExistingCustomers,
  createCustomerAndProject,
  createProjectUnderCustomer,
  getInvoice,
  voidInvoice
};
