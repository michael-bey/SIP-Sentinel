/**
 * Live Updates Endpoint (SSE with Redis Pub/Sub)
 *
 * Establishes a true real-time connection using Redis Pub/Sub for event broadcasting.
 * The connection is kept alive for the duration of the serverless function's timeout.
 */

const { getRecentEvents, getAllActiveCalls, healthCheck, getRawRedisClient } = require('../src/redis-service');

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    // Polling mode is a fallback and remains unchanged
    if (req.query.mode === 'poll') {
      return handlePollingRequest(req, res);
    }

    // Handle SSE mode with a real Redis subscription
    return handleSSEConnection(req, res);
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
};

/**
 * Handle polling requests for real-time updates
 */
async function handlePollingRequest(req, res) {
  try {
    const since = req.query.since;

    // Get recent events from Redis
    const events = await getRecentEvents('live_updates', 20, since);

    // Get current active calls
    const activeCalls = await getAllActiveCalls();

    res.json({
      success: true,
      events,
      activeCalls,
      timestamp: new Date().toISOString(),
      mode: 'polling'
    });
  } catch (error) {
    console.error('Error in polling mode:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch updates',
      message: error.message
    });
  }
}

/**
 * Handle SSE connections with a persistent Redis Pub/Sub listener.
 */
async function handleSSEConnection(req, res) {
  try {
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no' // Disable nginx buffering for Vercel
    });

    // 1. Initial health check and connection message
    const redisHealthy = await healthCheck();
    if (!redisHealthy) {
      console.warn('Redis health check failed, falling back to polling mode');
      sendSSEMessage(res, {
        type: 'connection_established',
        serverless: true,
        message: 'Redis unavailable - switching to polling mode',
        timestamp: new Date().toISOString()
      });

      setTimeout(() => {
        sendSSEMessage(res, {
          type: 'connection_timeout',
          serverless: true,
          message: 'Please switch to polling mode',
          timestamp: new Date().toISOString()
        });
        res.end();
      }, 500);
      return;
    }
    
    sendSSEMessage(res, { type: 'connection_established', message: 'SSE connection established with Redis Pub/Sub.' });

    // 2. Send the initial snapshot of data
    const activeCalls = await getAllActiveCalls();
    const recentEvents = await getRecentEvents('live_updates', 10);
    sendSSEMessage(res, {
      type: 'initial_data',
      data: { activeCalls: activeCalls.length, calls: activeCalls, recentEvents }
    });

    // 3. Create a NEW, DEDICATED Redis client for this specific SSE connection
    const subscriber = getRawRedisClient();
    await subscriber.connect();

    const channel = 'live_updates';

    // 4. Set up the message listener
    const listener = (message, receivedChannel) => {
      if (receivedChannel === channel) {
        console.log(`[SSE] Received message from Redis on channel '${channel}'`);
        try {
          // The message is the event we published, send it directly to the client
          const eventData = JSON.parse(message);
          sendSSEMessage(res, eventData);
        } catch (e) {
          console.error('[SSE] Error parsing message from Redis:', e);
        }
      }
    };

    // 5. Subscribe to the channel
    await subscriber.subscribe(channel, listener);
    console.log(`[SSE] Subscribed to Redis channel: ${channel}`);
    
    // 6. Set up heartbeat and cleanup logic
    const heartbeatInterval = setInterval(() => sendSSEMessage(res, { type: 'heartbeat' }), 5000);

    const cleanup = async () => {
      console.log('[SSE] Cleaning up SSE connection.');
      clearInterval(heartbeatInterval);
      if (subscriber.isOpen) {
        try {
          await subscriber.unsubscribe(channel);
          await subscriber.quit();
          console.log('[SSE] Redis subscriber connection closed.');
        } catch (e) {
          console.error('Error during Redis cleanup:', e);
        }
      }
      if (!res.finished) {
        res.end();
      }
    };

    // Vercel function will time out. Let's close gracefully just before it does.
    // Hobby tier timeout is 10s. Pro is 60s. We'll use a safe value.
    const closeTimeout = setTimeout(cleanup, 9500); // 9.5 seconds

    // Clean up if the client closes the connection
    req.on('close', () => {
      console.log('[SSE] Client disconnected.');
      clearTimeout(closeTimeout);
      cleanup();
    });

  } catch (error) {
    console.error('[SSE] Error in SSE connection handler:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Failed to establish SSE connection' });
    } else if (!res.finished) {
      res.end();
    }
  }
}

/**
 * Send SSE message to client
 */
function sendSSEMessage(res, data) {
  try {
    if (res.writable && !res.destroyed) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  } catch (error) {
    console.error('Error sending SSE message:', error);
  }
}