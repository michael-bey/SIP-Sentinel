/**
 * Test endpoint to manually trigger a QStash task
 */
const { queueTelegramUpload, qstash } = require('../src/qstash-service');

module.exports = async (req, res) => {
  console.log(`[TEST QSTASH] Received ${req.method} request`);
  
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  try {
    const { callId = 'test-qstash-manual', testEndpoint = false } = req.body || {};

    let result;

    if (testEndpoint) {
      // Test with the qstash-test endpoint directly using QStash client
      console.log(`[TEST QSTASH] Testing with qstash-test endpoint`);
      const testPayload = { message: 'Hello from QStash test!', timestamp: new Date().toISOString() };
      result = await qstash.publishJSON({
        url: 'https://sip-sentinel.vercel.app/api/qstash-test',
        body: testPayload,
        retries: 1,
        delay: 5
      });
      console.log(`[TEST QSTASH] Direct QStash call result:`, result);
    } else {
      console.log(`[TEST QSTASH] Attempting to queue Telegram upload for call: ${callId}`);
      result = await queueTelegramUpload({ callId });
    }

    console.log(`[TEST QSTASH] QStash task queued successfully:`, result);

    res.status(200).json({
      success: true,
      message: 'QStash task queued successfully',
      result,
      callId,
      testEndpoint
    });
  } catch (error) {
    console.error(`[TEST QSTASH] Error queuing task:`, error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to queue QStash task',
      error: error.message,
      stack: error.stack
    });
  }
};
