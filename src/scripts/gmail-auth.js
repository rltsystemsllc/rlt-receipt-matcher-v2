/**
 * Gmail OAuth Setup Script
 * Run this to set up Gmail authentication from command line
 */

require('dotenv').config();

const readline = require('readline');
const { client } = require('../services/gmail');
const logger = require('../utils/logger');

async function main() {
  console.log('\n=== Gmail OAuth Setup ===\n');

  // Initialize client
  client.initialize();

  // Generate auth URL
  const authUrl = client.getAuthUrl();

  console.log('1. Open this URL in your browser:\n');
  console.log(authUrl);
  console.log('\n2. Sign in with the Gmail account you want to monitor for receipts');
  console.log('3. Grant the requested permissions');
  console.log('4. Copy the authorization code from the redirect URL\n');

  // Get code from user
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('Enter the authorization code: ', async (code) => {
    try {
      await client.handleCallback(code.trim());
      console.log('\n✓ Gmail authentication successful!');
      console.log('Tokens saved to ./tokens/gmail-token.json');
    } catch (error) {
      console.error('\n✗ Authentication failed:', error.message);
    }

    rl.close();
    process.exit(0);
  });
}

main().catch(console.error);


