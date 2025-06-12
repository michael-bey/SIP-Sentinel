#!/usr/bin/env node

/**
 * Test the complete end-to-end flow from VAPI webhook to Telegram upload
 */

require('dotenv').config();
const { handleVapiWebhook } = require('../src/vapi-service');
const { handleTelegramUploadTask } = require('../api/queue-worker');

async function testEndToEndFlow() {
  console.log('🧪 Testing End-to-End Flow: VAPI Webhook → Telegram Upload...\n');

  // Simulate a real VAPI call.end webhook using data from our recent calls
  const mockCallEndWebhook = {
    message: {
      type: 'call.end',
      timestamp: Date.now(),
      call: {
        id: 'd08f8e91-92b6-4793-8b45-dc42225c042b', // Real call ID from our test
        status: 'ended',
        endedReason: 'customer-ended-call',
        startedAt: '2025-06-10T17:46:04.871Z',
        endedAt: '2025-06-10T17:47:00.357Z',
        duration: 55.486,
        assistant: {
          name: 'Coinbase Jim'
        },
        customer: {
          number: '+14403189164'
        },
        metadata: {
          source: 'SIPSentinel',
          scamType: 'crypto_exchange',
          confidence: 90,
          impersonatedCompany: 'Coinbase'
        }
      }
    }
  };

  console.log('📋 Step 1: Processing VAPI webhook');
  console.log(`   Webhook type: ${mockCallEndWebhook.message.type}`);
  console.log(`   Call ID: ${mockCallEndWebhook.message.call.id}`);
  console.log(`   Assistant: ${mockCallEndWebhook.message.call.assistant.name}`);

  try {
    const webhookResult = handleVapiWebhook(mockCallEndWebhook);
    console.log(`   ✅ Webhook processed: ${JSON.stringify(webhookResult)}`);
  } catch (error) {
    console.log(`   ❌ Webhook processing failed: ${error.message}`);
    return;
  }

  console.log('\n📋 Step 2: Simulating Telegram upload task');
  console.log(`   Task data: { callId: "${mockCallEndWebhook.message.call.id}" }`);

  try {
    // This should fetch the real VAPI call data and attempt Telegram upload
    await handleTelegramUploadTask({
      callId: mockCallEndWebhook.message.call.id
    });
    
    console.log(`   ✅ Telegram upload task completed`);
  } catch (error) {
    console.log(`   ❌ Telegram upload task failed: ${error.message}`);
    console.log(`   Stack trace:`, error.stack);
  }

  console.log('\n📋 Step 3: Testing with a different call ID');
  
  const secondCallId = 'ebb3a166-06a8-4397-944d-2948abc419ca';
  console.log(`   Call ID: ${secondCallId}`);

  try {
    await handleTelegramUploadTask({
      callId: secondCallId
    });
    
    console.log(`   ✅ Second Telegram upload task completed`);
  } catch (error) {
    console.log(`   ❌ Second Telegram upload task failed: ${error.message}`);
  }
}

// Run the test
if (require.main === module) {
  testEndToEndFlow()
    .then(() => {
      console.log('\n🏁 End-to-end test completed');
    })
    .catch(error => {
      console.error('\n❌ End-to-end test failed:', error);
    });
}

module.exports = { testEndToEndFlow };
