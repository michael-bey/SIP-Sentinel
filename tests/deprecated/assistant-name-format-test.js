#!/usr/bin/env node

/**
 * Test the new assistant name format
 */

require('dotenv').config();
const { createTransientAssistant } = require('../src/vapi-service');

function testAssistantNameFormat() {
  console.log('🧪 Testing Assistant Name Format...\n');

  const testCases = [
    {
      scamType: 'crypto_exchange',
      scamDetails: { impersonatedCompany: 'Coinbase' },
      expectedPattern: /^Coinbase \w+$/,
      description: 'Coinbase crypto exchange'
    },
    {
      scamType: 'crypto_exchange',
      scamDetails: { impersonatedCompany: 'Kraken' },
      expectedPattern: /^Kraken \w+$/,
      description: 'Kraken crypto exchange'
    },
    {
      scamType: 'it_support',
      scamDetails: { impersonatedCompany: 'Microsoft' },
      expectedPattern: /^Microsoft \w+$/,
      description: 'Microsoft IT support'
    },
    {
      scamType: 'generic',
      scamDetails: {},
      expectedPattern: /^Generic \w+$/,
      description: 'Generic scam type'
    }
  ];

  let passedTests = 0;
  let totalTests = testCases.length;

  for (const testCase of testCases) {
    try {
      const assistant = createTransientAssistant(testCase.scamType, testCase.scamDetails);
      const assistantName = assistant.name;
      const matches = testCase.expectedPattern.test(assistantName);
      
      console.log(`📋 ${testCase.description}`);
      console.log(`   Generated name: "${assistantName}"`);
      console.log(`   Expected pattern: ${testCase.expectedPattern}`);
      console.log(`   ${matches ? '✅ PASS' : '❌ FAIL'}`);
      console.log('');
      
      if (matches) passedTests++;
    } catch (error) {
      console.log(`📋 ${testCase.description}`);
      console.log(`   ❌ ERROR: ${error.message}`);
      console.log('');
    }
  }

  console.log(`📊 Test Results: ${passedTests}/${totalTests} tests passed`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All tests passed!');
    return true;
  } else {
    console.log('❌ Some tests failed');
    return false;
  }
}

// Run the test
if (require.main === module) {
  testAssistantNameFormat();
}

module.exports = { testAssistantNameFormat };
