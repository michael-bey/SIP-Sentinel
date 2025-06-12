#!/usr/bin/env node

/**
 * Debug script for Vercel deployment
 * Tests the actual deployed endpoints to identify issues
 */

// Note: Using built-in fetch in Node.js 18+, fallback to node-fetch if needed
const fetch = globalThis.fetch || require('node-fetch');

// Use your main production Vercel URL
const BASE_URL = 'https://sip-sentinel.vercel.app';

async function testVoiceWebhook() {
  console.log('🧪 Testing Voice Webhook...');
  
  try {
    const response = await fetch(`${BASE_URL}/voice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        CallSid: 'test-call-' + Date.now(),
        From: '+15551234567',
        To: '+17816787111',
        CallStatus: 'ringing'
      })
    });

    const responseText = await response.text();
    console.log('Voice webhook response status:', response.status);
    console.log('Voice webhook response:', responseText);

    if (responseText.includes('<Response>') && responseText.includes('<Record>')) {
      console.log('✅ Voice webhook returned valid TwiML with recording');
      return true;
    } else {
      console.log('❌ Voice webhook response invalid');
      return false;
    }
  } catch (error) {
    console.error('❌ Voice webhook test failed:', error.message);
    return false;
  }
}

async function testRecordingStatusWebhook() {
  console.log('\n🧪 Testing Recording Status Webhook...');
  
  try {
    // Test with proper recording completion data
    const response = await fetch(`${BASE_URL}/recording-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        RecordingSid: 'RE' + Date.now(),
        CallSid: 'CA' + Date.now(),
        RecordingStatus: 'completed',
        RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/test/Recordings/test.wav',
        RecordingDuration: '15',
        From: '+15551234567',
        To: '+17816787111'
      })
    });

    const responseText = await response.text();
    console.log('Recording status response status:', response.status);
    console.log('Recording status response:', responseText);

    if (response.status === 200) {
      console.log('✅ Recording status webhook accepted');
      return true;
    } else {
      console.log('❌ Recording status webhook failed');
      return false;
    }
  } catch (error) {
    console.error('❌ Recording status webhook test failed:', error.message);
    return false;
  }
}

async function testTranscriptionWebhook() {
  console.log('\n🧪 Testing Transcription Webhook...');
  
  try {
    // Test with scam-like transcription
    const response = await fetch(`${BASE_URL}/transcription`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        TranscriptionSid: 'TR' + Date.now(),
        CallSid: 'CA' + Date.now(),
        TranscriptionStatus: 'completed',
        TranscriptionText: 'Hello this is John from Coinbase security team. Your account has been compromised and we need to verify your identity. Please call us back at 555-123-4567 immediately.',
        RecordingSid: 'RE' + Date.now(),
        From: '+15551234567',
        To: '+17816787111'
      })
    });

    const responseText = await response.text();
    console.log('Transcription response status:', response.status);
    console.log('Transcription response:', responseText);

    if (response.status === 200) {
      console.log('✅ Transcription webhook accepted');
      return true;
    } else {
      console.log('❌ Transcription webhook failed');
      return false;
    }
  } catch (error) {
    console.error('❌ Transcription webhook test failed:', error.message);
    return false;
  }
}

async function testBasicEndpoints() {
  console.log('\n🧪 Testing Basic Endpoints...');
  
  const endpoints = [
    '/api/test',
    '/api/dashboard',
    '/api/live-updates'
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${BASE_URL}${endpoint}`);
      const data = await response.json();
      console.log(`${endpoint}: ${response.status} - ${data.success ? '✅' : '❌'}`);
    } catch (error) {
      console.log(`${endpoint}: ❌ Error - ${error.message}`);
    }
  }
}

async function runAllTests() {
  console.log('🚀 Starting Vercel Deployment Debug Tests...');
  console.log(`🌐 Testing URL: ${BASE_URL}\n`);

  const results = [];
  
  results.push(await testBasicEndpoints());
  results.push(await testVoiceWebhook());
  results.push(await testRecordingStatusWebhook());
  results.push(await testTranscriptionWebhook());

  console.log('\n📊 Test Summary:');
  console.log('================');
  
  // Wait a moment for any async processing
  console.log('\n⏳ Waiting 10 seconds for any background processing...');
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  console.log('✅ Debug tests completed');
  console.log('\n💡 Next steps:');
  console.log('1. Check Vercel function logs: vercel logs');
  console.log('2. Try calling your actual phone number: +17816787111');
  console.log('3. Monitor the logs during a real call');
}

if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = { testVoiceWebhook, testRecordingStatusWebhook, testTranscriptionWebhook };
