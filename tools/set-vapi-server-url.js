#!/usr/bin/env node

/**
 * Set VAPI Server URL for Assistants
 * Updates existing assistants to use our webhook endpoint
 */

require('dotenv').config();
const { VapiClient } = require('@vapi-ai/server-sdk');

async function setVapiServerUrl() {
  console.log('🔗 Setting VAPI Server URL for Assistants...\n');

  if (!process.env.VAPI_API_KEY) {
    console.error('❌ VAPI_API_KEY not found in environment variables');
    process.exit(1);
  }

  const SERVER_URL = 'https://sip-sentinel.vercel.app/api/webhooks/vapi';
  
  try {
    const vapiClient = new VapiClient({
      token: process.env.VAPI_API_KEY,
    });

    // Get all assistants
    console.log('1️⃣ Fetching existing assistants...');
    const assistants = await vapiClient.assistants.list();
    console.log(`   Found ${assistants.length} assistants`);

    if (assistants.length === 0) {
      console.log('ℹ️  No assistants found to update.');
      return;
    }

    // Update each assistant with the server URL
    console.log('\n2️⃣ Updating assistants with server URL...');
    
    for (const assistant of assistants) {
      console.log(`\n   Updating "${assistant.name}" (ID: ${assistant.id})`);
      
      // Check if it already has the correct server URL
      if (assistant.serverUrl === SERVER_URL) {
        console.log(`   ✅ Already has correct server URL`);
        continue;
      }
      
      try {
        // Update the assistant with the server URL
        const updatedAssistant = await vapiClient.assistants.update(assistant.id, {
          serverUrl: SERVER_URL
        });
        
        console.log(`   ✅ Updated successfully`);
        console.log(`   📡 Server URL: ${updatedAssistant.serverUrl}`);
        
      } catch (updateError) {
        console.error(`   ❌ Failed to update: ${updateError.message}`);
      }
    }

    console.log('\n3️⃣ Verification - checking updated assistants...');
    
    // Verify the updates
    const updatedAssistants = await vapiClient.assistants.list();
    
    for (const assistant of updatedAssistants) {
      const hasCorrectUrl = assistant.serverUrl === SERVER_URL;
      const status = hasCorrectUrl ? '✅' : '❌';
      console.log(`   ${status} "${assistant.name}": ${assistant.serverUrl || 'No server URL set'}`);
    }

    console.log('\n🎉 Server URL configuration complete!');
    console.log('\n💡 What happens now:');
    console.log('   • VAPI will send webhooks to your endpoint when calls start/end');
    console.log('   • Your system will receive call.start and call.end events');
    console.log('   • Telegram upload tasks will be queued when calls end');
    console.log('   • Audio recordings will be sent to your Telegram channel');
    console.log('\n🧪 Test by making a VAPI call and checking the logs!');

  } catch (error) {
    console.error('❌ Error setting server URL:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  setVapiServerUrl();
}

module.exports = { setVapiServerUrl };
