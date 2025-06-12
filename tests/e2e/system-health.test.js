#!/usr/bin/env node

/**
 * End-to-end system health tests
 * Consolidated from: test-fixes.js, test-enhanced-setup.js
 */

require('dotenv').config();

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/**
 * Test health endpoint
 */
async function testHealthEndpoint() {
  console.log('🏥 Testing Health Endpoint...\n');

  try {
    const response = await fetch(`${BASE_URL}/health`);
    const data = await response.json();

    console.log('✅ Health endpoint response:', {
      status: response.status,
      success: data.success,
      message: data.message,
      timestamp: data.timestamp
    });

    return response.ok && data.success;
  } catch (error) {
    console.error('❌ Health endpoint test failed:', error.message);
    return false;
  }
}

/**
 * Test dashboard endpoint
 */
async function testDashboardEndpoint() {
  console.log('📊 Testing Dashboard Endpoint...\n');

  try {
    const response = await fetch(`${BASE_URL}/dashboard`);
    
    if (response.ok) {
      const contentType = response.headers.get('content-type');
      console.log('✅ Dashboard endpoint accessible:', {
        status: response.status,
        contentType: contentType
      });
      return true;
    } else {
      console.log('❌ Dashboard endpoint failed:', response.status);
      return false;
    }
  } catch (error) {
    console.error('❌ Dashboard endpoint test failed:', error.message);
    return false;
  }
}

/**
 * Test live updates endpoint
 */
async function testLiveUpdatesEndpoint() {
  console.log('📡 Testing Live Updates Endpoint...\n');

  try {
    const response = await fetch(`${BASE_URL}/live-updates`);
    
    console.log('✅ Live updates response:', {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries())
    });

    return response.ok;
  } catch (error) {
    console.error('❌ Live updates endpoint test failed:', error.message);
    return false;
  }
}

/**
 * Test VAPI calls endpoint
 */
async function testVapiCallsEndpoint() {
  console.log('📞 Testing VAPI Calls Endpoint...\n');

  try {
    const response = await fetch(`${BASE_URL}/vapi-calls`);
    const data = await response.json();

    console.log('✅ VAPI calls response:', {
      status: response.status,
      hasData: !!data,
      dataType: Array.isArray(data) ? 'array' : typeof data
    });

    return response.ok;
  } catch (error) {
    console.error('❌ VAPI calls endpoint test failed:', error.message);
    return false;
  }
}

/**
 * Test scam detection function
 */
async function testScamDetectionFunction() {
  console.log('🔍 Testing Scam Detection Function...\n');

  try {
    const response = await fetch(`${BASE_URL}/test-detection`);
    const data = await response.json();

    console.log('✅ Scam detection response:', {
      success: data.success,
      hasRegexAnalysis: !!data.regexAnalysis,
      isScam: data.regexAnalysis?.isScam,
      scamType: data.regexAnalysis?.scamType,
      hasScamDetails: !!data.regexAnalysis?.scamDetails
    });

    // Validate that regexAnalysis has the expected structure
    const isValid = data.success &&
                   data.regexAnalysis &&
                   typeof data.regexAnalysis.isScam === 'boolean' &&
                   typeof data.regexAnalysis.scamDetails === 'object';

    return isValid;
  } catch (error) {
    console.error('❌ Scam detection test failed:', error.message);
    return false;
  }
}

/**
 * Test phone number validation
 */
async function testPhoneValidation() {
  console.log('📱 Testing Phone Number Validation...\n');

  const testCases = [
    { phone: '+1234567890', expected: true },
    { phone: '1234567890', expected: true },
    { phone: '+1-234-567-8900', expected: true },
    { phone: 'invalid', expected: false },
    { phone: '123', expected: false }
  ];

  let passed = 0;
  let total = testCases.length;

  for (const testCase of testCases) {
    try {
      const response = await fetch(`${BASE_URL}/validate-phone?phone=${encodeURIComponent(testCase.phone)}`);
      const data = await response.json();
      
      const isValid = data.valid === testCase.expected;
      
      if (isValid) {
        console.log(`✅ ${testCase.phone}: ${data.valid} (expected: ${testCase.expected})`);
        passed++;
      } else {
        console.log(`❌ ${testCase.phone}: ${data.valid} (expected: ${testCase.expected})`);
      }
    } catch (error) {
      console.log(`❌ Error testing ${testCase.phone}: ${error.message}`);
    }
  }

  console.log(`\n📊 Phone Validation Results: ${passed}/${total} tests passed\n`);
  return passed === total;
}

/**
 * Simulate incoming call webhook
 */
async function simulateIncomingCall() {
  console.log('📞 Testing Voice Webhook Simulation...\n');

  const webhookData = {
    CallSid: 'test_call_' + Date.now(),
    From: '+12345678901',
    To: process.env.TWILIO_PHONE_NUMBER || '+18339874597',
    CallStatus: 'completed',
    RecordingUrl: 'https://example.com/test-recording.mp3',
    TranscriptionText: 'this is mark from coinbase support'
  };

  try {
    const response = await fetch(`${BASE_URL}/voice-webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(webhookData).toString()
    });

    console.log('✅ Voice webhook response:', {
      status: response.status,
      ok: response.ok
    });

    return response.ok;
  } catch (error) {
    console.error('❌ Voice webhook test failed:', error.message);
    return false;
  }
}

/**
 * Run all system health tests
 */
async function runSystemHealthTests() {
  console.log('🧪 Running System Health E2E Tests...\n');
  console.log(`🌐 Testing against: ${BASE_URL}\n`);
  console.log('=' .repeat(60));
  
  const tests = [
    { name: 'Health Endpoint', test: testHealthEndpoint },
    { name: 'Dashboard Endpoint', test: testDashboardEndpoint },
    { name: 'Live Updates Endpoint', test: testLiveUpdatesEndpoint },
    { name: 'VAPI Calls Endpoint', test: testVapiCallsEndpoint },
    { name: 'Scam Detection Function', test: testScamDetectionFunction },
    { name: 'Phone Number Validation', test: testPhoneValidation },
    { name: 'Voice Webhook', test: simulateIncomingCall }
  ];

  const results = {};
  let passedCount = 0;

  for (const { name, test } of tests) {
    console.log(`\n🧪 Running: ${name}`);
    console.log('-'.repeat(40));
    
    try {
      const result = await test();
      results[name] = result;
      
      if (result) {
        console.log(`✅ ${name}: PASSED`);
        passedCount++;
      } else {
        console.log(`❌ ${name}: FAILED`);
      }
    } catch (error) {
      console.log(`💥 ${name}: CRASHED - ${error.message}`);
      results[name] = false;
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 Final Results:');
  
  for (const [name, result] of Object.entries(results)) {
    console.log(`   ${result ? '✅' : '❌'} ${name}`);
  }
  
  console.log(`\n🎯 Overall: ${passedCount}/${tests.length} tests passed`);
  
  const allPassed = passedCount === tests.length;
  console.log(`\n${allPassed ? '🎉 ALL TESTS PASSED!' : '🔧 SOME TESTS FAILED'}`);
  
  if (!allPassed) {
    console.log('\n💡 Troubleshooting Tips:');
    console.log('   - Ensure the server is running');
    console.log('   - Check environment variables are set');
    console.log('   - Verify network connectivity');
    console.log('   - Check server logs for errors');
  }
  
  return allPassed;
}

// Run tests if this script is executed directly
if (require.main === module) {
  runSystemHealthTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('💥 Test runner crashed:', error);
      process.exit(1);
    });
}

module.exports = {
  runSystemHealthTests,
  testHealthEndpoint,
  testDashboardEndpoint,
  testLiveUpdatesEndpoint,
  testVapiCallsEndpoint,
  testScamDetectionFunction,
  testPhoneValidation,
  simulateIncomingCall
};
