#!/usr/bin/env node

/**
 * Test the direct fallback Telegram upload method
 */

require('dotenv').config();

async function testDirectFallback() {
  console.log('🧪 Testing Direct Fallback Telegram Upload...\n');

  // Simulate a QStash failure and trigger the direct fallback
  const testCallId = '9a559ac7-8138-4fef-9f79-18efa08695b5';

  console.log(`📋 Test: Direct fallback Telegram upload`);
  console.log(`   Call ID: ${testCallId}`);

  try {
    console.log(`   🚀 Simulating QStash failure and triggering direct fallback...`);
    
    // Import the handler function and call it directly (like the fallback does)
    const { handleTelegramUploadTask } = require('../api/queue-worker');
    
    console.log(`   📞 Calling handleTelegramUploadTask directly...`);
    await handleTelegramUploadTask({ callId: testCallId });
    
    console.log(`   ✅ Direct fallback Telegram upload completed successfully!`);
    console.log(`   📱 Check your Telegram channel for the audio message.`);
    
  } catch (error) {
    console.log(`   ❌ Direct fallback failed: ${error.message}`);
    console.log(`   📊 Error details:`, error.stack);
  }

  console.log(`   ${'─'.repeat(50)}`);
  
  console.log(`\n💡 This test bypasses QStash entirely and calls the upload function directly`);
  console.log(`💡 This is what happens when QStash fails and the fallback is triggered`);
  console.log(`💡 If this works, the issue is definitely with QStash, not the upload logic`);
  
  console.log(`\n🏁 Direct fallback test completed`);
}

if (require.main === module) {
  testDirectFallback().catch(console.error);
}

module.exports = { testDirectFallback };
