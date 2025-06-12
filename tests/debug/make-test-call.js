#!/usr/bin/env node

/**
 * Debug utility for making test calls
 * Moved from: make-test-call.js
 */

require('dotenv').config();
const { createVapiCall } = require('../../src/vapi-service');

async function makeTestCall() {
  console.log('📞 Making Test VAPI Call...\n');

  // Get phone number from command line or use default
  const targetPhone = process.argv[2] || '+12345678901';
  const scamType = process.argv[3] || 'crypto_exchange';
  const company = process.argv[4] || 'Coinbase';

  console.log('📋 Call Parameters:');
  console.log(`   Target Phone: ${targetPhone}`);
  console.log(`   Scam Type: ${scamType}`);
  console.log(`   Company: ${company}`);
  console.log('');

  try {
    const callResult = await createVapiCall({
      phoneNumber: targetPhone,
      scamType: scamType,
      llmAnalysis: {
        impersonatedCompany: company,
        confidence: 85
      }
    });

    if (callResult.success) {
      console.log('✅ Test call initiated successfully!');
      console.log(`   Call ID: ${callResult.callId}`);
      console.log(`   Agent: ${callResult.agentName}`);
      console.log(`   Phone Number Used: ${callResult.phoneNumber}`);
      
      console.log('\n📊 Call Details:');
      console.log(`   Assistant ID: ${callResult.assistantId}`);
      console.log(`   Customer Number: ${callResult.customerNumber}`);
      
      console.log('\n⏰ Monitor the call:');
      console.log('   - Check VAPI dashboard for call status');
      console.log('   - Watch for webhook notifications');
      console.log('   - Monitor Telegram for notifications');
      
    } else {
      console.log('❌ Test call failed:');
      console.log(`   Error: ${callResult.error}`);
      console.log(`   Details: ${callResult.details || 'No additional details'}`);
    }

  } catch (error) {
    console.error('💥 Error making test call:', error.message);
    console.log('\n🔧 Possible issues:');
    console.log('   - VAPI_API_KEY not set or invalid');
    console.log('   - No available phone numbers');
    console.log('   - Invalid target phone number');
    console.log('   - Network connectivity issues');
  }
}

// Usage information
function showUsage() {
  console.log('📞 VAPI Test Call Utility\n');
  console.log('Usage:');
  console.log('  node make-test-call.js [phone] [scamType] [company]\n');
  console.log('Parameters:');
  console.log('  phone     - Target phone number (default: +12345678901)');
  console.log('  scamType  - Type of scam (default: crypto_exchange)');
  console.log('  company   - Company being impersonated (default: Coinbase)\n');
  console.log('Examples:');
  console.log('  node make-test-call.js +15551234567');
  console.log('  node make-test-call.js +15551234567 crypto_exchange Kraken');
  console.log('  node make-test-call.js +15551234567 it_support Microsoft\n');
  console.log('Scam Types:');
  console.log('  - crypto_exchange (Coinbase, Kraken, Binance)');
  console.log('  - it_support (Microsoft, Apple, Google)');
  console.log('  - financial (Bank, Credit Card)');
}

// Run the test call if this script is executed directly
if (require.main === module) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    showUsage();
    process.exit(0);
  }

  makeTestCall().then(() => {
    console.log('\n✨ Test call process completed!');
    process.exit(0);
  }).catch(error => {
    console.error('\n💥 Test call process failed:', error);
    process.exit(1);
  });
}

module.exports = { makeTestCall, showUsage };
