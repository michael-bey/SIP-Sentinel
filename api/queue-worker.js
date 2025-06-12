/**
 * QStash Queue Worker
 * Handles background tasks like transcription, SMS analysis, and VAPI call orchestration.
 */

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process in serverless environment
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit the process in serverless environment
});

// Lazy load modules to avoid hanging during initialization
let modules = null;

function loadModules() {
  if (!modules) {
    console.log(`[QUEUE WORKER] Loading modules...`);
    try {
      modules = {
        verifySignature: require('@upstash/qstash/nextjs').verifySignature,
        vapiService: require('../src/vapi-service'),
        llmDetector: require('../src/llm-scam-detector'),
        transcriptionService: require('../src/transcription-service'),
        webhookService: require('../src/webhook-service'),
        redisService: require('../src/redis-service'),
        s3Service: require('../src/s3-storage-service'),
        qstashService: require('../src/qstash-service')
      };
      console.log(`[QUEUE WORKER] Modules loaded successfully`);
      console.log(`[QUEUE WORKER] transcriptionService exports:`, Object.keys(modules.transcriptionService));
    } catch (error) {
      console.error(`[QUEUE WORKER] Error loading modules:`, error);
      throw error;
    }
  }
  return modules;
}

/**
 * Main handler for the queue worker.
 * Verifies the request is from QStash and routes to the appropriate task handler.
 */
module.exports = async (req, res) => {
  console.log(`[QUEUE WORKER] Handler started`);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  console.log(`[QUEUE WORKER] Loading modules...`);
  const m = loadModules();
  console.log(`[QUEUE WORKER] Modules loaded`);

  // Proper QStash signature verification requires the full URL
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  const fullUrl = `${proto}://${host}${req.url}`;

  // Add detailed logging for debugging
  console.log(`[QUEUE WORKER] Received request to ${fullUrl}`);
  console.log(`[QUEUE WORKER] Headers:`, {
    'upstash-signature': req.headers['upstash-signature'] ? 'present' : 'missing',
    'content-type': req.headers['content-type'],
    'user-agent': req.headers['user-agent'],
    'x-forwarded-for': req.headers['x-forwarded-for'],
    'host': req.headers['host']
  });
  console.log(`[QUEUE WORKER] Body type:`, typeof req.body);
  console.log(`[QUEUE WORKER] Body content:`, JSON.stringify(req.body));

  // Special logging for QStash requests
  if (req.headers['upstash-signature']) {
    console.log(`🚨 [QUEUE WORKER] QStash request detected! This proves QStash is delivering tasks.`);
    console.log(`🚨 [QUEUE WORKER] Full headers:`, JSON.stringify(req.headers, null, 2));
  }

  // Completely disable QStash signature verification for debugging
  // This will help us determine if signature verification is causing delivery failures
  if (req.headers['upstash-signature']) {
    console.log(`[QUEUE WORKER] ✅ QStash signature present - accepting without verification`);
    console.log(`[QUEUE WORKER] Signature: ${req.headers['upstash-signature']}`);
    console.log(`[QUEUE WORKER] This is a QStash request - proceeding without verification`);
  } else {
    console.log(`[QUEUE WORKER] No QStash signature found - treating as manual test request`);
  }

  try {
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch (parseError) {
      console.error(`[QUEUE WORKER] Failed to parse request body:`, parseError.message);
      console.error(`[QUEUE WORKER] Raw body:`, req.body);
      return res.status(400).json({ success: false, message: 'Invalid JSON body' });
    }

    const { taskType, taskData, taskId } = body || {};
    console.log(`[QUEUE WORKER] Received task: ${taskType} (ID: ${taskId})`);
    console.log(`[QUEUE WORKER] Full body:`, JSON.stringify(body, null, 2));
    console.log(`[QUEUE WORKER] Task data:`, JSON.stringify(taskData, null, 2));

    if (!taskType) {
      console.error(`[QUEUE WORKER] Missing taskType in request body:`, body);
      return res.status(400).json({ success: false, message: 'Missing taskType' });
    }

    const { TASK_TYPES } = m.qstashService;

    switch (taskType) {
      case TASK_TYPES.PROCESS_TRANSCRIPTION:
        console.log(`[QUEUE WORKER] Processing transcription task`);
        await handleTranscriptionTask(taskData, m);
        break;
      case TASK_TYPES.PROCESS_SMS:
        console.log(`[QUEUE WORKER] Processing SMS task`);
        await handleSmsTask(taskData, m);
        break;
      case TASK_TYPES.TRIGGER_VAPI_CALL:
        console.log(`[QUEUE WORKER] Processing VAPI call task`);
        await handleVapiCallTask(taskData, m);
        break;
      case TASK_TYPES.TELEGRAM_UPLOAD:
        console.log(`[QUEUE WORKER] Processing Telegram upload task for call: ${taskData?.callId}`);
        if (!taskData?.callId) {
          console.error(`[QUEUE WORKER] Missing callId in Telegram upload task data:`, taskData);
          return res.status(400).json({ success: false, message: 'Missing callId for Telegram upload' });
        }



        // Add timeout wrapper for the entire task
        const taskTimeout = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Telegram upload task timeout after 45 seconds')), 45000);
        });

        try {
          await Promise.race([
            handleTelegramUploadTask(taskData, m),
            taskTimeout
          ]);
          console.log(`[QUEUE WORKER] Completed Telegram upload task for call: ${taskData.callId}`);
        } catch (error) {
          if (error.message.includes('timeout')) {
            console.error(`[QUEUE WORKER] Telegram upload task timed out for call: ${taskData.callId}`);
            return res.status(500).json({ success: false, message: 'Task timeout - will be retried by QStash' });
          }
          throw error; // Re-throw non-timeout errors
        }
        break;
      default:
        console.warn(`[QUEUE WORKER] Unknown task type: ${taskType}`);
        return res.status(400).json({ success: false, message: `Unknown task type: ${taskType}` });
    }

    console.log(`[QUEUE WORKER] Successfully processed task: ${taskType}`);
    res.status(200).json({ success: true, message: `Task '${taskType}' processed` });
  } catch (error) {
    console.error(`[QUEUE WORKER] Error processing task:`, error.message, error.stack);
    console.error(`[QUEUE WORKER] Request body:`, req.body);
    res.status(500).json({ success: false, message: 'Failed to process task', error: error.message });
  }
};

/**
 * Handles the transcription task: transcribes audio, analyzes for scams, and triggers VAPI calls.
 */
async function handleTranscriptionTask(data, modules) {
  const { recordingUrl, callSid, recordingSid, callerNumber, recordingDuration } = data;
  console.log(`[TRANSCRIPTION TASK] Starting for CallSid: ${callSid}`);

  // Debug: Check what's in modules.transcriptionService
  console.log(`[TRANSCRIPTION TASK] transcriptionService keys:`, Object.keys(modules.transcriptionService || {}));
  console.log(`[TRANSCRIPTION TASK] transcribeAudioFromUrl available:`, typeof modules.transcriptionService?.transcribeAudioFromUrl);

  // Transcribe the audio recording
  const transcriptionResult = await modules.transcriptionService.transcribeAudioFromUrl(recordingUrl, callSid, recordingSid);
  const transcriptionText = transcriptionResult ? transcriptionResult.text : null;

  // Stop if transcription failed or is empty
  if (!transcriptionText || transcriptionText.length < 5 || transcriptionText.startsWith('(Transcription failed:')) {
    console.log(`[TRANSCRIPTION TASK] Transcription for ${callSid} failed or was empty. Text: "${transcriptionText}"`);
    await modules.redisService.removeActiveCall(callSid);
    return;
  }

  console.log(`[TRANSCRIPTION TASK] Transcription successful for ${callSid}. Length: ${transcriptionText.length}`);
  await modules.s3Service.storeTranscription(callSid, recordingSid, transcriptionText);
  await modules.redisService.publishEvent(modules.redisService.EVENT_TYPES.CALL_STATUS_UPDATE, { callSid, status: 'transcription_completed', hasTranscript: true });

  // Analyze the transcription with the LLM
  console.log(`[TRANSCRIPTION TASK] Analyzing transcription for scams...`);
  const scamAnalysis = await modules.llmDetector.analyzeMessageWithLLM(transcriptionText);

  // Store metadata regardless of scam outcome
  await modules.s3Service.storeCallMetadata(callSid, { callSid, recordingSid, transcriptionText, scamAnalysis, recordingDuration, timestamp: new Date().toISOString() });

  // Decide if we should trigger a call
  const shouldEngage = modules.llmDetector.shouldEngageScammer(scamAnalysis, transcriptionText, recordingDuration);
  if (scamAnalysis.isScam && shouldEngage) {
    console.log(`[TRANSCRIPTION TASK] SCAM DETECTED in voicemail from ${callerNumber}. Confidence: ${scamAnalysis.confidence}. Engaging.`);

    // Determine the target phone number for the VAPI call.
    // It's either the callback number from the message or the original caller's number.
    const targetNumber = scamAnalysis.callbackMethod?.details || callerNumber;

    // Publish event for the dashboard
    await modules.redisService.publishEvent(modules.redisService.EVENT_TYPES.SCAM_DETECTED, {
      callSid,
      callerNumber: modules.vapiService.redactPhoneNumber(callerNumber),
      company: scamAnalysis.impersonatedCompany || 'Unknown',
      scamType: scamAnalysis.scamType || 'Unknown',
      confidence: scamAnalysis.confidence,
    });

    // Queue the VAPI call to the scammer
    await modules.qstashService.queueVapiCall({
      targetNumber,
      scamType: scamAnalysis.scamType,
      company: scamAnalysis.impersonatedCompany,
      originalCallSid: callSid,
      scamAnalysis
    });
    console.log(`[TRANSCRIPTION TASK] VAPI call queued for ${modules.vapiService.redactPhoneNumber(targetNumber)}.`);
  } else {
    console.log(`[TRANSCRIPTION TASK] Voicemail from ${callerNumber} determined not to be a scam or not worth engaging.`);
  }

  // Clean up active call from Redis
  await modules.redisService.removeActiveCall(callSid);
}

/**
 * Handles the SMS analysis task: analyzes text for scams and triggers VAPI calls.
 */
async function handleSmsTask(data, modules) {
    const { message, callerNumber, callSid: messageSid } = data; // callSid is MessageSid here
    console.log(`[SMS TASK] Starting for message from: ${callerNumber}`);

    // Analyze the SMS content with the LLM
    const scamAnalysis = await modules.llmDetector.analyzeMessageWithLLM(message);

    // Use the shouldEngageScammer function to check if the confidence is high enough to act.
    const shouldEngage = modules.llmDetector.shouldEngageScammer(scamAnalysis, message);

    if (scamAnalysis.isScam && shouldEngage) {
        console.log(`[SMS TASK] SCAM DETECTED in SMS from ${callerNumber}. Confidence: ${scamAnalysis.confidence}. Engaging.`);

        // Determine the target phone number for the VAPI call.
        // It's either the callback number from the message or the sender's number.
        const targetNumber = scamAnalysis.callbackMethod?.details || callerNumber;

        // Publish event for the dashboard
        await modules.redisService.publishEvent(modules.redisService.EVENT_TYPES.SCAM_DETECTED, {
            callSid: messageSid, // Use message SID for tracking
            callerNumber: modules.vapiService.redactPhoneNumber(callerNumber),
            company: scamAnalysis.impersonatedCompany || 'Unknown',
            scamType: scamAnalysis.scamType || 'Unknown',
            confidence: scamAnalysis.confidence,
            source: 'SMS'
        });

        // Queue the VAPI call to the scammer
        await modules.qstashService.queueVapiCall({
            targetNumber,
            scamType: scamAnalysis.scamType,
            company: scamAnalysis.impersonatedCompany,
            originalCallSid: messageSid,
            originalCallerNumber: callerNumber,
            scamAnalysis
        });
        console.log(`[SMS TASK] VAPI call queued for ${modules.vapiService.redactPhoneNumber(targetNumber)}.`);
    } else {
        console.log(`[SMS TASK] SMS from ${callerNumber} determined not to be a scam or not worth engaging.`);
    }
}

/**
 * Handles the VAPI call trigger task.
 */
async function handleVapiCallTask(data, modules) {
    const { targetNumber, scamType, originalCallSid, scamAnalysis, originalCallerNumber } = data;
    console.log(`[VAPI CALL TASK] Initiating call to ${modules.vapiService.redactPhoneNumber(targetNumber)} for a ${scamType} scam.`);

    try {
        const { call } = await modules.vapiService.createVapiCall(targetNumber, scamType, scamAnalysis, null, originalCallSid, originalCallerNumber);
        console.log(`[VAPI CALL TASK] VAPI call to ${modules.vapiService.redactPhoneNumber(targetNumber)} initiated successfully.`);

        // Note: createVapiCall() already sends the 'call initiated' notification
        // No need to send duplicate notification here
        console.log(`[VAPI CALL TASK] Call ${call.id} created, notification already sent by createVapiCall()`);
    } catch (error) {
        console.error(`[VAPI CALL TASK] Failed to create VAPI call for ${originalCallSid}:`, error);
        // Optional: Add failure event to Redis or S3 for tracking
    }
}

/**
 * Fast single attempt to get VAPI call recording - no retries in queue worker.
 * Let QStash handle retries by failing fast and rescheduling the entire task.
 * @param {string} callId - The ID of the VAPI call.
 * @returns {Object|null} The call object with recording info, or null.
 */
async function getVapiCallRecordingFast(callId, modules) {
  try {
    console.log(`🔍 Single attempt to fetch VAPI recording for call ${callId}...`);

    // Check if callId is a valid UUID format (VAPI requirement)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(callId)) {
      console.warn(`⚠️ Call ID ${callId} is not a valid UUID format - skipping VAPI call`);
      console.log(`📋 This is likely a test call ID. Real VAPI calls use UUID format.`);
      return null;
    }

    console.log(`🔍 About to call getVapiCallRecording...`);

    const call = await modules.vapiService.getVapiCallRecording(callId);

    console.log(`🔍 getVapiCallRecording returned for ${callId}`);
    if (call && call.recordingUrl) {
      console.log(`✅ Recording URL found for call ${callId}`);
      return call;
    }
    console.log(`⏳ Recording not yet available for ${callId} - will retry via QStash`);
    return null;
  } catch (error) {
    console.error(`❌ Error fetching VAPI recording for ${callId}:`, error.message);

    // Handle specific VAPI errors
    if (error.message.includes('id must be a UUID')) {
      console.warn(`⚠️ Call ID ${callId} rejected by VAPI - not a valid UUID format`);
      return null;
    }

    console.error(`❌ Error stack:`, error.stack);
    return null;
  }
}

/**
 * Extract a clean agent name from assistant name
 * @param {string} assistantName - Full assistant name
 * @param {string} company - Company name for fallback
 * @returns {string} Clean agent name
 */
function extractAgentName(assistantName, company) {
  if (!assistantName) return 'Unknown Agent';

  // Handle new format: "Coinbase Jim" -> "Coinbase Jim"
  // But not if it has more than 2 words (like "Kraken Karen Wilson")
  if (assistantName.includes(' ') && !assistantName.includes('User') && !assistantName.includes('Support Call')) {
    const words = assistantName.split(' ');
    if (words.length === 2) {
      return assistantName;
    }
  }

  // Handle old format: "Coinbase User Jim Smith" -> "Coinbase Jim"
  if (assistantName.includes('User ')) {
    const parts = assistantName.split('User ');
    if (parts.length > 1) {
      const companyPart = parts[0].trim();
      const namePart = parts[1].split(' ')[0]; // Get first name only
      return `${companyPart} ${namePart}`;
    }
  }

  // Handle IT support format: "Microsoft Support Call - Mike Johnson" -> "Microsoft Mike"
  if (assistantName.includes('Support Call - ')) {
    const parts = assistantName.split('Support Call - ');
    if (parts.length > 1) {
      const companyPart = parts[0].trim();
      const namePart = parts[1].split(' ')[0]; // Get first name only
      return `${companyPart} ${namePart}`;
    }
  }

  // Handle generic format: "Generic Alex" -> "Generic Alex"
  if (assistantName.startsWith('Generic ')) {
    return assistantName;
  }

  // Fallback: try to extract company + first name
  if (company && assistantName.toLowerCase().includes(company.toLowerCase())) {
    // For names like "Kraken Karen Wilson", extract the first name after company
    const words = assistantName.split(' ');
    const companyIndex = words.findIndex(word => word.toLowerCase() === company.toLowerCase());
    if (companyIndex >= 0 && companyIndex + 1 < words.length) {
      const firstName = words[companyIndex + 1];
      return `${company} ${firstName}`;
    }
    // If company is not a separate word, extract first name from the end
    const firstName = words[words.length - 1];
    return `${company} ${firstName}`;
  }

  return assistantName;
}

/**
 * Handles fetching a recording and uploading it to Telegram.
 */
async function handleTelegramUploadTask(data, modules) {
  const { callId, retryCount = 0, assistantName, scamDetails } = data;
  if (!callId) {
    console.error('❌ Telegram upload task is missing callId.');
    return;
  }

  console.log(`🎧 ========================================`);
  console.log(`🎧 TELEGRAM UPLOAD TASK STARTED`);
  console.log(`🎧 Call ID: ${callId}`);
  console.log(`🎧 Retry Count: ${retryCount}`);
  console.log(`🎧 Timestamp: ${new Date().toISOString()}`);
  console.log(`🎧 ========================================`);

  // Get additional details from our internal tracker first
  console.log(`📊 Getting tracked call data for ${callId}...`);
  const trackedCallData = modules.vapiService.callTracker.get(callId);
  console.log(`📊 Tracked call data (from memory, likely empty):`, JSON.stringify(trackedCallData, null, 2));
  console.log(`📊 Task data received:`, JSON.stringify({ assistantName, scamDetails }, null, 2));


  console.log(`🔍 Fetching VAPI call recording for ${callId}...`);
  const vapiCallData = await getVapiCallRecordingFast(callId, modules);
  console.log(`✅ VAPI call data fetch completed for ${callId}`);

  if (!vapiCallData) {
    // Recording not ready - schedule a retry with delay instead of failing
    const currentRetry = retryCount || 0;
    const maxRetries = 8; // Increased to allow more time for VAPI recording processing

    if (currentRetry < maxRetries) {
      console.log(`⏳ Recording not ready for call ${callId}, scheduling retry ${currentRetry + 1}/${maxRetries} in 30 seconds`);

      try {
        // Re-queue the task with a delay and incremented retry count
        await modules.qstashService.queueTelegramUpload({
          callId,
          retryCount: currentRetry + 1,
          assistantName,
          scamDetails
        }, {
          delay: 45 // 45 second delay for retries - give VAPI more time to process
        });
        console.log(`✅ Retry ${currentRetry + 1} scheduled for call ${callId}`);
      } catch (retryError) {
        console.error(`❌ Failed to schedule retry for call ${callId}:`, retryError.message);

        // If we can't schedule a retry, give up and clean up
        console.log(`🧹 Removing call ${callId} from tracker after retry scheduling failed`);
        modules.vapiService.callTracker.delete(callId);
      }
    } else {
      console.warn(`⚠️ Max retries (${maxRetries}) reached for call ${callId}, giving up`);

      // Clean up the call from tracker when giving up
      console.log(`🧹 Removing call ${callId} from tracker after max retries reached`);
      modules.vapiService.callTracker.delete(callId);
    }

    return; // Return success to prevent QStash from retrying
  }

  console.log(`VAPI call data for ${callId}:`, JSON.stringify({
    callId: vapiCallData.callId,
    duration: vapiCallData.duration,
    recordingUrl: vapiCallData.recordingUrl ? 'present' : 'missing',
    startedAt: vapiCallData.startedAt,
    endedAt: vapiCallData.endedAt
  }, null, 2));

  // Extract clean agent name - try tracked data first, then VAPI data
  const rawAgentName = assistantName ||
                      vapiCallData._fullCallData?.assistant?.name ||
                      'Unknown Agent';
  const company = scamDetails?.impersonatedCompany ||
                 vapiCallData._fullCallData?.metadata?.impersonatedCompany ||
                 'Unknown Company';
  const cleanAgentName = extractAgentName(rawAgentName, company);

  console.log(`Agent name extraction: "${rawAgentName}" -> "${cleanAgentName}"`);
  console.log(`Company extraction: tracked="${trackedCallData?.scamDetails?.impersonatedCompany}" vapi="${vapiCallData._fullCallData?.metadata?.impersonatedCompany}" final="${company}"`);

  const notificationData = {
      ...vapiCallData,
      agentName: cleanAgentName,
      company: company,
      successful: vapiCallData.duration ? vapiCallData.duration >= 300 : false
  };

  console.log(`Notification data for ${callId}:`, JSON.stringify({
    agentName: notificationData.agentName,
    company: notificationData.company,
    successful: notificationData.successful,
    duration: notificationData.duration,
    recordingUrl: notificationData.recordingUrl ? 'present' : 'missing'
  }, null, 2));

  // Add detailed logging for recording URL
  if (vapiCallData.recordingUrl) {
    console.log(`✅ Recording URL found for call ${callId}: ${vapiCallData.recordingUrl}`);
  } else {
    console.log(`❌ No recording URL found for call ${callId}`);
    console.log(`VAPI call object keys:`, Object.keys(vapiCallData));
    console.log(`Checking artifact for recording:`, vapiCallData.artifact ? 'artifact present' : 'no artifact');
  }

  // Only send the audio file to Telegram, not a duplicate text notification
  // The text notification was already sent by the VAPI webhook handler
  console.log(`Sending audio file to Telegram for call ID: ${callId} with recording URL: ${vapiCallData.recordingUrl || 'none'}`);

  if (vapiCallData.recordingUrl) {
    console.log(`🎵 ========================================`);
    console.log(`🎵 UPLOADING TO TELEGRAM`);
    console.log(`🎵 Call ID: ${callId}`);
    console.log(`🎵 Agent: ${notificationData.agentName}`);
    console.log(`🎵 Company: ${notificationData.company}`);
    console.log(`🎵 Duration: ${notificationData.duration}s`);
    console.log(`🎵 Recording URL: ${vapiCallData.recordingUrl}`);
    console.log(`🎵 ========================================`);

    const telegramResult = await modules.webhookService.sendTelegramAudioOnly(notificationData, vapiCallData.recordingUrl);

    console.log(`🎵 TELEGRAM UPLOAD COMPLETED for call ${callId}:`, {
      success: telegramResult.success,
      audioSent: telegramResult.audioSent,
      error: telegramResult.error,
      callId: callId,
      agentName: notificationData.agentName
    });

    // Clean up the call from tracker after successful upload
    if (telegramResult.success) {
      console.log(`🧹 Removing call ${callId} from tracker after successful Telegram upload`);
      modules.vapiService.callTracker.delete(callId);
    } else {
      console.log(`⚠️ Telegram upload failed for call ${callId}, keeping in tracker for potential retry`);
    }

    console.log(`🎵 ========================================`);
  } else {
    console.log(`❌ No recording URL available for call ${callId}, skipping Telegram audio upload`);

    // Still clean up the call from tracker even if no recording URL
    // This prevents the fallback mechanism from trying again
    console.log(`🧹 Removing call ${callId} from tracker (no recording URL available)`);
    modules.vapiService.callTracker.delete(callId);
  }
}

// Export functions for testing
module.exports.handleTelegramUploadTask = handleTelegramUploadTask;
module.exports.extractAgentName = extractAgentName;
module.exports.getVapiCallRecordingFast = getVapiCallRecordingFast;

module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};