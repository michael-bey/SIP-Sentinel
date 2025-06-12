/**
 * Clear QStash queue by cancelling all pending messages
 */
module.exports = async (req, res) => {
  console.log(`[CLEAR QSTASH] Starting queue cleanup...`);
  
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  try {
    const QSTASH_TOKEN = process.env.QSTASH_TOKEN;
    if (!QSTASH_TOKEN) {
      throw new Error('QSTASH_TOKEN not configured');
    }

    // Cancel all messages using QStash bulk cancel API
    console.log(`[CLEAR QSTASH] Cancelling all pending messages...`);
    
    const response = await fetch('https://qstash.upstash.io/v2/messages/', {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${QSTASH_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        // Empty messageIds array means cancel all messages
        messageIds: []
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`QStash API error: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    console.log(`[CLEAR QSTASH] Successfully cancelled ${result.cancelled} messages`);

    res.status(200).json({
      success: true,
      message: `Cancelled ${result.cancelled} QStash messages`,
      cancelled: result.cancelled
    });

  } catch (error) {
    console.error(`[CLEAR QSTASH] Error:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear QStash queue',
      error: error.message
    });
  }
};
