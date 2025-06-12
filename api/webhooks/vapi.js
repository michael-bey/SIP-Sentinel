/**
 * VAPI Webhook Handler
 * Handles status updates from the VAPI service for AI agent calls.
 */
const { handleVapiWebhook } = require('../../src/vapi-service');

module.exports = async (req, res) => {
  try {
    const result = await handleVapiWebhook(req.body);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('Error in VAPI webhook handler:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}; 