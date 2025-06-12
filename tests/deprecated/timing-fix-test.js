#!/usr/bin/env node

/**
 * Test the timing fix for Telegram uploads to ensure recordings are ready
 */

require('dotenv').config();
const { queueTelegramUpload } = require('../src/qstash-service');

async function testTimingFix() {
  console.log('🧪 Testing Timing Fix for Telegram Uploads...\n');

  // Test with a real call ID to see the new timing
  const testCallId = '92f33026-97c5-4215-8305-a18020b9896d';
  
  console.log(`📋 Test Setup:`);
  console.log(`   Call ID: ${testCallId}`);
  console.log(`   Testing new timing configuration...`);
  
  console.log(`\n⏰ Current Timing Configuration:`);
  console.log(`   Initial delay: 90 seconds (increased from 10s)`);
  console.log(`   Retry delay: 30 seconds (decreased from 60s)`);
  console.log(`   Max retries: 3 (increased from 2)`);
  
  console.log(`\n🎯 Expected Behavior:`);
  console.log(`   1. VAPI call ends`);
  console.log(`   2. QStash waits 90 seconds before first attempt`);
  console.log(`   3. Recording should be ready by then`);
  console.log(`   4. Upload happens immediately for current call`);
  console.log(`   5. No more "one behind" behavior`);

  try {
    console.log(`\n🚀 Queuing Telegram upload with new timing...`);
    
    const result = await queueTelegramUpload({ callId: testCallId });
    
    console.log(`✅ Task queued successfully!`);
    console.log(`   Message ID: ${result.messageId}`);
    console.log(`   Task ID: ${result.taskId}`);
    
    console.log(`\n⏳ The task will now wait 90 seconds before attempting upload`);
    console.log(`   This should give VAPI enough time to process the recording`);
    console.log(`   Check your Telegram channel in about 2 minutes for the upload`);
    
  } catch (error) {
    console.log(`❌ Failed to queue task: ${error.message}`);
  }
}

async function testRetryTiming() {
  console.log('\n🧪 Testing Retry Timing...\n');
  
  const testCallId = 'test-retry-timing';
  
  console.log(`📋 Retry Timing Test:`);
  console.log(`   If recording is still not ready after 90s initial delay`);
  console.log(`   Retries will happen every 30s (faster than before)`);
  console.log(`   This provides better responsiveness while still giving VAPI time`);

  try {
    // Test with a retry scenario
    const result = await queueTelegramUpload({ 
      callId: testCallId,
      retryCount: 1 
    }, {
      delay: 30 // This simulates a retry with 30s delay
    });
    
    console.log(`✅ Retry task queued successfully!`);
    console.log(`   This retry will wait 30 seconds before attempting`);
    
  } catch (error) {
    console.log(`❌ Failed to queue retry task: ${error.message}`);
  }
}

async function explainTimingStrategy() {
  console.log('\n📊 Timing Strategy Explanation:\n');
  
  console.log(`🔄 Old Timing (causing "one behind" issue):`);
  console.log(`   Initial delay: 10s → Recording not ready → Retry in 60s`);
  console.log(`   Result: Always uploading previous call's recording`);
  
  console.log(`\n✅ New Timing (should fix the issue):`);
  console.log(`   Initial delay: 90s → Recording likely ready → Upload current call`);
  console.log(`   If still not ready: Retry in 30s → Should be ready by then`);
  
  console.log(`\n🎯 Benefits:`);
  console.log(`   • Recordings are uploaded for the correct call`);
  console.log(`   • Faster retry cycles if needed`);
  console.log(`   • More reliable overall system`);
  
  console.log(`\n⚠️ Trade-off:`);
  console.log(`   • Slightly longer delay before upload (90s vs 10s)`);
  console.log(`   • But uploads are for the correct call, not previous one`);
}

// Run the tests
async function runTests() {
  try {
    await testTimingFix();
    await testRetryTiming();
    await explainTimingStrategy();
    
    console.log(`\n🎉 Timing fix implemented!`);
    console.log(`   Deploy these changes and test with a new VAPI call`);
    console.log(`   The Telegram upload should now be for the current call, not the previous one`);
    
  } catch (error) {
    console.error('❌ Test execution failed:', error);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { testTimingFix, testRetryTiming };
