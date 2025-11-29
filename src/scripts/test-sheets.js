/**
 * Test Google Sheets Connection for Bot 2
 * Verifies Sheets authentication and reads from the Daily Job Log
 */

require('dotenv').config();

const sheetsService = require('../bot2/sheets');
const config = require('../config');

async function main() {
  console.log('\n🧪 Testing Google Sheets Connection for Bot 2\n');

  // Check config
  console.log('📋 Configuration:');
  console.log(`   Spreadsheet ID: ${config.sheets.spreadsheetId ? '***configured***' : '❌ NOT SET'}`);
  console.log(`   Sheet Name: ${config.sheets.sheetName || 'Daily Job Log'}`);
  console.log('');

  if (!config.sheets.spreadsheetId) {
    console.error('❌ GOOGLE_SHEET_ID is not set in .env');
    console.log('\nTo fix:');
    console.log('1. Open your Daily Job Log spreadsheet in Google Sheets');
    console.log('2. Copy the ID from the URL: https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit');
    console.log('3. Add to .env: GOOGLE_SHEET_ID=your_spreadsheet_id');
    process.exit(1);
  }

  // Try to initialize
  console.log('🔐 Authenticating with Google Sheets...');
  
  try {
    const client = await sheetsService.initialize();
    
    if (!client) {
      console.error('❌ Google Sheets not authenticated');
      console.log('\nTo authenticate:');
      console.log('1. Run: npm run auth:sheets');
      console.log('2. Or visit: http://localhost:3000/auth/sheets');
      process.exit(1);
    }

    console.log('✅ Google Sheets authenticated!\n');

    // Try to read from the sheet
    console.log('📖 Reading from Daily Job Log...');
    
    const rows = await sheetsService.getAllRows();
    console.log(`✅ Found ${rows.length} rows in the sheet\n`);

    if (rows.length > 0) {
      // Show last 5 rows
      console.log('📋 Last 5 entries:');
      console.log('-'.repeat(80));
      
      const lastRows = rows.slice(-5);
      for (const row of lastRows) {
        console.log(`   ${row.date || 'No date'} | ${row.jobName || 'No job'} | ${row.hoursWorked}h | ${row.billingStatus || 'Not billed'}`);
      }
      console.log('-'.repeat(80));
    }

    // Check for urgent billing
    console.log('\n🔍 Checking for urgent billing requests...');
    const urgentRows = await sheetsService.getUrgentBillingRows();
    
    if (urgentRows.length > 0) {
      console.log(`⚠️  Found ${urgentRows.length} urgent billing request(s):`);
      for (const row of urgentRows) {
        console.log(`   - ${row.jobName}: ${row.hoursWorked}h (${row.descriptionOfWork?.substring(0, 40)}...)`);
      }
    } else {
      console.log('✅ No urgent billing requests pending');
    }

    // Get unique job names
    console.log('\n📁 Active Jobs:');
    const jobNames = await sheetsService.getUniqueJobNames();
    if (jobNames.length > 0) {
      jobNames.slice(0, 10).forEach(job => console.log(`   - ${job}`));
      if (jobNames.length > 10) {
        console.log(`   ... and ${jobNames.length - 10} more`);
      }
    } else {
      console.log('   No jobs found');
    }

    console.log('\n🎉 Google Sheets test PASSED!\n');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error.message);
    
    if (error.message.includes('invalid_grant') || error.message.includes('Token')) {
      console.log('\n🔄 Token may be expired. Re-authenticate:');
      console.log('   npm run auth:sheets');
    }
    
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});

