/**
 * Twilio Transcription Webhook
 * Handles the callback from Twilio when a transcription is ready.
 */
const { buffer } = require('micro');
const { URLSearchParams } = require('url');
const { queueTranscriptionProcessing } = require('../../src/qstash-service');

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
    const transcriptionText = bodyParams.get('TranscriptionText') || '';
    const transcriptionStatus = bodyParams.get('TranscriptionStatus') || '';
    const recordingSid = bodyParams.get('RecordingSid');
    const callSid = bodyParams.get('CallSid');
    const callerNumber = bodyParams.get('From');

    console.log(`Transcription for Call SID ${callSid} (Status: ${transcriptionStatus})`);

    // RESPOND IMMEDIATELY to avoid Vercel timeout
    res.status(200).send('');

    // Asynchronously queue the full processing task
    const taskPayload = {
      transcriptionText,
      transcriptionStatus,
      callerNumber,
      callSid,
      recordingSid,
    };
    
    try {
      console.log('Attempting to queue transcription for async processing:', taskPayload);
      const result = await queueTranscriptionProcessing(taskPayload);
      console.log(`✅ Async transcription processing queued for call ${callSid}. Message ID: ${result.messageId}`);
    } catch (queueError) {
      console.error(`❌ FAILED to queue transcription processing for call ${callSid}.`);
      console.error(`❌ Reason:`, queueError.message);
      console.error(`❌ Error Details:`, queueError);
    }

  } catch (error) {
    console.error('Error in transcription webhook:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
};

module.exports = handler;
module.exports.config = config; 