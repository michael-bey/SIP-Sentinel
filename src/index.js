require('dotenv').config();
const express = require('express');
const path = require('path');
const twilio = require('twilio');
const axios = require('axios');
const { VapiClient } = require('@vapi-ai/server-sdk');
const { transcribeAudioFromUrl, getOrCreateTranscription } = require('./transcription-service');
const { analyzeMessageWithLLM, shouldEngageScammer, SCAM_DETECTION_THRESHOLDS } = require('./llm-scam-detector');
const { S3Client, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const {
  storeCallMetadata,
  storeTranscription,
  getCallMetadata,
  getTranscription,
  listRecentCallMetadata
} = require('./s3-storage-service');

// Check for help command first
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
=== SIPSentinel - Scam Detection Service ===

USAGE:
  node src/index.js [OPTIONS]

OPTIONS:
  --web-ui      Start with web dashboard (default)
  --headless    Start in headless mode (webhooks only)
  --help, -h    Show this help message

DESCRIPTION:
  SIPSentinel is a scam detection service that monitors phone calls and text messages
  for cryptocurrency exchange and IT support scams. When a scam is detected, it
  automatically triggers VAPI agent calls to engage with the scammers.

HONEYPOT NUMBER:
  ${process.env.TWILIO_PHONE_NUMBER || 'Not configured'}
  Call or text this number to test scam detection

EXAMPLES:
  node src/index.js --web-ui     # Start with web dashboard
  node src/index.js --headless   # Start in headless mode
  npm run web-ui                 # Start with web dashboard
  npm run headless               # Start in headless mode

For more information, visit: https://github.com/your-repo/sipsentinel
`);
  process.exit(0);
}

// Check if running in CLI mode (from environment variable or command line arguments)
const isCliMode = process.env.SIPSENTINEL_MODE;
const hasHeadlessArg = process.argv.includes('--headless');
const hasWebUIArg = process.argv.includes('--web-ui');

const isHeadlessMode = isCliMode === 'headless' || hasHeadlessArg;
const isWebUIMode = isCliMode === 'web-ui' || hasWebUIArg || (!isCliMode && !hasHeadlessArg);

/**
 * Extract bucket name and key from S3 URL
 * @param {string} url - The S3 URL
 * @returns {Object} - The bucket and key
 */
function parseS3Url(url) {
  // Handle URLs in the format: https://bucket-name.s3.region.amazonaws.com/key
  // or https://s3.region.amazonaws.com/bucket-name/key
  let bucket, key;

  // For Twilio recordings, always use the sip-sentinel bucket
  if (url.includes('sip-sentinel.s3.us-west-2.amazonaws.com')) {
    // Special case for Twilio recordings
    const parts = url.split('amazonaws.com/')[1].split('/');
    bucket = 'sip-sentinel';
    key = parts.join('/');
  } else if (url.includes('s3.us-west-2.amazonaws.com')) {
    // For Twilio recordings in the format: https://s3.us-west-2.amazonaws.com/bucket-name/key
    // Always use sip-sentinel bucket for Twilio recordings
    bucket = 'sip-sentinel';

    // Extract the key from the URL
    const urlParts = url.split('s3.us-west-2.amazonaws.com/');
    if (urlParts.length > 1) {
      const pathParts = urlParts[1].split('/');
      // Skip the first part (account SID) and use the rest as the key
      key = pathParts.join('/');
    }
  } else if (url.includes('s3.amazonaws.com/')) {
    // Format: https://s3.region.amazonaws.com/bucket-name/key
    const parts = url.split('s3.amazonaws.com/')[1].split('/');
    bucket = parts[0];
    key = parts.slice(1).join('/');
  } else if (url.includes('.s3.')) {
    // Format: https://bucket-name.s3.region.amazonaws.com/key
    const urlObj = new URL(url);
    const hostParts = urlObj.hostname.split('.');
    bucket = hostParts[0];
    key = urlObj.pathname.substring(1); // Remove leading slash
  }

  // If we couldn't parse the URL, use default values
  if (!bucket || !key) {
    console.log('Could not parse S3 URL correctly, using default values');
    bucket = 'sip-sentinel';
    key = `unknown-key-${Date.now()}`;
  }

  console.log(`Parsed S3 URL - Bucket: ${bucket}, Key: ${key}`);
  return { bucket, key };
}

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Add this for handling form data from Twilio

// Only serve static files in web UI mode
if (isWebUIMode) {
  // Serve static files with proper cache headers
  app.use(express.static(path.join(__dirname, '../public'), {
    setHeaders: (res, path) => {
      // Disable caching for HTML files to ensure fresh content
      if (path.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
      // Allow short-term caching for JS/CSS but enable revalidation
      else if (path.endsWith('.js') || path.endsWith('.css')) {
        res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
      }
    }
  }));
}

// Basic environment variable validation for critical endpoints
function validateEnvironment() {
  const required = ['VAPI_API_KEY'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.warn(`Missing environment variables: ${missing.join(', ')}`);
    return false;
  }
  return true;
}

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Function to fetch transcription from Twilio
async function fetchTranscription(recordingSid) {
  try {
    console.log(`Fetching transcription for recording: ${recordingSid}`);

    // First, get the recording to check if it's completed
    const recording = await twilioClient.recordings(recordingSid).fetch();
    console.log('Recording details:', recording);

    if (recording.status !== 'completed') {
      console.log(`Recording status is ${recording.status}, not completed yet`);
      return null;
    }

    // Get the recording media URL
    const recordingUrl = recording.mediaUrl;
    console.log('Recording URL:', recordingUrl);

    // Get all transcriptions for this recording
    const transcriptions = await twilioClient.transcriptions.list({
      recordingSid: recordingSid
    });

    console.log(`Found ${transcriptions.length} transcriptions for recording ${recordingSid}`);

    // If we have transcriptions, try to get the completed one
    if (transcriptions.length > 0) {
      // Sort by date created (newest first) to get the most recent one
      transcriptions.sort((a, b) => new Date(b.dateCreated) - new Date(a.dateCreated));

      // Get the most recent transcription
      const transcription = transcriptions[0];
      console.log('Transcription details:', transcription);

      // If transcription is completed, fetch the transcription text
      if (transcription.status === 'completed') {
        // Fetch the transcription text
        const transcriptionText = await twilioClient
          .transcriptions(transcription.sid)
          .fetch()
          .then(t => t.transcriptionText);

        console.log('Transcription text:', transcriptionText);
        return transcriptionText;
      } else if (transcription.status === 'failed') {
        console.log('Twilio transcription failed. Using our custom transcription service...');

        try {
          // Use our custom transcription service with the recording URL
          console.log('Attempting to transcribe using third-party service:', recordingUrl);
          const customTranscription = await transcribeAudioFromUrl(recordingUrl);

          if (customTranscription) {
            console.log('Successfully transcribed using custom service:', customTranscription);
            return customTranscription;
          } else {
            console.log('Custom transcription service returned no results');
          }
        } catch (customTranscriptionError) {
          console.error('Error using custom transcription service:', customTranscriptionError);
          console.log('Recording URL for manual processing:', recordingUrl);
        }
      } else {
        console.log(`Transcription status is ${transcription.status}, not ready yet`);
      }
    } else {
      console.log('No Twilio transcriptions found. Using our custom transcription service...');

      try {
        // Use our custom transcription service with the recording URL
        console.log('Attempting to transcribe using third-party service:', recordingUrl);
        const customTranscription = await transcribeAudioFromUrl(recordingUrl);

        if (customTranscription) {
          console.log('Successfully transcribed using custom service:', customTranscription);
          return customTranscription;
        } else {
          console.log('Custom transcription service returned no results');
        }
      } catch (customTranscriptionError) {
        console.error('Error using custom transcription service:', customTranscriptionError);
        console.log('Recording URL for manual processing:', recordingUrl);
      }
    }

    console.log('No completed transcription found');
    return null;
  } catch (error) {
    console.error('Error fetching transcription:', error);
    return null;
  }
}

/**
 * Redact phone numbers from transcript text for privacy protection
 * Handles various phone number formats including spaced digits
 * @param {string} text - Text to redact phone numbers from
 * @returns {string} Text with phone numbers redacted
 */
function redactPhoneNumbersFromTranscript(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }

  let redactedText = text;

  // Pattern 1: Spaced digits like "3 3 0 9 7 8 8 9 4 7" (common in voicemail transcripts)
  // Matches 10-11 digits with spaces between them
  const spacedDigitsPattern = /\b(\d\s){9,10}\d\b/g;
  redactedText = redactedText.replace(spacedDigitsPattern, (match) => {
    const digits = match.replace(/\s/g, '');
    return redactPhoneNumber(digits);
  });

  // Pattern 2: Standard phone number formats
  const phonePatterns = [
    // US formats with country code
    /\+?1[-.\s]?(\d{3})[-.\s]?(\d{3})[-.\s]?(\d{4})\b/g,
    // US formats without country code:
    /\b(\d{3})[-.\s]?(\d{3})[-.\s]?(\d{4})\b/g,
    // Parentheses format: 
    /\(\d{3}\)\s?-?\d{3}-?\d{4}\b/g,
    // Long format without separators
    /\b1?\d{10}\b/g
  ];

  phonePatterns.forEach(pattern => {
    redactedText = redactedText.replace(pattern, (match) => {
      // Extract just the digits
      const digits = match.replace(/\D/g, '');
      // Only redact if it looks like a valid phone number (10-11 digits)
      if (digits.length >= 10 && digits.length <= 11) {
        return redactPhoneNumber(digits);
      }
      return match; // Return original if not a valid phone number
    });
  });

  return redactedText;
}

// Function to format transcript for better display
function formatTranscriptForDisplay(transcriptionText, callSid) {
  if (!transcriptionText) return 'No transcript available';

  // Clean up the transcript but preserve all content
  let formatted = transcriptionText.trim();

  // Redact phone numbers from the transcript for privacy
  formatted = redactPhoneNumbersFromTranscript(formatted);

  // Only add line breaks at sentence endings if they don't already exist
  // Be more conservative to avoid losing content
  formatted = formatted.replace(/\.\s+/g, '.\n');
  formatted = formatted.replace(/\?\s+/g, '?\n');
  formatted = formatted.replace(/!\s+/g, '!\n');

  // Remove excessive line breaks (3 or more) but keep double line breaks
  formatted = formatted.replace(/\n{3,}/g, '\n\n');

  // Add a header with call information
  const header = `=== VOICEMAIL TRANSCRIPT ===\nCall ID: ${callSid}\nTranscribed: ${new Date().toLocaleString()}\n\n`;

  // Log the original and formatted transcript for debugging
  console.log(`[TRANSCRIPT DEBUG] Original length: ${transcriptionText.length}, Formatted length: ${formatted.length}`);
  if (transcriptionText.length !== formatted.length) {
    console.log(`[TRANSCRIPT DEBUG] Original: "${transcriptionText}"`);
    console.log(`[TRANSCRIPT DEBUG] Formatted: "${formatted}"`);
  }

  return header + formatted;
}

// Initialize VAPI client
const vapiClient = new VapiClient({
  token: process.env.VAPI_API_KEY
});

// Import VAPI service
const {
  listVapiAssistants,
  listVapiPhoneNumbers,
  createVapiCall: createVapiCallService,
  findAgentForCompany,
  getCallAnalytics,
  handleVapiWebhook,
  getCallDetails,
  getOrCreateVapiPhoneNumber,
  listVapiCalls,
  getVapiCallRecording,
  detectGenderFromName,
  redactPhoneNumber,
  getRandomVoice,
  callTracker,
  extractCompanyFromAgent
} = require('./vapi-service');

// Import webhook service
const {
  WEBHOOK_EVENTS,
  notifyAgentCallInitiated,
  notifyAgentCallStatus,
  notifyScamDetected,
  getWebhookUrls,
  getWebhookSecret,
  getSlackWebhookUrl,
  getTelegramConfig,
  sendSlackNotification,
  sendTelegramNotification
} = require('./webhook-service');

// Import async processor for timeout optimization
const {
  processScamDetectionAsync,
  processWebhooksAsync,
  queueAsyncTask,
  getTaskStatus
} = require('./async-processor');

// Async function to process transcription without blocking the webhook response
async function processTranscriptionAsync(transcriptionText, callerNumber, callSid, recordingSid) {
  try {
    console.log('🔄 Starting async transcription processing...');

    // Store the transcription in S3 (fast operation)
    if (callSid && recordingSid) {
      try {
        await storeTranscription(callSid, recordingSid, transcriptionText);
        console.log(`✅ Transcription stored in S3`);
      } catch (storageError) {
        console.error('❌ Error storing transcription in S3:', storageError);
        // Continue even if storage fails
      }
    }

    // Quick regex-based scam detection (fast operation)
    const regexAnalysis = isLikelyScam(transcriptionText);
    console.log('🔍 Regex analysis:', { isScam: regexAnalysis.isScam, score: regexAnalysis.scamDetails?.scamScore });

    // Update live call status if we have a call SID
    if (callSid && dashboardState.liveCallsMap.has(callSid)) {
      const liveCall = dashboardState.liveCallsMap.get(callSid);
      liveCall.status = regexAnalysis.isScam ? 'scam_detected' : 'processing';
      liveCall.lastUpdate = new Date();
      dashboardState.liveCallsMap.set(callSid, liveCall);

      // Broadcast status update
      broadcastToSSEClients({
        type: regexAnalysis.isScam ? 'scam_detected' : 'call_status_update',
        data: {
          callSid: callSid,
          status: liveCall.status,
          scamType: regexAnalysis.scamType,
          confidence: regexAnalysis.scamDetails?.scamScore * 10 || 0
        }
      });
    }

    // If regex detects a scam, proceed with async processing
    if (regexAnalysis.isScam && callerNumber) {
      console.log('🚨 Scam detected by regex, starting async processing...');

      // Queue the heavy LLM analysis and VAPI call creation for async processing
      const taskId = `scam-detection-${callSid}-${Date.now()}`;
      const result = await processScamDetectionAsync(transcriptionText, callerNumber, callSid, regexAnalysis);

      console.log('✅ Async scam processing completed:', result);

      // Clean up live call tracking
      if (callSid && dashboardState.liveCallsMap.has(callSid)) {
        dashboardState.liveCallsMap.delete(callSid);
        broadcastToSSEClients({
          type: 'call_processed',
          data: {
            callSid: callSid,
            scamDetected: true,
            result: result
          }
        });
      }

      return result;
    } else {
      console.log('ℹ️ No scam detected by regex analysis');

      // Clean up live call tracking
      if (callSid && dashboardState.liveCallsMap.has(callSid)) {
        dashboardState.liveCallsMap.delete(callSid);
        broadcastToSSEClients({
          type: 'call_processed',
          data: {
            callSid: callSid,
            scamDetected: false,
            message: 'No scam detected - call processed'
          }
        });
      }

      return { success: true, scamDetected: false, reason: 'no_scam_detected' };
    }
  } catch (error) {
    console.error('❌ Error in async transcription processing:', error);

    // Clean up live call tracking on error
    if (callSid && dashboardState.liveCallsMap.has(callSid)) {
      const liveCall = dashboardState.liveCallsMap.get(callSid);
      liveCall.status = 'processing_failed';
      liveCall.lastUpdate = new Date();
      dashboardState.liveCallsMap.set(callSid, liveCall);

      broadcastToSSEClients({
        type: 'call_status_update',
        data: {
          callSid: callSid,
          status: 'processing_failed',
          message: 'Error processing transcription'
        }
      });
    }

    return { success: false, error: error.message };
  }
}

// Async function to process fallback transcription when Twilio transcription fails
async function processFallbackTranscriptionAsync(recordingSid, callerNumber, callSid) {
  try {
    console.log('🔄 Starting fallback transcription processing...');

    // Get the recording details
    const recording = await twilioClient.recordings(recordingSid).fetch();
    const recordingUrl = recording.mediaUrl;
    console.log('Recording URL for fallback transcription:', recordingUrl);

    // Use our custom transcription service
    const customTranscription = await transcribeAudioFromUrl(recordingUrl);

    if (customTranscription) {
      console.log('Successfully transcribed using fallback service:', customTranscription);

      // Store the transcription in S3
      if (callSid && recordingSid) {
        try {
          await storeTranscription(callSid, recordingSid, customTranscription);
          console.log(`✅ Fallback transcription stored in S3`);
        } catch (storageError) {
          console.error('❌ Error storing fallback transcription in S3:', storageError);
        }
      }

      // Quick regex-based scam detection
      const regexAnalysis = isLikelyScam(customTranscription);
      console.log('🔍 Fallback regex analysis:', { isScam: regexAnalysis.isScam, score: regexAnalysis.scamDetails?.scamScore });

      // Update live call status
      if (callSid && dashboardState.liveCallsMap.has(callSid)) {
        const liveCall = dashboardState.liveCallsMap.get(callSid);
        liveCall.status = regexAnalysis.isScam ? 'scam_detected' : 'processing';
        liveCall.lastUpdate = new Date();
        dashboardState.liveCallsMap.set(callSid, liveCall);

        // Broadcast status update
        broadcastToSSEClients({
          type: regexAnalysis.isScam ? 'scam_detected' : 'call_status_update',
          data: {
            callSid: callSid,
            status: liveCall.status,
            scamType: regexAnalysis.scamType,
            confidence: regexAnalysis.scamDetails?.scamScore * 10 || 0
          }
        });
      }

      // If scam detected, proceed with async processing
      if (regexAnalysis.isScam && callerNumber) {
        console.log('🚨 Scam detected in fallback transcription, starting async processing...');

        const result = await processScamDetectionAsync(customTranscription, callerNumber, callSid, regexAnalysis);
        console.log('✅ Async scam processing completed for fallback:', result);

        // Clean up live call tracking
        if (callSid && dashboardState.liveCallsMap.has(callSid)) {
          dashboardState.liveCallsMap.delete(callSid);
          broadcastToSSEClients({
            type: 'call_processed',
            data: {
              callSid: callSid,
              scamDetected: true,
              result: result
            }
          });
        }

        return result;
      } else {
        console.log('ℹ️ No scam detected in fallback transcription');

        // Clean up live call tracking
        if (callSid && dashboardState.liveCallsMap.has(callSid)) {
          dashboardState.liveCallsMap.delete(callSid);
          broadcastToSSEClients({
            type: 'call_processed',
            data: {
              callSid: callSid,
              scamDetected: false,
              message: 'No scam detected in fallback transcription'
            }
          });
        }

        return { success: true, scamDetected: false, reason: 'no_scam_detected' };
      }
    } else {
      console.log('❌ Fallback transcription service returned no results');
      return { success: false, error: 'No transcription available' };
    }
  } catch (error) {
    console.error('❌ Error in fallback transcription processing:', error);

    // Clean up live call tracking on error
    if (callSid && dashboardState.liveCallsMap.has(callSid)) {
      const liveCall = dashboardState.liveCallsMap.get(callSid);
      liveCall.status = 'processing_failed';
      liveCall.lastUpdate = new Date();
      dashboardState.liveCallsMap.set(callSid, liveCall);

      broadcastToSSEClients({
        type: 'call_status_update',
        data: {
          callSid: callSid,
          status: 'processing_failed',
          message: 'Error in fallback transcription processing'
        }
      });
    }

    return { success: false, error: error.message };
  }
}

// Async function to process delayed transcription when no text is provided initially
async function processDelayedTranscriptionAsync(recordingSid, callerNumber, callSid) {
  try {
    console.log('🔄 Starting delayed transcription processing...');

    // Wait a bit for Twilio to process the transcription
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Try to fetch the transcription using our improved function
    const fetchedTranscription = await fetchTranscription(recordingSid);

    if (fetchedTranscription) {
      console.log('Successfully fetched delayed transcription:', fetchedTranscription);

      // Process the transcription normally
      return await processTranscriptionAsync(fetchedTranscription, callerNumber, callSid, recordingSid);
    } else {
      console.log('Could not fetch transcription, trying fallback service...');

      // Use fallback transcription service
      return await processFallbackTranscriptionAsync(recordingSid, callerNumber, callSid);
    }
  } catch (error) {
    console.error('❌ Error in delayed transcription processing:', error);

    // Clean up live call tracking on error
    if (callSid && dashboardState.liveCallsMap.has(callSid)) {
      const liveCall = dashboardState.liveCallsMap.get(callSid);
      liveCall.status = 'processing_failed';
      liveCall.lastUpdate = new Date();
      dashboardState.liveCallsMap.set(callSid, liveCall);

      broadcastToSSEClients({
        type: 'call_status_update',
        data: {
          callSid: callSid,
          status: 'processing_failed',
          message: 'Error in delayed transcription processing'
        }
      });
    }

    return { success: false, error: error.message };
  }
}

// Define VAPI agent IDs for specific scam types
// Note: These will be dynamically populated by finding agents by name
const VAPI_AGENTS = {
  coinbase: null, // Will be populated when agent is found/created
  kraken: null, // Will be populated when agent is created
  binance: null,
  microsoft: null,
  apple: null,
  google: null,
  amazon: null,
  paypal: null
};

// Note: getOrCreateVapiPhoneNumber is now imported from vapi-service.js

// Note: Voice options are now handled by the vapi-service.js module
// All voice configurations use VAPI native voices to prevent pipeline errors

// Define patterns for detecting crypto/exchange scams
const CRYPTO_EXCHANGES = [
  'kraken',
  'coinbase',
  'binance',
  'crypto.com',
  'gemini',
  'bitfinex',
  'bitstamp',
  'kucoin',
  'ftx',
  'blockchain',
  'metamask',
  'wallet',
  'bitcoin',
  'ethereum',
  'ledger',
  'trezor',
  // Add common misspellings or transcription errors
  'crack',
  'crackin',
  'cracken',
  'kracken',
  'crypto',
  'order',
  'purchase'
];

// Define patterns for IT support scams
const IT_SERVICES = [
  'microsoft',
  'apple',
  'google',
  'amazon',
  'paypal',
  'netflix',
  'facebook',
  'instagram',
  'icloud',
  'gmail',
  'account',
  'password',
  'login',
  'sign in',
  'security',
  'verification'
];

// Define alert/urgent terms commonly used in scams
const ALERT_TERMS = [
  'alert',
  'urgent',
  'warning',
  'attention',
  'important',
  'notice',
  'suspicious',
  'unusual',
  'unauthorized',
  'security',
  'fraud',
  'fraudulent',
  'compromised',
  'hacked',
  'breach',
  'locked',
  'disabled',
  'restricted',
  'limited',
  'verify',
  'confirm',
  'validate',
  'critical'
];

// Define action terms that indicate what the scammer wants the victim to do
const ACTION_TERMS = [
  'call',
  'contact',
  'press',
  'dial',
  'reach',
  'speak',
  'representative',
  'support',
  'service',
  'team',
  'department',
  'agent',
  'specialist',
  'immediately',
  'urgently',
  'asap',
  'now',
  'today',
  'customer service'
];

// Define interactive prompt terms that suggest the scam wants the user to interact with an automated system
const INTERACTIVE_PROMPTS = [
  'press 1',
  'press one',
  'press 2',
  'press two',
  'press 3',
  'press three',
  'press 4',
  'press four',
  'press 5',
  'press five',
  'press 6',
  'press six',
  'press 7',
  'press seven',
  'press 8',
  'press eight',
  'press 9',
  'press nine',
  'press 0',
  'press zero',
  'press the number',
  'press any key',
  'press pound',
  'press star',
  'press hashtag',
  'press #',
  'press *',
  'if this was not you',
  'if this wasn\'t you',
  'if you did not',
  'if you didn\'t',
  'to speak with',
  'to talk to',
  'to connect with',
  'to be connected',
  'for more information',
  'for assistance',
  'for help',
  'to verify',
  'to confirm'
];

// Import the actual scam detection function
const { isLikelyScam } = require('./scam-detector');

// Function to handle fallback calls when transcription fails
const handleFallbackCall = async (callerNumber) => {
  if (!callerNumber) {
    console.log('No caller number available for fallback call');
    return null;
  }

  console.log('Initiating fallback call to caller:', callerNumber);

  // Use a simulated crypto scam message
  const testScamType = 'crypto_exchange';
  const testScamDetails = {
    cryptoTerms: ['kraken'],
    itTerms: ['account', 'login'],
    alertTerms: [],
    actionTerms: ['call', 'press', 'representative'],
    hasPhoneNumber: false,
    hasCallbackMention: true
  };

  // Initiate a test call
  try {
    const call = await createVapiCall(callerNumber, testScamType, testScamDetails);
    console.log(`Initiated fallback call to ${callerNumber}:`, call.id);
    return call;
  } catch (error) {
    console.error('Error initiating fallback call:', error);
    throw error;
  }
};

// Function to create a callback to a scammer number with interactive prompts
const createScammerCallback = async (scammerNumber, scamType = null, scamDetails = {}, originalCaller = null) => {
  // Check if we have a phone number from the LLM analysis
  if (scamDetails.llmAnalysis && scamDetails.llmAnalysis.phoneNumber) {
    const llmPhoneNumber = scamDetails.llmAnalysis.phoneNumber;
    console.log(`LLM detected a callback phone number in the message: ${llmPhoneNumber}`);

    // Use the phone number from the message instead of the caller's number
    scammerNumber = llmPhoneNumber;
  }

  if (!scammerNumber) {
    console.log('No scammer number provided for callback');
    return null;
  }

  try {
    console.log(`Initiating callback to scammer number: ${scammerNumber}`);

    // Format the phone number to ensure it's in E.164 format
    let formattedNumber = scammerNumber;

    // Clean up the phone number by removing all non-digit characters
    const digitsOnly = formattedNumber.replace(/\D/g, '');

    // Check if the number already has a country code
    if (formattedNumber.startsWith('+')) {
      // Keep the + but ensure the rest is just digits
      formattedNumber = `+${digitsOnly}`;
    } else if (digitsOnly.length === 10) {
      // If it's a 10-digit number, assume it's a US number
      formattedNumber = `+1${digitsOnly}`;
    } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
      // If it's an 11-digit number starting with 1, assume it's a US number with country code
      formattedNumber = `+${digitsOnly}`;
    } else {
      // For any other format, just add a + at the beginning
      formattedNumber = `+${digitsOnly}`;
    }

    // Check if this is a Coinbase-specific scam
    if (scamType === 'crypto_exchange' &&
        scamDetails.llmAnalysis &&
        scamDetails.llmAnalysis.impersonatedCompany &&
        scamDetails.llmAnalysis.impersonatedCompany.toLowerCase().includes('coinbase')) {

      // Generate a random caller number for the Coinbase agent
      const randomCallerNumber = generateRandomPhoneNumber();
      console.log(`Using random caller number for Coinbase scam callback: ${randomCallerNumber}`);

      // Get the Coinbase agent details to determine gender for voice selection
      let agentGender = 'neutral';
      try {
        const assistants = await listVapiAssistants();
        const coinbaseAgent = assistants.find(a => a.id === VAPI_AGENTS.coinbase);
        if (coinbaseAgent && coinbaseAgent.name) {
          agentGender = detectGenderFromName(coinbaseAgent.name);
          console.log(`Detected gender for Coinbase agent "${coinbaseAgent.name}": ${agentGender}`);
        }
      } catch (error) {
        console.error('Error fetching agent details for gender detection:', error);
      }

      // Select a random voice based on agent gender using VAPI's high-quality native voices
      const voiceConfig = getRandomVoice(agentGender);
      console.log(`Using random voice for Coinbase agent callback: ${voiceConfig.voiceId} (gender: ${agentGender})`);

      // Get or create a VAPI phone number
      const vapiPhoneNumber = await getOrCreateVapiPhoneNumber();

      // Create the call options
      const callOptions = {
        // Specify the customer to call
        customer: {
          number: formattedNumber
        },

        // Use the Coinbase agent ID
        assistantId: VAPI_AGENTS.coinbase,

        // Don't override voice - use the agent's default VAPI voice to avoid ElevenLabs pipeline errors
        // assistantOverrides: {
        //   voice: voiceConfig
        // },

        // Add metadata to track original caller
        metadata: {
          originalCaller: originalCaller,
          scamType: scamType,
          timestamp: new Date().toISOString()
        }
      };

      // If we have a VAPI phone number, use it
      if (vapiPhoneNumber) {
        console.log(`Using VAPI phone number for callback: ${vapiPhoneNumber.number} (ID: ${vapiPhoneNumber.id})`);
        callOptions.phoneNumberId = vapiPhoneNumber.id;
      } else {
        // Otherwise, fall back to Twilio credentials if available
        console.log('No VAPI phone number available for callback, falling back to Twilio credentials');
        callOptions.phoneNumber = {
          twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER,
          twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
          twilioAuthToken: process.env.TWILIO_AUTH_TOKEN
        };
      }

      // Create a call with the VAPI client using the Coinbase agent ID and random voice
      const call = await vapiClient.calls.create(callOptions);

      console.log(`Initiated Coinbase agent callback to ${formattedNumber} with voice ${voiceConfig.voiceId}:`, call.id);
      return call;
    }

    console.log(`Formatted phone number: ${scammerNumber} -> ${formattedNumber}`);

    // Customize the assistant based on the scam type and interactive prompts
    let systemPrompt = '';
    let firstMessage = '';
    let assistantName = '';

    // Check if the scam has interactive prompts
    const hasInteractivePrompts = scamDetails.hasInteractivePrompts || false;
    const interactivePrompts = scamDetails.interactivePrompts || [];

    if (scamType === 'crypto_exchange') {
      assistantName = "Crypto Scam Callback Agent";
      firstMessage = "Hello, I'm returning your call about my cryptocurrency account.";

      systemPrompt = `You are an AI assistant designed to waste scammers' time by pretending to be a potential victim of a cryptocurrency scam.

Your goal is to keep the scammer engaged as long as possible to waste their time and prevent them from scamming real people.

If the scammer asks you to press buttons on your phone keypad:
1. Acknowledge their request verbally
2. Say you're pressing the button they requested
3. Ask what they see on their end or what the next step is

If they ask for personal information:
- Provide fake, believable information
- Act confused and ask them to repeat information
- Pretend to have technical difficulties
- Ask lots of questions about the process

If they ask about cryptocurrency:
- Act like you have limited knowledge but own some crypto
- Pretend to be concerned about your account
- Ask them to explain things in more detail

Never reveal:
- That you are an AI
- That you know they are scammers
- That you are intentionally wasting their time

Scam details detected: ${JSON.stringify(scamDetails)}`;
    } else if (scamType === 'it_support') {
      assistantName = "IT Support Scam Callback Agent";
      firstMessage = "Hello, I'm returning your call about my account security issue.";

      systemPrompt = `You are an AI assistant designed to waste scammers' time by pretending to be a potential victim of an IT support scam.

Your goal is to keep the scammer engaged as long as possible to waste their time and prevent them from scamming real people.

If the scammer asks you to press buttons on your phone keypad:
1. Acknowledge their request verbally
2. Say you're pressing the button they requested
3. Ask what they see on their end or what the next step is

If they ask for personal information:
- Provide fake, believable information
- Act confused and ask them to repeat information
- Pretend to have technical difficulties
- Ask lots of questions about the process

If they ask about your computer or account:
- Act like you have limited technical knowledge
- Pretend to be concerned about your account security
- Ask them to explain things in more detail

Never reveal:
- That you are an AI
- That you know they are scammers
- That you are intentionally wasting their time

Scam details detected: ${JSON.stringify(scamDetails)}`;
    } else {
      assistantName = "Scam Callback Agent";
      firstMessage = "Hello, I'm returning your call about the important message I received.";

      systemPrompt = `You are an AI assistant designed to waste scammers' time by pretending to be a potential victim of a scam.

Your goal is to keep the scammer engaged as long as possible to waste their time and prevent them from scamming real people.

If the scammer asks you to press buttons on your phone keypad:
1. Acknowledge their request verbally
2. Say you're pressing the button they requested
3. Ask what they see on their end or what the next step is

If they ask for personal information:
- Provide fake, believable information
- Act confused and ask them to repeat information
- Pretend to have technical difficulties
- Ask lots of questions about the process

Never reveal:
- That you are an AI
- That you know they are scammers
- That you are intentionally wasting their time

Scam details detected: ${JSON.stringify(scamDetails)}`;
    }

    // Create a call with the VAPI client
    const call = await vapiClient.calls.create({
      phoneNumber: {
        twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER,
        twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
        twilioAuthToken: process.env.TWILIO_AUTH_TOKEN
      },
      customer: {
        number: formattedNumber
      },
      assistant: {
        name: assistantName,
        firstMessage: firstMessage,
        model: {
          provider: "openai",
          model: "gpt-4",
          temperature: 0.7,
          messages: [
            {
              role: "system",
              content: systemPrompt
            }
          ]
        },
        voice: getRandomVoice(detectGenderFromName(assistantName)),
        silenceTimeoutSeconds: 45,
        maxDurationSeconds: 900 // 15 minutes max call duration
      },
      // Add metadata to track original caller
      metadata: {
        originalCaller: originalCaller,
        scamType: scamType,
        timestamp: new Date().toISOString()
      }
    });

    console.log(`Successfully initiated callback to scammer: ${formattedNumber}`, call.id);
    return call;
  } catch (error) {
    console.error('Error initiating scammer callback:', error);
    throw error;
  }
};

// Function to generate a random US phone number
const generateRandomPhoneNumber = () => {
  // Generate a random US area code (avoid toll-free codes)
  const areaCodes = [
    201, 202, 203, 205, 206, 207, 208, 209, 210, 212, 213, 214, 215, 216, 217, 218, 219,
    224, 225, 228, 229, 231, 234, 239, 240, 248, 251, 252, 253, 254, 256, 260, 262, 267,
    269, 270, 276, 281, 301, 302, 303, 304, 305, 307, 308, 309, 310, 312, 313, 314, 315,
    316, 317, 318, 319, 320, 321, 323, 325, 330, 331, 334, 336, 337, 339, 346, 347, 351,
    352, 360, 361, 385, 386, 401, 402, 404, 405, 406, 407, 408, 409, 410, 412, 413, 414,
    415, 417, 419, 423, 424, 425, 430, 432, 434, 435, 440, 442, 443, 458, 469, 470, 475,
    478, 479, 480, 484, 501, 502, 503, 504, 505, 507, 508, 509, 510, 512, 513, 515, 516,
    517, 518, 520, 530, 531, 534, 539, 540, 541, 551, 559, 561, 562, 563, 564, 567, 570,
    571, 573, 574, 575, 580, 585, 586, 601, 602, 603, 605, 606, 607, 608, 609, 610, 612,
    614, 615, 616, 617, 618, 619, 620, 623, 626, 628, 629, 630, 631, 636, 641, 646, 650,
    651, 657, 660, 661, 662, 667, 669, 678, 681, 682, 701, 702, 703, 704, 706, 707, 708,
    712, 713, 714, 715, 716, 717, 718, 719, 720, 724, 725, 727, 731, 732, 734, 737, 740,
    743, 747, 754, 757, 760, 762, 763, 765, 769, 770, 772, 773, 774, 775, 779, 781, 785,
    786, 801, 802, 803, 804, 805, 806, 808, 810, 812, 813, 814, 815, 816, 817, 818, 828,
    830, 831, 832, 843, 845, 847, 848, 850, 856, 857, 858, 859, 860, 862, 863, 864, 865,
    870, 872, 878, 901, 903, 904, 906, 907, 908, 909, 910, 912, 913, 914, 915, 916, 917,
    918, 919, 920, 925, 928, 929, 930, 931, 934, 936, 937, 938, 940, 941, 947, 949, 951,
    952, 954, 956, 959, 970, 971, 972, 973, 978, 979, 980, 984, 985, 989
  ];
  const areaCode = areaCodes[Math.floor(Math.random() * areaCodes.length)];

  // Generate random 7-digit number (avoiding 0 or 1 as first digit of exchange code)
  const exchangeCode = Math.floor(Math.random() * 8) + 2; // 2-9
  const secondExchangeDigit = Math.floor(Math.random() * 10); // 0-9
  const thirdExchangeDigit = Math.floor(Math.random() * 10); // 0-9

  // Generate random 4-digit line number
  const lineNumber = Math.floor(Math.random() * 10000).toString().padStart(4, '0');

  // Format as +1XXXXXXXXXX for Twilio
  return `+1${areaCode}${exchangeCode}${secondExchangeDigit}${thirdExchangeDigit}${lineNumber}`;
};

// Function to ensure we have a Coinbase agent available
const ensureCoinbaseAgent = async () => {
  try {
    // First, try to find an existing Coinbase agent
    const assistants = await listVapiAssistants();
    const coinbaseAgent = assistants.find(a =>
      a.name && a.name.toLowerCase().includes('coinbase')
    );

    if (coinbaseAgent) {
      console.log('Found existing Coinbase agent:', coinbaseAgent.name, 'ID:', coinbaseAgent.id);
      VAPI_AGENTS.coinbase = coinbaseAgent.id;
      return coinbaseAgent;
    }

    // If no agent found, create one
    console.log('No Coinbase agent found, creating one...');

    const newAgent = await vapiClient.assistants.create({
      name: "Coinbase Jim",
      firstMessage: "Hello, I'm calling about my Coinbase account. I received a message saying there was suspicious activity.",
      model: {
        provider: "openai",
        model: "gpt-4",
        temperature: 0.7,
        maxTokens: 500,
        messages: [
          {
            role: "system",
            content: `You are Jim, a concerned Coinbase user who received a suspicious message about your account. Your goal is to waste scammers' time by pretending to be a potential victim.

Key behaviors:
- Act worried about your Coinbase account security
- Pretend to be not very tech-savvy
- Ask lots of questions about the security issue
- Pretend to have trouble following instructions
- Ask them to repeat things multiple times
- Express confusion about cryptocurrency terms

If they ask you to press phone buttons, acknowledge and say you're pressing them.
If they ask for personal info, provide fake but believable information.
Act concerned about your account security and ask for detailed explanations.

Never reveal you are an AI or that you know they are scammers.`
          }
        ]
      },
      voice: {
        provider: "vapi",
        voiceId: "Elliot",
        cachingEnabled: true,
        speed: 1.0,
        language: "en-US"
      },
      silenceTimeoutSeconds: 45,
      maxDurationSeconds: 900,
      backgroundSound: "office",
      backchannelingEnabled: true,
      backgroundDenoisingEnabled: true,
      modelOutputInMessagesEnabled: true
    });

    console.log('Created new Coinbase agent:', newAgent.name, 'ID:', newAgent.id);
    VAPI_AGENTS.coinbase = newAgent.id;
    return newAgent;
  } catch (error) {
    console.error('Error ensuring Coinbase agent:', error);
    return null;
  }
};

// Function to create a VAPI call using a specific Coinbase agent
const createCoinbaseVapiCall = async (phoneNumber, scamDetails = {}, originalCaller = null) => {
  try {
    console.log('Creating Coinbase-specific VAPI call to:', phoneNumber);

    // Ensure we have a Coinbase agent
    await ensureCoinbaseAgent();

    // Ensure we have LLM analysis data for proper agent selection
    if (!scamDetails.llmAnalysis) {
      scamDetails.llmAnalysis = {
        isScam: true,
        impersonatedCompany: 'Coinbase',
        scamType: 'crypto_exchange',
        confidence: 95
      };
    }

    // Use the wrapper function that includes notifications instead of direct service call
    return await createVapiCall(phoneNumber, 'crypto_exchange', scamDetails, null, originalCaller);
  } catch (error) {
    console.error('Error creating Coinbase VAPI call:', error);
    throw error;
  }
};

// Function to create a VAPI call with the appropriate assistant based on scam type
const createVapiCall = async (phoneNumber, scamType = null, scamDetails = {}, originalCaller = null) => {
  try {
    // Use the new VAPI service for call creation
    const vapiCall = await createVapiCallService(phoneNumber, scamType, scamDetails, null, originalCaller);

    if (vapiCall && vapiCall.id) {
      // Add to live calls tracking
      const currentTime = new Date();
      const agentName = vapiCall.assistant?.name || 'Unknown Agent';
      const company = extractCompanyFromAgent(agentName);

      dashboardState.liveCallsMap.set(vapiCall.id, {
        id: vapiCall.id,
        type: 'vapi_agent',
        status: 'queued',
        startTime: currentTime,
        duration: 0,
        phoneNumber: phoneNumber,
        agentName: agentName,
        company: company,
        lastUpdate: currentTime
      });

      // Broadcast VAPI call creation
      broadcastToSSEClients({
        type: 'vapi_call_created',
        data: {
          callId: vapiCall.id,
          agentName: agentName,
          company: company,
          phoneNumber: phoneNumber,
          scamType: scamType || 'unknown'
        }
      });

      // Webhook notifications are now handled in the vapi-service createVapiCall function

      console.log(`Added VAPI call ${vapiCall.id} to live tracking`);
    }

    return vapiCall;
  } catch (error) {
    console.error('Error creating VAPI call:', error);
    throw error;
  }
};

// Handle incoming SMS messages
app.post('/sms', async (req, res) => {
  const twiml = new twilio.twiml.MessagingResponse();
  const message = req.body.Body || '';

  console.log('Received SMS:', message);
  console.log('SMS From number:', req.body.From);
  console.log('SMS request body:', JSON.stringify(req.body, null, 2));

  // Check if the message is a likely scam using both regex and LLM analysis
  const regexAnalysis = isLikelyScam(message);
  console.log('SMS Regex analysis:', regexAnalysis);

  // Perform LLM analysis for better phone number extraction
  let llmAnalysis = null;
  try {
    llmAnalysis = await analyzeMessageWithLLM(message);
    console.log('SMS LLM analysis:', llmAnalysis);
  } catch (error) {
    console.error('SMS LLM analysis failed:', error);
  }

  // Combine results - use LLM if available, fallback to regex
  const isScam = llmAnalysis?.isScam || regexAnalysis.isScam;
  const scamType = llmAnalysis?.scamType || regexAnalysis.scamType;
  const scamDetails = {
    ...regexAnalysis.scamDetails,
    llmAnalysis: llmAnalysis
  };

  if (isScam) {
    console.log(`Detected ${scamType} scam in SMS:`, scamDetails);

    // Send webhook notification for scam detected
    try {
      // Extract and normalize company name
      let impersonatedCompany = 'Unknown';
      const rawCompany = scamDetails.cryptoTerms?.[0] || scamDetails.itTerms?.[0];

      if (rawCompany) {
        // Normalize company names to proper case
        const normalized = rawCompany.toLowerCase();
        if (normalized === 'kraken' || normalized === 'crack' || normalized === 'crackin' || normalized === 'cracken' || normalized === 'kracken') {
          impersonatedCompany = 'Kraken';
        } else if (normalized === 'coinbase' || normalized === 'coin base') {
          impersonatedCompany = 'Coinbase';
        } else if (normalized === 'binance') {
          impersonatedCompany = 'Binance';
        } else if (normalized === 'microsoft' || normalized === 'micro soft') {
          impersonatedCompany = 'Microsoft';
        } else if (normalized === 'apple') {
          impersonatedCompany = 'Apple';
        } else if (normalized === 'google') {
          impersonatedCompany = 'Google';
        } else {
          // Capitalize first letter for other companies
          impersonatedCompany = rawCompany.charAt(0).toUpperCase() + rawCompany.slice(1).toLowerCase();
        }
      }

      await notifyScamDetected({
        callerNumber: req.body.From,
        scamType: scamType,
        confidence: scamDetails.scamScore || 8,
        company: impersonatedCompany, // Use 'company' for consistency
        impersonatedCompany: impersonatedCompany, // Keep both for backward compatibility
        callSid: null, // SMS doesn't have a call SID
        transcriptionUrl: null,
        recordingUrl: null
      });
    } catch (error) {
      console.error('Error sending scam detection webhook for SMS:', error);
    }

    try {
      // Determine which phone number to call back
      let callbackNumber = req.body.From; // Default to SMS sender

      // Check if we have a phone number from the LLM analysis (callback number in the message)
      if (scamDetails.llmAnalysis && scamDetails.llmAnalysis.phoneNumber) {
        const llmPhoneNumber = scamDetails.llmAnalysis.phoneNumber;
        console.log(`LLM detected a callback phone number in the message: ${llmPhoneNumber}`);

        // Format the phone number to E.164 format for VAPI
        const digitsOnly = llmPhoneNumber.replace(/\D/g, '');
        let formattedNumber;

        if (llmPhoneNumber.startsWith('+')) {
          // Keep the + but ensure the rest is just digits
          formattedNumber = `+${digitsOnly}`;
        } else if (digitsOnly.length === 10) {
          // If it's a 10-digit number, assume it's a US number
          formattedNumber = `+1${digitsOnly}`;
        } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
          // If it's an 11-digit number starting with 1, assume it's a US number with country code
          formattedNumber = `+${digitsOnly}`;
        } else {
          // For any other format, just add a + at the beginning
          formattedNumber = `+${digitsOnly}`;
        }

        console.log(`Formatted callback number: ${llmPhoneNumber} -> ${formattedNumber}`);
        callbackNumber = formattedNumber;
      }

      // Add detailed debugging for phone number format
      console.log(`About to create VAPI call with phone number: "${callbackNumber}"`);
      console.log(`Phone number type: ${typeof callbackNumber}`);
      console.log(`Phone number length: ${callbackNumber ? callbackNumber.length : 'undefined'}`);
      console.log(`Original SMS sender: ${req.body.From}`);
      console.log(`Using callback number: ${callbackNumber}`);

      // Initiate VAPI call with scam-specific assistant
      await createVapiCall(callbackNumber, scamType, scamDetails, req.body.From);

      // Send a neutral response to avoid alerting potential scammers
      twiml.message('Thank you for your message. We will process your request.');

      // Log the detection for monitoring
      console.log(`Initiated scam response call for ${scamType} to ${callbackNumber} (original sender: ${req.body.From})`);
    } catch (error) {
      console.error('Error initiating scam response call:', error);
      console.error('Error details:', error.message);
      console.error('Phone number that caused error:', req.body.From);
      twiml.message('We received your message but encountered an issue. Please try again later.');
    }
  } else {
    // For non-scam messages, provide a standard response
    twiml.message('Thank you for your message. If you need assistance, please contact our official support channels.');
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// Store caller numbers for potential callbacks
const callerDatabase = new Map();

// Handle voice calls and voicemail transcriptions
app.post('/voice', async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();

  console.log('Received voice request with headers:', req.headers);
  console.log('Received voice request with body:', req.body);
  console.log('Received voice request with query:', req.query);

  // Extract caller info
  const callerNumber = req.body.From || req.query.From || req.body.Caller || req.query.Caller || '';
  const callSid = req.body.CallSid || req.query.CallSid || '';
  console.log('Caller number:', callerNumber);
  console.log('Call SID:', callSid);

  // Store the caller's number for potential callback
  if (callerNumber && callSid) {
    callerDatabase.set(callSid, {
      number: callerNumber,
      timestamp: new Date(),
      hasInteractivePrompts: false, // Will be updated when we analyze the transcription
      scamType: null,
      scamDetails: null
    });
    console.log(`Stored caller information for ${callSid}`);

    // Add incoming call to live calls tracking
    const currentTime = new Date();
    dashboardState.liveCallsMap.set(callSid, {
      id: callSid,
      type: 'incoming_call',
      status: 'ringing',
      startTime: currentTime,
      duration: 0,
      phoneNumber: callerNumber,
      agentName: null,
      company: 'Unknown',
      lastUpdate: currentTime
    });

    // Broadcast incoming call to SSE clients
    broadcastToSSEClients({
      type: 'incoming_call',
      data: {
        callSid: callSid,
        callerNumber: callerNumber,
        timestamp: currentTime
      }
    });
  }

  // Get the base URL for absolute webhook URLs
  // Prioritize custom domain over internal Vercel URL
  const baseUrl = process.env.CUSTOM_DOMAIN
    ? process.env.CUSTOM_DOMAIN
    : process.env.VERCEL
    ? 'https://sip-sentinel.vercel.app'
    : process.env.NETLIFY_URL
    ? process.env.NETLIFY_URL
    : `http://localhost:${PORT}`;

  // For any incoming call, provide instructions and record a message
  twiml.say({
    voice: 'alice',
    language: 'en-US'
  }, 'Hello. Please leave your message after the tone. When you are finished, you may hang up.');

  // Pause for a moment before the beep
  twiml.pause({ length: 1 });

  // Record the message with transcription enabled
  twiml.record({
    action: `${baseUrl}/recording-status`,
    maxLength: 300,  // Allow up to 5 minutes for the message (increased from 2 minutes)
    timeout: 10,     // Stop recording after 10 seconds of silence (increased from 5)
    playBeep: true,
    transcribe: true,  // Enable transcription
    transcribeCallback: `${baseUrl}/transcription`,  // Send transcription to this endpoint
    recordingStatusCallback: `${baseUrl}/recording-status`,  // Add this for additional status updates
    recordingStatusCallbackEvent: 'in-progress completed',  // Get notified when recording starts and completes
    statusCallback: `${baseUrl}/api/webhooks/call-status`, // The fix: get final call status
    statusCallbackEvent: 'completed canceled failed no-answer', // The fix: final events
    trim: 'do-not-trim'  // Don't trim silence to preserve complete message
  });

  // In case the caller doesn't hang up, provide a closing message
  twiml.say({
    voice: 'alice',
    language: 'en-US'
  }, 'Thank you for your message. Goodbye.');

  // Log the TwiML response for debugging
  const twimlString = twiml.toString();
  console.log('TwiML response:', twimlString);

  res.type('text/xml');
  res.send(twimlString);
});

// Handle recording status callbacks
app.post('/recording-status', async (req, res) => {
  console.log('Recording status with headers:', req.headers);
  console.log('Recording status with body:', req.body);
  console.log('Recording status with query:', req.query);

  // Extract recording info with fallbacks
  const recordingUrl = req.body.RecordingUrl || req.query.RecordingUrl || '';
  const recordingSid = req.body.RecordingSid || req.query.RecordingSid || '';
  const callSid = req.body.CallSid || req.query.CallSid || '';
  const callerNumber = req.body.From || req.query.From || req.body.Caller || req.query.Caller || '';
  const recordingStatus = req.body.RecordingStatus || req.query.RecordingStatus || '';
  const recordingDuration = parseInt(req.body.RecordingDuration || req.query.RecordingDuration || '0', 10);

  // Update live call status based on recording status
  if (callSid && dashboardState.liveCallsMap.has(callSid)) {
    const liveCall = dashboardState.liveCallsMap.get(callSid);

    if (recordingStatus === 'in-progress') {
      liveCall.status = 'recording';
      liveCall.lastUpdate = new Date();

      // Broadcast recording started
      broadcastToSSEClients({
        type: 'call_status_update',
        data: {
          callSid: callSid,
          status: 'recording',
          message: 'Voicemail recording in progress'
        }
      });
    } else if (recordingStatus === 'completed') {
      liveCall.status = 'processing';
      liveCall.lastUpdate = new Date();

      // Broadcast recording completed
      broadcastToSSEClients({
        type: 'call_status_update',
        data: {
          callSid: callSid,
          status: 'processing',
          message: 'Processing voicemail for scam detection'
        }
      });
    }

    dashboardState.liveCallsMap.set(callSid, liveCall);
  }

  console.log('Recording details:', {
    recordingUrl,
    recordingSid,
    callSid,
    callerNumber,
    recordingStatus,
    recordingDuration
  });

  // If the recording is completed and we have a recording SID, queue background processing
  if (recordingStatus === 'completed' && recordingSid && callerNumber) {
    console.log('Recording completed, queuing background transcription processing...');

    try {
      // Get the recording URL from Twilio
      const recording = await twilioClient.recordings(recordingSid).fetch();
      const recordingUrl = recording.mediaUrl;

      // Queue async task for transcription and analysis
      const taskId = `transcribe-${callSid}-${Date.now()}`;
      queueAsyncTask(taskId, async () => {
        return await processTranscriptionAsync(null, callerNumber, callSid, recordingSid);
      });

      console.log(`🚀 Background transcription task queued: ${taskId}`);
    } catch (error) {
      console.error('❌ Error queuing background transcription task:', error);

      // Fallback to old async processing
      setTimeout(() => {
        processDelayedTranscriptionAsync(recordingSid, callerNumber, callSid)
          .then(result => {
            console.log('✅ Fallback async recording processing completed:', result);
          })
          .catch(error => {
            console.error('❌ Fallback async recording processing failed:', error);
          });
      }, 10000);
    }
  }

  // Send an empty response immediately
  res.status(200).send('');
});



// Add a dedicated endpoint for transcription callbacks (OPTIMIZED FOR VERCEL)
app.post('/transcription', async (req, res) => {
  console.log('📞 Received transcription callback');

  // Extract transcription and caller info with fallbacks
  const transcriptionText = req.body.TranscriptionText || req.query.TranscriptionText || '';
  const callerNumber = req.body.From || req.query.From || req.body.Caller || req.query.Caller || '';
  const recordingSid = req.body.RecordingSid || req.query.RecordingSid || '';
  const transcriptionSid = req.body.TranscriptionSid || req.query.TranscriptionSid || '';
  const transcriptionStatus = req.body.TranscriptionStatus || req.query.TranscriptionStatus || '';
  const callSid = req.body.CallSid || req.query.CallSid || '';

  console.log('[TRANSCRIPTION] Text length:', transcriptionText.length, 'Status:', transcriptionStatus);
  console.log('[TRANSCRIPTION] Caller:', callerNumber, 'CallSid:', callSid);

  // RESPOND IMMEDIATELY to avoid Vercel timeout
  res.status(200).send('');

  // Process everything asynchronously without awaiting to avoid timeouts
  if (transcriptionText && transcriptionText.length > 0 && transcriptionStatus === 'completed') {
    console.log('📝 Processing transcription asynchronously to avoid timeout...');

    // Don't await - let this run in background
    processTranscriptionAsync(transcriptionText, callerNumber, callSid, recordingSid)
      .then(result => {
        console.log('✅ Async transcription processing completed:', result);
      })
      .catch(error => {
        console.error('❌ Async transcription processing failed:', error);
      });

    console.log('🚀 Transcription processing started in background');
  }
  // If transcription failed, queue fallback processing asynchronously
  else if (transcriptionStatus === 'failed' && recordingSid && callerNumber) {
    console.log('Transcription failed. Queuing fallback processing...');

    // Don't await - let this run in background
    processFallbackTranscriptionAsync(recordingSid, callerNumber, callSid)
      .then(result => {
        console.log('✅ Async fallback processing completed:', result);
      })
      .catch(error => {
        console.error('❌ Async fallback processing failed:', error);
      });

    console.log('🚀 Fallback transcription processing started in background');
  }
  // If we don't have transcription text but we have a recording SID, queue async processing
  else if (recordingSid && callerNumber) {
    console.log('No transcription text in callback, queuing async fetch and processing...');

    // Don't await - let this run in background
    processDelayedTranscriptionAsync(recordingSid, callerNumber, callSid)
      .then(result => {
        console.log('✅ Async delayed processing completed:', result);
      })
      .catch(error => {
        console.error('❌ Async delayed processing failed:', error);
      });

    console.log('🚀 Delayed transcription processing started in background');
  }
  // If we don't have enough information, just log it
  else {
    console.log('Insufficient information for processing:', {
      hasTranscription: !!transcriptionText,
      hasRecordingSid: !!recordingSid,
      hasCallerNumber: !!callerNumber
    });
  }

  // Response already sent on line 1611 to avoid timeout
});

// Sample scam messages for testing
const SAMPLE_SCAMS = {
  crypto_exchange: [
    "ALERT: Suspicious Coinbase withdrawal request. Requires your confirmation. Fraudulent? Call us: +18777344899",
    "URGENT: Unauthorized login attempt on your Kraken account. To secure your funds, call +1-888-555-1234 immediately.",
    "Your Bitcoin wallet has been temporarily locked due to suspicious activity. Call +1-800-555-9876 to verify your identity and restore access.",
    "Binance Security Alert: Unusual withdrawal detected. $2,500 pending transfer. If not you, call support: +1-844-555-7890"
  ],
  it_support: [
    "A login to your Microsoft account has been deleted from Salt Lake City, Utah. If this was not you, please call +1-877-555-1234",
    "APPLE SECURITY ALERT: Your iCloud account has been compromised. Call Apple Support immediately: +1-800-555-6789",
    "Google Security: Your account was accessed from a new device. If this wasn't you, call our security team: +1-888-555-4321",
    "Amazon Security: Suspicious purchase of $899 detected on your account. To cancel order, call +1-855-555-2345"
  ]
};

// Add a test endpoint for regex-based scam detection
app.get('/test-detection', (req, res) => {
  // Test message with interactive prompts
  const testMessage = "A login to your Kraken account has been detected from Salt Lake City, Utah. If this was not you, please press 1. A representative will be calling you shortly to follow up on this sign in attempt.";

  // Analyze the message
  const { isScam, scamType, scamDetails } = isLikelyScam(testMessage);

  // Log the results
  console.log('Test detection results:', { isScam, scamType, scamDetails });

  // Return the results
  res.json({
    message: testMessage,
    analysis: {
      isScam,
      scamType,
      scamDetails
    }
  });
});

// Add a test endpoint for LLM-based scam detection
app.get('/test-llm-detection', async (req, res) => {
  try {
    // Get the message from the query parameter or use a default test message
    const message = req.query.message || "A login to your Kraken account has been detected from Salt Lake City, Utah. If this was not you, please press 1. A representative will be calling you shortly to follow up on this sign in attempt.";

    console.log('Testing LLM-based scam detection with message:', message);

    // Analyze the message using our LLM-based detector
    const analysis = await analyzeMessageWithLLM(message);

    // Log the results
    console.log('LLM analysis results:', analysis);

    // Return the results
    res.json({
      message: message,
      analysis: analysis
    });
  } catch (error) {
    console.error('Error in LLM-based scam detection:', error);
    res.status(500).json({
      error: 'Error analyzing message with LLM',
      message: error.message
    });
  }
});

// Add a test endpoint for phone number extraction
app.get('/test-phone-extraction', async (req, res) => {
  try {
    // Get the message from the query parameter or use a default test message with a phone number
    const message = req.query.message || "ALERT: Suspicious Coinbase withdrawal request. Requires your confirmation. Fraudulent? Call us: +18777344899";

    console.log('Testing phone number extraction with message:', message);

    // Analyze the message using our LLM-based detector
    const analysis = await analyzeMessageWithLLM(message);

    // Log the results
    console.log('LLM analysis results:', analysis);

    // Extract and format the phone number
    let phoneNumber = null;
    if (analysis.phoneNumber) {
      phoneNumber = analysis.phoneNumber;

      // Clean up the phone number by removing all non-digit characters
      const digitsOnly = phoneNumber.replace(/\D/g, '');

      // Format the phone number
      let formattedNumber;
      if (phoneNumber.startsWith('+')) {
        // Keep the + but ensure the rest is just digits
        formattedNumber = `+${digitsOnly}`;
      } else if (digitsOnly.length === 10) {
        // If it's a 10-digit number, assume it's a US number
        formattedNumber = `+1${digitsOnly}`;
      } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
        // If it's an 11-digit number starting with 1, assume it's a US number with country code
        formattedNumber = `+${digitsOnly}`;
      } else {
        // For any other format, just add a + at the beginning
        formattedNumber = `+${digitsOnly}`;
      }

      console.log(`Extracted and formatted phone number: ${phoneNumber} -> ${formattedNumber}`);

      // Update the phone number in the analysis
      analysis.formattedPhoneNumber = formattedNumber;
    }

    // Return the results
    res.json({
      message: message,
      analysis: analysis,
      extractedPhoneNumber: phoneNumber,
      formattedPhoneNumber: analysis.formattedPhoneNumber || null
    });
  } catch (error) {
    console.error('Error in phone number extraction:', error);
    res.status(500).json({
      error: 'Error extracting phone number',
      message: error.message
    });
  }
});

// Serve the frontend dashboard as the main route (only in web UI mode)
if (isWebUIMode) {
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });
} else {
  // In headless mode, provide a simple status endpoint
  app.get('/', (req, res) => {
    res.json({
      service: 'SIPSentinel',
      mode: 'headless',
      status: 'running',
      message: 'Webhook endpoints active, web UI disabled',
      honeypotNumber: process.env.TWILIO_PHONE_NUMBER || 'Not configured',
      endpoints: [
        '/voice',
        '/sms',
        '/recording-status',
        '/transcription',
        '/vapi/webhook',
        '/health',
        '/honeypot-number'
      ]
    });
  });
}

// Real-time dashboard state - no mock data
const dashboardState = {
  detectionStatus: 'active',
  activeCalls: 0, // Will be updated by real VAPI call tracking
  recentScamDetections: [], // Store recent real scam detections
  liveCallsMap: new Map(), // Track individual live calls with detailed status
  sseClients: new Set() // Track SSE connections for real-time updates
};

// Function to update active calls count from VAPI
async function updateActiveCallsCount() {
  try {
    const calls = await listVapiCalls({ limit: 50 });
    const now = new Date();
    const maxAge = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

    const activeCalls = calls.filter(call => {
      const callStartTime = new Date(call.startedAt || call.createdAt);
      const callAge = now - callStartTime;

      // Only include calls that are truly active and not too old
      return (call.status === 'in-progress' || call.status === 'ringing' || call.status === 'queued') &&
             callAge <= maxAge &&
             call.status !== 'ended' &&
             call.status !== 'completed' &&
             call.status !== 'failed' &&
             call.status !== 'busy' &&
             call.status !== 'no-answer';
    });

    // Update the live calls map with detailed information
    const currentTime = new Date();
    dashboardState.liveCallsMap.clear();

    activeCalls.forEach(call => {
      const callStartTime = call.startedAt ? new Date(call.startedAt) : currentTime;
      const duration = Math.floor((currentTime - callStartTime) / 1000);

      dashboardState.liveCallsMap.set(call.id, {
        id: call.id,
        type: 'vapi_agent',
        status: call.status,
        startTime: callStartTime,
        duration: duration,
        phoneNumber: call.customer?.number || 'Unknown',
        agentName: call.assistant?.name || 'Unknown Agent',
        company: extractCompanyFromAgent(call.assistant?.name || ''),
        lastUpdate: currentTime
      });
    });

    dashboardState.activeCalls = activeCalls.length;
    console.log(`Updated active calls count: ${dashboardState.activeCalls}`);

    // Broadcast update to SSE clients
    broadcastToSSEClients({
      type: 'active_calls_update',
      data: {
        count: dashboardState.activeCalls,
        calls: Array.from(dashboardState.liveCallsMap.values())
      }
    });
  } catch (error) {
    console.error('Error updating active calls count:', error);
  }
}

// Function to add real scam detection to dashboard
function addScamDetection(scamData) {
  dashboardState.recentScamDetections.unshift(scamData);
  // Keep only the 20 most recent detections
  if (dashboardState.recentScamDetections.length > 20) {
    dashboardState.recentScamDetections = dashboardState.recentScamDetections.slice(0, 20);
  }
  console.log(`Added new scam detection to dashboard: ${scamData.company} ${scamData.scamType}`);

  // Broadcast scam detection to SSE clients
  broadcastToSSEClients({
    type: 'scam_detected',
    data: scamData
  });
}

// Function to broadcast updates to all SSE clients

function broadcastToSSEClients(message) {
  // Redact phone numbers in the message data before broadcasting
  if (message.data) {
    if (message.data.callerNumber) {
      message.data.callerNumber = redactPhoneNumber(message.data.callerNumber);
    }
    if (message.data.phoneNumber) {
      message.data.phoneNumber = redactPhoneNumber(message.data.phoneNumber);
    }
    // Also redact phone numbers in nested call objects
    if (message.data.calls && Array.isArray(message.data.calls)) {
      message.data.calls = message.data.calls.map(call => ({
        ...call,
        phoneNumber: call.phoneNumber ? redactPhoneNumber(call.phoneNumber) : call.phoneNumber
      }));
    }
  }

  const messageStr = `data: ${JSON.stringify(message)}\n\n`;
  const clientsToRemove = [];

  dashboardState.sseClients.forEach(client => {
    try {
      // Check if the connection is still writable
      if (client.writable && !client.destroyed) {
        client.write(messageStr);
      } else {
        console.log('SSE client connection is no longer writable, marking for removal');
        clientsToRemove.push(client);
      }
    } catch (error) {
      console.error('Error sending SSE message to client:', error.message);
      // Mark client for removal instead of removing during iteration
      clientsToRemove.push(client);
    }
  });

  // Remove failed clients after iteration
  clientsToRemove.forEach(client => {
    dashboardState.sseClients.delete(client);
  });

  if (clientsToRemove.length > 0) {
    console.log(`Removed ${clientsToRemove.length} failed SSE clients`);
  }

  console.log(`Broadcasted ${message.type} to ${dashboardState.sseClients.size} SSE clients`);
}

// Set up periodic updates for real-time dashboard data (only in non-serverless environments)
if (!process.env.VERCEL && !process.env.NETLIFY) {
  setInterval(async () => {
    try {
      await updateActiveCallsCount();
    } catch (error) {
      console.error('Error in periodic dashboard update:', error);
    }
  }, 30000); // Update every 30 seconds
}

// Server-Sent Events endpoint for real-time updates
app.get('/api/live-updates', (req, res) => {
  try {
    console.log('SSE endpoint called');

    // Check if headers have already been sent
    if (res.headersSent) {
      console.warn('Headers already sent for SSE connection');
      return;
    }

    // Set SSE headers with better connection handling
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
      'X-Accel-Buffering': 'no' // Disable nginx buffering
    });

    // Add client to the set
    dashboardState.sseClients.add(res);
    console.log(`New SSE client connected. Total clients: ${dashboardState.sseClients.size}`);

    // Send initial data
    const initialData = {
      type: 'initial_data',
      data: {
        activeCalls: dashboardState.activeCalls || 0,
        calls: Array.from(dashboardState.liveCallsMap.values()),
        detectionStatus: dashboardState.detectionStatus || 'active'
      }
    };

    try {
      res.write(`data: ${JSON.stringify(initialData)}\n\n`);
    } catch (writeError) {
      console.error('Error writing initial SSE data:', writeError);
      dashboardState.sseClients.delete(res);
      return;
    }

    // Send periodic heartbeat to keep connection alive (reduced frequency for Vercel)
    const heartbeatInterval = setInterval(() => {
      try {
        if (res.writable && !res.destroyed) {
          res.write(`: heartbeat ${Date.now()}\n\n`);
        } else {
          clearInterval(heartbeatInterval);
          dashboardState.sseClients.delete(res);
        }
      } catch (error) {
        console.error('Error sending heartbeat:', error);
        clearInterval(heartbeatInterval);
        dashboardState.sseClients.delete(res);
      }
    }, 25000); // Send heartbeat every 25 seconds

    // Handle Vercel timeout by closing connection gracefully before 60 seconds
    const timeoutHandler = setTimeout(() => {
      console.log('Closing SSE connection before Vercel timeout');
      try {
        res.write(`data: ${JSON.stringify({ type: 'connection_timeout', message: 'Reconnecting due to server timeout...' })}\n\n`);
        res.end();
      } catch (error) {
        console.log('Error closing SSE connection:', error.message);
      }
      clearInterval(heartbeatInterval);
      dashboardState.sseClients.delete(res);
    }, 50000); // Close after 50 seconds to avoid Vercel timeout

    // Handle client disconnect
    req.on('close', () => {
      clearInterval(heartbeatInterval);
      clearTimeout(timeoutHandler);
      dashboardState.sseClients.delete(res);
      console.log(`SSE client disconnected. Total clients: ${dashboardState.sseClients.size}`);
    });

    req.on('error', (error) => {
      console.error('SSE client error:', error);
      clearInterval(heartbeatInterval);
      clearTimeout(timeoutHandler);
      dashboardState.sseClients.delete(res);
    });

    // Handle response errors
    res.on('error', (error) => {
      console.error('SSE response error:', error);
      clearInterval(heartbeatInterval);
      clearTimeout(timeoutHandler);
      dashboardState.sseClients.delete(res);
    });

    res.on('close', () => {
      clearInterval(heartbeatInterval);
      clearTimeout(timeoutHandler);
      dashboardState.sseClients.delete(res);
      console.log(`SSE response closed. Total clients: ${dashboardState.sseClients.size}`);
    });

  } catch (error) {
    console.error('Error setting up SSE connection:', error);

    // Only send JSON error if headers haven't been sent yet
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
      res.status(500).json({
        success: false,
        error: 'Failed to establish SSE connection',
        message: error.message || 'Unknown error'
      });
    }
  }
});

// Add API endpoint for dashboard data
app.get('/api/dashboard', async (req, res) => {
  try {
    console.log('Dashboard endpoint called');

    // Ensure we always return JSON
    res.setHeader('Content-Type', 'application/json');

    // Update active calls count from VAPI (with timeout)
    try {
      await Promise.race([
        updateActiveCallsCount(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
      ]);
    } catch (error) {
      console.warn('Failed to update active calls count:', error.message);
    }

    // Get data from multiple sources with timeouts
    const [s3CallData, vapiCalls] = await Promise.all([
      Promise.race([
        listRecentCallMetadata(10),
        new Promise((_, reject) => setTimeout(() => reject(new Error('S3 timeout')), 8000))
      ]).catch(err => {
        console.error('Error fetching S3 data:', err);
        return [];
      }),
      Promise.race([
        listVapiCalls({ limit: 10 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('VAPI timeout')), 8000))
      ]).catch(err => {
        console.error('Error fetching VAPI calls:', err);
        return [];
      })
    ]);

    // Map S3 data to the format expected by the frontend (scam voicemails)
    // Apply filtering to only include voicemails that meet scam detection criteria
    // This excludes: empty voicemails, low confidence scores, non-scam classifications
    console.log(`Processing ${s3CallData.length} voicemails from S3 for dashboard display`);

    const s3Scams = s3CallData
      .filter(call => {
        const scamAnalysis = call.scamAnalysis || {};
        const transcriptionText = call.transcriptionText || '';
        const duration = call.recordingDuration || 0;

        // Apply filtering logic to exclude voicemails that don't meet criteria
        const shouldDisplay = shouldEngageScammer(scamAnalysis, transcriptionText, duration);
        const hasValidRecordingSid = call.recordingSid && call.recordingSid !== 'undefined';

        if (!shouldDisplay) {
          console.log(`Filtering out voicemail ${call.callSid}: Does not meet scam detection criteria (duration: ${duration}s)`);
        }

        if (!hasValidRecordingSid) {
          console.log(`Filtering out voicemail ${call.callSid}: Missing or invalid recordingSid`);
        }

        return shouldDisplay && hasValidRecordingSid;
      })
      .map(call => {
        const scamAnalysis = call.scamAnalysis || {};

        // Get phone numbers with redaction
        const originalCaller = call.callerNumber || call.from || null;
        const callbackNumber = scamAnalysis.phoneNumber || null; // Extracted callback number from scam
        const redactedOriginalCaller = originalCaller ? redactPhoneNumber(originalCaller) : null;
        const redactedCallbackNumber = callbackNumber ? redactPhoneNumber(callbackNumber) : null;

        return {
          id: call.callSid || Date.now(),
          company: scamAnalysis.company || 'Unknown',
          scamType: scamAnalysis.scamType || 'unknown',
          message: call.transcriptionText ?
            (redactPhoneNumbersFromTranscript(call.transcriptionText).substring(0, 150) +
             (call.transcriptionText.length > 150 ? '...' : '')) :
            'No transcript available',
          timestamp: new Date(call.timestamp || Date.now()),
          confidence: scamAnalysis.confidence || 0,
          audioUrl: call.recordingSid ? `/api/audio/${call.recordingSid}` : null,
          transcriptUrl: call.recordingSid ? `/api/transcriptions/${call.callSid}/${call.recordingSid}` : null,
          type: 'scam_voicemail', // Mark as scam voicemail
          source: 'twilio',
          // Phone number information with redaction
          originalCaller: originalCaller, // Original caller (who called our Twilio number)
          redactedOriginalCaller: redactedOriginalCaller, // For display
          callbackNumber: callbackNumber, // Extracted callback number from scam message
          redactedCallbackNumber: redactedCallbackNumber // For display
        };
      });

    console.log(`After filtering: ${s3Scams.length} voicemails will be displayed in dashboard (filtered out ${s3CallData.length - s3Scams.length})`);

    // Convert VAPI calls to dashboard format (agent conversations)
    // Apply filtering to exclude 0-duration calls
    console.log(`Processing ${vapiCalls.length} VAPI calls for dashboard display`);
    console.log(`=== DEBUG: Starting VAPI call processing ===`);

    const vapiConversations = vapiCalls
      .map(call => {
        // Calculate duration if not provided and store it on the call object
        if (!call.duration && call.startedAt && call.endedAt) {
          const startTime = new Date(call.startedAt);
          const endTime = new Date(call.endedAt);
          call.calculatedDuration = Math.round((endTime - startTime) / 1000); // Convert to seconds
          console.log(`Calculated duration for call ${call.id}: ${call.calculatedDuration}s (${call.startedAt} to ${call.endedAt})`);
        } else {
          call.calculatedDuration = call.duration || 0;
        }
        return call;
      })
      .filter(call => {
        const duration = call.calculatedDuration;
        console.log(`Call ${call.id}: duration=${duration}s, threshold=${SCAM_DETECTION_THRESHOLDS.MIN_RECORDING_DURATION}s`);

        // Filter out calls with 0 duration
        if (duration < SCAM_DETECTION_THRESHOLDS.MIN_RECORDING_DURATION) {
          console.log(`Filtering out VAPI call ${call.id}: Duration ${duration}s below minimum ${SCAM_DETECTION_THRESHOLDS.MIN_RECORDING_DURATION}s`);
          return false;
        }

        return true;
      })
      .map(call => {
      // Try to determine company and agent name from assistant name or other metadata
      let company = 'Unknown';
      let agentName = 'Unknown Agent';

      if (call.assistantId) {
        // Extract company and agent name from assistant name patterns
        const assistantName = call.assistant?.name || '';

        if (assistantName.toLowerCase().includes('coinbase')) {
          company = 'Coinbase';
          agentName = assistantName; // Use full name like "Coinbase Jim"
        } else if (assistantName.toLowerCase().includes('kraken')) {
          company = 'Kraken';
          agentName = assistantName;
        } else if (assistantName.toLowerCase().includes('binance')) {
          company = 'Binance';
          agentName = assistantName;
        } else {
          // If no specific company match, use the assistant name as is
          agentName = assistantName || 'Unknown Agent';
        }
      }

      // Get phone numbers with redaction
      const callbackNumber = call.customer?.number || call.phoneNumber;
      const redactedCallbackNumber = redactPhoneNumber(callbackNumber);

      // For now, we don't have the original caller number in VAPI calls
      // This would need to be stored when the call is initiated
      const originalCallerNumber = call.metadata?.originalCaller || null;
      const redactedOriginalCaller = originalCallerNumber ? redactPhoneNumber(originalCallerNumber) : null;

      // Format transcript for better display
      let formattedTranscript = call.transcript || `Agent conversation with ${redactedCallbackNumber}`;
      if (call.transcript) {
        // Redact phone numbers from the transcript for privacy
        const redactedTranscript = redactPhoneNumbersFromTranscript(call.transcript);
        // Add agent name to transcript header and format it better
        formattedTranscript = `Agent: ${agentName}\n\n${redactedTranscript}`;
      }

      // Generate multiple tags for filtering
      const tags = [];
      tags.push(agentName); // Full agent name (e.g., "Coinbase Jim")
      tags.push(company); // Company name (e.g., "Coinbase")

      // Add category tags based on company
      if (company.toLowerCase().includes('coinbase') || company.toLowerCase().includes('kraken') ||
          company.toLowerCase().includes('binance') || company.toLowerCase().includes('crypto')) {
        tags.push('Crypto');
      } else if (company.toLowerCase().includes('microsoft') || company.toLowerCase().includes('apple') ||
                 company.toLowerCase().includes('google')) {
        tags.push('IT Support');
      } else if (company.toLowerCase().includes('bank') || company.toLowerCase().includes('chase') ||
                 company.toLowerCase().includes('wells')) {
        tags.push('Banking');
      }

      return {
        id: call.id,
        company: company,
        agentName: agentName, // Add agent name field
        tags: tags, // Add tags for filtering
        scamType: 'agent_conversation',
        message: formattedTranscript.substring(0, 150) + (formattedTranscript.length > 150 ? '...' : ''),
        timestamp: new Date(call.startedAt || call.createdAt),
        confidence: call.metadata && call.metadata.confidence !== undefined ? call.metadata.confidence : (call.successful ? 95 : 60),
        audioUrl: call.recordingUrl ? call.recordingUrl : null,
        transcriptUrl: null, // VAPI stores transcript differently
        transcript: formattedTranscript, // Store full formatted transcript
        type: 'agent_conversation', // Mark as agent conversation
        source: 'vapi',
        duration: call.calculatedDuration, // Use calculated duration
        successful: call.successful,
        cost: call.cost,
        endedReason: call.endedReason,
        // Phone number information with redaction
        phoneNumber: callbackNumber, // Keep original for internal use
        redactedPhoneNumber: redactedCallbackNumber, // For display
        originalCaller: originalCallerNumber, // Original caller (if available)
        redactedOriginalCaller: redactedOriginalCaller, // For display
        // Include analysis data from VAPI
        analysis: call.analysis
      };
    });

    console.log(`After filtering: ${vapiConversations.length} VAPI calls will be displayed in dashboard (filtered out ${vapiCalls.length - vapiConversations.length})`);

    // Combine all data sources
    const allItems = [...s3Scams, ...vapiConversations];

    // Sort by timestamp (newest first)
    allItems.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Limit to 20 most recent items
    const recentItems = allItems.slice(0, 20);

    // Calculate stats
    const scamVoicemails = recentItems.filter(item => item.type === 'scam_voicemail');
    const agentConversations = recentItems.filter(item => item.type === 'agent_conversation');
    const successfulConversations = agentConversations.filter(item => item.successful);

    // Calculate scams detected this week (last 7 days)
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const scamsThisWeek = scamVoicemails.filter(scam => {
      const scamDate = new Date(scam.timestamp);
      return scamDate >= oneWeekAgo;
    });

    res.json({
      status: 'ok',
      service: 'SIPSentinel - Scam Detection',
      scamTypes: ['crypto_exchange', 'it_support', 'banking', 'agent_conversation'],
      stats: {
        scamsDetectedThisWeek: scamsThisWeek.length,
        agentConversations: agentConversations.length,
        successfulConversations: successfulConversations.length,
        activeCalls: dashboardState.activeCalls,
        detectionStatus: dashboardState.detectionStatus,
        successRate: agentConversations.length > 0 ?
          Math.round((successfulConversations.length / agentConversations.length) * 100) : 0
      },
      recentScams: recentItems, // Now includes both scam voicemails and agent conversations
      scamVoicemails: scamVoicemails,
      agentConversations: agentConversations,
      serverTime: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching dashboard data:', error);

    // Ensure we always return JSON, never raw text
    res.setHeader('Content-Type', 'application/json');

    // Return empty data structure instead of mock data
    res.status(200).json({
      status: 'error',
      service: 'SIPSentinel - Scam Detection',
      scamTypes: ['crypto_exchange', 'it_support', 'banking', 'agent_conversation'],
      stats: {
        scamsDetectedThisWeek: 0,
        agentConversations: 0,
        successfulConversations: 0,
        activeCalls: dashboardState.activeCalls || 0,
        detectionStatus: dashboardState.detectionStatus || 'active',
        successRate: 0
      },
      recentScams: [],
      scamVoicemails: [],
      agentConversations: [],
      serverTime: new Date().toISOString(),
      error: 'Failed to fetch real-time data',
      message: error.message || 'Unknown error occurred'
    });
  }
});



// Add a dedicated health check endpoint
app.get('/health', (req, res) => {
  // Use the same base URL logic as webhook generation
  const baseUrl = process.env.CUSTOM_DOMAIN
    ? process.env.CUSTOM_DOMAIN
    : process.env.VERCEL
    ? 'https://sip-sentinel.vercel.app'
    : process.env.NETLIFY_URL
    ? process.env.NETLIFY_URL
    : `http://localhost:${process.env.PORT || 3000}`;

  res.json({
    status: 'ok',
    uptime: process.uptime(),
    serverTime: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    platform: process.env.VERCEL ? 'vercel' : process.env.NETLIFY ? 'netlify' : 'local',
    baseUrl: baseUrl,
    honeypotNumber: process.env.TWILIO_PHONE_NUMBER || 'Not configured',
    webhookUrls: {
      voice: `${baseUrl}/voice`,
      recordingStatus: `${baseUrl}/recording-status`,
      transcription: `${baseUrl}/transcription`,
      sms: `${baseUrl}/sms`
    }
  });
});

// Add an endpoint to get the honeypot phone number
app.get('/honeypot-number', (req, res) => {
  try {
    // Ensure we always return JSON
    res.setHeader('Content-Type', 'application/json');

    const phoneNumber = process.env.TWILIO_PHONE_NUMBER;

    res.json({
      success: true,
      phoneNumber: phoneNumber || 'Not configured',
      status: phoneNumber ? 'configured' : 'missing'
    });
  } catch (error) {
    console.error('Error in honeypot-number endpoint:', error);

    // Ensure we always return JSON, never raw text
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({
      success: false,
      error: 'Failed to get honeypot number',
      message: error.message || 'Unknown error'
    });
  }
});

// Add webhook test endpoint to verify Twilio can reach our endpoints
app.post('/test-webhook', (req, res) => {
  console.log('Test webhook called with headers:', req.headers);
  console.log('Test webhook called with body:', req.body);

  res.json({
    success: true,
    message: 'Webhook endpoint is accessible',
    timestamp: new Date().toISOString(),
    receivedData: {
      headers: req.headers,
      body: req.body,
      query: req.query
    }
  });
});

app.get('/test-webhook', (req, res) => {
  res.json({
    success: true,
    message: 'Webhook endpoint is accessible via GET',
    timestamp: new Date().toISOString(),
    note: 'Twilio webhooks use POST requests'
  });
});

// Add an endpoint to get deployment information
app.get('/deployment-info', (req, res) => {
  // Use the same base URL logic as webhook generation
  const baseUrl = process.env.CUSTOM_DOMAIN
    ? process.env.CUSTOM_DOMAIN
    : process.env.VERCEL
    ? 'https://sip-sentinel.vercel.app'
    : process.env.NETLIFY_URL
    ? process.env.NETLIFY_URL
    : `http://localhost:${process.env.PORT || 3000}`;

  res.json({
    status: 'ok',
    platform: process.env.VERCEL ? 'vercel' : process.env.NETLIFY ? 'netlify' : 'local',
    baseUrl: baseUrl,
    honeypotNumber: process.env.TWILIO_PHONE_NUMBER || 'Not configured',
    webhookConfiguration: {
      instructions: 'Configure these URLs in your Twilio Console:',
      voice: `${baseUrl}/voice`,
      sms: `${baseUrl}/sms`,
      recordingStatus: `${baseUrl}/recording-status`,
      transcription: `${baseUrl}/transcription`
    },
    environmentVariables: {
      required: [
        'TWILIO_ACCOUNT_SID',
        'TWILIO_AUTH_TOKEN',
        'TWILIO_PHONE_NUMBER',
        'VAPI_API_KEY',
        'OPENROUTER_API_KEY',
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
        'AWS_REGION'
      ],
      configured: {
        TWILIO_ACCOUNT_SID: !!process.env.TWILIO_ACCOUNT_SID,
        TWILIO_AUTH_TOKEN: !!process.env.TWILIO_AUTH_TOKEN,
        TWILIO_PHONE_NUMBER: !!process.env.TWILIO_PHONE_NUMBER,
        VAPI_API_KEY: !!process.env.VAPI_API_KEY,
        OPENROUTER_API_KEY: !!process.env.OPENROUTER_API_KEY,
        AWS_ACCESS_KEY_ID: !!(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY),
        AWS_SECRET_ACCESS_KEY: !!(process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_KEY),
        AWS_REGION: !!process.env.AWS_REGION
      }
    }
  });
});

// Add S3 debug endpoint to test S3 connectivity and list bucket contents
app.get('/debug/s3', async (req, res) => {
  try {
    console.log('=== S3 Debug Endpoint Called ===');

    // Test S3 configuration
    const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

    const awsConfig = {
      region: process.env.AWS_REGION || 'us-west-2',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_KEY
      }
    };

    console.log('AWS Config:', {
      region: awsConfig.region,
      hasAccessKey: !!awsConfig.credentials.accessKeyId,
      hasSecretKey: !!awsConfig.credentials.secretAccessKey
    });

    const s3Client = new S3Client(awsConfig);
    const bucketName = 'sip-sentinel';

    // List objects in metadata folder
    const listParams = {
      Bucket: bucketName,
      Prefix: 'metadata/',
      MaxKeys: 20
    };

    console.log('Listing S3 objects with params:', listParams);
    const response = await s3Client.send(new ListObjectsV2Command(listParams));

    console.log('S3 ListObjects response:', {
      KeyCount: response.KeyCount,
      IsTruncated: response.IsTruncated,
      Contents: response.Contents?.map(obj => ({
        Key: obj.Key,
        Size: obj.Size,
        LastModified: obj.LastModified
      }))
    });

    // Also try to call the listRecentCallMetadata function directly
    const callMetadata = await listRecentCallMetadata(5);
    console.log('listRecentCallMetadata result:', callMetadata);

    res.json({
      success: true,
      s3Config: {
        region: awsConfig.region,
        bucket: bucketName,
        hasCredentials: !!awsConfig.credentials.accessKeyId && !!awsConfig.credentials.secretAccessKey
      },
      s3Response: {
        keyCount: response.KeyCount || 0,
        isTruncated: response.IsTruncated || false,
        objects: response.Contents?.map(obj => ({
          key: obj.Key,
          size: obj.Size,
          lastModified: obj.LastModified
        })) || []
      },
      callMetadata: callMetadata,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('S3 Debug Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
});

// Add endpoint to manually process a recording and store metadata in S3
app.post('/debug/process-recording', async (req, res) => {
  try {
    const { recordingSid, callSid } = req.body;

    if (!recordingSid) {
      return res.status(400).json({ error: 'Recording SID is required' });
    }

    console.log(`=== Manually Processing Recording ${recordingSid} ===`);

    // Get recording details from Twilio
    const recording = await twilioClient.recordings(recordingSid).fetch();
    const callerNumber = recording.callSid ?
      (await twilioClient.calls(recording.callSid).fetch()).from :
      'Unknown';

    console.log('Recording details:', {
      sid: recording.sid,
      callSid: recording.callSid,
      duration: recording.duration,
      status: recording.status,
      callerNumber: callerNumber
    });

    // Fetch transcription
    const transcriptionText = await fetchTranscription(recordingSid);

    if (!transcriptionText) {
      return res.status(404).json({
        error: 'No transcription found for this recording',
        recordingSid: recordingSid
      });
    }

    console.log('Transcription text:', transcriptionText);

    // Analyze for scams using both regex and LLM
    const regexAnalysis = isLikelyScam(transcriptionText);
    console.log('Regex analysis:', regexAnalysis);

    let llmAnalysis = null;
    try {
      llmAnalysis = await analyzeMessageWithLLM(transcriptionText);
      console.log('LLM analysis:', llmAnalysis);
    } catch (llmError) {
      console.error('LLM analysis failed:', llmError);
    }

    // Determine final analysis results
    const isScam = llmAnalysis?.isScam || regexAnalysis.isScam;
    const scamType = llmAnalysis?.scamType || regexAnalysis.scamType;

    // Extract and normalize company name
    let company = llmAnalysis?.impersonatedCompany || 'Unknown';

    if (!llmAnalysis?.impersonatedCompany) {
      // If LLM didn't provide company, extract from regex analysis
      const rawCompany = regexAnalysis.scamDetails.cryptoTerms.length > 0 ?
                        regexAnalysis.scamDetails.cryptoTerms[0] :
                        regexAnalysis.scamDetails.itTerms.length > 0 ?
                          regexAnalysis.scamDetails.itTerms[0] : null;

      if (rawCompany) {
        // Normalize company names to proper case
        const normalized = rawCompany.toLowerCase();
        if (normalized === 'kraken' || normalized === 'crack' || normalized === 'crackin' || normalized === 'cracken' || normalized === 'kracken') {
          company = 'Kraken';
        } else if (normalized === 'coinbase' || normalized === 'coin base') {
          company = 'Coinbase';
        } else if (normalized === 'binance') {
          company = 'Binance';
        } else if (normalized === 'microsoft' || normalized === 'micro soft') {
          company = 'Microsoft';
        } else if (normalized === 'apple') {
          company = 'Apple';
        } else if (normalized === 'google') {
          company = 'Google';
        } else {
          // Capitalize first letter for other companies
          company = rawCompany.charAt(0).toUpperCase() + rawCompany.slice(1).toLowerCase();
        }
      }
    }

    // Store metadata in S3 if it's a scam
    let s3StorageResult = null;
    if (isScam) {
      try {
        const metadata = {
          callSid: callSid || recording.callSid,
          recordingSid: recordingSid,
          callerNumber: callerNumber,
          transcriptionText: transcriptionText,
          transcriptionSid: null, // We don't have this from manual processing
          scamAnalysis: {
            isScam: isScam,
            scamType: scamType,
            company: company,
            confidence: llmAnalysis?.confidence || (regexAnalysis.scamDetails.scamScore * 10),
            callbackPhoneNumber: llmAnalysis?.phoneNumber || null,
            details: {
              ...regexAnalysis.scamDetails,
              llmAnalysis: llmAnalysis
            }
          },
          timestamp: new Date().toISOString(),
          processedManually: true
        };

        await storeCallMetadata(callSid || recording.callSid, metadata);
        s3StorageResult = { success: true, message: 'Metadata stored in S3' };
        console.log(`Call metadata for ${callSid || recording.callSid} stored in S3`);

        // Also store the transcription
        await storeTranscription(callSid || recording.callSid, recordingSid, transcriptionText);
        console.log(`Transcription for recording ${recordingSid} stored in S3`);

      } catch (storageError) {
        console.error('Error storing in S3:', storageError);
        s3StorageResult = { success: false, error: storageError.message };
      }
    }

    res.json({
      success: true,
      recordingSid: recordingSid,
      callSid: callSid || recording.callSid,
      callerNumber: callerNumber,
      transcriptionText: transcriptionText,
      analysis: {
        isScam: isScam,
        scamType: scamType,
        company: company,
        regexAnalysis: regexAnalysis,
        llmAnalysis: llmAnalysis
      },
      s3Storage: s3StorageResult,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error processing recording:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
});

// API endpoints that mirror VAPI endpoints for frontend compatibility
app.get('/api/vapi/phone-numbers', async (req, res) => {
  try {
    const phoneNumbers = await listVapiPhoneNumbers();
    res.json({
      success: true,
      count: phoneNumbers.length,
      phoneNumbers: phoneNumbers
    });
  } catch (error) {
    console.error('Error fetching VAPI phone numbers:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/vapi/assistants', async (req, res) => {
  try {
    const assistants = await listVapiAssistants();
    res.json({
      success: true,
      count: assistants.length,
      assistants: assistants
    });
  } catch (error) {
    console.error('Error fetching VAPI assistants:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/vapi/calls', async (req, res) => {
  try {
    const { limit = 20, assistantId, status } = req.query;
    const options = {};
    if (limit) options.limit = parseInt(limit);
    if (assistantId) options.assistantId = assistantId;
    if (status) options.status = status;

    const calls = await listVapiCalls(options);
    res.json({
      success: true,
      count: calls.length,
      calls: calls
    });
  } catch (error) {
    console.error('Error fetching VAPI calls:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Background task monitoring endpoints
app.get('/api/background-tasks/stats', (req, res) => {
  try {
    // Simple stats for async processing
    const stats = {
      queueSize: 0, // We don't maintain a persistent queue in serverless
      processing: 0,
      completed: 0,
      failed: 0
    };
    res.json({
      success: true,
      stats: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting background task stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/background-tasks/:taskId', (req, res) => {
  try {
    const { taskId } = req.params;
    const taskStatus = getTaskStatus(taskId);

    if (taskStatus.status === 'not_found') {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    res.json({
      success: true,
      task: taskStatus
    });
  } catch (error) {
    console.error('Error getting task status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Add a test route to manually trigger a call
app.get('/test-call', async (req, res) => {
  const phoneNumber = req.query.phone;
  const scamType = req.query.scamType || null;

  if (!phoneNumber) {
    return res.status(400).json({ error: 'Phone number is required as a query parameter' });
  }

  try {
    const call = await createVapiCall(phoneNumber, scamType);
    res.json({
      success: true,
      message: `Test call initiated for ${scamType || 'general'} scam`,
      callId: call.id
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


// Add a test endpoint for the Coinbase agent
app.get('/test-coinbase', async (req, res) => {
  // Use the phone number from the query parameter
  const phoneNumber = req.query.phone;

  if (!phoneNumber) {
    return res.status(400).json({
      success: false,
      error: 'Phone number is required as a query parameter'
    });
  }

  try {
    console.log(`Initiating Coinbase agent test call to ${phoneNumber}`);

    // Create a simulated Coinbase scam detection result
    const testScamDetails = {
      cryptoTerms: ['coinbase'],
      itTerms: ['account', 'login'],
      alertTerms: ['unauthorized', 'suspicious'],
      actionTerms: ['call', 'press', 'verify'],
      hasPhoneNumber: true,
      hasCallbackMention: true,
      llmAnalysis: {
        isScam: true,
        impersonatedCompany: 'Coinbase',
        scamType: 'crypto_exchange',
        confidence: 95,
        phoneNumber: req.query.callback || generateRandomPhoneNumber() // Use provided callback number or generate one
      }
    };

    // Use the Coinbase-specific agent (now includes notifications)
    const { call, agentId, assistantName } = await createCoinbaseVapiCall(phoneNumber, testScamDetails);

    res.json({
      success: true,
      message: `Coinbase agent test call initiated to ${phoneNumber}`,
      callId: call.id,
      agentId: agentId,
      agentName: assistantName
    });
  } catch (error) {
    console.error('Error initiating Coinbase agent test call:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Add a test endpoint to check Telegram configuration
app.get('/check-telegram', (req, res) => {
  try {
    console.log('Checking Telegram configuration...');
    console.log('TELEGRAM_BOT_TOKEN exists:', !!process.env.TELEGRAM_BOT_TOKEN);
    console.log('TELEGRAM_CHAT_ID exists:', !!process.env.TELEGRAM_CHAT_ID);
    console.log('TELEGRAM_BOT_TOKEN length:', process.env.TELEGRAM_BOT_TOKEN ? process.env.TELEGRAM_BOT_TOKEN.length : 0);
    console.log('TELEGRAM_CHAT_ID value:', process.env.TELEGRAM_CHAT_ID || 'Not set');

    const telegramConfig = getTelegramConfig();

    res.json({
      success: true,
      telegram: {
        configured: !!telegramConfig,
        botTokenExists: !!process.env.TELEGRAM_BOT_TOKEN,
        chatIdExists: !!process.env.TELEGRAM_CHAT_ID,
        botTokenLength: process.env.TELEGRAM_BOT_TOKEN ? process.env.TELEGRAM_BOT_TOKEN.length : 0,
        chatId: process.env.TELEGRAM_CHAT_ID || 'Not set',
        allEnvVars: Object.keys(process.env).filter(key => key.toLowerCase().includes('telegram'))
      }
    });
  } catch (error) {
    console.error('Error checking Telegram config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Add a test endpoint to ensure Coinbase agent exists
app.get('/ensure-coinbase-agent', async (req, res) => {
  try {
    const agent = await ensureCoinbaseAgent();

    if (agent) {
      res.json({
        success: true,
        message: 'Coinbase agent is ready',
        agent: {
          id: agent.id,
          name: agent.name,
          voice: agent.voice?.voiceId || 'Not set'
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to create or find Coinbase agent'
      });
    }
  } catch (error) {
    console.error('Error ensuring Coinbase agent:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Add a test endpoint to call a specified number
app.get('/call-user', async (req, res) => {
  // Get phone number from query parameter
  const phoneNumber = req.query.phone;

  if (!phoneNumber) {
    return res.status(400).json({
      success: false,
      error: 'Phone number is required as a query parameter'
    });
  }

  try {
    console.log(`Initiating Coinbase agent test call to user: ${phoneNumber}`);

    // Create a simulated Coinbase scam detection result
    const testScamDetails = {
      cryptoTerms: ['coinbase'],
      itTerms: ['account', 'login'],
      alertTerms: ['unauthorized', 'suspicious'],
      actionTerms: ['call', 'press', 'verify'],
      hasPhoneNumber: true,
      hasCallbackMention: true,
      llmAnalysis: {
        isScam: true,
        impersonatedCompany: 'Coinbase',
        scamType: 'crypto_exchange',
        confidence: 95
      }
    };

    // Use the Coinbase-specific agent (now includes notifications)
    const { call, agentId, assistantName } = await createCoinbaseVapiCall(phoneNumber, testScamDetails);

    res.json({
      success: true,
      message: `Coinbase agent call initiated to user at ${phoneNumber}`,
      callId: call.id,
      agentId: agentId,
      agentName: assistantName
    });
  } catch (error) {
    console.error('Error initiating Coinbase agent call to user:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Add a test endpoint for the Coinbase scammer callback
app.get('/test-coinbase-callback', async (req, res) => {
  // Use the callback number from the query parameter or generate a random one
  const callbackNumber = req.query.callback || generateRandomPhoneNumber();

  try {
    console.log(`Initiating Coinbase agent callback test to ${callbackNumber}`);

    // Create a simulated Coinbase scam detection result
    const testScamDetails = {
      cryptoTerms: ['coinbase'],
      itTerms: ['account', 'login'],
      alertTerms: ['unauthorized', 'suspicious'],
      actionTerms: ['call', 'press', 'verify'],
      hasPhoneNumber: true,
      hasCallbackMention: true,
      llmAnalysis: {
        isScam: true,
        impersonatedCompany: 'Coinbase',
        scamType: 'crypto_exchange',
        confidence: 95,
        phoneNumber: callbackNumber
      }
    };

    // Use the VAPI call creation with proper notifications
    const { call, agentId, assistantName } = await createVapiCall(callbackNumber, 'crypto_exchange', testScamDetails, null, process.env.TWILIO_PHONE_NUMBER);

    res.json({
      success: true,
      message: `Coinbase agent callback test initiated to ${callbackNumber}`,
      callId: call.id,
      agentId: agentId,
      agentName: assistantName,
      randomCallerNumber: true
    });
  } catch (error) {
    console.error('Error initiating Coinbase agent callback test:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Add a test endpoint for Microsoft/IT support scammer callback
app.get('/test-microsoft-callback', async (req, res) => {
  // Use the callback number from the query parameter or generate a random one
  const callbackNumber = req.query.callback || generateRandomPhoneNumber();

  try {
    console.log(`Initiating Microsoft IT support agent callback test to ${callbackNumber}`);

    // Create a simulated Microsoft IT support scam detection result
    const testScamDetails = {
      itTerms: ['microsoft', 'support', 'computer'],
      alertTerms: ['virus', 'security', 'infected', 'malware'],
      actionTerms: ['call', 'verify', 'fix', 'remove'],
      hasPhoneNumber: true,
      hasCallbackMention: true,
      llmAnalysis: {
        isScam: true,
        impersonatedCompany: 'Microsoft',
        scamType: 'it_support',
        confidence: 95,
        phoneNumber: callbackNumber
      }
    };

    // Use the VAPI call creation with transient assistant (notifications now handled in service)
    const { call, agentId, assistantName } = await createVapiCall(callbackNumber, 'it_support', testScamDetails, null, process.env.TWILIO_PHONE_NUMBER);

    res.json({
      success: true,
      message: `Microsoft IT support agent callback test initiated to ${callbackNumber}`,
      callId: call.id,
      agentType: 'transient',
      company: 'Microsoft',
      scamType: 'it_support',
      agentName: assistantName
    });
  } catch (error) {
    console.error('Error initiating Microsoft agent callback test:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Add an endpoint to serve audio files from S3 with range request support
app.get('/api/audio/:recordingSid', async (req, res) => {
  const { recordingSid } = req.params;

  if (!recordingSid) {
    return res.status(400).json({ error: 'Recording SID is required' });
  }

  try {
    console.log(`[AUDIO ENDPOINT] Fetching audio for recording SID: ${recordingSid}`);

    // First, try to construct the S3 URL directly since we know external storage is enabled
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    let recordingUrl = null;

    if (accountSid) {
      // Construct the S3 URL based on the known pattern from Twilio external storage
      recordingUrl = `https://sip-sentinel.s3.us-west-2.amazonaws.com/${accountSid}/${recordingSid}`;
      console.log(`[AUDIO ENDPOINT] Trying S3 URL: ${recordingUrl}`);

      // Test if the S3 URL exists by making a HEAD request
      const axios = require('axios');
      try {
        const headResponse = await axios.head(recordingUrl);
        if (headResponse.status === 200) {
          console.log(`[AUDIO ENDPOINT] Found recording in S3: ${recordingUrl}`);
        } else {
          console.log(`[AUDIO ENDPOINT] S3 HEAD request returned status: ${headResponse.status}`);
          recordingUrl = null;
        }
      } catch (headError) {
        console.log(`[AUDIO ENDPOINT] S3 HEAD request failed: ${headError.response?.status || headError.message}`);
        recordingUrl = null;
      }
    }

    // If S3 direct access failed, try getting the URL from Twilio (fallback)
    if (!recordingUrl) {
      try {
        console.log(`[AUDIO ENDPOINT] Falling back to Twilio API for recording ${recordingSid}`);
        const recording = await twilioClient.recordings(recordingSid).fetch();

        if (recording.status !== 'completed') {
          console.log(`[AUDIO ENDPOINT] Recording ${recordingSid} status is ${recording.status}, not completed`);
          return res.status(404).json({
            error: 'Recording not found or not completed',
            status: recording.status,
            recordingSid: recordingSid
          });
        }

        recordingUrl = recording.mediaUrl;
        console.log(`[AUDIO ENDPOINT] Got recording URL from Twilio: ${recordingUrl}`);
      } catch (twilioError) {
        console.error(`[AUDIO ENDPOINT] Twilio API failed for recording ${recordingSid}:`, twilioError.message);
        return res.status(404).json({
          error: 'Recording not found',
          message: 'Recording not found in S3 or Twilio',
          recordingSid: recordingSid,
          details: twilioError.message
        });
      }
    }

    console.log(`[AUDIO ENDPOINT] Final recording URL: ${recordingUrl}`);

    // Parse range header for seeking support
    const range = req.headers.range;
    console.log('Range header:', range);

    // Check if this is an S3 URL
    if (recordingUrl.includes('s3.amazonaws.com') || recordingUrl.includes('s3.us-west-2.amazonaws.com')) {
      // Get AWS configuration
      const awsConfig = {
        region: process.env.AWS_REGION || 'us-west-2',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_KEY
        }
      };

      // Parse the S3 URL to get bucket and key
      const { bucket, key } = parseS3Url(recordingUrl);

      if (!bucket || !key) {
        throw new Error('Could not parse S3 URL correctly');
      }

      // Create S3 client
      const s3Client = new S3Client(awsConfig);

      // First, get the object metadata to know the content length
      const headCommand = new HeadObjectCommand({
        Bucket: bucket,
        Key: key
      });
      const headResponse = await s3Client.send(headCommand);
      const contentLength = headResponse.ContentLength;

      // Set up parameters for getObject
      const params = {
        Bucket: bucket,
        Key: key
      };

      // Handle range requests for seeking support
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : contentLength - 1;
        const chunksize = (end - start) + 1;

        // Add range to S3 request
        params.Range = `bytes=${start}-${end}`;

        console.log(`Serving range: ${start}-${end} (${chunksize} bytes) of ${contentLength} total`);

        // Get the object from S3 with range
        const command = new GetObjectCommand(params);
        const response = await s3Client.send(command);

        // Set appropriate headers for partial content
        res.status(206); // Partial Content
        res.setHeader('Content-Range', `bytes ${start}-${end}/${contentLength}`);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', chunksize);
        res.setHeader('Content-Type', 'audio/wav');

        // Stream the audio data to the response
        response.Body.pipe(res);
      } else {
        // No range request, serve the entire file
        const command = new GetObjectCommand(params);
        const response = await s3Client.send(command);

        // Set appropriate headers
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Content-Length', contentLength);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Disposition', `attachment; filename="${recordingSid}.wav"`);

        // Stream the audio data to the response
        response.Body.pipe(res);
      }
    } else {
      // For non-S3 URLs, proxy the request with range support
      const headers = {};
      if (range) {
        headers.Range = range;
      }

      const response = await axios({
        method: 'GET',
        url: recordingUrl,
        headers: headers,
        responseType: 'stream'
      });

      // Forward the status code (206 for partial content, 200 for full)
      res.status(response.status);

      // Forward relevant headers
      if (response.headers['content-range']) {
        res.setHeader('Content-Range', response.headers['content-range']);
      }
      if (response.headers['accept-ranges']) {
        res.setHeader('Accept-Ranges', response.headers['accept-ranges']);
      }
      if (response.headers['content-length']) {
        res.setHeader('Content-Length', response.headers['content-length']);
      }

      // Set appropriate headers
      res.setHeader('Content-Type', 'audio/wav');
      if (!range) {
        res.setHeader('Content-Disposition', `attachment; filename="${recordingSid}.wav"`);
      }

      // Stream the audio data to the response
      response.data.pipe(res);
    }
  } catch (error) {
    console.error(`[AUDIO ENDPOINT] Error fetching audio for recording ${recordingSid}:`, error);

    // Handle specific error cases
    if (error.response && error.response.status === 403) {
      res.status(404).json({
        error: 'Recording not accessible',
        message: 'This recording may have expired or is no longer available',
        recordingSid: recordingSid
      });
    } else if (error.message && error.message.includes('authenticate')) {
      res.status(500).json({
        error: 'Authentication failed',
        message: 'Please check AWS or Twilio credentials',
        recordingSid: recordingSid
      });
    } else if (error.response && error.response.status === 404) {
      res.status(404).json({
        error: 'Recording not found',
        message: 'The requested recording does not exist in S3 or Twilio',
        recordingSid: recordingSid,
        hint: 'Check if Twilio External Storage is properly configured'
      });
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      res.status(503).json({
        error: 'Service unavailable',
        message: 'Unable to connect to audio storage service',
        recordingSid: recordingSid
      });
    } else {
      res.status(500).json({
        error: 'Error fetching audio file',
        message: error.message || 'Unknown error',
        recordingSid: recordingSid,
        errorType: error.constructor.name
      });
    }
  }
});

// Add an endpoint to manually fetch a transcription by recording SID
app.get('/fetch-transcription/:recordingSid', async (req, res) => {
  const { recordingSid } = req.params;

  if (!recordingSid) {
    return res.status(400).json({ error: 'Recording SID is required' });
  }

  try {
    console.log(`Manually fetching transcription for recording: ${recordingSid}`);

    // Try to fetch the transcription
    const transcriptionText = await fetchTranscription(recordingSid);

    if (transcriptionText) {
      // Check if the transcription is a likely scam
      const { isScam, scamType, scamDetails } = isLikelyScam(transcriptionText);

      res.json({
        success: true,
        recordingSid,
        transcriptionText,
        scamDetection: {
          isScam,
          scamType,
          scamDetails
        }
      });
    } else {
      res.json({
        success: false,
        recordingSid,
        message: 'No transcription found or transcription not yet available'
      });
    }
  } catch (error) {
    console.error('Error fetching transcription:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Add an endpoint to fetch transcriptions from S3
app.get('/api/transcriptions/:callSid/:recordingSid', async (req, res) => {
  const { callSid, recordingSid } = req.params;

  if (!callSid || !recordingSid) {
    return res.status(400).json({ error: 'Call SID and Recording SID are required' });
  }

  try {
    console.log(`Fetching transcription from S3 for call ${callSid}, recording ${recordingSid}`);

    // Try to get the transcription from S3
    const transcriptionText = await getTranscription(callSid, recordingSid);

    if (transcriptionText) {
      // Format the transcription for better display
      const formattedTranscript = formatTranscriptForDisplay(transcriptionText, callSid);

      // Return the transcription as plain text
      res.setHeader('Content-Type', 'text/plain');
      res.send(formattedTranscript);
    } else {
      // If not found in S3, try to fetch from Twilio
      console.log('Transcription not found in S3, trying Twilio...');
      const twilioTranscription = await fetchTranscription(recordingSid);

      if (twilioTranscription) {
        // Store in S3 for future use
        try {
          await storeTranscription(callSid, recordingSid, twilioTranscription);
          console.log(`Transcription for recording ${recordingSid} stored in S3`);
        } catch (storageError) {
          console.error('Error storing transcription in S3:', storageError);
          // Continue even if storage fails
        }

        // Format the transcription for better display
        const formattedTranscript = formatTranscriptForDisplay(twilioTranscription, callSid);

        // Return the transcription as plain text
        res.setHeader('Content-Type', 'text/plain');
        res.send(formattedTranscript);
      } else {
        // If still not found, try to transcribe the audio
        console.log('Transcription not found in Twilio, trying to transcribe audio...');

        try {
          // Get the recording details from Twilio
          const recording = await twilioClient.recordings(recordingSid).fetch();
          const recordingUrl = recording.mediaUrl;

          // Transcribe the audio
          const customTranscription = await getOrCreateTranscription(recordingUrl, callSid, recordingSid);

          if (customTranscription) {
            // Format the transcription for better display
            const formattedTranscript = formatTranscriptForDisplay(customTranscription, callSid);

            // Return the transcription as plain text
            res.setHeader('Content-Type', 'text/plain');
            res.send(formattedTranscript);
          } else {
            res.status(404).json({ error: 'Could not generate transcription' });
          }
        } catch (transcriptionError) {
          console.error('Error transcribing audio:', transcriptionError);
          res.status(500).json({ error: 'Error transcribing audio' });
        }
      }
    }
  } catch (error) {
    console.error('Error fetching transcription from S3:', error);
    res.status(500).json({ error: 'Error fetching transcription' });
  }
});

// Add a debug endpoint to check transcription completeness
app.get('/debug/transcription/:recordingSid', async (req, res) => {
  const { recordingSid } = req.params;

  if (!recordingSid) {
    return res.status(400).json({ error: 'Recording SID is required' });
  }

  try {
    console.log(`[TRANSCRIPTION DEBUG] Checking transcription for recording: ${recordingSid}`);

    // Get recording details
    const recording = await twilioClient.recordings(recordingSid).fetch();
    console.log(`[TRANSCRIPTION DEBUG] Recording status: ${recording.status}, duration: ${recording.duration}s`);

    // Get all transcriptions for this recording
    const transcriptions = await twilioClient.transcriptions.list({
      recordingSid: recordingSid
    });

    console.log(`[TRANSCRIPTION DEBUG] Found ${transcriptions.length} transcriptions`);

    const debugInfo = {
      recordingSid,
      recording: {
        status: recording.status,
        duration: recording.duration,
        channels: recording.channels,
        source: recording.source,
        dateCreated: recording.dateCreated,
        mediaUrl: recording.mediaUrl
      },
      transcriptions: transcriptions.map(t => ({
        sid: t.sid,
        status: t.status,
        dateCreated: t.dateCreated,
        transcriptionText: t.transcriptionText || 'Not available'
      }))
    };

    // Try to get the actual transcription text
    if (transcriptions.length > 0) {
      const transcription = transcriptions[0];
      if (transcription.status === 'completed') {
        try {
          const fullTranscription = await twilioClient.transcriptions(transcription.sid).fetch();
          // Redact phone numbers from debug transcription text for privacy
          debugInfo.fullTranscriptionText = fullTranscription.transcriptionText ?
            redactPhoneNumbersFromTranscript(fullTranscription.transcriptionText) : null;
          debugInfo.transcriptionLength = fullTranscription.transcriptionText ? fullTranscription.transcriptionText.length : 0;
        } catch (error) {
          debugInfo.transcriptionError = error.message;
        }
      }
    }

    // Try our custom transcription service as well
    try {
      const customTranscription = await transcribeAudioFromUrl(recording.mediaUrl);
      debugInfo.customTranscription = {
        text: customTranscription ? redactPhoneNumbersFromTranscript(customTranscription) : null,
        length: customTranscription ? customTranscription.length : 0
      };
    } catch (error) {
      debugInfo.customTranscriptionError = error.message;
    }

    res.json(debugInfo);
  } catch (error) {
    console.error('[TRANSCRIPTION DEBUG] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add an endpoint to list recent recordings
app.get('/list-recordings', async (req, res) => {
  try {
    console.log('Fetching recent recordings');

    // Get recent recordings (last 20)
    const recordings = await twilioClient.recordings.list({
      limit: 20
    });

    // Format the recordings for display
    const formattedRecordings = recordings.map(recording => ({
      sid: recording.sid,
      duration: recording.duration,
      channels: recording.channels,
      status: recording.status,
      dateCreated: recording.dateCreated,
      callSid: recording.callSid,
      url: recording.url,
      source: recording.source,
      links: {
        fetchTranscription: `/fetch-transcription/${recording.sid}`,
        media: recording.mediaUrl,
        audio: `/api/audio/${recording.sid}`
      }
    }));

    // Add to dashboard state for display in the frontend
    // Only include completed recordings with a duration
    const completedRecordings = recordings
      .filter(recording => recording.status === 'completed' && recording.duration > 0)
      .slice(0, 10); // Limit to 10 recordings

    if (completedRecordings.length > 0) {
      // Update dashboard state with real recordings
      const recordingsForDashboard = await Promise.all(completedRecordings.map(async (recording) => {
        try {
          // Try to get transcription
          const transcriptions = await twilioClient.transcriptions.list({
            recordingSid: recording.sid
          });

          // Get the transcription text if available
          let transcriptionText = '';
          if (transcriptions.length > 0) {
            const transcription = transcriptions[0];
            if (transcription.status === 'completed') {
              // Get the transcription text
              const transcriptionData = await twilioClient.transcriptions(transcription.sid).fetch();
              if (transcriptionData.transcriptionText) {
                transcriptionText = transcriptionData.transcriptionText;
              }
            }
          }

          // If no transcription, use a placeholder
          if (!transcriptionText) {
            transcriptionText = 'Voicemail recording (no transcription available)';
          }

          // Determine scam type based on transcription (simplified)
          let scamType = 'unknown';
          let company = 'Unknown';
          let confidence = 75;

          // Very basic detection for demo purposes
          if (transcriptionText.toLowerCase().includes('coinbase') ||
              transcriptionText.toLowerCase().includes('kraken') ||
              transcriptionText.toLowerCase().includes('crypto')) {
            scamType = 'crypto_exchange';
            company = transcriptionText.toLowerCase().includes('coinbase') ? 'Coinbase' :
                     transcriptionText.toLowerCase().includes('kraken') ? 'Kraken' : 'Crypto Exchange';
            confidence = 90;
          } else if (transcriptionText.toLowerCase().includes('microsoft') ||
                    transcriptionText.toLowerCase().includes('apple') ||
                    transcriptionText.toLowerCase().includes('support')) {
            scamType = 'it_support';
            company = transcriptionText.toLowerCase().includes('microsoft') ? 'Microsoft' :
                     transcriptionText.toLowerCase().includes('apple') ? 'Apple' : 'IT Support';
            confidence = 85;
          } else if (transcriptionText.toLowerCase().includes('bank') ||
                    transcriptionText.toLowerCase().includes('account')) {
            scamType = 'banking';
            company = 'Banking Service';
            confidence = 80;
          }

          return {
            id: recording.sid,
            company: company,
            scamType: scamType,
            message: redactPhoneNumbersFromTranscript(transcriptionText).substring(0, 150) + (transcriptionText.length > 150 ? '...' : ''),
            timestamp: recording.dateCreated,
            confidence: confidence,
            duration: recording.duration,
            audioUrl: `/api/audio/${recording.sid}`
          };
        } catch (error) {
          console.error(`Error processing recording ${recording.sid}:`, error);
          return null;
        }
      }));

      // Filter out any null entries
      const validRecordings = recordingsForDashboard.filter(r => r !== null);

      // Note: Dashboard stats are now calculated from real data sources in the API endpoint
      // No need to update dashboard state here as the API fetches fresh data each time
    }

    res.json({
      success: true,
      count: formattedRecordings.length,
      recordings: formattedRecordings
    });
  } catch (error) {
    console.error('Error listing recordings:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Add a route to test scam detection without making a call
app.post('/test-detection', (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required in the request body' });
  }

  const result = isLikelyScam(message);

  res.json({
    message,
    result
  });
});

// Add an endpoint to test voicemail filtering logic
app.post('/test-voicemail-filtering', async (req, res) => {
  try {
    const { transcriptionText, scamAnalysis, duration } = req.body;

    if (!transcriptionText) {
      return res.status(400).json({ error: 'transcriptionText is required in the request body' });
    }

    // Test the filtering logic
    const shouldDisplay = shouldEngageScammer(scamAnalysis || {}, transcriptionText, duration);

    // Also run LLM analysis if no scamAnalysis provided
    let llmAnalysis = null;
    if (!scamAnalysis) {
      try {
        llmAnalysis = await analyzeMessageWithLLM(transcriptionText);
      } catch (error) {
        console.error('LLM analysis failed:', error);
      }
    }

    // Test with LLM analysis if available
    const shouldDisplayWithLLM = llmAnalysis ?
      shouldEngageScammer(llmAnalysis, transcriptionText, duration) : null;

    res.json({
      transcriptionText,
      duration: duration || null,
      providedScamAnalysis: scamAnalysis,
      llmAnalysis,
      shouldDisplay,
      shouldDisplayWithLLM,
      thresholds: SCAM_DETECTION_THRESHOLDS,
      filteringCriteria: {
        hasMinimumLength: transcriptionText.trim().length >= SCAM_DETECTION_THRESHOLDS.MIN_TRANSCRIPT_LENGTH,
        meetsConfidenceThreshold: scamAnalysis?.confidence >= SCAM_DETECTION_THRESHOLDS.MIN_LLM_CONFIDENCE,
        isClassifiedAsScam: scamAnalysis?.isScam !== false,
        meetsMinimumDuration: duration === null || duration >= SCAM_DETECTION_THRESHOLDS.MIN_RECORDING_DURATION
      }
    });
  } catch (error) {
    console.error('Error in voicemail filtering test:', error);
    res.status(500).json({
      error: 'Failed to test voicemail filtering',
      message: error.message
    });
  }
});



// VAPI Management Endpoints

// List all available VAPI assistants
app.get('/vapi/assistants', async (req, res) => {
  try {
    const assistants = await listVapiAssistants();
    res.json({
      success: true,
      count: assistants.length,
      assistants: assistants.map(assistant => ({
        id: assistant.id,
        name: assistant.name || 'Unnamed Assistant',
        createdAt: assistant.createdAt,
        updatedAt: assistant.updatedAt
      }))
    });
  } catch (error) {
    console.error('Error listing assistants:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// List all available VAPI phone numbers
app.get('/vapi/phone-numbers', async (req, res) => {
  try {
    const phoneNumbers = await listVapiPhoneNumbers();
    res.json({
      success: true,
      count: phoneNumbers.length,
      phoneNumbers: phoneNumbers.map(pn => ({
        id: pn.id,
        number: pn.number,
        provider: pn.provider,
        status: pn.status,
        createdAt: pn.createdAt
      }))
    });
  } catch (error) {
    console.error('Error listing phone numbers:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Create or get a VAPI phone number
app.post('/vapi/phone-numbers', async (req, res) => {
  try {
    const { areaCode } = req.body;
    const phoneNumber = await getOrCreateVapiPhoneNumber(areaCode);

    if (phoneNumber) {
      res.json({
        success: true,
        phoneNumber: {
          id: phoneNumber.id,
          number: phoneNumber.number,
          provider: phoneNumber.provider,
          status: phoneNumber.status
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to create or get phone number'
      });
    }
  } catch (error) {
    console.error('Error creating phone number:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get call analytics
app.get('/vapi/analytics', async (req, res) => {
  try {
    console.log('Analytics endpoint called');

    // Ensure we always return JSON
    res.setHeader('Content-Type', 'application/json');

    const analytics = await getCallAnalytics();
    console.log('Analytics result:', JSON.stringify(analytics, null, 2));

    // Return real analytics data only - no mock data
    res.json({
      success: true,
      analytics
    });
  } catch (error) {
    console.error('Error getting analytics:', error);

    // Ensure we always return JSON, never raw text
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get analytics',
      message: 'Unable to retrieve call analytics data'
    });
  }
});

// Get specific call details
app.get('/vapi/calls/:callId', async (req, res) => {
  try {
    const { callId } = req.params;
    const callDetails = await getCallDetails(callId);

    res.json({
      success: true,
      callDetails
    });
  } catch (error) {
    console.error('Error getting call details:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// VAPI webhook endpoint
app.post('/vapi/webhook', async (req, res) => {
  try {
    const result = handleVapiWebhook(req.body);

    // Broadcast VAPI call status updates to SSE clients
    const { type, call } = req.body;
    if (call && call.id) {
      const callId = call.id;

      // Always send webhook notifications for call status events, regardless of liveCallsMap
      switch (type) {
        case 'call.started':
          // Send webhook notification for call started
          try {
            await notifyAgentCallStatus(WEBHOOK_EVENTS.AGENT_CALL_STARTED, {
              callId: callId,
              status: 'in-progress',
              startTime: new Date().toISOString(),
              agentName: call.assistant?.name || 'Unknown Agent'
            });
          } catch (error) {
            console.error(`Error sending webhook for call started ${callId}:`, error);
          }
          break;

        case 'call.ended':
          // Update active calls count
          await updateActiveCallsCount();

          // Calculate duration from timestamps (VAPI provides startedAt/endedAt, not duration directly)
          const duration = call.endedAt && call.startedAt ?
            Math.round((new Date(call.endedAt) - new Date(call.startedAt)) / 1000) : 0;
          const successful = duration >= 300;

          // Get recording URL from multiple possible sources
          let recordingUrl = null;
          // Check multiple possible locations for the recording URL
          recordingUrl = call.artifact?.recordingUrl ||
                        call.recordingUrl ||
                        call.artifact?.stereoRecordingUrl ||
                        null;

          console.log(`📹 Recording URL extraction: artifact=${!!call.artifact?.recordingUrl}, direct=${!!call.recordingUrl}, stereo=${!!call.artifact?.stereoRecordingUrl}, final=${!!recordingUrl}`);

          // If no recording URL found immediately, try fetching the call again (sometimes it takes a moment)
          if (!recordingUrl && duration > 30) { // Only retry for calls longer than 30 seconds
            try {
              console.log(`📹 No recording URL found, trying immediate re-fetch for call ${callId}...`);
              await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
              const refetchedCall = await vapiClient.calls.get(callId);
              recordingUrl = refetchedCall.artifact?.recordingUrl ||
                           refetchedCall.recordingUrl ||
                           refetchedCall.artifact?.stereoRecordingUrl ||
                           null;

              if (recordingUrl) {
                console.log(`📹 Found recording URL on immediate re-fetch: ${recordingUrl}`);
              } else {
                console.log(`📹 Still no recording URL found on immediate re-fetch`);
              }
            } catch (refetchError) {
              console.error(`📹 Error in immediate re-fetch for call ${callId}:`, refetchError);
            }
          }

          // If still no recording URL found, schedule a delayed retry
          if (!recordingUrl && duration > 30) { // Only retry for calls longer than 30 seconds
            console.log(`📹 No recording URL found immediately for call ${callId}, scheduling delayed retry...`);
            setTimeout(async () => {
              try {
                console.log(`📹 Retrying recording URL fetch for call ${callId}...`);
                const updatedCall = await vapiClient.calls.get(callId);
                const delayedRecordingUrl = updatedCall.artifact?.recordingUrl ||
                                          updatedCall.recordingUrl ||
                                          updatedCall.artifact?.stereoRecordingUrl ||
                                          null;

                if (delayedRecordingUrl) {
                  console.log(`📹 Found recording URL on retry: ${delayedRecordingUrl}`);

                  // Send audio notification with the delayed recording
                  const delayedCallData = {
                    callId: callId,
                    status: 'completed',
                    endTime: new Date().toISOString(),
                    duration: duration,
                    successful: successful,
                    agentName: updatedCall.assistant?.name || 'Unknown Agent',
                    company: 'Unknown Company'
                  };

                  // If we have tracked data, use it for more detailed information
                  if (trackedCall) {
                    delayedCallData.status = trackedCall.status;
                    delayedCallData.company = trackedCall.scamDetails?.impersonatedCompany ||
                                              extractCompanyFromAgent(call.assistant?.name) ||
                                              'Unknown';
                    delayedCallData.originalCaller = trackedCall.originalCaller;
                  }

                  // Send only Telegram notification with audio (avoid duplicate text notifications)
                  const { sendTelegramNotification } = require('./src/webhook-service');
                  await sendTelegramNotification(WEBHOOK_EVENTS.AGENT_CALL_ENDED, delayedCallData, delayedRecordingUrl);
                  console.log(`📹 Delayed audio notification sent for call ${callId}`);
                } else {
                  console.log(`📹 Still no recording URL found for call ${callId} after retry`);
                }
              } catch (retryError) {
                console.error(`📹 Error in delayed recording retry for call ${callId}:`, retryError);
              }
            }, 30000); // Wait 30 seconds before retrying
          }

          // Send webhook notification for call ended
          try {
            const callData = {
              callId: callId,
              status: 'completed',
              endTime: new Date().toISOString(),
              duration: duration,
              successful: successful,
              agentName: call.assistant?.name || 'Unknown Agent',
              company: 'Unknown Company' // We'll need to get this from call tracking
            };

            // If we have tracked data, use it for more detailed information
            if (trackedCall) {
              callData.status = trackedCall.status;
              callData.company = trackedCall.scamDetails?.impersonatedCompany ||
                                extractCompanyFromAgent(call.assistant?.name) ||
                                'Unknown';
              callData.originalCaller = trackedCall.originalCaller;
            }

            console.log(`📧 Sending webhook notification for call ended: ${callId}, duration: ${duration}s, successful: ${successful}, recordingUrl: ${recordingUrl ? 'yes' : 'no'}`);
            await notifyAgentCallStatus(WEBHOOK_EVENTS.AGENT_CALL_ENDED, callData, recordingUrl);
          } catch (error) {
            console.error(`Error sending webhook for call ended ${callId}:`, error);
          }
          break;

        case 'call.failed':
          // Send webhook notification for call failed
          try {
            const callData = {
              callId: callId,
              status: 'failed',
              endTime: new Date().toISOString(),
              failureReason: call.endedReason || 'unknown',
              agentName: call.assistant?.name || 'Unknown Agent'
            };

            await notifyAgentCallStatus(WEBHOOK_EVENTS.AGENT_CALL_FAILED, callData);
          } catch (error) {
            console.error(`Error sending webhook for call failed ${callId}:`, error);
          }
          break;
      }

      // Update live calls map for UI tracking (separate from notifications)
      if (dashboardState.liveCallsMap.has(callId)) {
        const liveCall = dashboardState.liveCallsMap.get(callId);

        switch (type) {
          case 'call.started':
            liveCall.status = 'in-progress';
            liveCall.lastUpdate = new Date();

            broadcastToSSEClients({
              type: 'vapi_call_started',
              data: {
                callId: callId,
                agentName: liveCall.agentName,
                company: liveCall.company,
                phoneNumber: liveCall.phoneNumber
              }
            });
            break;

          case 'call.ended':
            const duration = call.endedAt && call.startedAt ?
              Math.round((new Date(call.endedAt) - new Date(call.startedAt)) / 1000) : 0;
            const successful = duration >= 300;

            // Remove from live calls map
            dashboardState.liveCallsMap.delete(callId);

            broadcastToSSEClients({
              type: 'vapi_call_ended',
              data: {
                callId: callId,
                duration: duration,
                successful: successful
              }
            });
            break;

          case 'call.failed':
            // Remove from live calls map
            dashboardState.liveCallsMap.delete(callId);

            broadcastToSSEClients({
              type: 'vapi_call_failed',
              data: {
                callId: callId,
                reason: call.endedReason || 'unknown'
              }
            });
            break;
        }
      }
    }

    res.json(result);
  } catch (error) {
    console.error('Error handling VAPI webhook:', error);
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

// Test VAPI call endpoint
app.post('/vapi/test-call', async (req, res) => {
  try {
    const { phoneNumber, scamType, agentId } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      });
    }

    // Create test scam details
    const testScamDetails = {
      scamScore: 8,
      hasInteractivePrompts: false,
      llmAnalysis: {
        impersonatedCompany: scamType === 'crypto_exchange' ? 'Coinbase' : 'Microsoft'
      }
    };

    const call = await createVapiCallService(phoneNumber, scamType || 'crypto_exchange', testScamDetails, agentId);

    res.json({
      success: true,
      message: 'VAPI call initiated successfully',
      call: {
        id: call.id,
        phoneNumber,
        scamType: scamType || 'crypto_exchange',
        agentId: agentId || 'transient'
      }
    });
  } catch (error) {
    console.error('Error creating test VAPI call:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// List VAPI calls
app.get('/vapi/calls', async (req, res) => {
  try {
    const { limit = 20, assistantId, status } = req.query;

    const options = {};
    if (limit) options.limit = parseInt(limit);
    if (assistantId) options.assistantId = assistantId;
    if (status) options.status = status;

    const calls = await listVapiCalls(options);

    res.json({
      success: true,
      count: calls.length,
      calls: calls.map(call => {
        const phoneNumber = call.customer?.number;
        const redactedPhoneNumber = redactPhoneNumber(phoneNumber);

        return {
          id: call.id,
          assistantId: call.assistantId,
          assistantName: call.assistant?.name || 'Unknown Agent',
          phoneNumber: phoneNumber, // Keep original for internal use
          redactedPhoneNumber: redactedPhoneNumber, // For display
          startedAt: call.startedAt,
          endedAt: call.endedAt,
          duration: call.duration,
          successful: call.successful,
          hasRecording: call.hasRecording,
          hasTranscript: call.hasTranscript,
          cost: call.cost,
          endedReason: call.endedReason,
          type: call.type,
          source: call.source,
          // Include analysis data
          analysis: call.analysis,
          // Include transcript preview (first 200 chars) with phone number redaction
          transcriptPreview: call.transcript ?
            redactPhoneNumbersFromTranscript(call.transcript).substring(0, 200) +
            (call.transcript.length > 200 ? '...' : '') : null
        };
      })
    });
  } catch (error) {
    console.error('Error listing VAPI calls:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get detailed VAPI call information
app.get('/vapi/calls/:callId', async (req, res) => {
  try {
    const { callId } = req.params;

    // Get call details from VAPI API
    const call = await vapiClient.calls.get(callId);

    if (!call) {
      return res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }

    // Get assistant information
    let assistant = null;
    if (call.assistantId) {
      try {
        const assistants = await listVapiAssistants();
        assistant = assistants.find(a => a.id === call.assistantId);
      } catch (error) {
        console.warn('Could not fetch assistant details:', error.message);
      }
    }

    // Calculate duration
    const duration = call.endedAt && call.startedAt ?
      (new Date(call.endedAt) - new Date(call.startedAt)) / 1000 : null;

    const phoneNumber = call.customer?.number;
    const redactedPhoneNumber = redactPhoneNumber(phoneNumber);

    res.json({
      success: true,
      call: {
        id: call.id,
        assistantId: call.assistantId,
        assistant: assistant,
        phoneNumber: phoneNumber, // Keep original for internal use
        redactedPhoneNumber: redactedPhoneNumber, // For display
        startedAt: call.startedAt,
        endedAt: call.endedAt,
        duration: duration,
        successful: duration ? duration >= 300 : false,
        cost: call.cost,
        endedReason: call.endedReason,
        status: call.status,
        type: 'agent_conversation',
        source: 'vapi',
        // Full analysis data
        analysis: call.analysis || null,
        // Full transcript with phone number redaction
        transcript: call.artifact?.transcript || call.transcript ?
          redactPhoneNumbersFromTranscript(call.artifact?.transcript || call.transcript) : null,
        // Conversation messages
        messages: call.artifact?.messages || call.messages || [],
        // Recording URLs
        recordingUrl: call.artifact?.recordingUrl || call.recordingUrl || null,
        stereoRecordingUrl: call.artifact?.stereoRecordingUrl || null,
        // Additional metadata
        costBreakdown: call.costBreakdown || null
      }
    });
  } catch (error) {
    console.error('Error getting VAPI call details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get call details'
    });
  }
});

// Get VAPI call recording
app.get('/vapi/calls/:callId/recording', async (req, res) => {
  try {
    const { callId } = req.params;
    const recording = await getVapiCallRecording(callId);

    if (recording) {
      res.json({
        success: true,
        recording
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Recording not found'
      });
    }
  } catch (error) {
    console.error('Error getting VAPI call recording:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Find agent for company
app.get('/vapi/find-agent', async (req, res) => {
  try {
    const { company, scamType } = req.query;

    if (!company) {
      return res.status(400).json({
        success: false,
        error: 'Company parameter is required'
      });
    }

    const agent = await findAgentForCompany(company, scamType);

    res.json({
      success: true,
      agent: agent ? {
        id: agent.id,
        name: agent.name,
        voice: agent.voice,
        createdAt: agent.createdAt
      } : null,
      company,
      scamType
    });
  } catch (error) {
    console.error('Error finding agent for company:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test endpoint for voice configuration
app.get('/test-voice/:name', (req, res) => {
  const { name } = req.params;
  const gender = detectGenderFromName(name);
  const voiceConfig = getRandomVoice(gender, 'vapi');

  res.json({
    name,
    detectedGender: gender,
    voiceConfig,
    availableVoices: {
      male: ['Elliot', 'Rohan', 'Cole', 'Harry', 'Spencer'],
      female: ['Paige', 'Hana', 'Kylie', 'Lily', 'Savannah', 'Neha']
    }
  });
});

// Rate limiting for test endpoints
const testEndpointLimits = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 5; // 5 requests per minute

function rateLimitTestEndpoints(req, res, next) {
  const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;

  // Clean up old entries
  for (const [ip, requests] of testEndpointLimits.entries()) {
    const filteredRequests = requests.filter(timestamp => timestamp > windowStart);
    if (filteredRequests.length === 0) {
      testEndpointLimits.delete(ip);
    } else {
      testEndpointLimits.set(ip, filteredRequests);
    }
  }

  // Check current IP's request count
  const ipRequests = testEndpointLimits.get(clientIP) || [];
  const recentRequests = ipRequests.filter(timestamp => timestamp > windowStart);

  if (recentRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
    console.warn(`⚠️  Rate limit exceeded for IP: ${clientIP} (${recentRequests.length} requests in last minute)`);
    return res.status(429).json({
      success: false,
      error: 'Rate limit exceeded. Maximum 5 requests per minute for test endpoints.',
      retryAfter: Math.ceil((recentRequests[0] + RATE_LIMIT_WINDOW - now) / 1000)
    });
  }

  // Add current request
  recentRequests.push(now);
  testEndpointLimits.set(clientIP, recentRequests);

  next();
}

// Localhost-only middleware for admin endpoints
function requireLocalhost(req, res, next) {
  const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
  const forwardedFor = req.headers['x-forwarded-for'];

  // Get the real client IP (handle proxies)
  const realIP = forwardedFor ? forwardedFor.split(',')[0].trim() : clientIP;

  // Allow localhost, 127.0.0.1, and ::1 (IPv6 localhost)
  const isLocalhost = realIP === '127.0.0.1' ||
                     realIP === '::1' ||
                     realIP === 'localhost' ||
                     realIP === '::ffff:127.0.0.1' ||
                     // Also allow if no IP is detected (local development)
                     !realIP;

  if (!isLocalhost) {
    console.warn(`⚠️  Admin endpoint access denied from IP: ${realIP}`);
    return res.status(403).json({
      success: false,
      error: 'Access denied. Admin endpoints are only accessible from localhost.'
    });
  }

  next();
}

// Webhook configuration endpoints (localhost only)
app.get('/webhooks/config', requireLocalhost, (req, res) => {
  try {
    const urls = getWebhookUrls();
    const slackUrl = getSlackWebhookUrl();
    const telegramConfig = getTelegramConfig();

    res.json({
      success: true,
      config: {
        webhookCount: urls.length,
        slackConfigured: !!slackUrl,
        telegramConfigured: !!telegramConfig,
        events: Object.values(WEBHOOK_EVENTS),
        // Only show if webhooks are configured, not the actual URLs
        hasWebhooks: urls.length > 0
      }
    });
  } catch (error) {
    console.error('Error getting webhook config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Slack configuration endpoint (localhost only)
app.get('/slack/config', requireLocalhost, (req, res) => {
  try {
    const slackUrl = getSlackWebhookUrl();

    res.json({
      success: true,
      slack: {
        configured: !!slackUrl,
        // Don't expose any part of the URL
        status: slackUrl ? 'active' : 'not_configured'
      }
    });
  } catch (error) {
    console.error('Error getting Slack config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test Slack notification endpoint (localhost only + rate limited)
app.post('/slack/test', requireLocalhost, rateLimitTestEndpoints, async (req, res) => {
  try {
    const slackUrl = getSlackWebhookUrl();

    if (!slackUrl) {
      return res.status(400).json({
        success: false,
        error: 'Slack webhook URL not configured'
      });
    }

    // Create test data
    const testData = {
      callId: 'test_call_' + Date.now(),
      agentName: 'Test Agent',
      company: 'Test Company',
      phoneNumber: '+12***567890',
      scamType: 'crypto_exchange'
    };

    const result = await sendSlackNotification(WEBHOOK_EVENTS.AGENT_CALL_INITIATED, testData);

    res.json({
      success: result.success,
      message: result.success ? 'Test Slack notification sent successfully' : 'Test Slack notification failed',
      // Don't expose detailed error information
      status: result.success ? 'delivered' : 'failed'
    });
  } catch (error) {
    console.error('Error testing Slack notification:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Telegram configuration endpoint (localhost only)
app.get('/telegram/config', requireLocalhost, (req, res) => {
  try {
    const telegramConfig = getTelegramConfig();

    res.json({
      success: true,
      telegram: {
        configured: !!telegramConfig,
        // Don't expose any part of the token or chat ID
        status: telegramConfig ? 'active' : 'not_configured'
      }
    });
  } catch (error) {
    console.error('Error getting Telegram config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test Telegram notification endpoint (localhost only + rate limited)
app.post('/telegram/test', requireLocalhost, rateLimitTestEndpoints, async (req, res) => {
  try {
    const telegramConfig = getTelegramConfig();

    if (!telegramConfig) {
      return res.status(400).json({
        success: false,
        error: 'Telegram bot not configured'
      });
    }

    // Create test data
    const testData = {
      callId: 'test_call_' + Date.now(),
      agentName: 'Test Agent',
      company: 'Test Company',
      phoneNumber: '+12***567890',
      scamType: 'crypto_exchange'
    };

    const result = await sendTelegramNotification(WEBHOOK_EVENTS.AGENT_CALL_INITIATED, testData);

    res.json({
      success: result.success,
      message: result.success ? 'Test Telegram notification sent successfully' : 'Test Telegram notification failed',
      // Don't expose detailed error information
      status: result.success ? 'delivered' : 'failed'
    });
  } catch (error) {
    console.error('Error testing Telegram notification:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Test Telegram audio notification endpoint (localhost only + rate limited)
app.post('/telegram/test-audio', requireLocalhost, rateLimitTestEndpoints, async (req, res) => {
  try {
    const telegramConfig = getTelegramConfig();

    if (!telegramConfig) {
      return res.status(400).json({
        success: false,
        error: 'Telegram not configured'
      });
    }

    // Create test data for a completed call with recording
    const testData = {
      callId: 'test_audio_call_' + Date.now(),
      agentName: 'Coinbase Jim',
      company: 'Coinbase',
      phoneNumber: '+12***567890',
      scamType: 'crypto_exchange',
      status: 'completed',
      duration: 420, // 7 minutes
      successful: true,
      endTime: new Date().toISOString()
    };

    // Use a test audio URL (replace with actual VAPI recording URL for real testing)
    const testRecordingUrl = req.body.recordingUrl || 'https://www.soundjay.com/misc/sounds/bell-ringing-05.wav';

    console.log(`🧪 Testing Telegram audio with URL: ${testRecordingUrl}`);

    const result = await notifyAgentCallStatus(WEBHOOK_EVENTS.AGENT_CALL_ENDED, testData, testRecordingUrl);
    const telegramResult = result.find(r => r.type === 'telegram');

    res.json({
      success: telegramResult?.success || false,
      audioSent: telegramResult?.audioSent || false,
      message: telegramResult?.success ?
        (telegramResult.audioSent ? 'Test audio notification sent successfully' : 'Text sent but audio failed') :
        'Test audio notification failed',
      testData,
      recordingUrl: testRecordingUrl,
      details: telegramResult?.success ? null : 'Check server logs for details'
    });
  } catch (error) {
    console.error('Error sending test Telegram audio notification:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Debug endpoint to check recent calls and their recording status (localhost only)
app.get('/debug/recent-calls-recordings', requireLocalhost, async (req, res) => {
  try {
    const { limit = 5 } = req.query;

    // Get recent calls from VAPI
    const calls = await listVapiCalls({ limit: parseInt(limit) });

    const callsWithRecordingStatus = calls.map(call => {
      const duration = call.endedAt && call.startedAt ?
        Math.round((new Date(call.endedAt) - new Date(call.startedAt)) / 1000) : 0;

      return {
        id: call.id,
        startedAt: call.startedAt,
        endedAt: call.endedAt,
        duration: duration,
        successful: duration >= 300,
        status: call.status,
        endedReason: call.endedReason,
        hasRecording: !!call.hasRecording,
        recordingUrl: call.artifact?.recordingUrl || call.recordingUrl || null,
        stereoRecordingUrl: call.artifact?.stereoRecordingUrl || null,
        artifactExists: !!call.artifact,
        artifactKeys: call.artifact ? Object.keys(call.artifact) : [],
        phoneNumber: redactPhoneNumber(call.customer?.number)
      };
    });

    res.json({
      success: true,
      totalCalls: callsWithRecordingStatus.length,
      callsWithRecordings: callsWithRecordingStatus.filter(c => c.recordingUrl).length,
      calls: callsWithRecordingStatus
    });
  } catch (error) {
    console.error('Error getting recent calls recording status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Manual trigger to send audio notification for a specific call (localhost only)
app.post('/debug/send-audio-for-call/:callId', requireLocalhost, rateLimitTestEndpoints, async (req, res) => {
  try {
    const { callId } = req.params;

    if (!callId) {
      return res.status(400).json({
        success: false,
        error: 'Call ID is required'
      });
    }

    // Get call details from VAPI
    const call = await vapiClient.calls.get(callId);

    if (!call) {
      return res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }

    // Extract recording URL
    const recordingUrl = call.artifact?.recordingUrl ||
                        call.recordingUrl ||
                        call.artifact?.stereoRecordingUrl ||
                        null;

    if (!recordingUrl) {
      return res.status(404).json({
        success: false,
        error: 'No recording URL found for this call',
        callDetails: {
          id: call.id,
          status: call.status,
          hasArtifact: !!call.artifact,
          artifactKeys: call.artifact ? Object.keys(call.artifact) : []
        }
      });
    }

    // Calculate duration
    const duration = call.endedAt && call.startedAt ?
      Math.round((new Date(call.endedAt) - new Date(call.startedAt)) / 1000) : 0;

    // Create call data for notification
    const callData = {
      callId: callId,
      status: 'completed',
      endTime: call.endedAt || new Date().toISOString(),
      duration: duration,
      successful: duration >= 300,
      agentName: call.assistant?.name || 'Unknown Agent',
      company: 'Unknown Company' // Default, will try to get from tracking
    };

    // If we have tracked data, use it for more detailed information
    if (trackedCall) {
      callData.status = trackedCall.status;
      callData.company = trackedCall.scamDetails?.impersonatedCompany ||
                        extractCompanyFromAgent(call.assistant?.name) ||
                        'Unknown';
      callData.originalCaller = trackedCall.originalCaller;
    }

    console.log(`🧪 Manually sending audio notification for call ${callId} with recording: ${recordingUrl}`);

    // Send only Telegram notification with audio
    const { sendTelegramNotification } = require('./src/webhook-service');
    const result = await sendTelegramNotification(WEBHOOK_EVENTS.AGENT_CALL_ENDED, callData, recordingUrl);

    res.json({
      success: result.success,
      audioSent: result.audioSent,
      message: result.success ?
        (result.audioSent ? 'Audio notification sent successfully' : 'Text sent but audio failed') :
        'Audio notification failed',
      callData,
      recordingUrl,
      callDetails: {
        id: call.id,
        duration: duration,
        successful: duration >= 300,
        status: call.status,
        hasRecording: !!recordingUrl
      }
    });
  } catch (error) {
    console.error('Error sending manual audio notification:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test webhook endpoint (localhost only + rate limited)
app.post('/webhooks/test', requireLocalhost, rateLimitTestEndpoints, async (req, res) => {
  try {
    const { url, secret } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'Webhook URL is required'
      });
    }

    // Validate URL format for security
    try {
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid URL protocol. Only HTTP and HTTPS are allowed.'
        });
      }
    } catch (urlError) {
      return res.status(400).json({
        success: false,
        error: 'Invalid URL format'
      });
    }

    // Create a test payload
    const testPayload = {
      event: 'webhook_test',
      timestamp: new Date().toISOString(),
      data: {
        message: 'This is a test webhook from SIPSentinel',
        testId: Date.now()
      }
    };

    // Import the webhook service function
    const { sendWebhookWithRetry } = require('./webhook-service');

    const result = await sendWebhookWithRetry(url, testPayload, secret || getWebhookSecret());

    res.json({
      success: result.success,
      message: result.success ? 'Test webhook sent successfully' : 'Test webhook failed',
      // Don't expose detailed error information
      status: result.success ? 'delivered' : 'failed'
    });
  } catch (error) {
    console.error('Error testing webhook:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Start the server for local development only
if (!process.env.VERCEL && !process.env.NETLIFY) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`=== SIPSentinel - Scam Detection Service ===`);
    console.log(`Mode: ${isHeadlessMode ? 'Headless (webhooks only)' : 'Web UI + Webhooks'}`);
    console.log(`Server is running on port ${PORT}`);
    console.log(`Monitoring for crypto exchange scams with terms: ${CRYPTO_EXCHANGES.slice(0, 5).join(', ')}...`);
    console.log(`Monitoring for IT support scams with terms: ${IT_SERVICES.slice(0, 5).join(', ')}...`);

    if (isWebUIMode) {
      console.log(`🌐 Web Dashboard: http://localhost:${PORT}`);
    }

    console.log(`Available endpoints:`);
    console.log(`- GET /: ${isWebUIMode ? 'Web dashboard' : 'Status endpoint'}`);
    console.log(`- GET /health: Detailed health check with deployment status`);
    console.log(`- GET /deployment-info: Get deployment and webhook configuration`);
    console.log(`- GET /test-call?phone=+1234567890&scamType=crypto_exchange: Test call with specific scam type`);
    console.log(`- GET /test-coinbase?phone=+1234567890: Test Coinbase agent call`);
    console.log(`- GET /test-coinbase-callback?callback=+1234567890: Test Coinbase agent callback`);
    console.log(`- GET /test-microsoft-callback?callback=+1234567890: Test Microsoft IT support agent callback`);
    console.log(`- POST /test-detection: Test scam detection without making a call`);

    console.log(`- GET /list-recordings: List recent Twilio recordings`);
    console.log(`- GET /fetch-transcription/:recordingSid: Fetch transcription for a specific recording`);
    console.log(`- POST /voice: Twilio voice webhook endpoint`);
    console.log(`- POST /recording-status: Twilio recording status webhook endpoint`);
    console.log(`- POST /transcription: Twilio transcription webhook endpoint`);
    console.log(`\nVAPI Management endpoints:`);
    console.log(`- GET /vapi/assistants: List all available VAPI assistants`);
    console.log(`- GET /vapi/phone-numbers: List all available VAPI phone numbers`);
    console.log(`- POST /vapi/phone-numbers: Create or get a VAPI phone number`);
    console.log(`- GET /vapi/calls: List VAPI calls with filtering options`);
    console.log(`- GET /vapi/calls/:callId/recording: Get VAPI call recording and transcript`);
    console.log(`- GET /vapi/find-agent?company=X: Find agent for specific company`);
    console.log(`- GET /vapi/analytics: Get call analytics and success metrics`);
    console.log(`- GET /vapi/calls/:callId: Get specific call details`);
    console.log(`- POST /vapi/webhook: VAPI webhook endpoint for call events`);
    console.log(`- POST /vapi/test-call: Test VAPI call with specific parameters`);
    console.log(`\nWebhook Management endpoints (localhost only):`);
    console.log(`- GET /webhooks/config: Get current webhook configuration`);
    console.log(`- POST /webhooks/test: Test webhook delivery (rate limited: 5/min)`);
    console.log(`\nSlack Integration endpoints (localhost only):`);
    console.log(`- GET /slack/config: Get current Slack configuration`);
    console.log(`- POST /slack/test: Test Slack notification (rate limited: 5/min)`);
    console.log(`\nTelegram Integration endpoints (localhost only):`);
    console.log(`- GET /telegram/config: Get current Telegram configuration`);
    console.log(`- POST /telegram/test: Test Telegram notification (rate limited: 5/min)`);
    console.log(`\nSecurity: Admin endpoints only accessible from localhost + rate limited`);

    // Print deployment information
    const baseUrl = process.env.CUSTOM_DOMAIN
      ? process.env.CUSTOM_DOMAIN
      : process.env.VERCEL
      ? 'https://sip-sentinel.vercel.app'
      : process.env.NETLIFY_URL
      ? process.env.NETLIFY_URL
      : `http://localhost:${PORT}`;

    const platform = process.env.VERCEL ? 'Vercel' : process.env.NETLIFY ? 'Netlify' : 'Local';

    console.log(`\n🚀 Deployment Platform: ${platform}`);
    console.log(`🌐 Base URL: ${baseUrl}`);

    // Prominently display the honeypot number
    const honeypotNumber = process.env.TWILIO_PHONE_NUMBER || 'NOT CONFIGURED';
    console.log(`\n🍯 HONEYPOT NUMBER: ${honeypotNumber}`);
    console.log(`📱 Call or text this number to test scam detection`);

    console.log(`\n📞 Configure these webhook URLs in your Twilio Console:`);
    console.log(`- Voice URL: ${baseUrl}/voice`);
    console.log(`- SMS URL: ${baseUrl}/sms`);
    console.log(`- Recording Status Callback: ${baseUrl}/recording-status`);
    console.log(`- Transcription Callback: ${baseUrl}/transcription`);

    if (platform === 'Local') {
      console.log(`\n💡 For production deployment:`);
      console.log(`- Run: vercel --prod`);
      console.log(`- Or: netlify deploy --prod`);
    }
  });
}

// Global error handler to ensure all errors return JSON (must be last)
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);

  // Ensure we always return JSON
  res.setHeader('Content-Type', 'application/json');

  if (!res.headersSent) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: err.message || 'An unexpected error occurred'
    });
  }
});

// Export the Express app for serverless deployment
module.exports = app;

// Export additional functions for testing and API usage
module.exports.isLikelyScam = isLikelyScam;
module.exports.processTranscriptionAsync = processTranscriptionAsync;
module.exports.processFallbackTranscriptionAsync = processFallbackTranscriptionAsync;
module.exports.processDelayedTranscriptionAsync = processDelayedTranscriptionAsync;