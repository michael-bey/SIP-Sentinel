#!/usr/bin/env node

/**
 * Unit tests for scam detection functionality
 * Consolidated from: test-scam-detection-fix.js, simple-test.js
 */

require('dotenv').config();

const { analyzeMessageWithLLM } = require('../../src/llm-scam-detector');
const { isLikelyScam } = require('../../src/index');

/**
 * Test LLM-based scam detection
 */
async function testLLMScamDetection() {
  console.log('🤖 Testing LLM Scam Detection...\n');

  const testCases = [
    {
      message: "this is mark from coinbase support",
      expectedScam: true,
      expectedType: "crypto_exchange"
    },
    {
      message: "hello this is microsoft technical support",
      expectedScam: true,
      expectedType: "it_support"
    },
    {
      message: "your kraken account has been compromised",
      expectedScam: true,
      expectedType: "crypto_exchange"
    },
    {
      message: "hello this is a normal message",
      expectedScam: false,
      expectedType: null
    }
  ];

  let passed = 0;
  let total = testCases.length;

  for (const testCase of testCases) {
    console.log(`📝 Testing: "${testCase.message}"`);
    
    try {
      const result = await analyzeMessageWithLLM(testCase.message);
      
      const isCorrect = result.isScam === testCase.expectedScam;
      const typeCorrect = !testCase.expectedScam || result.scamType === testCase.expectedType;
      
      if (isCorrect && typeCorrect) {
        console.log(`✅ PASS - Scam: ${result.isScam}, Type: ${result.scamType}, Confidence: ${result.confidence}`);
        passed++;
      } else {
        console.log(`❌ FAIL - Expected scam: ${testCase.expectedScam}, got: ${result.isScam}`);
        console.log(`   Expected type: ${testCase.expectedType}, got: ${result.scamType}`);
      }
    } catch (error) {
      console.log(`❌ ERROR - ${error.message}`);
    }
    
    console.log('');
  }

  console.log(`📊 LLM Detection Results: ${passed}/${total} tests passed\n`);
  return passed === total;
}

/**
 * Test regex-based scam detection
 */
async function testRegexScamDetection() {
  console.log('🔍 Testing Regex Scam Detection...\n');

  const testCases = [
    {
      message: "this is mark from coinbase support",
      expectedScam: true,
      expectedType: "crypto_exchange"
    },
    {
      message: "microsoft technical support calling",
      expectedScam: true,
      expectedType: "it_support"
    },
    {
      message: "your binance account needs verification",
      expectedScam: true,
      expectedType: "crypto_exchange"
    },
    {
      message: "hello how are you today",
      expectedScam: false,
      expectedType: null
    }
  ];

  let passed = 0;
  let total = testCases.length;

  for (const testCase of testCases) {
    console.log(`📝 Testing: "${testCase.message}"`);
    
    try {
      const result = isLikelyScam(testCase.message);
      
      const isCorrect = result.isScam === testCase.expectedScam;
      const typeCorrect = !testCase.expectedScam || result.scamType === testCase.expectedType;
      
      if (isCorrect && typeCorrect) {
        console.log(`✅ PASS - Scam: ${result.isScam}, Type: ${result.scamType}`);
        passed++;
      } else {
        console.log(`❌ FAIL - Expected scam: ${testCase.expectedScam}, got: ${result.isScam}`);
        console.log(`   Expected type: ${testCase.expectedType}, got: ${result.scamType}`);
      }
    } catch (error) {
      console.log(`❌ ERROR - ${error.message}`);
    }
    
    console.log('');
  }

  console.log(`📊 Regex Detection Results: ${passed}/${total} tests passed\n`);
  return passed === total;
}

/**
 * Test combined detection logic
 */
async function testCombinedDetection() {
  console.log('🔄 Testing Combined Detection Logic...\n');

  const testMessage = "this is mark from coinbase support";
  
  try {
    const llmResult = await analyzeMessageWithLLM(testMessage);
    const regexResult = isLikelyScam(testMessage);
    
    // Combined logic
    const finalIsScam = llmResult.isScam || regexResult.isScam;
    const finalScamType = llmResult.scamType || regexResult.scamType;
    const finalConfidence = llmResult.confidence || (regexResult.scamDetails?.scamScore * 10) || 0;
    
    console.log('Combined Result:', {
      isScam: finalIsScam,
      scamType: finalScamType,
      confidence: finalConfidence,
      llmDetected: llmResult.isScam,
      regexDetected: regexResult.isScam
    });
    
    // Test callback decision logic
    const shouldTriggerCallback = finalIsScam && finalConfidence >= 70;
    console.log('\n🎯 Callback Decision:', {
      shouldTriggerCallback,
      reason: shouldTriggerCallback ? 
        'Scam detected with sufficient confidence' : 
        'Either not a scam or confidence too low'
    });
    
    return shouldTriggerCallback;
    
  } catch (error) {
    console.error('❌ Combined detection test failed:', error.message);
    return false;
  }
}

/**
 * Run all scam detection tests
 */
async function runScamDetectionTests() {
  console.log('🧪 Running Scam Detection Unit Tests...\n');
  console.log('=' .repeat(60));
  
  const results = {
    llm: await testLLMScamDetection(),
    regex: await testRegexScamDetection(),
    combined: await testCombinedDetection()
  };
  
  console.log('=' .repeat(60));
  console.log('📊 Final Results:');
  console.log(`   LLM Detection: ${results.llm ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Regex Detection: ${results.regex ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Combined Logic: ${results.combined ? '✅ PASS' : '❌ FAIL'}`);
  
  const allPassed = Object.values(results).every(result => result);
  console.log(`\n🎯 Overall: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  
  return allPassed;
}

// Run tests if this script is executed directly
if (require.main === module) {
  runScamDetectionTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('💥 Test runner crashed:', error);
      process.exit(1);
    });
}

module.exports = {
  runScamDetectionTests,
  testLLMScamDetection,
  testRegexScamDetection,
  testCombinedDetection
};
