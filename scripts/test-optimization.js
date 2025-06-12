#!/usr/bin/env node

/**
 * Test script for Vercel optimization
 * Validates that all optimized endpoints are working correctly
 */

const axios = require('axios');

// Configuration
const BASE_URL = process.env.VERCEL_URL 
  ? `https://${process.env.VERCEL_URL}` 
  : process.argv[2] || 'http://localhost:3000';

console.log('🧪 Testing SIPSentinel Optimized Functions');
console.log('==========================================');
console.log(`Base URL: ${BASE_URL}`);
console.log('');

// Test configuration
const tests = [
  {
    name: 'Health Check',
    url: '/health',
    method: 'GET',
    expectedStatus: 200,
    expectedFields: ['status', 'uptime', 'optimized'],
    timeout: 5000
  },
  {
    name: 'Dashboard',
    url: '/',
    method: 'GET',
    expectedStatus: 200,
    timeout: 10000
  },
  {
    name: 'Deployment Info',
    url: '/deployment-info',
    method: 'GET',
    expectedStatus: 200,
    expectedFields: ['status', 'platform', 'optimized'],
    timeout: 5000
  },
  {
    name: 'VAPI Assistants',
    url: '/vapi/assistants',
    method: 'GET',
    expectedStatus: 200,
    expectedFields: ['success'],
    timeout: 10000
  },
  {
    name: 'VAPI Calls',
    url: '/vapi/calls',
    method: 'GET',
    expectedStatus: 200,
    expectedFields: ['success'],
    timeout: 10000
  }
];

// Test webhook endpoints (these should return TwiML or JSON)
const webhookTests = [
  {
    name: 'Voice Webhook',
    url: '/voice',
    method: 'POST',
    data: {
      CallSid: 'test-call-sid',
      From: '+1234567890',
      To: '+1987654321',
      CallStatus: 'in-progress'
    },
    expectedStatus: 200,
    timeout: 15000
  },
  {
    name: 'SMS Webhook',
    url: '/sms',
    method: 'POST',
    data: {
      MessageSid: 'test-message-sid',
      From: '+1234567890',
      To: '+1987654321',
      Body: 'Test message'
    },
    expectedStatus: 200,
    timeout: 15000
  },
  {
    name: 'Recording Status Webhook',
    url: '/recording-status',
    method: 'POST',
    data: {
      RecordingSid: 'test-recording-sid',
      CallSid: 'test-call-sid',
      RecordingStatus: 'completed',
      RecordingUrl: 'https://example.com/recording.wav'
    },
    expectedStatus: 200,
    timeout: 15000
  },
  {
    name: 'VAPI Webhook',
    url: '/vapi/webhook',
    method: 'POST',
    data: {
      type: 'call-started',
      call: {
        id: 'test-call-id',
        status: 'in-progress'
      }
    },
    expectedStatus: 200,
    timeout: 10000
  }
];

// Performance tracking
const performanceResults = [];

async function runTest(test) {
  const startTime = Date.now();
  
  try {
    console.log(`Testing ${test.name}...`);
    
    const config = {
      method: test.method,
      url: `${BASE_URL}${test.url}`,
      timeout: test.timeout,
      headers: {
        'Content-Type': test.method === 'POST' ? 'application/x-www-form-urlencoded' : 'application/json'
      }
    };
    
    if (test.data) {
      if (test.method === 'POST' && test.url.includes('webhook')) {
        // For webhooks, send as form data
        const params = new URLSearchParams();
        Object.keys(test.data).forEach(key => {
          if (typeof test.data[key] === 'object') {
            params.append(key, JSON.stringify(test.data[key]));
          } else {
            params.append(key, test.data[key]);
          }
        });
        config.data = params.toString();
      } else {
        config.data = test.data;
      }
    }
    
    const response = await axios(config);
    const duration = Date.now() - startTime;
    
    // Check status code
    if (response.status !== test.expectedStatus) {
      throw new Error(`Expected status ${test.expectedStatus}, got ${response.status}`);
    }
    
    // Check expected fields for JSON responses
    if (test.expectedFields && response.headers['content-type']?.includes('application/json')) {
      const data = response.data;
      for (const field of test.expectedFields) {
        if (!(field in data)) {
          throw new Error(`Missing expected field: ${field}`);
        }
      }
    }
    
    performanceResults.push({
      name: test.name,
      duration,
      status: 'PASS',
      responseSize: JSON.stringify(response.data).length
    });
    
    console.log(`  ✅ ${test.name} - ${duration}ms`);
    
  } catch (error) {
    const duration = Date.now() - startTime;

    let errorMessage = error.message;
    if (error.code === 'ECONNREFUSED') {
      errorMessage = 'Connection refused - server not running';
    } else if (error.code === 'ENOTFOUND') {
      errorMessage = 'Host not found';
    } else if (error.response) {
      errorMessage = `HTTP ${error.response.status}: ${error.response.statusText}`;
    }

    performanceResults.push({
      name: test.name,
      duration,
      status: 'FAIL',
      error: errorMessage
    });

    console.log(`  ❌ ${test.name} - ${errorMessage} (${duration}ms)`);
  }
}

async function runAllTests() {
  console.log('🔍 Running API endpoint tests...\n');
  
  // Run API tests
  for (const test of tests) {
    await runTest(test);
  }
  
  console.log('\n🔗 Running webhook tests...\n');
  
  // Run webhook tests
  for (const test of webhookTests) {
    await runTest(test);
  }
  
  // Performance summary
  console.log('\n📊 Performance Summary:');
  console.log('======================');
  
  const passed = performanceResults.filter(r => r.status === 'PASS');
  const failed = performanceResults.filter(r => r.status === 'FAIL');
  
  console.log(`Total tests: ${performanceResults.length}`);
  console.log(`Passed: ${passed.length}`);
  console.log(`Failed: ${failed.length}`);
  console.log('');
  
  if (passed.length > 0) {
    console.log('✅ Successful tests:');
    passed.forEach(result => {
      console.log(`  ${result.name}: ${result.duration}ms`);
    });
  }
  
  if (failed.length > 0) {
    console.log('\n❌ Failed tests:');
    failed.forEach(result => {
      console.log(`  ${result.name}: ${result.error}`);
    });
  }
  
  // Performance analysis
  const avgDuration = passed.reduce((sum, r) => sum + r.duration, 0) / passed.length;
  const maxDuration = Math.max(...passed.map(r => r.duration));
  const minDuration = Math.min(...passed.map(r => r.duration));
  
  console.log('\n⚡ Performance Metrics:');
  console.log(`Average response time: ${Math.round(avgDuration)}ms`);
  console.log(`Fastest response: ${minDuration}ms`);
  console.log(`Slowest response: ${maxDuration}ms`);
  
  // Optimization validation
  console.log('\n🎯 Optimization Validation:');
  const healthTest = passed.find(r => r.name === 'Health Check');
  if (healthTest && healthTest.duration < 1000) {
    console.log('✅ Health check is fast (< 1s)');
  } else {
    console.log('⚠️  Health check might be slow');
  }
  
  const webhookPassed = passed.filter(r => r.name.includes('Webhook'));
  if (webhookPassed.length > 0) {
    const avgWebhookTime = webhookPassed.reduce((sum, r) => sum + r.duration, 0) / webhookPassed.length;
    if (avgWebhookTime < 5000) {
      console.log('✅ Webhooks are responding quickly (< 5s)');
    } else {
      console.log('⚠️  Webhooks might be slow');
    }
  }
  
  console.log('\n🎉 Optimization test complete!');
  
  if (failed.length === 0) {
    console.log('All tests passed! Your optimized functions are working correctly.');
    process.exit(0);
  } else {
    console.log(`${failed.length} tests failed. Please check the errors above.`);
    process.exit(1);
  }
}

// Run the tests
runAllTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
