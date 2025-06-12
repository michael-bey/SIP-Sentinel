#!/usr/bin/env node

/**
 * Integration tests for QStash functionality
 * Consolidated from: test/redis-qstash-integration.js, test/simple-qstash-test.js,
 * test/qstash-production-test.js, and other QStash-related tests
 */

require('dotenv').config();
const { Client } = require('@upstash/qstash');
const { queueTelegramUpload } = require('../../src/qstash-service');

/**
 * Test QStash configuration
 */
async function testQStashConfiguration() {
  console.log('⚙️ Testing QStash Configuration...\n');

  const requiredVars = ['QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY'];
  let allVarsPresent = true;
  
  requiredVars.forEach(varName => {
    if (process.env[varName]) {
      console.log(`✅ ${varName}: Present`);
    } else {
      console.log(`❌ ${varName}: Missing`);
      allVarsPresent = false;
    }
  });
  
  if (allVarsPresent) {
    console.log('✅ All required QStash environment variables are present\n');
  } else {
    console.log('❌ Some required QStash environment variables are missing\n');
  }
  
  return allVarsPresent;
}

/**
 * Test direct QStash client functionality
 */
async function testQStashClient() {
  console.log('🔄 Testing QStash Client...\n');

  try {
    const qstash = new Client({
      token: process.env.QSTASH_TOKEN,
    });

    const testCallId = 'qstash-test-' + Date.now();
    
    console.log(`📋 Test Setup:`);
    console.log(`   Call ID: ${testCallId}`);
    console.log(`   Target URL: https://sip-sentinel.vercel.app/api/queue-worker`);
    
    const payload = {
      taskType: 'telegram_upload',
      taskData: { callId: testCallId },
      timestamp: new Date().toISOString(),
      taskId: `telegram_upload_${Date.now()}_test`
    };
    
    console.log(`\n📤 Sending test message to QStash...`);
    console.log(`   Payload:`, JSON.stringify(payload, null, 2));
    
    const result = await qstash.publishJSON({
      url: 'https://sip-sentinel.vercel.app/api/queue-worker',
      body: payload,
      retries: 1,
      delay: 60 // 1 minute delay
    });
    
    console.log(`✅ QStash message sent successfully!`);
    console.log(`   📊 Message ID: ${result.messageId}`);
    console.log(`   📊 URL: ${result.url || 'Not provided'}`);
    
    console.log(`\n⏰ Message should be delivered in ~60 seconds`);
    console.log(`   Check your Vercel function logs for delivery confirmation`);
    
    return true;
  } catch (error) {
    console.error('❌ QStash client test failed:', error.message);
    return false;
  }
}

/**
 * Test QStash service wrapper
 */
async function testQStashService() {
  console.log('🛠️ Testing QStash Service Wrapper...\n');

  try {
    const testCallId = 'qstash-service-test-' + Date.now();
    
    console.log(`📋 Testing queueTelegramUpload function:`);
    console.log(`   Call ID: ${testCallId}`);
    
    const result = await queueTelegramUpload({ callId: testCallId });
    
    if (result && result.messageId) {
      console.log(`✅ QStash service test successful!`);
      console.log(`   📊 Message ID: ${result.messageId}`);
      console.log(`   📊 Task ID: ${result.taskId}`);
      
      console.log(`\n⏰ The task should execute in ~90 seconds`);
      console.log(`   📱 Check your Vercel function logs for QStash delivery`);
      console.log(`   🔍 Look for logs starting with "[QUEUE WORKER]"`);
      
      return true;
    } else {
      console.log(`❌ QStash service returned invalid result:`, result);
      return false;
    }
  } catch (error) {
    console.error('❌ QStash service test failed:', error.message);
    return false;
  }
}

/**
 * Test QStash production URL configuration
 */
async function testQStashProductionURL() {
  console.log('🌐 Testing QStash Production URL Configuration...\n');

  const productionURL = 'https://sip-sentinel.vercel.app';
  const queueWorkerEndpoint = `${productionURL}/api/queue-worker`;
  
  console.log(`📋 Production URL Test:`);
  console.log(`   Base URL: ${productionURL}`);
  console.log(`   Queue Worker: ${queueWorkerEndpoint}`);
  
  try {
    // Test if the endpoint is reachable
    const response = await fetch(queueWorkerEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        taskType: 'health_check',
        taskData: { test: true },
        timestamp: new Date().toISOString()
      })
    });
    
    if (response.ok) {
      console.log(`✅ Queue worker endpoint is reachable`);
      console.log(`   Status: ${response.status}`);
      return true;
    } else {
      console.log(`⚠️  Queue worker endpoint returned status: ${response.status}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Queue worker endpoint test failed: ${error.message}`);
    return false;
  }
}

/**
 * Test QStash task delivery monitoring
 */
async function testQStashDeliveryMonitoring() {
  console.log('📊 Testing QStash Delivery Monitoring...\n');

  console.log(`🔍 QStash Delivery Debugging Tips:`);
  console.log(`   1. Check QStash Dashboard:`);
  console.log(`      - Go to Upstash QStash console`);
  console.log(`      - Look for recent messages and their delivery status`);
  console.log(`      - Check for failed deliveries or retries`);
  
  console.log(`\n   2. Check Vercel Function Logs:`);
  console.log(`      - Go to Vercel dashboard → Functions → queue-worker`);
  console.log(`      - Look for logs with "[QUEUE WORKER]" prefix`);
  console.log(`      - Verify QStash signature verification is working`);
  
  console.log(`\n   3. Common Issues:`);
  console.log(`      - QStash signature verification failing`);
  console.log(`      - Vercel function timeout (60s limit)`);
  console.log(`      - Environment variables missing in production`);
  console.log(`      - Network connectivity issues`);
  
  console.log(`\n   4. URL Mismatch Issues:`);
  console.log(`      - Ensure production URL matches deployment URL`);
  console.log(`      - Check for deployment-specific URLs vs. custom domain`);
  console.log(`      - Verify webhook endpoints are accessible`);
  
  return true; // This is informational, always passes
}

/**
 * Run all QStash integration tests
 */
async function runQStashIntegrationTests() {
  console.log('🧪 Running QStash Integration Tests...\n');
  console.log('=' .repeat(60));
  
  const results = {
    configuration: await testQStashConfiguration(),
    client: await testQStashClient(),
    service: await testQStashService(),
    productionURL: await testQStashProductionURL(),
    monitoring: await testQStashDeliveryMonitoring()
  };
  
  console.log('=' .repeat(60));
  console.log('📊 Final Results:');
  console.log(`   Configuration: ${results.configuration ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Client: ${results.client ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Service: ${results.service ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Production URL: ${results.productionURL ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Monitoring: ${results.monitoring ? '✅ PASS' : '❌ FAIL'}`);
  
  const criticalTests = ['configuration', 'client', 'service'];
  const criticalPassed = criticalTests.every(test => results[test]);
  
  console.log(`\n🎯 Critical Tests: ${criticalPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}`);
  
  if (criticalPassed) {
    console.log('\n🎉 QStash integration is working correctly!');
    console.log('📱 Check your QStash dashboard and Vercel logs for task delivery confirmation.');
  } else {
    console.log('\n🔧 QStash integration issues detected. Check the logs above.');
  }
  
  return criticalPassed;
}

// Run tests if this script is executed directly
if (require.main === module) {
  runQStashIntegrationTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('💥 Test runner crashed:', error);
      process.exit(1);
    });
}

module.exports = {
  runQStashIntegrationTests,
  testQStashConfiguration,
  testQStashClient,
  testQStashService,
  testQStashProductionURL,
  testQStashDeliveryMonitoring
};
