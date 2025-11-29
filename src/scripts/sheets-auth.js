/**
 * Google Sheets OAuth Setup Script
 * Run this to set up Google Sheets authentication for Bot 2
 */

require('dotenv').config();

const readline = require('readline');
const { google } = require('googleapis');
const fs = require('fs').promises;
const config = require('../config');

async function main() {
  console.log('\n=== Google Sheets OAuth Setup (Bot 2) ===\n');

  // Check for required config
  if (!config.gmail.clientId || !config.gmail.clientSecret) {
    console.error('❌ Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET in .env');
    console.log('   (Sheets auth uses the same Google OAuth credentials as Gmail)');
    process.exit(1);
  }

  // Create OAuth client
  const oauth2Client = new google.auth.OAuth2(
    config.gmail.clientId,
    config.gmail.clientSecret,
    'http://localhost:3000/auth/sheets/callback'
  );

  // Generate auth URL with Sheets scopes
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly'
    ],
    prompt: 'consent'
  });

  console.log('1. Open this URL in your browser:\n');
  console.log(authUrl);
  console.log('\n2. Sign in with the Google account that has access to your Daily Job Log');
  console.log('3. Grant the requested permissions');
  console.log('4. You\'ll be redirected - copy the "code" parameter from the URL\n');
  console.log('   Example: http://localhost:3000/auth/sheets/callback?code=4/0ABC...xyz');
  console.log('   Copy everything after "code=" until the next "&" or end of URL\n');

  // Get code from user
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('Enter the authorization code: ', async (code) => {
    try {
      // Exchange code for tokens
      const { tokens } = await oauth2Client.getToken(code.trim());
      
      // Save tokens
      await fs.writeFile(
        config.sheets.tokenPath,
        JSON.stringify(tokens, null, 2)
      );

      console.log('\n✅ Google Sheets authentication successful!');
      console.log(`   Tokens saved to ${config.sheets.tokenPath}`);
      console.log('\n   Now run: npm run test:sheets');

    } catch (error) {
      console.error('\n❌ Authentication failed:', error.message);
      
      if (error.message.includes('invalid_grant')) {
        console.log('\n   The code may have expired or already been used.');
        console.log('   Please run this script again and use a fresh code.');
      }
    }

    rl.close();
    process.exit(0);
  });
}

main().catch(console.error);

