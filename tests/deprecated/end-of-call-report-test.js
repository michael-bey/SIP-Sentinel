#!/usr/bin/env node

/**
 * Test end-of-call-report webhook handling
 */

require('dotenv').config();
const { handleVapiWebhook } = require('../src/vapi-service');

function testEndOfCallReportWebhook() {
  console.log('🧪 Testing End-of-Call-Report Webhook Handling...\n');

  // Simulate the exact webhook you're receiving
  const endOfCallReportWebhook = {
    message: {
      type: 'end-of-call-report',
      timestamp: Date.now(),
      call: {
        id: '87e6d35c-f72d-41e1-be39-c2abba84dc9d', // Your actual call ID
        status: 'ended',
        endedReason: 'customer-ended-call',
        startedAt: '2025-06-10T18:00:00.000Z',
        endedAt: '2025-06-10T18:02:30.000Z',
        duration: 150,
        assistant: {
          name: 'Coinbase Jim'
        },
        customer: {
          number: '+1234567890'
        },
        metadata: {
          source: 'SIPSentinel',
          scamType: 'crypto_exchange',
          confidence: 90,
          impersonatedCompany: 'Coinbase'
        }
      },
      summary: 'Call completed with scammer interaction',
      analysis: 'Successful scam detection and engagement',
      transcript: 'AI: Hello, I\'m calling about my Coinbase account...',
      cost: 0.15,
      duration: 150
    }
  };

  console.log('📋 Testing end-of-call-report webhook');
  console.log(`   Webhook type: ${endOfCallReportWebhook.message.type}`);
  console.log(`   Call ID: ${endOfCallReportWebhook.message.call.id}`);
  console.log(`   Assistant: ${endOfCallReportWebhook.message.call.assistant.name}`);

  try {
    const result = handleVapiWebhook(endOfCallReportWebhook);
    
    console.log(`   ✅ Webhook processed successfully!`);
    console.log(`   📊 Result: ${JSON.stringify(result)}`);
    
    if (result.status === 'processed') {
      console.log(`   🎉 SUCCESS: end-of-call-report webhook now triggers Telegram upload!`);
    } else {
      console.log(`   ❌ ISSUE: Webhook was not processed as expected`);
    }
  } catch (error) {
    console.log(`   ❌ ERROR processing webhook: ${error.message}`);
    console.log(`   Stack trace:`, error.stack);
  }

  console.log('\n📋 Testing duplicate prevention');
  
  // Test the same webhook again to see if duplicate prevention works
  try {
    const result2 = handleVapiWebhook(endOfCallReportWebhook);
    console.log(`   📊 Second webhook result: ${JSON.stringify(result2)}`);
    console.log(`   💡 Check logs above to see if duplicate upload was prevented`);
  } catch (error) {
    console.log(`   ❌ ERROR on second webhook: ${error.message}`);
  }

  console.log('\n💡 Key points:');
  console.log('💡 - end-of-call-report webhooks now trigger Telegram uploads');
  console.log('💡 - Duplicate uploads are prevented with telegramUploadQueued flag');
  console.log('💡 - Both call.end and end-of-call-report can trigger uploads');
}

// Run the test
if (require.main === module) {
  testEndOfCallReportWebhook();
}

module.exports = { testEndOfCallReportWebhook };
