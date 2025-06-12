#!/usr/bin/env node

require('dotenv').config();
const twilio = require('twilio');

// Configuration
const BASE_URL = 'https://sip-sentinel.vercel.app';
const PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

// Initialize Twilio client
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

async function updateWebhooks() {
  console.log('🔧 Updating Twilio webhook configuration...');
  console.log(`📱 Phone Number: ${PHONE_NUMBER}`);
  console.log(`🌐 Base URL: ${BASE_URL}`);
  
  if (!PHONE_NUMBER) {
    console.error('❌ TWILIO_PHONE_NUMBER environment variable not set');
    process.exit(1);
  }

  try {
    // Get the phone number resource
    const phoneNumbers = await client.incomingPhoneNumbers.list({
      phoneNumber: PHONE_NUMBER
    });

    if (phoneNumbers.length === 0) {
      console.error(`❌ Phone number ${PHONE_NUMBER} not found in your Twilio account`);
      process.exit(1);
    }

    const phoneNumberSid = phoneNumbers[0].sid;
    console.log(`📞 Found phone number SID: ${phoneNumberSid}`);

    // Update webhook URLs
    const updatedNumber = await client.incomingPhoneNumbers(phoneNumberSid)
      .update({
        voiceUrl: `${BASE_URL}/api/webhooks/voice`,
        voiceMethod: 'POST',
        smsUrl: `${BASE_URL}/api/webhooks/sms`,
        smsMethod: 'POST',
        // Remove statusCallback - it sends call status events, not recording events
        // Recording status is handled by the TwiML record action parameter
        statusCallback: '',  // Clear any existing status callback
        statusCallbackMethod: 'POST'
      });

    console.log('✅ Successfully updated webhook URLs:');
    console.log(`   Voice URL: ${updatedNumber.voiceUrl}`);
    console.log(`   SMS URL: ${updatedNumber.smsUrl}`);
    console.log(`   Status Callback: ${updatedNumber.statusCallback || 'Cleared (not needed)'}`);

    console.log('\n📋 Recording and transcription webhooks are configured in TwiML:');
    console.log(`   Recording Status: Handled by TwiML record action → /recording-status`);
    console.log(`   Transcription: Handled by TwiML transcribeCallback → /transcription`);
    
    console.log('\n🧪 Test your webhooks:');
    console.log(`   curl -X POST ${BASE_URL}/api/test-webhook`);
    console.log(`   Call your number: ${PHONE_NUMBER}`);

  } catch (error) {
    console.error('❌ Error updating webhooks:', error.message);
    
    if (error.code === 20003) {
      console.error('   Check your Twilio Account SID and Auth Token');
    } else if (error.code === 21608) {
      console.error('   Phone number not found or not owned by your account');
    }
    
    process.exit(1);
  }
}

// Show current webhook configuration
async function showCurrentConfig() {
  console.log('📋 Current webhook configuration:');
  
  try {
    const phoneNumbers = await client.incomingPhoneNumbers.list({
      phoneNumber: PHONE_NUMBER
    });

    if (phoneNumbers.length > 0) {
      const number = phoneNumbers[0];
      console.log(`   Voice URL: ${number.voiceUrl || 'Not set'}`);
      console.log(`   SMS URL: ${number.smsUrl || 'Not set'}`);
      console.log(`   Status Callback: ${number.statusCallback || 'Not set'}`);
    } else {
      console.log('   Phone number not found');
    }
  } catch (error) {
    console.error('❌ Error fetching current config:', error.message);
  }
}

// Main execution
async function main() {
  const command = process.argv[2];
  
  if (command === '--show' || command === '-s') {
    await showCurrentConfig();
  } else if (command === '--help' || command === '-h') {
    console.log(`
🔧 Twilio Webhook Configuration Tool

Usage:
  node bin/update-twilio-webhooks.js [options]

Options:
  --show, -s     Show current webhook configuration
  --help, -h     Show this help message
  (no options)   Update webhooks to production URLs

Environment Variables Required:
  TWILIO_ACCOUNT_SID    Your Twilio Account SID
  TWILIO_AUTH_TOKEN     Your Twilio Auth Token  
  TWILIO_PHONE_NUMBER   Your Twilio phone number (e.g., +1234567890)

Examples:
  node bin/update-twilio-webhooks.js           # Update webhooks
  node bin/update-twilio-webhooks.js --show    # Show current config
`);
  } else {
    await showCurrentConfig();
    console.log('\n' + '='.repeat(50));
    await updateWebhooks();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { updateWebhooks, showCurrentConfig };
