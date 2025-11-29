/**
 * Test RingCentral SMS - Bot 2
 * Sends a test message to Jessica and Bobby
 */

require('dotenv').config();

const RC = require('@ringcentral/sdk').SDK;

async function testSMS() {
  console.log('🚀 Testing RingCentral SMS for Bot 2...\n');

  // Check environment variables
  const requiredVars = [
    'RINGCENTRAL_CLIENT_ID',
    'RINGCENTRAL_CLIENT_SECRET', 
    'RINGCENTRAL_SERVER',
    'RINGCENTRAL_JWT_TOKEN',
    'RINGCENTRAL_BOT_PHONE',
    'JESSICA_PHONE',
    'BOBBY_PHONE'
  ];

  const missing = requiredVars.filter(v => !process.env[v]);
  if (missing.length > 0) {
    console.error('❌ Missing environment variables:', missing.join(', '));
    process.exit(1);
  }

  console.log('✅ All environment variables found');
  console.log(`   Bot Phone: ${process.env.RINGCENTRAL_BOT_PHONE}`);
  console.log(`   Jessica: ${process.env.JESSICA_PHONE}`);
  console.log(`   Bobby: ${process.env.BOBBY_PHONE}`);
  console.log('');

  // Initialize RingCentral SDK
  const rcsdk = new RC({
    server: process.env.RINGCENTRAL_SERVER,
    clientId: process.env.RINGCENTRAL_CLIENT_ID,
    clientSecret: process.env.RINGCENTRAL_CLIENT_SECRET
  });

  try {
    // Login with JWT
    console.log('🔐 Authenticating with RingCentral...');
    await rcsdk.login({ jwt: process.env.RINGCENTRAL_JWT_TOKEN });
    console.log('✅ Authentication successful!\n');

    // Send test SMS
    console.log('📱 Sending test SMS...');
    
    const response = await rcsdk.platform().post('/restapi/v1.0/account/~/extension/~/sms', {
      from: { phoneNumber: process.env.RINGCENTRAL_BOT_PHONE },
      to: [
        { phoneNumber: process.env.JESSICA_PHONE },
        { phoneNumber: process.env.BOBBY_PHONE }
      ],
      text: '🤖 RLT Bot 2 Test: This is a test message from the Billing Bot. If you received this, SMS notifications are working! Reply STOP to opt out.'
    });

    const data = await response.json();
    console.log('✅ SMS sent successfully!');
    console.log(`   Message ID: ${data.id}`);
    console.log(`   Status: ${data.messageStatus}`);
    console.log(`   To: Jessica & Bobby`);
    console.log('');
    console.log('🎉 RingCentral SMS test PASSED!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      const errorData = await error.response.json();
      console.error('   Details:', JSON.stringify(errorData, null, 2));
    }
    process.exit(1);
  } finally {
    // Logout
    try {
      await rcsdk.logout();
    } catch (e) {
      // Ignore logout errors
    }
  }
}

testSMS();
