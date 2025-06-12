/**
 * Simple test endpoint to verify QStash can reach our server
 */
module.exports = async (req, res) => {
  console.log(`[QSTASH TEST] Received ${req.method} request`);
  console.log(`[QSTASH TEST] Headers:`, JSON.stringify(req.headers, null, 2));
  console.log(`[QSTASH TEST] Body:`, JSON.stringify(req.body, null, 2));
  
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  // Log QStash signature if present
  if (req.headers['upstash-signature']) {
    console.log(`[QSTASH TEST] QStash signature present: ${req.headers['upstash-signature']}`);
  } else {
    console.log(`[QSTASH TEST] No QStash signature found`);
  }

  res.status(200).json({ 
    success: true, 
    message: 'QStash test endpoint reached successfully',
    timestamp: new Date().toISOString(),
    headers: req.headers,
    body: req.body
  });
};
