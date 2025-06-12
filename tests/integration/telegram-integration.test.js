#!/usr/bin/env node

/**
 * Integration tests for Telegram functionality
 * Consolidated from: test/telegram-test.js, test/telegram-upload-fix-test.js, 
 * test/debug-telegram-upload.js, and other Telegram-related tests
 */

require('dotenv').config();

const {
  WEBHOOK_EVENTS,
  getTelegramConfig,
  sendTelegramNotification
} = require('../../src/webhook-service');

/**
 * Test Telegram configuration
 */
async function testTelegramConfiguration() {
  console.log('⚙️ Testing Telegram Configuration...\n');

  const telegramConfig = getTelegramConfig();
  
  if (!telegramConfig) {
    console.log('❌ Telegram not configured');
    console.log('Please set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in your .env file');
    console.log('\nTo configure Telegram:');
    console.log('1. Message @BotFather on Telegram and create a bot');
    console.log('2. Get your chat ID by messaging your bot and visiting:');
    console.log('   https://api.telegram.org/bot<TOKEN>/getUpdates');
    console.log('3. Add to .env:');
    console.log('   TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz');
    console.log('   TELEGRAM_CHAT_ID=-1001234567890');
    return false;
  }

  console.log('✅ Telegram configuration found');
  console.log(`   Bot Token: ${telegramConfig.botToken ? 'SET' : 'MISSING'}`);
  console.log(`   Chat ID: ${telegramConfig.chatId ? 'SET' : 'MISSING'}`);
  
  return true;
}

/**
 * Test different notification types
 */
async function testTelegramNotifications() {
  console.log('📱 Testing Telegram Notifications...\n');

  const testCases = [
    {
      event: WEBHOOK_EVENTS.SCAM_DETECTED,
      data: {
        company: 'Coinbase',
        scamType: 'crypto_exchange',
        confidence: 85,
        phoneNumber: '+12345678901'
      },
      description: 'Scam Detection'
    },
    {
      event: WEBHOOK_EVENTS.AGENT_CALL_INITIATED,
      data: {
        callId: 'test_call_' + Date.now(),
        agentName: 'Coinbase Jim',
        company: 'Coinbase',
        phoneNumber: '+12345678901',
        scamType: 'crypto_exchange'
      },
      description: 'Agent Call Initiated'
    },
    {
      event: WEBHOOK_EVENTS.AGENT_CALL_STARTED,
      data: {
        callId: 'test_call_' + Date.now(),
        agentName: 'Coinbase Jim',
        duration: 'Just started'
      },
      description: 'Agent Call Started'
    },
    {
      event: WEBHOOK_EVENTS.AGENT_CALL_ENDED,
      data: {
        callId: 'test_call_' + Date.now(),
        agentName: 'Coinbase Jim',
        company: 'Coinbase',
        duration: 480, // 8 minutes - successful call
        successful: true
      },
      description: 'Agent Call Ended (Success)'
    },
    {
      event: WEBHOOK_EVENTS.AGENT_CALL_FAILED,
      data: {
        callId: 'test_call_' + Date.now(),
        agentName: 'Microsoft Support',
        company: 'Microsoft',
        phoneNumber: '+12345678901',
        reason: 'busy'
      },
      description: 'Agent Call Failed'
    }
  ];

  let passed = 0;
  let total = testCases.length;

  for (const testCase of testCases) {
    console.log(`Testing: ${testCase.description}`);
    
    try {
      const result = await sendTelegramNotification(testCase.event, testCase.data);
      
      if (result.success) {
        console.log(`✅ ${testCase.description} - Sent successfully`);
        if (result.audioSent) {
          console.log('   🎧 Audio attachment included');
        }
        passed++;
      } else {
        console.log(`❌ ${testCase.description} - Failed: ${result.error || result.reason}`);
      }
    } catch (error) {
      console.log(`❌ ${testCase.description} - Error: ${error.message}`);
    }
    
    // Wait a bit between messages to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\n📊 Notification Results: ${passed}/${total} tests passed\n`);
  return passed === total;
}

/**
 * Test Telegram upload functionality with call tracker cleanup
 */
async function testTelegramUploadCleanup() {
  console.log('🧹 Testing Telegram Upload Cleanup...\n');

  try {
    const { handleTelegramUploadTask } = require('../../api/queue-worker');
    const { callTracker } = require('../../src/vapi-service');

    // Use a test call ID
    const testCallId = 'test-cleanup-' + Date.now();
    
    console.log(`📋 Test Setup:`);
    console.log(`   Call ID: ${testCallId}`);
    console.log(`   Initial tracker size: ${callTracker.size}`);
    
    // Add the call to the tracker to simulate the webhook adding it
    callTracker.set(testCallId, {
      callId: testCallId,
      status: 'completed',
      telegramUploadQueued: true,
      timestamp: new Date().toISOString()
    });
    
    console.log(`   Tracker size after adding test call: ${callTracker.size}`);
    console.log(`   Call exists in tracker: ${callTracker.has(testCallId)}`);

    console.log(`\n🚀 Running Telegram upload task...`);
    
    // Mock modules object for the test
    const modules = {
      vapiService: require('../../src/vapi-service'),
      webhookService: require('../../src/webhook-service'),
      qstashService: require('../../src/qstash-service')
    };

    await handleTelegramUploadTask({ callId: testCallId }, modules);
    
    console.log(`\n✅ Telegram upload task completed!`);
    console.log(`   Final tracker size: ${callTracker.size}`);
    console.log(`   Call still exists in tracker: ${callTracker.has(testCallId)}`);
    
    if (!callTracker.has(testCallId)) {
      console.log(`🎉 SUCCESS: Call was properly removed from tracker after upload!`);
      return true;
    } else {
      console.log(`❌ ISSUE: Call is still in tracker - cleanup may have failed`);
      return false;
    }
    
  } catch (error) {
    console.log(`❌ Telegram upload cleanup test failed: ${error.message}`);
    return false;
  }
}

/**
 * Run all Telegram integration tests
 */
async function runTelegramIntegrationTests() {
  console.log('🧪 Running Telegram Integration Tests...\n');
  console.log('=' .repeat(60));
  
  const configOk = await testTelegramConfiguration();
  
  if (!configOk) {
    console.log('❌ Telegram not configured - skipping notification tests');
    return false;
  }
  
  const results = {
    notifications: await testTelegramNotifications(),
    uploadCleanup: await testTelegramUploadCleanup()
  };
  
  console.log('=' .repeat(60));
  console.log('📊 Final Results:');
  console.log(`   Configuration: ${configOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Notifications: ${results.notifications ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Upload Cleanup: ${results.uploadCleanup ? '✅ PASS' : '❌ FAIL'}`);
  
  const allPassed = configOk && Object.values(results).every(result => result);
  console.log(`\n🎯 Overall: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  
  if (allPassed) {
    console.log('\n🎉 Telegram integration is working correctly!');
    console.log('Check your Telegram chat for the test messages.');
  }
  
  return allPassed;
}

// Run tests if this script is executed directly
if (require.main === module) {
  runTelegramIntegrationTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('💥 Test runner crashed:', error);
      process.exit(1);
    });
}

module.exports = {
  runTelegramIntegrationTests,
  testTelegramConfiguration,
  testTelegramNotifications,
  testTelegramUploadCleanup
};
