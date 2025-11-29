/**
 * Test Gmail Connection
 * Verifies Gmail authentication and lists recent receipt emails
 */

require('dotenv').config();

const { client, fetcher } = require('../services/gmail');
const logger = require('../utils/logger');

async function main() {
  console.log('\n=== Testing Gmail Connection ===\n');

  // Authenticate
  console.log('Authenticating...');
  const authenticated = await client.authenticate();

  if (!authenticated) {
    console.error('✗ Gmail not authenticated. Run: npm run auth:gmail');
    process.exit(1);
  }

  console.log('✓ Gmail authenticated\n');

  // Get profile
  try {
    const profile = await client.getProfile();
    console.log('Email:', profile.emailAddress);
    console.log('Messages:', profile.messagesTotal);
    console.log('Threads:', profile.threadsTotal);
  } catch (error) {
    console.error('Failed to get profile:', error.message);
  }

  // Fetch recent receipt emails
  console.log('\n--- Recent Receipt Emails ---\n');

  try {
    const emails = await fetcher.fetchUnreadReceipts(10);

    if (emails.length === 0) {
      console.log('No unread receipt emails found.');
    } else {
      for (const email of emails) {
        console.log(`From: ${email.from}`);
        console.log(`Subject: ${email.subject}`);
        console.log(`Date: ${email.date}`);
        console.log(`Vendor: ${email.vendor?.name || 'Unknown'}`);
        console.log(`Attachments: ${email.attachments.length}`);
        console.log('---');
      }
    }
  } catch (error) {
    console.error('Failed to fetch emails:', error.message);
  }

  console.log('\n✓ Test complete');
  process.exit(0);
}

main().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});




