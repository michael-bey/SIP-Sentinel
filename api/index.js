/**
 * Main API Router
 * This file acts as a central router for all API endpoints, consolidating
 * multiple serverless functions into one to stay within Vercel's limits.
 */

const express = require('express');
const twilio = require('twilio');
const NodeCache = require('node-cache');
const apiCache = new NodeCache({ stdTTL: 30 }); // Cache for 30 seconds

// Lazy load services to keep cold starts fast
let vapiService = null;
function getVapiService() {
  if (!vapiService) vapiService = require('../src/vapi-service');
  return vapiService;
}

// Consolidated webhook handlers to stay under Vercel function limits
async function handleTranscription(req, res) {
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

    const { queueTranscriptionProcessing } = require('../src/qstash-service');
    queueTranscriptionProcessing({
        transcriptionText,
        callerNumber,
        callSid,
        recordingSid
    }).then(result => {
        console.log('✅ Async transcription processing queued:', result);
      })
      .catch(error => {
        console.error('❌ Async transcription processing queueing failed:', error);
      });

    console.log('🚀 Transcription processing started in background');
  }
  // If transcription failed, queue fallback processing asynchronously
  else if (transcriptionStatus === 'failed' && recordingSid && callerNumber) {
    console.log('Transcription failed. Queuing fallback processing...');

    const { queueTranscriptionProcessing } = require('../src/qstash-service');
    queueTranscriptionProcessing({
        recordingSid,
        callerNumber,
        callSid,
        transcriptionStatus: 'failed'
    }).then(result => {
        console.log('✅ Async fallback processing queued:', result);
      })
      .catch(error => {
        console.error('❌ Async fallback processing queueing failed:', error);
      });

    console.log('🚀 Fallback transcription processing started in background');
  }
  // If we don't have transcription text but we have a recording SID, queue async processing
  else if (recordingSid && callerNumber) {
    console.log('No transcription text in callback, queuing async fetch and processing...');

    const { queueTranscriptionProcessing } = require('../src/qstash-service');
    queueTranscriptionProcessing({
        recordingSid,
        callerNumber,
        callSid
    }).then(result => {
        console.log('✅ Async delayed processing queued:', result);
      })
      .catch(error => {
        console.error('❌ Async delayed processing queueing failed:', error);
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
}

// Handler for /api/audio/:recordingSid endpoint
async function handleAudioEndpoint(req, res, pathname) {
  const recordingSid = pathname.split('/').pop();

  if (!recordingSid) {
    return res.status(400).json({ error: 'Recording SID is required' });
  }

  try {
    console.log(`[AUDIO ENDPOINT] Fetching audio for recording SID: ${recordingSid}`);

    // Import required modules
    const { S3Client, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
    const axios = require('axios');

    // Get Twilio client
    const twilio = require('twilio');
    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    // First, try to construct the S3 URL directly since we know external storage is enabled
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    let recordingUrl = null;

    if (accountSid) {
      // Construct the S3 URL based on the known pattern from Twilio external storage
      recordingUrl = `https://sip-sentinel.s3.us-west-2.amazonaws.com/${accountSid}/${recordingSid}`;
      console.log(`[AUDIO ENDPOINT] Trying S3 URL: ${recordingUrl}`);

      // Test if the S3 URL exists by making a HEAD request
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
      const urlParts = recordingUrl.replace('https://', '').split('/');
      const bucket = urlParts[0].split('.')[0]; // Extract bucket name
      const key = urlParts.slice(1).join('/'); // Everything after bucket

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
}

// Handler for /api/transcriptions/:callSid/:recordingSid endpoint
async function handleTranscriptionEndpoint(req, res, pathname) {
  const pathParts = pathname.split('/');
  const callSid = pathParts[pathParts.length - 2];
  const recordingSid = pathParts[pathParts.length - 1];

  if (!callSid || !recordingSid) {
    return res.status(400).json({ error: 'Call SID and Recording SID are required' });
  }

  try {
    console.log(`Fetching transcription from S3 for call ${callSid}, recording ${recordingSid}`);

    // Import required modules
    const { getTranscription, storeTranscription } = require('../src/s3-storage-service');
    const { transcribeAudioFromUrl, getOrCreateTranscription } = require('../src/transcription-service');
    const { redactPhoneNumber } = require('../src/vapi-service');

    // Get Twilio client
    const twilio = require('twilio');
    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    // Helper function to format transcript for display
    function formatTranscriptForDisplay(transcriptionText, callSid) {
      if (!transcriptionText) return 'No transcript available';

      // Redact phone numbers for privacy
      let formattedText = transcriptionText;

      // Replace phone numbers with redacted versions
      const phoneRegex = /(\+?1?[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g;
      formattedText = formattedText.replace(phoneRegex, (match) => {
        return redactPhoneNumber(match);
      });

      return formattedText;
    }

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

      // Helper function to fetch transcription from Twilio
      async function fetchTranscription(recordingSid) {
        try {
          const transcriptions = await twilioClient.transcriptions.list({
            recordingSid: recordingSid
          });

          if (transcriptions.length > 0) {
            const transcription = transcriptions[0];
            if (transcription.status === 'completed') {
              const transcriptionData = await twilioClient.transcriptions(transcription.sid).fetch();
              return transcriptionData.transcriptionText;
            }
          }
          return null;
        } catch (error) {
          console.error('Error fetching transcription from Twilio:', error);
          return null;
        }
      }

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
}

// --- Redis/QStash Integration Handlers ---

async function handleLiveUpdates(req, res) {
  try {
    const { getRecentEvents, getAllActiveCalls, healthCheck } = require('../src/redis-service');

    if (req.method === 'GET') {
      // Handle polling mode (query parameter)
      if (req.query.mode === 'poll') {
        const since = req.query.since;

        // Get recent events from Redis
        const events = await getRecentEvents('live_updates', 20, since);

        // Get current active calls
        const activeCalls = await getAllActiveCalls();

        return res.json({
          success: true,
          events,
          activeCalls,
          timestamp: new Date().toISOString(),
          mode: 'polling'
        });
      }

      // Handle SSE mode with 9-second timeout
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control',
        'X-Accel-Buffering': 'no'
      });

      // Check Redis health
      const redisHealthy = await healthCheck();
      if (!redisHealthy) {
        res.write(`data: ${JSON.stringify({
          type: 'connection_established',
          serverless: true,
          message: 'Redis unavailable - switching to polling mode',
          timestamp: new Date().toISOString()
        })}\n\n`);

        setTimeout(() => {
          res.write(`data: ${JSON.stringify({
            type: 'connection_timeout',
            serverless: true,
            message: 'Please switch to polling mode',
            timestamp: new Date().toISOString()
          })}\n\n`);
          res.end();
        }, 500);
        return;
      }

      // Send connection established message
      res.write(`data: ${JSON.stringify({
        type: 'connection_established',
        message: 'SSE connection established with Redis',
        timestamp: new Date().toISOString()
      })}\n\n`);

      // Send initial data
      const activeCalls = await getAllActiveCalls();
      const recentEvents = await getRecentEvents('live_updates', 10);

      res.write(`data: ${JSON.stringify({
        type: 'initial_data',
        data: {
          activeCalls: activeCalls.length,
          calls: activeCalls,
          detectionStatus: 'active',
          recentEvents
        },
        timestamp: new Date().toISOString()
      })}\n\n`);

      // Close connection after 9 seconds for serverless compatibility
      setTimeout(() => {
        res.write(`data: ${JSON.stringify({
          type: 'connection_timeout',
          message: 'Connection closing - switch to polling mode',
          timestamp: new Date().toISOString()
        })}\n\n`);
        res.end();
      }, 9000);

    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error in live-updates:', error);
    res.status(500).json({ error: 'Failed to handle live updates' });
  }
}

async function handleProcessTranscription(req, res) {
  try {
    const { verifyQStashSignature, TASK_TYPES } = require('../src/qstash-service');
    const { publishEvent, removeActiveCall, EVENT_TYPES } = require('../src/redis-service');
    const { analyzeMessageWithLLM, shouldEngageScammer } = require('../src/llm-scam-detector');
    const { storeCallMetadata, storeTranscription } = require('../src/s3-storage-service');
    const { createVapiCall, redactPhoneNumber, isValidPhoneNumber } = require('../src/vapi-service');
    const { transcribeAudioFromUrl } = require('../src/transcription-service');

    // Verify QStash signature for security
    if (!verifyQStashSignature(req.headers['upstash-signature'], JSON.stringify(req.body), req.url)) {
      console.error('Invalid QStash signature');
      return res.status(403).json({ error: 'Invalid signature' });
    }

    const { taskType, taskData, taskId } = req.body;
    console.log(`🔄 Processing QStash task: ${taskType} (ID: ${taskId})`);

    if (taskType === TASK_TYPES.PROCESS_TRANSCRIPTION) {
      const { callSid, recordingUrl, recordingSid, recordingDuration, useS3 } = taskData;

      console.log(`📝 Processing transcription for call ${callSid}`);

      let actualRecordingUrl = recordingUrl;

      // If using AWS external storage, construct the S3 URL
      if (useS3) {
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        actualRecordingUrl = `https://sip-sentinel.s3.us-west-2.amazonaws.com/${accountSid}/${recordingSid}.wav`;
        console.log(`Constructed S3 URL: ${actualRecordingUrl}`);
      }

      // Get transcription from AWS Transcribe
      const transcriptionResult = await transcribeAudioFromUrl(actualRecordingUrl);

      if (!transcriptionResult || !transcriptionResult.text) {
        console.warn(`No transcription available for call ${callSid}`);
        await removeActiveCall(callSid);
        return res.status(200).json({ success: true, message: 'No transcription available' });
      }

      // Store transcription in S3
      await storeTranscription(callSid, recordingSid, transcriptionResult.text);

      // Publish transcription completed event
      await publishEvent(EVENT_TYPES.CALL_STATUS_UPDATE, {
        callSid,
        status: 'transcription_completed',
        hasTranscript: true,
        transcriptLength: transcriptionResult.text.length,
        timestamp: new Date().toISOString()
      });

      // Analyze for scams
      const scamAnalysis = await analyzeMessageWithLLM(transcriptionResult.text);
      const shouldDisplay = shouldEngageScammer(scamAnalysis, transcriptionResult.text, recordingDuration);

      // Store call metadata
      const callMetadata = {
        callSid,
        recordingSid,
        transcriptionText: transcriptionResult.text,
        scamAnalysis,
        recordingDuration,
        timestamp: new Date().toISOString(),
        shouldDisplay
      };

      await storeCallMetadata(callSid, callMetadata);

      if (shouldDisplay && scamAnalysis.isScam) {
        // Publish scam detected event
        await publishEvent(EVENT_TYPES.SCAM_DETECTED, {
          callSid,
          company: scamAnalysis.impersonatedCompany || 'Unknown',
          scamType: scamAnalysis.scamType || 'unknown',
          confidence: scamAnalysis.confidence,
          timestamp: new Date().toISOString()
        });
      }

      // Remove from active calls
      await removeActiveCall(callSid);

      return res.status(200).json({
        success: true,
        message: 'Transcription processed',
        transcriptLength: transcriptionResult.text.length
      });
    }

    res.status(400).json({ error: 'Unknown task type' });
  } catch (error) {
    console.error('Error processing QStash task:', error);
    res.status(500).json({ error: 'Task processing failed' });
  }
}

async function handleS3RecordingProcessor(req, res) {
  try {
    const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
    const { publishEvent, getActiveCall, storeActiveCall, EVENT_TYPES } = require('../src/redis-service');
    const { queueTranscriptionProcessing } = require('../src/qstash-service');

    const s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-west-2',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });

    const S3_BUCKET = 'sip-sentinel';

    if (req.method === 'GET') {
      // Handle polling request
      console.log('🔍 Polling for new recordings in S3');

      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const prefix = `${accountSid}/`;

      const listCommand = new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: prefix,
        MaxKeys: 50
      });

      const response = await s3Client.send(listCommand);
      const newRecordings = [];

      if (response.Contents) {
        const now = new Date();
        const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

        for (const object of response.Contents) {
          if (object.LastModified > fiveMinutesAgo && object.Key.endsWith('.wav')) {
            const recordingSid = object.Key.split('/')[1].replace('.wav', '');

            // Check if we've already processed this recording
            const activeCall = await getActiveCall(recordingSid);
            if (activeCall && activeCall.status !== 'recording_processed') {
              newRecordings.push({
                key: object.Key,
                recordingSid: recordingSid,
                lastModified: object.LastModified,
                size: object.Size
              });
            }
          }
        }
      }

      console.log(`📊 Found ${newRecordings.length} new recordings to process`);

      // Process each new recording
      for (const recording of newRecordings) {
        const recordingUrl = `https://${S3_BUCKET}.s3.${process.env.AWS_REGION || 'us-west-2'}.amazonaws.com/${recording.key}`;

        // Queue transcription processing
        await queueTranscriptionProcessing({
          callSid: recording.recordingSid,
          recordingUrl: recordingUrl,
          recordingSid: recording.recordingSid,
          recordingDuration: 0, // Will be estimated
          useS3: true
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Polling completed',
        newRecordings: newRecordings.length,
        recordings: newRecordings
      });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Error in S3 recording processor:', error);
    res.status(500).json({ error: 'Processing failed' });
  }
}

module.exports = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  console.log(`API router received request for: ${pathname}`);

  // --- Health & Static Handlers ---
  if (pathname.endsWith('/health')) {
    return require('./health.js')(req, res);
  }
  if (pathname.endsWith('/dashboard')) {
    return require('./dashboard.js')(req, res);
  }

  // --- Legacy /api/twilio-webhook Router ---
  // This handles old webhook configurations that point to a single endpoint.
  if (pathname === '/api/twilio-webhook') {
    const webhookType = url.searchParams.get('type');
    console.warn(`[Legacy Router] Handling deprecated /api/twilio-webhook with type: '${webhookType}'`);

    const handlers = {
      'voice': './webhooks/voice.js',
      'sms': './webhooks/sms.js',
      'recording-status': './webhooks/recording-status.js',
      'transcription': './webhooks/transcription.js'
    };

    if (handlers[webhookType]) {
      return require(handlers[webhookType])(req, res);
    }

    console.error(`[Legacy Router] Unknown webhook type: ${webhookType} for /api/twilio-webhook`);
    return res.status(400).json({ error: 'Unknown webhook type specified in query parameter' });
  }

  // --- Consolidated Webhook Router ---
  // All /api/webhooks/* routes are handled here to conserve Vercel functions.
  if (pathname.startsWith('/api/webhooks/')) {
    const webhookType = pathname.split('/').pop();
    console.log(`[Webhook Router] Handling '${webhookType}' webhook.`);

    if (webhookType === 'voice') {
      return require('./webhooks/voice.js')(req, res);
    }
    if (webhookType === 'sms') {
      return require('./webhooks/sms.js')(req, res);
    }
    if (webhookType === 'recording-status') {
      return require('./webhooks/recording-status.js')(req, res);
    }
    if (webhookType === 'transcription') {
      return require('./webhooks/transcription.js')(req, res);
    }
    if (webhookType === 'vapi') {
      return require('./webhooks/vapi.js')(req, res);
    }

    console.warn(`[Webhook Router] No handler for webhook type: ${webhookType}`);
    return res.status(404).json({ error: 'Unknown webhook type' });
  }

  // --- New Redis/QStash Integration Handlers ---
  if (pathname.endsWith('/live-updates')) {
    return handleLiveUpdates(req, res);
  }

  if (pathname.endsWith('/process-transcription')) {
    return handleProcessTranscription(req, res);
  }
  if (pathname.endsWith('/s3-recording-processor')) {
    return handleS3RecordingProcessor(req, res);
  }

  // Handle legacy webhook endpoints for backward compatibility
  // These will be routed to the new handlers.
  if (pathname.endsWith('/recording-status')) {
      console.warn('WARN: Legacy webhook call to /recording-status. Using /api/webhooks/recording-status handler.');
      return require('./webhooks/recording-status.js')(req, res);
  }
  if (pathname.endsWith('/transcription')) {
      console.warn('WARN: Legacy webhook call to /transcription. Using /api/webhooks/transcription handler.');
      return require('./webhooks/transcription.js')(req, res);
  }
  if (pathname === '/voice' || pathname === '/sms') {
     console.warn(`WARN: Legacy webhook call to ${pathname}. Please ensure Twilio is configured to use /api/webhooks${pathname}`);
     if (pathname === '/voice') return require('./webhooks/voice.js')(req, res);
     if (pathname === '/sms') return require('./webhooks/sms.js')(req, res);
  }

  // --- API Endpoints for Frontend ---
  if (pathname.endsWith('/honeypot-number')) {
    const phoneNumber = process.env.TWILIO_PHONE_NUMBER;
    return res.status(200).json({
      success: true,
      phoneNumber: phoneNumber || 'Not configured',
    });
  }

  // VAPI Audio Proxy - Handle CORS issues with VAPI storage
  if (pathname.startsWith('/api/vapi-audio/')) {
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
      return res.status(200).end();
    }

    const vapiUrl = decodeURIComponent(pathname.replace('/api/vapi-audio/', ''));

    if (!vapiUrl || !vapiUrl.startsWith('https://storage.vapi.ai/')) {
      return res.status(400).json({ error: 'Invalid VAPI audio URL' });
    }

    try {
      console.log(`[VAPI AUDIO PROXY] Proxying audio from: ${vapiUrl}`);

      const axios = require('axios');
      const range = req.headers.range;

      const headers = {
        'User-Agent': 'SIPSentinel/1.0'
      };

      if (range) {
        headers.Range = range;
      }

      const response = await axios({
        method: 'GET',
        url: vapiUrl,
        headers: headers,
        responseType: 'stream',
        timeout: 30000
      });

      // Forward the status code (206 for partial content, 200 for full)
      res.status(response.status);

      // Set CORS headers to allow frontend access
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');

      // Forward relevant headers
      if (response.headers['content-type']) {
        res.setHeader('Content-Type', response.headers['content-type']);
      }
      if (response.headers['content-range']) {
        res.setHeader('Content-Range', response.headers['content-range']);
      }
      if (response.headers['accept-ranges']) {
        res.setHeader('Accept-Ranges', response.headers['accept-ranges']);
      }
      if (response.headers['content-length']) {
        res.setHeader('Content-Length', response.headers['content-length']);
      }

      // Stream the audio data to the response
      response.data.pipe(res);

    } catch (error) {
      console.error(`[VAPI AUDIO PROXY] Error proxying audio: ${error.message}`);
      return res.status(500).json({
        error: 'Failed to proxy VAPI audio',
        message: error.message
      });
    }
    return;
  }

  if (pathname.endsWith('/vapi/analytics')) {
    try {
      const cacheKey = 'vapi-analytics';
      if (apiCache.has(cacheKey)) {
        return res.status(200).json(apiCache.get(cacheKey));
      }

      const vapi = getVapiService();

      // First, get the calls, utilizing the cache if available
      const callsCacheKey = 'vapi-calls';
      let calls;
      if (apiCache.has(callsCacheKey)) {
        calls = apiCache.get(callsCacheKey);
      } else {
        calls = await vapi.listVapiCalls();
        apiCache.set(callsCacheKey, calls);
      }

      // Then, get the assistants, also using the cache
      const assistantsCacheKey = 'vapi-assistants';
      let assistants;
      if (apiCache.has(assistantsCacheKey)) {
        assistants = apiCache.get(assistantsCacheKey);
      } else {
        assistants = await vapi.listVapiAssistants();
        apiCache.set(assistantsCacheKey, assistants);
      }
      const assistantMap = new Map(assistants.map(a => [a.id, a]));

      const analytics = await vapi.getCallAnalytics(calls, assistantMap);
      
      const response = {
        success: true,
        analytics: analytics
      };
      apiCache.set(cacheKey, response);

      return res.status(200).json(response);
    } catch (error) {
      console.error('Error fetching VAPI analytics:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch VAPI analytics' });
    }
  }
  
  if (pathname.endsWith('/vapi/assistants')) {
    try {
      const cacheKey = 'vapi-assistants';
      if (apiCache.has(cacheKey)) {
        return res.status(200).json(apiCache.get(cacheKey));
      }

      const vapi = getVapiService();
      const assistants = await vapi.listVapiAssistants();
      apiCache.set(cacheKey, assistants);

      return res.status(200).json(assistants);
    } catch (error) {
      console.error('Error fetching VAPI assistants:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch VAPI assistants' });
    }
  }
  
  if (pathname.endsWith('/vapi/calls')) {
    try {
      const cacheKey = 'vapi-calls';
      if (apiCache.has(cacheKey)) {
        return res.status(200).json(apiCache.get(cacheKey));
      }

      const vapi = getVapiService();
      const calls = await vapi.listVapiCalls();
      apiCache.set(cacheKey, calls);

      return res.status(200).json(calls);
    } catch (error) {
      console.error('Error fetching VAPI calls:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch VAPI calls',
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  if (pathname.endsWith('/vapi/phone-numbers')) {
    try {
      const cacheKey = 'vapi-phone-numbers';
      if (apiCache.has(cacheKey)) {
        return res.status(200).json(apiCache.get(cacheKey));
      }

      const vapi = getVapiService();
      const phoneNumbers = await vapi.listVapiPhoneNumbers();
      apiCache.set(cacheKey, phoneNumbers);

      return res.status(200).json(phoneNumbers);
    } catch (error) {
      console.error('Error fetching VAPI phone numbers:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch VAPI phone numbers' });
    }
  }

  // VAPI test call endpoint
  if (pathname.endsWith('/vapi/test-call') && req.method === 'POST') {
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

      const vapi = getVapiService();
      const call = await vapi.createVapiCall(phoneNumber, scamType || 'crypto_exchange', testScamDetails, agentId);

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
  }

  // --- Audio & Transcription Endpoints ---
  if (pathname.startsWith('/api/audio/')) {
    return handleAudioEndpoint(req, res, pathname);
  }

  if (pathname.startsWith('/api/transcriptions/')) {
    return handleTranscriptionEndpoint(req, res, pathname);
  }

  // --- Test Endpoints ---
  if (pathname === '/test-telegram-notification') {
    try {
      console.log('Testing Telegram notification system...');

      const { notifyAgentCallInitiated } = require('../src/webhook-service');

      const testWebhookData = {
        callId: 'test-call-' + Date.now(),
        agentName: 'Test Agent',
        company: 'Microsoft',
        phoneNumber: '+15551234567',
        scamType: 'it_support',
        scamDetails: { test: true },
        originalCaller: '+15559876543',
        agentId: 'test-agent-id'
      };

      const webhookResults = await notifyAgentCallInitiated(testWebhookData);

      return res.json({
        success: true,
        message: 'Telegram notification test completed',
        results: webhookResults
      });
    } catch (error) {
      console.error('Error testing Telegram notification:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  if (pathname === '/test-microsoft-callback') {
    try {
      const callbackNumber = req.query.callback || '+1234567890';
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

      const vapi = getVapiService();
      const { call, agentId, assistantName } = await vapi.createVapiCall(callbackNumber, 'it_support', testScamDetails, null, null, process.env.TWILIO_PHONE_NUMBER);

      return res.json({
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
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  if (pathname === '/test-coinbase-callback') {
    try {
      const callbackNumber = req.query.callback || '+1234567890';
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

      const vapi = getVapiService();
      const { call, agentId, assistantName } = await vapi.createVapiCall(callbackNumber, 'crypto_exchange', testScamDetails, null, null, process.env.TWILIO_PHONE_NUMBER);

      return res.json({
        success: true,
        message: `Coinbase agent callback test initiated to ${callbackNumber}`,
        callId: call.id,
        agentId: agentId,
        agentName: assistantName,
        randomCallerNumber: true
      });
    } catch (error) {
      console.error('Error initiating Coinbase agent callback test:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // Fallback for any other requests to /api
  res.setHeader('Content-Type', 'application/json');
  res.status(404).json({ success: false, message: `Not Found: No handler for ${pathname}` });
};
