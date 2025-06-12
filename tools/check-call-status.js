#!/usr/bin/env node

/**
 * Check VAPI Call Status Script
 * Monitors a specific VAPI call for errors and status updates
 */

require('dotenv').config();
const { getCallDetails } = require('../src/vapi-service');

// Get call ID from command line or use the latest test call
const callId = process.argv[2] || 'd5b7772c-8647-487a-b879-169fc74a3e10';

async function checkCallStatus() {
  console.log('🔍 Checking VAPI Call Status...\n');

  if (!process.env.VAPI_API_KEY) {
    console.error('❌ VAPI_API_KEY not found in environment variables');
    process.exit(1);
  }

  console.log(`📞 Call ID: ${callId}`);
  console.log(`🌐 Dashboard: https://dashboard.vapi.ai/calls/${callId}\n`);

  try {
    console.log('📋 Fetching call details...');
    const callDetails = await getCallDetails(callId);

    if (!callDetails) {
      console.error('❌ Call not found or could not fetch details');
      process.exit(1);
    }

    console.log('\n📊 Call Status:');
    console.log(`   Status: ${callDetails.status || 'unknown'}`);
    console.log(`   Created: ${callDetails.createdAt || 'unknown'}`);
    console.log(`   Updated: ${callDetails.updatedAt || 'unknown'}`);

    if (callDetails.customer) {
      console.log(`   Customer: ${callDetails.customer.number || 'unknown'}`);
    }

    if (callDetails.phoneNumber) {
      console.log(`   Phone Provider: Twilio (${callDetails.phoneNumber.twilioPhoneNumber || 'unknown'})`);
    } else if (callDetails.phoneNumberId) {
      console.log(`   Phone Provider: VAPI (ID: ${callDetails.phoneNumberId})`);
    }

    // Check for voice configuration
    if (callDetails.assistant && callDetails.assistant.voice) {
      console.log('\n🎤 Voice Configuration:');
      console.log(`   Provider: ${callDetails.assistant.voice.provider || 'unknown'}`);
      console.log(`   Voice ID: ${callDetails.assistant.voice.voiceId || 'unknown'}`);
      console.log(`   Language: ${callDetails.assistant.voice.language || 'unknown'}`);
      console.log(`   Speed: ${callDetails.assistant.voice.speed || 'unknown'}`);

      // Check for ElevenLabs
      if (callDetails.assistant.voice.provider === 'elevenlabs') {
        console.log('   ⚠️  WARNING: ElevenLabs voice detected!');
      } else if (callDetails.assistant.voice.provider === 'vapi') {
        console.log('   ✅ VAPI native voice confirmed');
      }
    }

    // Check for errors
    console.log('\n🔍 Error Analysis:');
    if (callDetails.error) {
      console.log(`   ❌ Error: ${callDetails.error}`);
      
      if (callDetails.error.includes('eleven-labs-voice-failed')) {
        console.log('   🚨 ElevenLabs pipeline error detected!');
        console.log('   💡 This indicates an ElevenLabs voice configuration is still being used');
      }
    } else {
      console.log('   ✅ No errors detected');
    }

    // Check call duration and success
    if (callDetails.startedAt && callDetails.endedAt) {
      const startTime = new Date(callDetails.startedAt);
      const endTime = new Date(callDetails.endedAt);
      const duration = Math.round((endTime - startTime) / 1000);
      
      console.log('\n⏱️  Call Duration:');
      console.log(`   Started: ${startTime.toLocaleString()}`);
      console.log(`   Ended: ${endTime.toLocaleString()}`);
      console.log(`   Duration: ${duration} seconds`);

      if (duration > 300) { // 5 minutes
        console.log('   🎯 SUCCESS: Call lasted longer than 5 minutes!');
      } else if (duration > 60) {
        console.log('   ✅ Good: Call lasted over 1 minute');
      } else if (duration > 10) {
        console.log('   ⚠️  Short call: Less than 1 minute');
      } else {
        console.log('   ❌ Very short call: Likely failed quickly');
      }
    } else if (callDetails.startedAt) {
      console.log('\n📞 Call Status:');
      console.log(`   Started: ${new Date(callDetails.startedAt).toLocaleString()}`);
      console.log('   Status: Still in progress');
    } else {
      console.log('\n📞 Call Status:');
      console.log('   Status: Not yet started or failed to start');
    }

    // Check transcript for insights
    if (callDetails.transcript) {
      console.log('\n📝 Transcript Available:');
      console.log(`   Length: ${callDetails.transcript.length} characters`);
      
      // Look for common error indicators in transcript
      const transcript = callDetails.transcript.toLowerCase();
      if (transcript.includes('error') || transcript.includes('failed')) {
        console.log('   ⚠️  Potential errors mentioned in transcript');
      } else if (transcript.length > 100) {
        console.log('   ✅ Substantial conversation detected');
      }
    }

    // Overall assessment
    console.log('\n🎯 Overall Assessment:');
    if (callDetails.error && callDetails.error.includes('eleven-labs-voice-failed')) {
      console.log('   ❌ FAILED: ElevenLabs pipeline error still occurring');
      console.log('   💡 Need to investigate voice configuration further');
    } else if (callDetails.status === 'completed' && !callDetails.error) {
      console.log('   ✅ SUCCESS: Call completed without voice errors');
    } else if (callDetails.status === 'in-progress') {
      console.log('   🔄 IN PROGRESS: Call is currently active');
    } else if (callDetails.status === 'queued') {
      console.log('   ⏳ QUEUED: Call is waiting to start');
    } else {
      console.log(`   ❓ UNKNOWN: Status is "${callDetails.status || 'unknown'}"`);
    }

  } catch (error) {
    console.error('\n❌ Failed to check call status:', error.message);
    
    if (error.message.includes('404') || error.message.includes('not found')) {
      console.log('\n💡 Call ID troubleshooting:');
      console.log('   - Verify the call ID is correct');
      console.log('   - Check if the call was created successfully');
      console.log('   - Try checking the VAPI dashboard directly');
    }
    
    process.exit(1);
  }

  console.log('\n📱 Next Steps:');
  console.log('   1. Monitor the call in VAPI dashboard');
  console.log('   2. Check for any new error messages');
  console.log('   3. Test answering the call if it\'s still active');
  console.log(`   4. Dashboard: https://dashboard.vapi.ai/calls/${callId}`);
}

// Run the check
if (require.main === module) {
  checkCallStatus().catch(error => {
    console.error('❌ Status check failed:', error);
    process.exit(1);
  });
}

module.exports = { checkCallStatus };
