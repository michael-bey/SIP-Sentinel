/**
 * Twilio Voice Webhook
 * Handles incoming voice calls and generates TwiML to record a message.
 */
const twilio = require('twilio');
const { buffer } = require('micro');
const { URLSearchParams } = require('url');
const { storeActiveCall, publishEvent, EVENT_TYPES } = require('../../src/redis-service');

// Disable Vercel's default body parser for this route.
const config = {
  api: {
    bodyParser: false,
  },
};

// Verify Twilio signature for security
/* async function verifyTwilioSignature(req) {
  const twilioSignature = req.headers['x-twilio-signature'];
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!twilioSignature || !authToken) {
    return { isValid: false, error: 'Missing signature or token' };
  }

  // In development, skip signature verification for easier local testing
  if (process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1') {
    console.log('Voice: Development mode: skipping Twilio signature verification');
    const rawBody = await buffer(req); // Still need to buffer for consistency
    return { isValid: true, rawBody };
  }

  // Reconstruct the URL that Twilio signed.
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const webhookUrl = new URL(req.url, `${proto}://${host}`).href;
  
  console.log('Voice: Verifying Twilio signature for URL:', webhookUrl);

  const rawBody = await buffer(req);
  const isValid = twilio.validateRequestWithBody(
    authToken,
    twilioSignature,
    webhookUrl,
    rawBody
  );

  console.log('Voice: Signature validation result:', isValid);
  return { isValid, rawBody };
} */

const handler = async (req, res) => {
  try {
    // Bypassing signature verification for debugging
    const rawBody = await buffer(req);

    // Parse the request body to extract call information
    const bodyParams = new URLSearchParams(rawBody.toString());
    const callerNumber = bodyParams.get('From') || '';
    const callSid = bodyParams.get('CallSid') || '';

    console.log(`📞 Incoming voice call from ${callerNumber} (Call SID: ${callSid})`);

    // Store active call data in Redis for real-time dashboard
    if (callSid && callerNumber) {
      const currentTime = new Date();
      const callData = {
        id: callSid,
        type: 'incoming_call',
        status: 'ringing',
        startTime: currentTime,
        duration: 0,
        phoneNumber: callerNumber,
        agentName: null,
        company: 'Unknown',
        lastUpdate: currentTime
      };

      try {
        await storeActiveCall(callSid, callData, 3600); // Store for 1 hour
        console.log(`💾 Stored active call data for ${callSid}`);

        // Publish real-time event for dashboard
        await publishEvent(EVENT_TYPES.INCOMING_CALL, {
          callSid: callSid,
          callerNumber: callerNumber,
          timestamp: currentTime.toISOString(),
          status: 'ringing'
        });
        console.log(`📡 Published incoming call event for ${callSid}`);
      } catch (redisError) {
        console.error('❌ Failed to store active call data:', redisError);
        // Continue processing even if Redis fails
      }
    }

    const twiml = new twilio.twiml.VoiceResponse();

    // Always use the main production URL for webhooks to avoid preview deployment issues
    const baseUrl = process.env.VERCEL
      ? 'https://sip-sentinel.vercel.app'
      : 'http://localhost:3000';

    // A simple, personal voicemail message to encourage scammers to leave messages
    twiml.say({
      voice: 'alice',
      language: 'en-US'
    }, 'Hi, you\'ve reached me but I can\'t come to the phone right now. Please leave your name, number, and a message and I\'ll get back to you.');

    twiml.record({
      action: `${baseUrl}/api/webhooks/recording-status`,
      transcribeCallback: `${baseUrl}/api/webhooks/transcription`,
      maxLength: 300,
      timeout: 15,
      playBeep: true,
      transcribe: true,
      trim: 'do-not-trim'
    });

    twiml.hangup();

    res.setHeader('Content-Type', 'text/xml');
    res.status(200).end(twiml.toString());
  } catch (error) {
    console.error('Voice: Error processing webhook:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
};

module.exports = handler;
module.exports.config = config;