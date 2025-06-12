#!/usr/bin/env node

/**
 * S3 Recording Polling Script
 * Polls S3 for new recordings and triggers processing
 * Can be run as a cron job or called periodically
 */

require('dotenv').config();
const axios = require('axios');

// Configuration
const POLL_INTERVAL = 30000; // 30 seconds
const MAX_POLLS = 10; // Maximum number of polls before stopping
const BASE_URL = process.env.VERCEL 
  ? 'https://sip-sentinel.vercel.app'
  : 'http://localhost:3000';

let pollCount = 0;

/**
 * Poll for new recordings
 */
async function pollForRecordings() {
  try {
    console.log(`🔍 Polling for new recordings (${pollCount + 1}/${MAX_POLLS})...`);
    
    const response = await axios.get(`${BASE_URL}/api/s3-recording-processor`, {
      timeout: 30000 // 30 second timeout
    });
    
    if (response.data.success) {
      const { newRecordings, recordings } = response.data;
      
      if (newRecordings > 0) {
        console.log(`✅ Found and processed ${newRecordings} new recordings`);
        recordings.forEach(recording => {
          console.log(`  - ${recording.recordingSid} (${recording.size} bytes)`);
        });
      } else {
        console.log('📭 No new recordings found');
      }
    } else {
      console.error('❌ Polling failed:', response.data.error);
    }
    
  } catch (error) {
    console.error('❌ Error polling for recordings:', error.message);
    
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

/**
 * Start continuous polling
 */
async function startPolling() {
  console.log('🚀 Starting S3 recording polling...');
  console.log(`📊 Configuration:`);
  console.log(`  - Base URL: ${BASE_URL}`);
  console.log(`  - Poll interval: ${POLL_INTERVAL}ms`);
  console.log(`  - Max polls: ${MAX_POLLS}`);
  console.log('');
  
  // Initial poll
  await pollForRecordings();
  pollCount++;
  
  // Set up interval polling
  const interval = setInterval(async () => {
    if (pollCount >= MAX_POLLS) {
      console.log(`🏁 Reached maximum polls (${MAX_POLLS}), stopping...`);
      clearInterval(interval);
      return;
    }
    
    await pollForRecordings();
    pollCount++;
  }, POLL_INTERVAL);
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, stopping polling...');
    clearInterval(interval);
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, stopping polling...');
    clearInterval(interval);
    process.exit(0);
  });
}

/**
 * Single poll (for cron jobs)
 */
async function singlePoll() {
  console.log('🔍 Running single poll for new recordings...');
  await pollForRecordings();
  console.log('✅ Single poll completed');
}

/**
 * Test the polling endpoint
 */
async function testEndpoint() {
  try {
    console.log('🧪 Testing S3 recording processor endpoint...');
    
    const response = await axios.get(`${BASE_URL}/api/s3-recording-processor`, {
      timeout: 10000
    });
    
    console.log('✅ Endpoint is responding');
    console.log('Response:', response.data);
    
  } catch (error) {
    console.error('❌ Endpoint test failed:', error.message);
    
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
  }
}

/**
 * Process a specific recording manually
 */
async function processSpecificRecording(recordingSid, callSid) {
  try {
    console.log(`🎵 Processing specific recording: ${recordingSid}`);
    
    const response = await axios.post(`${BASE_URL}/api/s3-recording-processor`, {
      recordingSid: recordingSid,
      callSid: callSid
    }, {
      timeout: 30000
    });
    
    if (response.data.success) {
      console.log('✅ Recording processed successfully');
      console.log('Response:', response.data);
    } else {
      console.error('❌ Processing failed:', response.data.error);
    }
    
  } catch (error) {
    console.error('❌ Error processing recording:', error.message);
    
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
  }
}

// Handle command line arguments
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'start':
  case 'continuous':
    startPolling();
    break;
    
  case 'single':
  case 'once':
    singlePoll();
    break;
    
  case 'test':
    testEndpoint();
    break;
    
  case 'process':
    const recordingSid = args[1];
    const callSid = args[2];
    
    if (!recordingSid) {
      console.error('❌ Recording SID is required for process command');
      console.log('Usage: node poll-s3-recordings.js process <recordingSid> [callSid]');
      process.exit(1);
    }
    
    processSpecificRecording(recordingSid, callSid);
    break;
    
  case 'help':
  case '--help':
  case '-h':
    console.log('S3 Recording Polling Script');
    console.log('');
    console.log('Usage:');
    console.log('  node poll-s3-recordings.js <command> [options]');
    console.log('');
    console.log('Commands:');
    console.log('  start, continuous  Start continuous polling');
    console.log('  single, once       Run a single poll');
    console.log('  test              Test the endpoint');
    console.log('  process <sid>     Process a specific recording');
    console.log('  help              Show this help');
    console.log('');
    console.log('Examples:');
    console.log('  node poll-s3-recordings.js start');
    console.log('  node poll-s3-recordings.js single');
    console.log('  node poll-s3-recordings.js test');
    console.log('  node poll-s3-recordings.js process RE1234567890abcdef');
    break;
    
  default:
    if (command) {
      console.error(`❌ Unknown command: ${command}`);
    } else {
      console.log('🔍 No command specified, running single poll...');
      singlePoll();
    }
    break;
}

module.exports = {
  pollForRecordings,
  startPolling,
  singlePoll,
  testEndpoint,
  processSpecificRecording
};
