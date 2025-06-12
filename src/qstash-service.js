/**
 * QStash Service for Background Task Processing
 * Uses Upstash QStash for serverless-compatible async task processing
 */

const { Client } = require('@upstash/qstash');
require('dotenv').config();

// Initialize QStash client
const qstash = new Client({
  token: process.env.QSTASH_TOKEN,
});

// Task types for QStash processing
const TASK_TYPES = {
  PROCESS_TRANSCRIPTION: 'process_transcription',
  PROCESS_SMS: 'process_sms',
  ANALYZE_TRANSCRIPTION: 'analyze_transcription',
  TRIGGER_VAPI_CALL: 'trigger_vapi_call',
  SEND_NOTIFICATIONS: 'send_notifications',
  CLEANUP_EXPIRED_DATA: 'cleanup_expired_data',
  TELEGRAM_UPLOAD: 'telegram_upload'
};

/**
 * Queue a task for background processing
 * @param {string} taskType - Type of task to process
 * @param {Object} taskData - Data for the task
 * @param {Object} options - QStash options (delay, retries, etc.)
 */
async function queueTask(taskType, taskData, options = {}) {
  try {
    // Determine the endpoint URL based on environment
    let baseUrl;
    if (process.env.VERCEL_ENV === 'production') {
      // Use the production domain for QStash delivery
      baseUrl = 'https://sip-sentinel.vercel.app';
    } else if (process.env.VERCEL_URL) {
      // Use deployment URL for preview/development
      baseUrl = `https://${process.env.VERCEL_URL}`;
    } else {
      // Local development fallback
      baseUrl = 'http://localhost:3000';
    }
    
    const endpoint = `${baseUrl}/api/queue-worker`;
    
    const payload = {
      taskType: taskType,
      taskData: taskData,
      timestamp: new Date().toISOString(),
      taskId: `${taskType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };

    console.log(`📤 Queuing task: ${taskType} to ${endpoint}`);
    console.log(`📤 Environment: VERCEL_ENV=${process.env.VERCEL_ENV}, VERCEL_URL=${process.env.VERCEL_URL}`);
    console.log(`📤 Payload:`, JSON.stringify(payload, null, 2));

    // Construct the options for publishJSON cleanly.
    // The `publishJSON` method handles stringifying the body and setting the correct Content-Type.
    const publishOptions = {
      url: endpoint,
      body: payload,
      retries: options.retries || 3,
      ...(options.delay && { delay: options.delay }),
      ...(options.headers && { headers: options.headers })
    };

    console.log(`📤 QStash options:`, JSON.stringify(publishOptions, null, 2));

    const result = await qstash.publishJSON(publishOptions);

    console.log(`✅ Task queued successfully: ${taskType}, Message ID: ${result.messageId}`);
    console.log(`✅ QStash result:`, JSON.stringify(result, null, 2));
    return {
      success: true,
      messageId: result.messageId,
      taskId: payload.taskId,
      taskType
    };
  } catch (error) {
    console.error('❌ Error queuing task:', error);
    if (error.response) {
      console.error('❌ QStash API Error Response:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

/**
 * Queue transcription processing task
 * @param {Object} callData - Call data including recording URL, call SID, etc.
 */
async function queueTranscriptionProcessing(callData) {
  return await queueTask(TASK_TYPES.PROCESS_TRANSCRIPTION, {
    callSid: callData.callSid,
    recordingUrl: callData.recordingUrl,
    recordingSid: callData.recordingSid,
    callerNumber: callData.callerNumber,
    recordingDuration: callData.recordingDuration, // Fix: Include recording duration
    useS3: callData.useS3 || false, // Fix: Include S3 flag
    timestamp: callData.timestamp || new Date().toISOString()
  });
}

/**
 * Queue scam analysis task
 * @param {Object} analysisData - Data for scam analysis
 */
async function queueScamAnalysis(analysisData) {
  return await queueTask(TASK_TYPES.ANALYZE_TRANSCRIPTION, {
    transcriptionText: analysisData.transcriptionText,
    callSid: analysisData.callSid,
    callerNumber: analysisData.callerNumber,
    recordingDuration: analysisData.recordingDuration
  });
}

/**
 * Queue VAPI call trigger task
 * @param {Object} vapiData - Data for VAPI call
 */
async function queueVapiCall(vapiData) {
  return await queueTask(TASK_TYPES.TRIGGER_VAPI_CALL, {
    targetNumber: vapiData.targetNumber,
    scamType: vapiData.scamType,
    company: vapiData.company,
    originalCallSid: vapiData.originalCallSid,
    originalCallerNumber: vapiData.originalCallerNumber,
    scamAnalysis: vapiData.scamAnalysis
  }, {
    delay: vapiData.delay || 0 // Allow delayed VAPI calls
  });
}

/**
 * Queue notification sending task
 * @param {Object} notificationData - Notification data
 */
async function queueNotification(notificationData) {
  return await queueTask(TASK_TYPES.SEND_NOTIFICATIONS, {
    eventType: notificationData.eventType,
    data: notificationData.data,
    channels: notificationData.channels || ['telegram', 'slack']
  });
}

/**
 * Queue cleanup task for expired data
 * @param {Object} cleanupData - Cleanup configuration
 */
async function queueCleanup(cleanupData) {
  return await queueTask(TASK_TYPES.CLEANUP_EXPIRED_DATA, cleanupData, {
    delay: cleanupData.delay || 3600 // Default 1 hour delay
  });
}

/**
 * Queue SMS processing task
 * @param {Object} smsData - SMS data including message and caller number
 */
async function queueSmsProcessing(smsData) {
  return await queueTask(TASK_TYPES.PROCESS_SMS, {
    message: smsData.message,
    callerNumber: smsData.callerNumber,
    callSid: smsData.callSid // Pass along for tracking
  });
}

/**
 * Verify QStash webhook signature
 * @param {string} signature - QStash signature from headers
 * @param {string} body - Request body
 * @param {string} url - Request URL
 */
function verifyQStashSignature(signature, body, url) {
  try {
    // Check if we have the required environment variables
    if (!process.env.QSTASH_CURRENT_SIGNING_KEY || !process.env.QSTASH_NEXT_SIGNING_KEY) {
      console.error('❌ QStash signing keys not configured');
      return false;
    }

    // Check if signature is provided
    if (!signature) {
      console.error('❌ No QStash signature provided');
      return false;
    }

    const { Receiver } = require('@upstash/qstash');

    const receiver = new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
    });

    // Verify the signature
    receiver.verify({
      signature,
      body,
      url
    });

    console.log('✅ QStash signature verified successfully');
    return true;
  } catch (error) {
    console.error('❌ QStash signature verification failed:', error.message);
    // Log more details for debugging
    console.error('❌ Signature:', signature);
    console.error('❌ URL:', url);
    console.error('❌ Body length:', body ? body.length : 0);
    return false;
  }
}

/**
 * Get task status from QStash (if supported)
 * @param {string} messageId - QStash message ID
 */
async function getTaskStatus(messageId) {
  try {
    // Note: QStash doesn't provide a direct status API in the current version
    // This is a placeholder for future functionality
    console.log(`📊 Checking status for task: ${messageId}`);
    return {
      messageId,
      status: 'unknown',
      message: 'Status checking not available in current QStash version'
    };
  } catch (error) {
    console.error('❌ Error getting task status:', error);
    return {
      messageId,
      status: 'error',
      error: error.message
    };
  }
}

/**
 * Health check for QStash service
 */
async function healthCheck() {
  try {
    // Simple health check by attempting to queue a test task
    const testEndpoint = process.env.VERCEL 
      ? 'https://sip-sentinel.vercel.app/health'
      : 'http://localhost:3000/health';
    
    // Don't actually send the test message, just validate the client setup
    if (!process.env.QSTASH_TOKEN) {
      throw new Error('QSTASH_TOKEN not configured');
    }
    
    console.log('✅ QStash health check passed');
    return true;
  } catch (error) {
    console.error('❌ QStash health check failed:', error);
    return false;
  }
}

/**
 * Queues a task to fetch a call recording and upload it to Telegram.
 * Uses QStash's built-in retry mechanism with exponential backoff.
 * @param {Object} taskData - Data for the task, should include { callId }.
 * @param {Object} options - QStash options (delay, retries, etc.)
 */
async function queueTelegramUpload(taskData, options = {}) {
    try {
        const delayInfo = options.delay ? ` with ${options.delay}s delay` : '';
        console.log(`[QSTASH] Queuing Telegram upload task for call: ${taskData.callId}${delayInfo}`);

        // Configure QStash retry settings
        // VAPI recordings need time to process after call ends, so use longer initial delay
        const qstashOptions = {
          retries: 3, // Increased back to 3 for better reliability
          delay: options.delay || 90, // Increased to 90s to give VAPI time to process recordings
          ...options
        };

        const result = await queueTask(TASK_TYPES.TELEGRAM_UPLOAD, taskData, qstashOptions);
        console.log(`[QSTASH] Telegram upload task queued successfully for call: ${taskData.callId} (${qstashOptions.retries} retries, ${qstashOptions.delay}s initial delay)`);
        return result;
    } catch (error) {
        console.error(`[QSTASH] Error queuing Telegram upload task for call ${taskData.callId}:`, error.message);
        throw error;
    }
}

module.exports = {
  qstash,
  TASK_TYPES,
  queueTask,
  queueTranscriptionProcessing,
  queueScamAnalysis,
  queueVapiCall,
  queueNotification,
  queueCleanup,
  queueSmsProcessing,
  verifyQStashSignature,
  getTaskStatus,
  healthCheck,
  queueTelegramUpload
};
