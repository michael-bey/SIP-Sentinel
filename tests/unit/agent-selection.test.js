#!/usr/bin/env node

/**
 * Unit tests for agent selection functionality
 * Consolidated from: test-agent-selection.js, test-karen-gender.js, test-voice-config.js
 */

require('dotenv').config();
const { findAgentForCompany, createTransientAssistant } = require('../../src/vapi-service');

/**
 * Test dynamic agent selection by company name
 */
async function testAgentSelection() {
  console.log('🧪 Testing Dynamic Agent Selection...\n');

  const testCases = [
    { company: 'Coinbase', expected: 'Coinbase' },
    { company: 'coinbase', expected: 'Coinbase' },
    { company: 'COINBASE', expected: 'Coinbase' },
    { company: 'Kraken', expected: 'Kraken' },
    { company: 'kraken', expected: 'Kraken' },
    { company: 'Binance', expected: null }, // Should not find agent
    { company: 'Microsoft', expected: null }, // Should not find agent
    { company: '', expected: null }, // Empty company
  ];

  let passed = 0;
  let total = testCases.length;

  for (const testCase of testCases) {
    console.log(`🔍 Testing: "${testCase.company}"`);
    
    try {
      const agent = await findAgentForCompany(testCase.company);
      
      if (agent) {
        console.log(`✅ Found agent: ${agent.name} (ID: ${agent.id})`);
        
        // Check if the result matches expectations
        if (testCase.expected && agent.name.toLowerCase().includes(testCase.expected.toLowerCase())) {
          console.log(`✅ Correct agent selected for ${testCase.company}`);
          passed++;
        } else if (!testCase.expected) {
          console.log(`⚠️  Unexpected agent found for ${testCase.company}`);
        } else {
          console.log(`❌ Wrong agent selected for ${testCase.company}`);
        }
      } else {
        console.log(`❌ No agent found`);
        
        if (testCase.expected === null) {
          console.log(`✅ Correctly found no agent for ${testCase.company}`);
          passed++;
        } else {
          console.log(`❌ Expected to find agent for ${testCase.company}`);
        }
      }
    } catch (error) {
      console.error(`❌ Error testing ${testCase.company}:`, error.message);
    }
    
    console.log('');
  }

  console.log(`📊 Agent Selection Results: ${passed}/${total} tests passed\n`);
  return passed === total;
}

/**
 * Test voice gender assignment for agents
 */
async function testVoiceGenderAssignment() {
  console.log('🎭 Testing Voice Gender Assignment...\n');

  const testCases = [
    { agentName: 'Coinbase Jim', expectedGender: 'male' },
    { agentName: 'Kraken Karen', expectedGender: 'female' },
    { agentName: 'Microsoft Sarah', expectedGender: 'female' },
    { agentName: 'Support Alex', expectedGender: 'male' }, // Default to male for ambiguous
  ];

  let passed = 0;
  let total = testCases.length;

  for (const testCase of testCases) {
    console.log(`🔍 Testing voice for: "${testCase.agentName}"`);
    
    try {
      const assistant = createTransientAssistant('crypto_exchange', {
        llmAnalysis: {
          impersonatedCompany: 'Test Company'
        },
        agentName: testCase.agentName
      });
      
      if (assistant && assistant.voice) {
        const voiceName = assistant.voice.voiceId || assistant.voice.voice;
        console.log(`🎤 Voice assigned: ${voiceName}`);
        
        // Check if voice matches expected gender
        const femaleVoices = ['paige', 'sarah', 'jennifer', 'emma'];
        const maleVoices = ['ryan', 'mark', 'john', 'alex'];
        
        const isFemaleVoice = femaleVoices.some(v => voiceName.toLowerCase().includes(v));
        const isMaleVoice = maleVoices.some(v => voiceName.toLowerCase().includes(v));
        
        const assignedGender = isFemaleVoice ? 'female' : isMaleVoice ? 'male' : 'unknown';
        
        if (assignedGender === testCase.expectedGender) {
          console.log(`✅ Correct gender assignment: ${assignedGender}`);
          passed++;
        } else {
          console.log(`❌ Wrong gender assignment: expected ${testCase.expectedGender}, got ${assignedGender}`);
        }
      } else {
        console.log(`❌ No voice assigned to agent`);
      }
    } catch (error) {
      console.error(`❌ Error testing voice for ${testCase.agentName}:`, error.message);
    }
    
    console.log('');
  }

  console.log(`📊 Voice Gender Results: ${passed}/${total} tests passed\n`);
  return passed === total;
}

/**
 * Test agent configuration for different scam types
 */
async function testAgentConfiguration() {
  console.log('⚙️ Testing Agent Configuration...\n');

  const testCases = [
    {
      scamType: 'crypto_exchange',
      company: 'Coinbase',
      expectedPersona: 'victim'
    },
    {
      scamType: 'it_support',
      company: 'Microsoft',
      expectedPersona: 'victim'
    },
    {
      scamType: 'crypto_exchange',
      company: 'Kraken',
      expectedPersona: 'victim'
    }
  ];

  let passed = 0;
  let total = testCases.length;

  for (const testCase of testCases) {
    console.log(`🔍 Testing config for: ${testCase.scamType} - ${testCase.company}`);
    
    try {
      const assistant = createTransientAssistant(testCase.scamType, {
        llmAnalysis: {
          impersonatedCompany: testCase.company
        }
      });
      
      if (assistant) {
        console.log(`✅ Agent created: ${assistant.name}`);
        
        // Check if it's configured as victim persona
        const systemPrompt = assistant.model.messages[0].content;
        const isVictimPersona = systemPrompt.includes('waste scammers') ||
                               systemPrompt.includes('potential victim') ||
                               systemPrompt.includes('concerned') ||
                               systemPrompt.includes('worried');
        
        if (isVictimPersona) {
          console.log(`✅ Correct victim persona configuration`);
          passed++;
        } else {
          console.log(`❌ Not configured as victim persona`);
          console.log(`   Prompt preview: ${systemPrompt.substring(0, 200)}...`);
        }
      } else {
        console.log(`❌ Failed to create agent`);
      }
    } catch (error) {
      console.error(`❌ Error testing config:`, error.message);
    }
    
    console.log('');
  }

  console.log(`📊 Agent Configuration Results: ${passed}/${total} tests passed\n`);
  return passed === total;
}

/**
 * Run all agent selection tests
 */
async function runAgentSelectionTests() {
  console.log('🧪 Running Agent Selection Unit Tests...\n');
  console.log('=' .repeat(60));
  
  const results = {
    selection: await testAgentSelection(),
    voiceGender: await testVoiceGenderAssignment(),
    configuration: await testAgentConfiguration()
  };
  
  console.log('=' .repeat(60));
  console.log('📊 Final Results:');
  console.log(`   Agent Selection: ${results.selection ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Voice Gender: ${results.voiceGender ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Configuration: ${results.configuration ? '✅ PASS' : '❌ FAIL'}`);
  
  const allPassed = Object.values(results).every(result => result);
  console.log(`\n🎯 Overall: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  
  return allPassed;
}

// Run tests if this script is executed directly
if (require.main === module) {
  runAgentSelectionTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('💥 Test runner crashed:', error);
      process.exit(1);
    });
}

module.exports = {
  runAgentSelectionTests,
  testAgentSelection,
  testVoiceGenderAssignment,
  testAgentConfiguration
};
