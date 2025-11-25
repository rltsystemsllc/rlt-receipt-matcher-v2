/**
 * Test QuickBooks Connection
 * Verifies QuickBooks authentication and lists accounts/vendors
 */

require('dotenv').config();

const { client, matcher } = require('../services/quickbooks');
const logger = require('../utils/logger');

async function main() {
  console.log('\n=== Testing QuickBooks Connection ===\n');

  // Authenticate
  console.log('Authenticating...');
  const authenticated = await client.authenticate();

  if (!authenticated) {
    console.error('✗ QuickBooks not authenticated. Run: npm run auth:quickbooks');
    process.exit(1);
  }

  console.log('✓ QuickBooks authenticated');
  console.log('Company ID:', client.getCompanyId());

  // Test API call - Get company info
  console.log('\n--- Company Info ---\n');

  try {
    const response = await client.makeApiCall('GET', '/companyinfo/' + client.getCompanyId());
    const info = response.CompanyInfo;
    console.log('Company Name:', info.CompanyName);
    console.log('Legal Name:', info.LegalName);
    console.log('Email:', info.Email?.Address);
  } catch (error) {
    console.error('Failed to get company info:', error.message);
  }

  // List vendors
  console.log('\n--- Vendors ---\n');

  try {
    const response = await client.makeApiCall('GET', '/query?query=SELECT * FROM Vendor MAXRESULTS 10');
    const vendors = response.QueryResponse?.Vendor || [];

    if (vendors.length === 0) {
      console.log('No vendors found.');
    } else {
      for (const vendor of vendors) {
        console.log(`- ${vendor.DisplayName} (ID: ${vendor.Id})`);
      }
    }
  } catch (error) {
    console.error('Failed to list vendors:', error.message);
  }

  // List expense accounts
  console.log('\n--- Expense Accounts ---\n');

  try {
    const response = await client.makeApiCall('GET', 
      '/query?query=' + encodeURIComponent("SELECT * FROM Account WHERE AccountType = 'Expense' MAXRESULTS 10"));
    const accounts = response.QueryResponse?.Account || [];

    if (accounts.length === 0) {
      console.log('No expense accounts found.');
    } else {
      for (const account of accounts) {
        console.log(`- ${account.Name} (ID: ${account.Id})`);
      }
    }
  } catch (error) {
    console.error('Failed to list accounts:', error.message);
  }

  // List customers/projects
  console.log('\n--- Customers/Projects ---\n');

  try {
    const response = await client.makeApiCall('GET', '/query?query=SELECT * FROM Customer MAXRESULTS 10');
    const customers = response.QueryResponse?.Customer || [];

    if (customers.length === 0) {
      console.log('No customers found.');
    } else {
      for (const customer of customers) {
        console.log(`- ${customer.DisplayName} (ID: ${customer.Id})`);
      }
    }
  } catch (error) {
    console.error('Failed to list customers:', error.message);
  }

  console.log('\n✓ Test complete');
  process.exit(0);
}

main().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});


