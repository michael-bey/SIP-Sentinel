#!/usr/bin/env node

/**
 * Test assistant configuration sanitization
 */

require('dotenv').config();
const { createTransientAssistant, sanitizeAssistantConfig } = require('../src/vapi-service');

function testAssistantConfigSanitization() {
  console.log('🧪 Testing Assistant Configuration Sanitization...\n');

  // Test 1: Create transient assistant and check for invalid properties
  console.log('📋 Test 1: Transient assistant creation');
  
  const cryptoAssistant = createTransientAssistant('crypto_exchange', {
    impersonatedCompany: 'Coinbase'
  });
  
  console.log(`   Assistant name: ${cryptoAssistant.name}`);
  console.log(`   Has endCallOnBye: ${cryptoAssistant.hasOwnProperty('endCallOnBye')}`);
  console.log(`   Has endCallPhrases: ${cryptoAssistant.hasOwnProperty('endCallPhrases')}`);
  console.log(`   Voice provider: ${cryptoAssistant.voice.provider}`);
  console.log(`   Voice ID: ${cryptoAssistant.voice.voiceId}`);

  if (cryptoAssistant.endCallOnBye !== undefined) {
    console.log(`   ❌ ISSUE: endCallOnBye property still present: ${cryptoAssistant.endCallOnBye}`);
  } else {
    console.log(`   ✅ GOOD: endCallOnBye property not present`);
  }

  console.log('\n📋 Test 2: Sanitization function');
  
  // Test with a config that has the problematic property
  const problematicConfig = {
    name: 'Test Assistant',
    voice: {
      provider: 'vapi',
      voiceId: 'Elliot'
    },
    firstMessage: 'Hello',
    endCallOnBye: true, // This should be removed
    endCallPhrases: ['bye', 'goodbye'],
    model: {
      provider: 'openai',
      model: 'gpt-4'
    }
  };

  console.log(`   Original config has endCallOnBye: ${problematicConfig.hasOwnProperty('endCallOnBye')}`);
  
  const sanitizedConfig = sanitizeAssistantConfig(problematicConfig);
  
  console.log(`   Sanitized config has endCallOnBye: ${sanitizedConfig.hasOwnProperty('endCallOnBye')}`);
  console.log(`   Sanitized config has endCallPhrases: ${sanitizedConfig.hasOwnProperty('endCallPhrases')}`);
  console.log(`   Voice provider: ${sanitizedConfig.voice.provider}`);
  console.log(`   Voice ID: ${sanitizedConfig.voice.voiceId}`);

  if (sanitizedConfig.endCallOnBye !== undefined) {
    console.log(`   ❌ ISSUE: endCallOnBye property not removed by sanitization`);
  } else {
    console.log(`   ✅ GOOD: endCallOnBye property successfully removed`);
  }

  console.log('\n📋 Test 3: Generic fallback assistant');
  
  const genericAssistant = createTransientAssistant('unknown', {});
  
  console.log(`   Assistant name: ${genericAssistant.name}`);
  console.log(`   Has endCallOnBye: ${genericAssistant.hasOwnProperty('endCallOnBye')}`);
  console.log(`   Voice provider: ${genericAssistant.voice.provider}`);

  if (genericAssistant.endCallOnBye !== undefined) {
    console.log(`   ❌ ISSUE: endCallOnBye property still present in generic assistant`);
  } else {
    console.log(`   ✅ GOOD: endCallOnBye property not present in generic assistant`);
  }

  console.log('\n💡 Summary:');
  console.log('💡 - endCallOnBye property has been removed from transient assistants');
  console.log('💡 - sanitizeAssistantConfig function removes invalid properties');
  console.log('💡 - This should fix the VAPI "endCallOnBye should not exist" error');
}

// Run the test
if (require.main === module) {
  testAssistantConfigSanitization();
}

module.exports = { testAssistantConfigSanitization };
