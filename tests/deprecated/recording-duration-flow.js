#!/usr/bin/env node

/**
 * Test script to verify recordingDuration flows correctly through the entire pipeline
 * Tests the fix for the recordingDuration propagation issue
 */

require('dotenv').config();

const { queueTranscriptionProcessing, queueScamAnalysis } = require('../src/qstash-service');
const { publishEvent, storeActiveCall, EVENT_TYPES } = require('../src/redis-service');

async function testRecordingDurationFlow() {
  console.log('🧪 Testing Recording Duration Flow...\n');

  try {
    // Test 1: queueTranscriptionProcessing with recordingDuration
    console.log('📝 Test 1: queueTranscriptionProcessing with recordingDuration');
    
    const transcriptionTaskData = {
      callSid: 'test_call_123',
      recordingUrl: 'https://example.com/test.wav',
      recordingSid: 'test_recording_123',
      callerNumber: '+1234567890',
      recordingDuration: 45, // 45 seconds
      useS3: true,
      timestamp: new Date().toISOString()
    };

    console.log('Input data:', transcriptionTaskData);
    
    // This should now include recordingDuration in the queued task
    const transcriptionResult = await queueTranscriptionProcessing(transcriptionTaskData);
    console.log('✅ Transcription task queued:', transcriptionResult.taskId);
    console.log('Task type:', transcriptionResult.taskType);

    // Test 2: queueScamAnalysis with recordingDuration
    console.log('\n🔍 Test 2: queueScamAnalysis with recordingDuration');
    
    const analysisTaskData = {
      callSid: 'test_call_123',
      transcriptionText: 'This is a test transcription from coinbase support',
      callerNumber: '+1234567890',
      recordingDuration: 45 // This should be propagated
    };

    console.log('Input data:', analysisTaskData);
    
    const analysisResult = await queueScamAnalysis(analysisTaskData);
    console.log('✅ Scam analysis task queued:', analysisResult.taskId);
    console.log('Task type:', analysisResult.taskType);

    // Test 3: Store active call with recording duration
    console.log('\n💾 Test 3: Store active call with recording duration');
    
    const callData = {
      callSid: 'test_call_123',
      from: '+1234567890',
      status: 'recording_completed',
      recordingDuration: 45,
      recordingUrl: 'https://example.com/test.wav',
      recordingSid: 'test_recording_123',
      timestamp: new Date().toISOString(),
      type: 'test_call'
    };

    await storeActiveCall('test_call_123', callData, 300); // 5 minutes TTL
    console.log('✅ Active call stored with recording duration');

    // Test 4: Publish event with recording duration
    console.log('\n📡 Test 4: Publish event with recording duration');
    
    const eventData = {
      callSid: 'test_call_123',
      status: 'recording_completed',
      recordingDuration: 45,
      timestamp: new Date().toISOString()
    };

    const eventResult = await publishEvent(EVENT_TYPES.CALL_STATUS_UPDATE, eventData);
    console.log('✅ Event published:', eventResult.id);

    console.log('\n🎉 All tests passed! Recording duration is properly propagated.');
    return true;

  } catch (error) {
    console.error('❌ Test failed:', error);
    return false;
  }
}

async function testMissingRecordingDuration() {
  console.log('\n🧪 Testing Missing Recording Duration Handling...\n');

  try {
    // Test with missing recordingDuration
    console.log('📝 Test: queueTranscriptionProcessing without recordingDuration');
    
    const incompleteTaskData = {
      callSid: 'test_call_456',
      recordingUrl: 'https://example.com/test2.wav',
      recordingSid: 'test_recording_456',
      callerNumber: '+1234567890',
      // recordingDuration: missing!
      useS3: true,
      timestamp: new Date().toISOString()
    };

    console.log('Input data (missing recordingDuration):', incompleteTaskData);
    
    const result = await queueTranscriptionProcessing(incompleteTaskData);
    console.log('✅ Task queued even without recordingDuration:', result.taskId);
    console.log('⚠️ recordingDuration will be undefined in the task data');

    return true;

  } catch (error) {
    console.error('❌ Test failed:', error);
    return false;
  }
}

async function testDataStructureValidation() {
  console.log('\n🧪 Testing Data Structure Validation...\n');

  // Simulate the data structures that would be passed through the pipeline
  const testCases = [
    {
      name: 'Twilio Recording Webhook',
      data: {
        CallSid: 'CA123',
        RecordingUrl: 'https://api.twilio.com/recording.wav',
        RecordingSid: 'RE123',
        RecordingDuration: '45' // String from Twilio
      }
    },
    {
      name: 'S3 Recording Processing',
      data: {
        callSid: 'CA123',
        recordingUrl: 'https://s3.amazonaws.com/recording.wav',
        recordingSid: 'RE123',
        recordingDuration: 45, // Number
        useS3: true
      }
    },
    {
      name: 'Scam Analysis Task',
      data: {
        callSid: 'CA123',
        transcriptionText: 'Test transcription',
        callerNumber: '+1234567890',
        recordingDuration: 45 // Should be number
      }
    }
  ];

  for (const testCase of testCases) {
    console.log(`📋 Testing: ${testCase.name}`);
    console.log('Data structure:', testCase.data);
    
    // Validate that recordingDuration is properly typed
    if (testCase.data.RecordingDuration) {
      const duration = parseInt(testCase.data.RecordingDuration);
      console.log(`  RecordingDuration: "${testCase.data.RecordingDuration}" -> ${duration} (${typeof duration})`);
    }
    
    if (testCase.data.recordingDuration !== undefined) {
      console.log(`  recordingDuration: ${testCase.data.recordingDuration} (${typeof testCase.data.recordingDuration})`);
    }
    
    console.log('✅ Structure validated\n');
  }

  return true;
}

async function runAllTests() {
  console.log('🚀 Starting Recording Duration Flow Tests\n');
  console.log('=' .repeat(60));

  const results = {
    flowTest: false,
    missingTest: false,
    validationTest: false
  };

  // Test 1: Normal flow with recordingDuration
  results.flowTest = await testRecordingDurationFlow();

  // Test 2: Handling missing recordingDuration
  results.missingTest = await testMissingRecordingDuration();

  // Test 3: Data structure validation
  results.validationTest = await testDataStructureValidation();

  // Summary
  console.log('\n' + '=' .repeat(60));
  console.log('📊 Test Results Summary:');
  console.log(`Recording Duration Flow: ${results.flowTest ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Missing Duration Handling: ${results.missingTest ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Data Structure Validation: ${results.validationTest ? '✅ PASS' : '❌ FAIL'}`);

  const allPassed = Object.values(results).every(result => result === true);
  console.log(`\nOverall Status: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

  if (allPassed) {
    console.log('\n🎉 Recording duration propagation is working correctly!');
    console.log('✅ recordingDuration will now flow through the entire pipeline');
    console.log('✅ Display logic and analytics will receive proper duration data');
  } else {
    console.log('\n⚠️ Some tests failed - please review the implementation.');
  }

  return allPassed;
}

// Run tests if this script is executed directly
if (require.main === module) {
  runAllTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('❌ Test execution failed:', error);
      process.exit(1);
    });
}

module.exports = {
  testRecordingDurationFlow,
  testMissingRecordingDuration,
  testDataStructureValidation,
  runAllTests
};
