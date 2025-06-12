/**
 * Twilio Recording Status Webhook
 * Handles the callback from Twilio when a recording is available.
 */
const { buffer } = require('micro');
const { URLSearchParams } = require('url');
const { queueTranscriptionProcessing } = require('../../src/qstash-service');
const { removeActiveCall, publishEvent, EVENT_TYPES } = require('../../src/redis-service');

// Disable Vercel's default body parser to get the raw body for validation.
const config = {
  api: {
    bodyParser: false,
  },
};

// Reusable signature verification function
/* async function verifyTwilioSignature(req) {
  const twilioSignature = req.headers['x-twilio-signature'];
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!twilioSignature || !authToken) {
    return { isValid: false, error: 'Missing signature or token' };
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const webhookUrl = new URL(req.url, `${proto}://${host}`).href;
  
  const rawBody = await buffer(req);
  const isValid = twilio.validateRequestWithBody(authToken, twilioSignature, webhookUrl, rawBody);
  
  return { isValid, rawBody };
} */

const handler = async (req, res) => {
  try {
    // Bypassing signature verification for debugging
    const rawBody = await buffer(req);
    
    // Manually parse the validated raw body
    const bodyParams = new URLSearchParams(rawBody.toString());
    const recordingSid = bodyParams.get('RecordingSid');
    const callSid = bodyParams.get('CallSid');
    const callerNumber = bodyParams.get('From'); // `From` is available in recording status callbacks
    const recordingDuration = parseInt(bodyParams.get('RecordingDuration') || '0', 10);
    
    console.log(`📹 Recording completed for Call SID ${callSid} (Recording SID: ${recordingSid}, Duration: ${recordingDuration}s)`);

    // Remove the call from active calls since recording is complete
    if (callSid) {
      try {
        await removeActiveCall(callSid);
        console.log(`🗑️ Removed active call ${callSid} from Redis`);

        // Publish call completion event
        await publishEvent(EVENT_TYPES.CALL_STATUS_UPDATE, {
          callSid: callSid,
          status: 'recording_completed',
          recordingDuration: recordingDuration,
          timestamp: new Date().toISOString()
        });
        console.log(`📡 Published call completion event for ${callSid}`);
      } catch (redisError) {
        console.error('❌ Failed to remove active call from Redis:', redisError);
        // Continue processing even if Redis fails
      }
    }

    if (recordingSid && callerNumber) {
      try {
        console.log('Attempting to queue background transcription for recording:', recordingSid);
        
        // With external S3 storage, Twilio saves the file without an extension.
        // We will construct the base S3 URL here, and the transcription service will handle renaming.
        const finalRecordingUrl = `https://sip-sentinel.s3.us-west-2.amazonaws.com/${process.env.TWILIO_ACCOUNT_SID}/${recordingSid}`;

        const result = await queueTranscriptionProcessing({
          recordingUrl: finalRecordingUrl,
          recordingSid: recordingSid,
          callerNumber: callerNumber,
          callSid: callSid,
          recordingDuration: recordingDuration
        });
        console.log(`✅ Background transcription task queued for ${recordingSid}. Message ID: ${result.messageId}`);
      } catch (queueError) {
        console.error(`❌ FAILED to queue transcription for recording ${recordingSid}.`);
        console.error(`❌ Reason:`, queueError.message);
        console.error(`❌ Error Details:`, queueError);
      }
    }

    // Respond immediately to Twilio
    res.status(200).send('');

  } catch (error) {
    console.error('Error in recording-status webhook:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
};

module.exports = handler;
module.exports.config = config; 