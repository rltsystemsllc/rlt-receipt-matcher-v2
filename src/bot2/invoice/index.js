/**
 * Invoice Service for Bot 2
 * Creates draft invoices in QuickBooks Online
 */

const config = require('../../config');
const logger = require('../../utils/logger');
const qboClient = require('../../services/quickbooks/client');
const pdfGenerator = require('./pdf-generator');
const { v4: uuidv4 } = require('uuid');

/**
 * Create a draft invoice for a job
 */
async function createDraftInvoice(jobName, rows) {
  logger.info('Creating draft invoice', { jobName, rowCount: rows.length });

  try {
    // 1. Find or match the customer/project in QBO
    const customer = await findOrCreateCustomer(jobName);
    
    // 2. Calculate labor totals
    const laborData = calculateLabor(rows);
    
    // 3. Get billable expenses from QBO (created by Bot 1)
    const billableExpenses = await getBillableExpenses(customer.Id);
    
    // 4. Calculate materials from stock/truck
    const stockMaterials = calculateStockMaterials(rows);
    
    // 5. Create the invoice lines
    const invoiceLines = buildInvoiceLines(laborData, billableExpenses, stockMaterials);
    
    // 6. Create draft invoice in QBO
    const invoice = await createQBOInvoice(customer, invoiceLines, jobName);
    
    // 7. Create time activity entry
    const timeActivity = await createTimeActivity(customer, laborData);
    
    // 8. Generate internal PDFs
    const summaries = await generateSummaries(jobName, rows, laborData, billableExpenses, stockMaterials);

    // Calculate totals
    const totalAmount = laborData.total + 
      billableExpenses.reduce((sum, e) => sum + e.amount, 0) +
      stockMaterials.total;

    return {
      invoiceId: invoice.Id,
      invoiceNumber: invoice.DocNumber,
      jobName,
      customerId: customer.Id,
      customerName: customer.DisplayName,
      totalAmount,
      laborTotal: laborData.total,
      materialsTotal: billableExpenses.reduce((sum, e) => sum + e.amount, 0) + stockMaterials.total,
      totalHours: laborData.totalHours,
      phases: laborData.phases,
      rowCount: rows.length,
      timeActivityId: timeActivity?.Id,
      summaries
    };

  } catch (error) {
    logger.error('Failed to create draft invoice', { error: error.message, jobName });
    throw error;
  }
}

/**
 * Find existing customer/project or create placeholder
 */
async function findOrCreateCustomer(jobName) {
  try {
    // Search for existing customer by job name
    const query = `SELECT * FROM Customer WHERE DisplayName LIKE '%${jobName.replace(/'/g, "\\'")}%'`;
    const result = await qboClient.query(query);
    
    if (result.QueryResponse?.Customer?.length > 0) {
      logger.info('Found existing customer', { jobName, customerId: result.QueryResponse.Customer[0].Id });
      return result.QueryResponse.Customer[0];
    }

    // If not found, we might need to handle this via SMS flow
    // For now, throw an error - the new project flow should handle this
    logger.warn('Customer not found, may need to create', { jobName });
    throw new Error(`Customer "${jobName}" not found in QuickBooks. Please create it first or use the new project flow.`);
    
  } catch (error) {
    logger.error('Error finding customer', { error: error.message, jobName });
    throw error;
  }
}

/**
 * Calculate labor totals from sheet rows
 */
function calculateLabor(rows) {
  const standardRate = config.billing.laborRateStandard;
  const emergencyRate = config.billing.laborRateEmergency;

  let totalHours = 0;
  const phases = new Set();
  const descriptions = [];
  const entries = [];

  for (const row of rows) {
    const hours = row.hoursWorked || 0;
    totalHours += hours;
    
    if (row.constructionPhase) {
      phases.add(row.constructionPhase);
    }
    
    if (row.descriptionOfWork) {
      descriptions.push({
        date: row.date,
        description: row.descriptionOfWork,
        hours
      });
    }

    entries.push({
      date: row.date,
      hours,
      phase: row.constructionPhase,
      description: row.descriptionOfWork
    });
  }

  // For now, all labor is standard rate
  // TODO: Add logic to detect emergency/after-hours based on time or form field
  const total = totalHours * standardRate;

  // Generate polished summary
  const summary = generateLaborSummary(entries, Array.from(phases));

  return {
    totalHours,
    standardHours: totalHours,
    emergencyHours: 0,
    standardRate,
    emergencyRate,
    total,
    phases: Array.from(phases),
    descriptions,
    entries,
    summary
  };
}

/**
 * Generate a polished labor summary
 */
function generateLaborSummary(entries, phases) {
  let summary = `Electrical work completed for the following phases: ${phases.join(', ')}.\n\n`;
  summary += 'Work performed includes:\n';
  
  // Group similar descriptions
  const uniqueDescriptions = [...new Set(entries.map(e => e.description).filter(Boolean))];
  for (const desc of uniqueDescriptions) {
    summary += `• ${desc}\n`;
  }

  summary += `\nAll work completed to code and ready for inspection.`;
  
  return summary;
}

/**
 * Get billable expenses for this customer from QBO (created by Bot 1)
 */
async function getBillableExpenses(customerId) {
  try {
    // Query for unbilled purchases linked to this customer
    const query = `SELECT * FROM Purchase WHERE CustomerRef = '${customerId}' AND BillableStatus = 'Billable'`;
    const result = await qboClient.query(query);
    
    const expenses = [];
    if (result.QueryResponse?.Purchase) {
      for (const purchase of result.QueryResponse.Purchase) {
        expenses.push({
          id: purchase.Id,
          vendor: purchase.EntityRef?.name || 'Unknown Vendor',
          date: purchase.TxnDate,
          amount: purchase.TotalAmt,
          description: purchase.PrivateNote || '',
          lineItems: purchase.Line || []
        });
      }
    }

    logger.info('Found billable expenses', { customerId, count: expenses.length });
    return expenses;

  } catch (error) {
    logger.error('Error getting billable expenses', { error: error.message });
    return [];
  }
}

/**
 * Calculate stock/truck materials with markup
 */
function calculateStockMaterials(rows) {
  const markupPercent = config.billing.stockMarkupPercent;
  const items = [];
  let subtotal = 0;

  for (const row of rows) {
    if (row.materialFromStock) {
      // Parse the materials - format could be "Item: $cost" or just description
      const materials = row.materialFromStock.split(',').map(m => m.trim());
      
      for (const material of materials) {
        // Try to extract cost if provided
        const costMatch = material.match(/\$?([\d.]+)/);
        let cost = costMatch ? parseFloat(costMatch[1]) : 0;
        let description = material.replace(/\$?[\d.]+/, '').trim();
        
        if (cost > 0) {
          const withMarkup = cost * (1 + markupPercent / 100);
          items.push({
            description: description || material,
            baseCost: cost,
            markup: markupPercent,
            total: withMarkup
          });
          subtotal += withMarkup;
        }
      }
    }
  }

  return {
    items,
    subtotal,
    markupPercent,
    total: subtotal
  };
}

/**
 * Build invoice line items
 */
function buildInvoiceLines(laborData, billableExpenses, stockMaterials) {
  const lines = [];
  let lineNum = 1;

  // Labor line
  if (laborData.totalHours > 0) {
    const laborDescription = `LABOR — Phase(s): ${laborData.phases.join(', ')}\n\n` +
      `Descriptions:\n${laborData.descriptions.map(d => `- ${d.description}`).join('\n')}\n\n` +
      `Summary:\n${laborData.summary}`;

    lines.push({
      Id: lineNum.toString(),
      LineNum: lineNum,
      Description: laborDescription,
      Amount: laborData.total,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        Qty: laborData.totalHours,
        UnitPrice: config.billing.laborRateStandard
        // ItemRef would be set to your labor service item
      }
    });
    lineNum++;
  }

  // Billable expense lines (from Bot 1)
  for (const expense of billableExpenses) {
    lines.push({
      Id: lineNum.toString(),
      LineNum: lineNum,
      Description: `Materials - ${expense.vendor} (${expense.date})`,
      Amount: expense.amount,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        // Mark as linked to original expense
        LinkedTxn: [{
          TxnId: expense.id,
          TxnType: 'Purchase'
        }]
      }
    });
    lineNum++;
  }

  // Stock materials lines
  for (const item of stockMaterials.items) {
    lines.push({
      Id: lineNum.toString(),
      LineNum: lineNum,
      Description: `Stock Materials: ${item.description} (+${item.markup}% markup)`,
      Amount: item.total,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {}
    });
    lineNum++;
  }

  return lines;
}

/**
 * Create the invoice in QuickBooks (as draft)
 */
async function createQBOInvoice(customer, lines, jobName) {
  try {
    const invoiceData = {
      CustomerRef: {
        value: customer.Id,
        name: customer.DisplayName
      },
      Line: lines,
      CustomerMemo: {
        value: config.billing.invoiceMemo
      },
      PrivateNote: `Auto-generated by Bot 2 for job: ${jobName}. Review before sending.`,
      DocNumber: `RLT-${Date.now().toString().slice(-6)}`,
      // Leave as draft (don't send email)
      EmailStatus: 'NotSet',
      BillEmail: customer.PrimaryEmailAddr
    };

    const result = await qboClient.create('Invoice', invoiceData);
    logger.info('Created draft invoice in QBO', { invoiceId: result.Id, docNumber: result.DocNumber });
    
    return result;
  } catch (error) {
    logger.error('Failed to create QBO invoice', { error: error.message });
    throw error;
  }
}

/**
 * Create time activity entry in QBO
 */
async function createTimeActivity(customer, laborData) {
  try {
    const timeActivityData = {
      TxnDate: new Date().toISOString().split('T')[0],
      NameOf: 'Vendor', // or 'Employee' if Bobby is an employee
      CustomerRef: {
        value: customer.Id,
        name: customer.DisplayName
      },
      Hours: Math.floor(laborData.totalHours),
      Minutes: Math.round((laborData.totalHours % 1) * 60),
      Description: `Labor for ${laborData.phases.join(', ')}`,
      BillableStatus: 'Billable'
    };

    const result = await qboClient.create('TimeActivity', timeActivityData);
    logger.info('Created time activity', { id: result.Id, hours: laborData.totalHours });
    
    return result;
  } catch (error) {
    logger.warn('Failed to create time activity', { error: error.message });
    return null; // Non-critical, continue
  }
}

/**
 * Generate internal summary PDFs
 */
async function generateSummaries(jobName, rows, laborData, billableExpenses, stockMaterials) {
  try {
    const laborPdf = await pdfGenerator.generateLaborSummary(jobName, laborData, rows);
    const materialsPdf = await pdfGenerator.generateMaterialsSummary(jobName, billableExpenses, stockMaterials);
    
    return {
      laborPdf,
      materialsPdf
    };
  } catch (error) {
    logger.warn('Failed to generate PDF summaries', { error: error.message });
    return null;
  }
}

/**
 * Send invoice to customer (after approval)
 */
async function sendInvoiceToCustomer(invoiceId) {
  try {
    // Get the invoice
    const invoice = await qboClient.read('Invoice', invoiceId);
    
    // Send via QBO email
    await qboClient.sendEmail('Invoice', invoiceId, invoice.BillEmail?.Address);
    
    logger.info('Invoice sent to customer', { invoiceId });
    
    return {
      invoiceId,
      jobName: invoice.CustomerRef?.name,
      totalAmount: invoice.TotalAmt,
      customerEmail: invoice.BillEmail?.Address
    };
  } catch (error) {
    logger.error('Failed to send invoice', { error: error.message, invoiceId });
    throw error;
  }
}

/**
 * Create new customer and project in QBO
 */
async function createCustomerAndProject(customerName, projectName) {
  try {
    // Create customer
    const customerData = {
      DisplayName: customerName,
      CompanyName: customerName,
      Notes: `Created by Bot 2 on ${new Date().toISOString()}`
    };

    const customer = await qboClient.create('Customer', customerData);
    logger.info('Created new customer', { customerId: customer.Id, name: customerName });

    // Create project as sub-customer
    const projectData = {
      DisplayName: projectName,
      ParentRef: {
        value: customer.Id
      },
      Job: true,
      Notes: `Project created by Bot 2`
    };

    const project = await qboClient.create('Customer', projectData);
    logger.info('Created new project', { projectId: project.Id, name: projectName });

    return {
      customerId: customer.Id,
      customerName,
      projectId: project.Id,
      projectName
    };
  } catch (error) {
    logger.error('Failed to create customer/project', { error: error.message });
    throw error;
  }
}

/**
 * Create project under existing customer
 */
async function createProjectUnderCustomer(customerId, projectName) {
  try {
    const projectData = {
      DisplayName: projectName,
      ParentRef: {
        value: customerId
      },
      Job: true,
      Notes: `Project created by Bot 2`
    };

    const project = await qboClient.create('Customer', projectData);
    logger.info('Created project under customer', { projectId: project.Id, customerId, name: projectName });

    return {
      projectId: project.Id,
      projectName
    };
  } catch (error) {
    logger.error('Failed to create project', { error: error.message });
    throw error;
  }
}

/**
 * Get existing customers for selection
 */
async function getExistingCustomers() {
  try {
    const query = `SELECT * FROM Customer WHERE Active = true ORDER BY DisplayName`;
    const result = await qboClient.query(query);
    
    return result.QueryResponse?.Customer || [];
  } catch (error) {
    logger.error('Failed to get customers', { error: error.message });
    return [];
  }
}

module.exports = {
  createDraftInvoice,
  sendInvoiceToCustomer,
  createCustomerAndProject,
  createProjectUnderCustomer,
  getExistingCustomers
};



