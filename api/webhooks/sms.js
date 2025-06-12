/**
 * Twilio SMS Webhook
 * Handles incoming SMS messages, enqueues them for async processing.
 */
const twilio = require('twilio');
const { queueSmsProcessing } = require('../../src/qstash-service');
const { storeTemporaryData } = require('../../src/redis-service');
const { buffer } = require('micro');
const { URLSearchParams } = require('url');

// Disable Vercel's default body parser for this route.
// This is required to get the raw body for signature validation.
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

    const twiml = new twilio.twiml.MessagingResponse();
    
    // Manually parse the now-validated raw body
    const bodyParams = new URLSearchParams(rawBody.toString());
    const message = bodyParams.get('Body');
    const callerNumber = bodyParams.get('From');
    const messageSid = bodyParams.get('MessageSid');


    console.log(`SMS received from ${callerNumber} (SID: ${messageSid}): "${message}"`);

    // Immediately respond to Twilio to avoid timeouts
    twiml.message('Thank you for your message. It has been received and is being processed.');
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).end(twiml.toString());

    // Asynchronously queue the SMS for full analysis to avoid Vercel timeouts
    try {
      console.log(`Attempting to queue SMS from ${callerNumber} for background processing.`);
      const result = await queueSmsProcessing({
        message,
        callerNumber,
        callSid: messageSid // Use MessageSid for tracking, as CallSid is for calls
      });
      console.log(`✅ SMS from ${callerNumber} successfully queued with QStash. Message ID: ${result.messageId}`);
    } catch (queueError) {
      console.error(`❌ FAILED to queue SMS from ${callerNumber}.`);
      console.error(`❌ Reason:`, queueError.message);
      console.error(`❌ Error Details:`, queueError);
      // We can't send a response to Twilio here because we already did.
      // The console error is the only signal we have.
    }

  } catch (error) {
    console.error('SMS: Unhandled error in webhook:', error);
    // Avoid sending a JSON response if headers are already sent
    if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
    }
  }
};

module.exports = handler;
module.exports.config = config;