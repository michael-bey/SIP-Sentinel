#!/usr/bin/env node

/**
 * Master test runner for all SIPSentinel tests
 */

require('dotenv').config();

// Import all test modules
const { runScamDetectionTests } = require('./unit/scam-detection.test.js');
const { runAgentSelectionTests } = require('./unit/agent-selection.test.js');
const { runTelegramIntegrationTests } = require('./integration/telegram-integration.test.js');
const { runVapiIntegrationTests } = require('./integration/vapi-integration.test.js');
const { runQStashIntegrationTests } = require('./integration/qstash-integration.test.js');
const { runSystemHealthTests } = require('./e2e/system-health.test.js');

/**
 * Run unit tests
 */
async function runUnitTests() {
  console.log('🧪 Running Unit Tests...\n');
  console.log('=' .repeat(80));
  
  const results = {
    scamDetection: await runScamDetectionTests(),
    agentSelection: await runAgentSelectionTests()
  };
  
  console.log('\n' + '=' .repeat(80));
  console.log('📊 Unit Test Results:');
  console.log(`   Scam Detection: ${results.scamDetection ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Agent Selection: ${results.agentSelection ? '✅ PASS' : '❌ FAIL'}`);
  
  const allPassed = Object.values(results).every(result => result);
  console.log(`\n🎯 Unit Tests Overall: ${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}`);
  
  return allPassed;
}

/**
 * Run integration tests
 */
async function runIntegrationTests() {
  console.log('\n\n🔗 Running Integration Tests...\n');
  console.log('=' .repeat(80));
  
  const results = {
    telegram: await runTelegramIntegrationTests(),
    vapi: await runVapiIntegrationTests(),
    qstash: await runQStashIntegrationTests()
  };
  
  console.log('\n' + '=' .repeat(80));
  console.log('📊 Integration Test Results:');
  console.log(`   Telegram: ${results.telegram ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   VAPI: ${results.vapi ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   QStash: ${results.qstash ? '✅ PASS' : '❌ FAIL'}`);
  
  const allPassed = Object.values(results).every(result => result);
  console.log(`\n🎯 Integration Tests Overall: ${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}`);
  
  return allPassed;
}

/**
 * Run end-to-end tests
 */
async function runE2ETests() {
  console.log('\n\n🌐 Running End-to-End Tests...\n');
  console.log('=' .repeat(80));
  
  const results = {
    systemHealth: await runSystemHealthTests()
  };
  
  console.log('\n' + '=' .repeat(80));
  console.log('📊 E2E Test Results:');
  console.log(`   System Health: ${results.systemHealth ? '✅ PASS' : '❌ FAIL'}`);
  
  const allPassed = Object.values(results).every(result => result);
  console.log(`\n🎯 E2E Tests Overall: ${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}`);
  
  return allPassed;
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('🚀 SIPSentinel Test Suite\n');
  console.log('Running comprehensive tests for all components...\n');
  
  const startTime = Date.now();
  
  try {
    const results = {
      unit: await runUnitTests(),
      integration: await runIntegrationTests(),
      e2e: await runE2ETests()
    };
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log('\n\n' + '='.repeat(80));
    console.log('🏁 FINAL TEST RESULTS');
    console.log('='.repeat(80));
    console.log(`   Unit Tests: ${results.unit ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`   Integration Tests: ${results.integration ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`   E2E Tests: ${results.e2e ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`   Duration: ${duration}s`);
    
    const allPassed = Object.values(results).every(result => result);
    
    if (allPassed) {
      console.log('\n🎉 ALL TESTS PASSED! 🎉');
      console.log('✨ SIPSentinel is working correctly across all components.');
    } else {
      console.log('\n❌ SOME TESTS FAILED');
      console.log('🔧 Check the detailed logs above for specific issues.');
      
      console.log('\n💡 Common Issues:');
      console.log('   - Environment variables not set (check .env file)');
      console.log('   - Services not running (VAPI, Telegram, QStash)');
      console.log('   - Network connectivity issues');
      console.log('   - API keys expired or invalid');
    }
    
    console.log('\n📋 Test Categories:');
    console.log('   Unit: Individual component logic');
    console.log('   Integration: Service interactions');
    console.log('   E2E: Full system workflows');
    
    return allPassed;
    
  } catch (error) {
    console.error('\n💥 Test suite crashed:', error);
    return false;
  }
}

/**
 * Parse command line arguments and run appropriate tests
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log('🧪 SIPSentinel Test Runner\n');
    console.log('Usage:');
    console.log('  npm test                 # Run all tests');
    console.log('  npm run test:unit        # Run unit tests only');
    console.log('  npm run test:integration # Run integration tests only');
    console.log('  npm run test:e2e         # Run E2E tests only');
    console.log('  npm run test:scam        # Run scam detection tests');
    console.log('  npm run test:telegram    # Run Telegram tests');
    console.log('  npm run test:vapi        # Run VAPI tests');
    console.log('  npm run test:qstash      # Run QStash tests\n');
    console.log('Environment:');
    console.log('  BASE_URL=http://localhost:3000  # Override test target URL');
    return;
  }
  
  let success = false;
  
  if (args.includes('--unit')) {
    success = await runUnitTests();
  } else if (args.includes('--integration')) {
    success = await runIntegrationTests();
  } else if (args.includes('--e2e')) {
    success = await runE2ETests();
  } else if (args.includes('--scam')) {
    success = await runScamDetectionTests();
  } else if (args.includes('--telegram')) {
    success = await runTelegramIntegrationTests();
  } else if (args.includes('--vapi')) {
    success = await runVapiIntegrationTests();
  } else if (args.includes('--qstash')) {
    success = await runQStashIntegrationTests();
  } else {
    success = await runAllTests();
  }
  
  process.exit(success ? 0 : 1);
}

// Run if this script is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Test runner failed:', error);
    process.exit(1);
  });
}

module.exports = {
  runAllTests,
  runUnitTests,
  runIntegrationTests,
  runE2ETests
};
