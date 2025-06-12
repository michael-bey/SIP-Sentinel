#!/usr/bin/env node

/**
 * Fix Existing VAPI Assistants Script
 * Checks and fixes existing VAPI assistants that might have problematic voice configurations
 */

require('dotenv').config();
const { VapiClient } = require('@vapi-ai/server-sdk');

// Initialize VAPI client
const vapiClient = new VapiClient({
  token: process.env.VAPI_API_KEY
});

async function fixExistingAssistants() {
  console.log('🔧 Checking and Fixing Existing VAPI Assistants...\n');

  if (!process.env.VAPI_API_KEY) {
    console.error('❌ VAPI_API_KEY not found in environment variables');
    process.exit(1);
  }

  try {
    // Get all assistants
    console.log('📋 Fetching all VAPI assistants...');
    const assistants = await vapiClient.assistants.list();
    console.log(`Found ${assistants.length} assistants\n`);

    let fixedCount = 0;
    let alreadyCorrectCount = 0;
    let errorCount = 0;

    for (const assistant of assistants) {
      console.log(`🔍 Checking assistant: ${assistant.name} (ID: ${assistant.id})`);
      
      if (!assistant.voice) {
        console.log('   ⚠️  No voice configuration found');
        continue;
      }

      console.log(`   Current voice: ${assistant.voice.provider}:${assistant.voice.voiceId}`);
      
      let needsUpdate = false;
      let updateData = {};

      // Check for problematic configurations
      if (assistant.voice.provider === 'elevenlabs') {
        console.log('   🚨 ElevenLabs voice detected - needs conversion to VAPI');
        needsUpdate = true;
        
        // Map to VAPI equivalent
        const elevenLabsToVapiMapping = {
          'Adam': 'Elliot',
          'Antoni': 'Rohan',
          'Arnold': 'Cole',
          'Josh': 'Harry',
          'Sam': 'Spencer',
          'Bella': 'Paige',
          'Domi': 'Hana',
          'Elli': 'Kylie',
          'Rachel': 'Lily'
        };
        
        const mappedVoice = elevenLabsToVapiMapping[assistant.voice.voiceId] || 'Elliot';
        updateData.voice = {
          provider: "vapi",
          voiceId: mappedVoice,
          cachingEnabled: true,
          speed: 1.0
        };
        console.log(`   🔄 Will map to VAPI voice: ${mappedVoice}`);
        
      } else if (assistant.voice.provider === 'vapi') {
        // Check if it has the problematic language field
        if (assistant.voice.language) {
          console.log(`   ⚠️  VAPI voice has language field: ${assistant.voice.language} - removing it`);
          needsUpdate = true;
          updateData.voice = {
            provider: "vapi",
            voiceId: assistant.voice.voiceId,
            cachingEnabled: assistant.voice.cachingEnabled !== false,
            speed: assistant.voice.speed || 1.0
            // Intentionally omitting language field
          };
        } else {
          console.log('   ✅ VAPI voice configuration is correct');
          alreadyCorrectCount++;
        }
      } else {
        console.log(`   ❓ Unknown voice provider: ${assistant.voice.provider}`);
      }

      if (needsUpdate) {
        try {
          console.log('   🔧 Updating assistant...');
          await vapiClient.assistants.update(assistant.id, updateData);
          console.log('   ✅ Successfully updated assistant');
          fixedCount++;
        } catch (error) {
          console.error(`   ❌ Failed to update assistant: ${error.message}`);
          errorCount++;
        }
      }
      
      console.log(''); // Empty line for readability
    }

    console.log('📊 Summary:');
    console.log(`   ✅ Already correct: ${alreadyCorrectCount}`);
    console.log(`   🔧 Fixed: ${fixedCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   📋 Total checked: ${assistants.length}`);

    if (fixedCount > 0) {
      console.log('\n🎉 Assistant fixes completed!');
      console.log('💡 Try creating a new test call to see if the ElevenLabs error is resolved.');
    } else if (alreadyCorrectCount === assistants.length) {
      console.log('\n✅ All assistants already have correct voice configurations!');
      console.log('💡 The ElevenLabs error might be coming from another source.');
    }

  } catch (error) {
    console.error('\n❌ Failed to check assistants:', error.message);
    
    if (error.message.includes('401') || error.message.includes('unauthorized')) {
      console.log('\n💡 Authentication troubleshooting:');
      console.log('   - Check VAPI_API_KEY in .env file');
      console.log('   - Verify the API key is valid and active');
    }
    
    process.exit(1);
  }
}

// Run the fix
if (require.main === module) {
  fixExistingAssistants().catch(error => {
    console.error('❌ Fix script failed:', error);
    process.exit(1);
  });
}

module.exports = { fixExistingAssistants };
