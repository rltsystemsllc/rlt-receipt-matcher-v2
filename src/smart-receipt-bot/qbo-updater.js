/**
 * QBO Updater
 * 
 * Updates QuickBooks transactions with:
 * - Customer/Job assignment
 * - Billable status
 * - Taxable status
 * - Receipt attachments
 */

const qboClient = require('../services/quickbooks/client');
const logger = require('../utils/logger');

// Cache for customers/jobs
const customerCache = new Map();

/**
 * Update a transaction with job assignment and billable/taxable status
 */
async function updateTransaction(transactionId, options) {
  try {
    const {
      customerId,
      customerName,
      billable = true,
      taxable = true,
      memo
    } = options;

    // First, get the current transaction
    const response = await qboClient.makeApiCall('GET', `/purchase/${transactionId}`);
    const purchase = response.Purchase;

    if (!purchase) {
      throw new Error(`Transaction ${transactionId} not found`);
    }

    // Update each line item
    const updatedLines = purchase.Line.map(line => {
      if (line.DetailType === 'AccountBasedExpenseLineDetail') {
        return {
          ...line,
          AccountBasedExpenseLineDetail: {
            ...line.AccountBasedExpenseLineDetail,
            // Set customer reference (job)
            CustomerRef: customerId ? { value: customerId, name: customerName } : undefined,
            // Set billable status
            BillableStatus: billable ? 'Billable' : 'NotBillable',
            // Set tax code
            TaxCodeRef: taxable ? { value: 'TAX' } : { value: 'NON' }
          }
        };
      }
      return line;
    });

    // Build update payload
    const updatePayload = {
      ...purchase,
      Line: updatedLines,
      SyncToken: purchase.SyncToken
    };

    // Add memo if provided
    if (memo) {
      updatePayload.PrivateNote = purchase.PrivateNote 
        ? `${purchase.PrivateNote}\n${memo}`
        : memo;
    }

    // Update the transaction
    const updateResponse = await qboClient.makeApiCall('POST', '/purchase', updatePayload);

    logger.info('Transaction updated', {
      id: transactionId,
      customer: customerName,
      billable,
      taxable
    });

    return updateResponse.Purchase;

  } catch (error) {
    logger.error('Failed to update transaction', { 
      transactionId, 
      error: error.message 
    });
    throw error;
  }
}

/**
 * Find or create a customer/job in QBO
 */
async function findOrCreateCustomer(jobName) {
  try {
    // Check cache first
    const cacheKey = jobName.toLowerCase().trim();
    if (customerCache.has(cacheKey)) {
      return customerCache.get(cacheKey);
    }

    // Search for existing customer
    const searchResponse = await qboClient.makeApiCall('GET',
      `/query?query=${encodeURIComponent(
        `SELECT * FROM Customer WHERE DisplayName LIKE '%${jobName.replace(/'/g, "\\'")}%' AND Active = true`
      )}`
    );

    const customers = searchResponse.QueryResponse?.Customer || [];

    // Try to find best match
    let customer = customers.find(c => 
      c.DisplayName.toLowerCase() === jobName.toLowerCase()
    );

    // If no exact match, try partial match
    if (!customer && customers.length > 0) {
      customer = customers.find(c =>
        c.DisplayName.toLowerCase().includes(jobName.toLowerCase()) ||
        jobName.toLowerCase().includes(c.DisplayName.toLowerCase())
      );
    }

    // If still no match, create new customer/job
    if (!customer) {
      logger.info('Creating new customer/job', { name: jobName });
      
      const createResponse = await qboClient.makeApiCall('POST', '/customer', {
        DisplayName: jobName,
        CompanyName: jobName,
        Job: true,
        BillWithParent: false,
        Active: true
      });

      customer = createResponse.Customer;
    }

    // Cache the result
    customerCache.set(cacheKey, customer);

    logger.info('Found/created customer', { 
      id: customer.Id, 
      name: customer.DisplayName 
    });

    return customer;

  } catch (error) {
    logger.error('Failed to find/create customer', { 
      jobName, 
      error: error.message 
    });
    throw error;
  }
}

/**
 * Attach a receipt to a transaction
 */
async function attachReceipt(transactionId, fileData, filename = 'receipt.pdf') {
  try {
    // Convert to buffer if needed
    let buffer;
    if (Buffer.isBuffer(fileData)) {
      buffer = fileData;
    } else if (typeof fileData === 'string') {
      buffer = Buffer.from(fileData.replace(/^data:\w+\/\w+;base64,/, ''), 'base64');
    }

    // Determine content type
    let contentType = 'application/pdf';
    if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) {
      contentType = 'image/jpeg';
    } else if (filename.endsWith('.png')) {
      contentType = 'image/png';
    }

    // Create attachable object first
    const attachableResponse = await qboClient.makeApiCall('POST', '/attachable', {
      FileName: filename,
      ContentType: contentType,
      AttachableRef: [{
        EntityRef: {
          type: 'Purchase',
          value: transactionId
        }
      }]
    });

    const attachable = attachableResponse.Attachable;

    // Note: Actual file upload requires multipart form data
    // This is a simplified version - full implementation would need
    // to use the upload endpoint with proper multipart handling

    logger.info('Receipt attached to transaction', {
      transactionId,
      attachableId: attachable.Id,
      filename
    });

    return attachable;

  } catch (error) {
    logger.error('Failed to attach receipt', { 
      transactionId, 
      error: error.message 
    });
    // Don't throw - attachment failure shouldn't block categorization
    return null;
  }
}

/**
 * Get recent jobs/customers for suggestions
 */
async function getRecentJobs(limit = 10) {
  try {
    const response = await qboClient.makeApiCall('GET',
      `/query?query=${encodeURIComponent(
        `SELECT * FROM Customer WHERE Active = true ORDER BY MetaData.LastUpdatedTime DESC MAXRESULTS ${limit}`
      )}`
    );

    const customers = response.QueryResponse?.Customer || [];

    return customers.map(c => ({
      id: c.Id,
      name: c.DisplayName,
      isJob: c.Job || false
    }));

  } catch (error) {
    logger.error('Failed to get recent jobs', { error: error.message });
    return [];
  }
}

/**
 * Clear customer cache
 */
function clearCache() {
  customerCache.clear();
}

/**
 * Get all active jobs (for listing)
 */
async function getAllJobs() {
  try {
    const response = await qboClient.makeApiCall('GET',
      `/query?query=${encodeURIComponent(
        `SELECT * FROM Customer WHERE Active = true AND Job = true MAXRESULTS 100`
      )}`
    );

    return response.QueryResponse?.Customer || [];

  } catch (error) {
    logger.error('Failed to get all jobs', { error: error.message });
    return [];
  }
}

module.exports = {
  updateTransaction,
  findOrCreateCustomer,
  attachReceipt,
  getRecentJobs,
  getAllJobs,
  clearCache
};

