#!/usr/bin/env node

/**
 * Test script for Telegram webhook integration
 * Tests the Telegram notification functionality without requiring a full server setup
 */

require('dotenv').config();

const {
  WEBHOOK_EVENTS,
  getTelegramConfig,
  sendTelegramNotification
} = require('../src/webhook-service');

async function testTelegramIntegration() {
  console.log('🧪 Testing Telegram Integration...\n');

  // Check if Telegram is configured
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
    return;
  }

  console.log('✅ Telegram configuration found');
  console.log(`Bot Token: ${telegramConfig.botToken.substring(0, 10)}...`);
  console.log(`Chat ID: ${telegramConfig.chatId}`);
  console.log('');

  // Test different notification types
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
      event: WEBHOOK_EVENTS.AGENT_CALL_ENDED,
      data: {
        callId: 'test_call_' + Date.now(),
        agentName: 'Kraken Support',
        company: 'Kraken',
        duration: 120, // 2 minutes - short call
        successful: false
      },
      description: 'Agent Call Ended (Short)'
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

  console.log('📱 Sending test notifications...\n');

  for (const testCase of testCases) {
    console.log(`Testing: ${testCase.description}`);
    
    try {
      const result = await sendTelegramNotification(testCase.event, testCase.data);
      
      if (result.success) {
        console.log(`✅ ${testCase.description} - Sent successfully`);
        if (result.audioSent) {
          console.log('   🎧 Audio attachment included');
        }
      } else {
        console.log(`❌ ${testCase.description} - Failed: ${result.error || result.reason}`);
      }
    } catch (error) {
      console.log(`❌ ${testCase.description} - Error: ${error.message}`);
    }
    
    // Wait a bit between messages to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n🎉 Telegram integration test completed!');
  console.log('\nCheck your Telegram chat for the test messages.');
  console.log('If you received all messages, the integration is working correctly.');
}

// Run the test
if (require.main === module) {
  testTelegramIntegration().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}

module.exports = { testTelegramIntegration };
