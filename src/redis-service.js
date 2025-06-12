/**
 * Redis Service for Real-time Event Broadcasting
 * Uses Upstash Redis for serverless-compatible real-time updates
 */

const { Redis } = require('@upstash/redis');
const redisNode = require('redis');

// Initialize Redis client
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Event types for Redis channels
const REDIS_CHANNELS = {
  LIVE_UPDATES: 'live_updates',
  CALL_EVENTS: 'call_events',
  SCAM_DETECTION: 'scam_detection',
  VAPI_EVENTS: 'vapi_events'
};

// Event types for broadcasting
const EVENT_TYPES = {
  INCOMING_CALL: 'incoming_call',
  CALL_STATUS_UPDATE: 'call_status_update',
  SCAM_DETECTED: 'scam_detected',
  CALL_PROCESSED: 'call_processed',
  VAPI_CALL_STARTED: 'vapi_call_started',
  VAPI_CALL_ENDED: 'vapi_call_ended',
  VAPI_CALL_FAILED: 'vapi_call_failed',
  ACTIVE_CALLS_UPDATE: 'active_calls_update'
};

/**
 * Publish an event to Redis for real-time broadcasting
 * @param {string} eventType - Type of event
 * @param {Object} data - Event data
 * @param {string} channel - Redis channel (optional, defaults to LIVE_UPDATES)
 */
async function publishEvent(eventType, data, channel = REDIS_CHANNELS.LIVE_UPDATES) {
  try {
    const event = {
      type: eventType,
      data: data,
      timestamp: new Date().toISOString(),
      id: `${eventType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };

    console.log(`📡 Publishing event to Redis channel ${channel}:`, eventType);
    
    // Publish to Redis channel
    await redis.publish(channel, JSON.stringify(event));
    
    // Also store in a list for polling fallback (with expiration)
    const listKey = `events:${channel}`;
    await redis.lpush(listKey, JSON.stringify(event));
    await redis.expire(listKey, 300); // Expire after 5 minutes
    await redis.ltrim(listKey, 0, 99); // Keep only last 100 events
    
    console.log(`✅ Event published successfully: ${eventType}`);
    return event;
  } catch (error) {
    console.error('❌ Error publishing event to Redis:', error);
    throw error;
  }
}

/**
 * Get recent events from Redis (for polling fallback)
 * @param {string} channel - Redis channel
 * @param {number} limit - Maximum number of events to retrieve
 * @param {string} since - ISO timestamp to get events since (optional)
 */
async function getRecentEvents(channel = REDIS_CHANNELS.LIVE_UPDATES, limit = 10, since = null) {
  try {
    const listKey = `events:${channel}`;
    const events = await redis.lrange(listKey, 0, limit - 1);

    let parsedEvents = [];

    // Safely parse each event
    for (const event of events) {
      try {
        if (typeof event === 'string') {
          parsedEvents.push(JSON.parse(event));
        } else if (typeof event === 'object' && event !== null) {
          parsedEvents.push(event);
        }
      } catch (parseError) {
        console.warn('Failed to parse event:', event, parseError);
      }
    }

    // Filter by timestamp if 'since' is provided
    if (since) {
      const sinceDate = new Date(since);
      parsedEvents = parsedEvents.filter(event =>
        event.timestamp && new Date(event.timestamp) > sinceDate
      );
    }

    console.log(`📋 Retrieved ${parsedEvents.length} recent events from ${channel}`);
    return parsedEvents;
  } catch (error) {
    console.error('❌ Error getting recent events from Redis:', error);
    return [];
  }
}

/**
 * Store active call data in Redis with expiration
 * @param {string} callId - Unique call identifier
 * @param {Object} callData - Call data to store
 * @param {number} ttl - Time to live in seconds (default: 1 hour)
 */
async function storeActiveCall(callId, callData, ttl = 3600) {
  try {
    const key = `active_call:${callId}`;
    await redis.setex(key, ttl, JSON.stringify(callData));
    console.log(`💾 Stored active call data for ${callId}`);
  } catch (error) {
    console.error('❌ Error storing active call data:', error);
    throw error;
  }
}

/**
 * Get active call data from Redis
 * @param {string} callId - Unique call identifier
 */
async function getActiveCall(callId) {
  try {
    const key = `active_call:${callId}`;
    const data = await redis.get(key);
    if (!data) return null;

    if (typeof data === 'string') {
      return JSON.parse(data);
    } else if (typeof data === 'object' && data !== null) {
      return data;
    }

    return null;
  } catch (error) {
    console.error('❌ Error getting active call data:', error);
    return null;
  }
}

/**
 * Remove active call data from Redis
 * @param {string} callId - Unique call identifier
 */
async function removeActiveCall(callId) {
  try {
    const key = `active_call:${callId}`;
    await redis.del(key);
    console.log(`🗑️ Removed active call data for ${callId}`);
  } catch (error) {
    console.error('❌ Error removing active call data:', error);
  }
}

/**
 * Get all active calls from Redis
 */
async function getAllActiveCalls() {
  try {
    const keys = await redis.keys('active_call:*');
    const calls = [];

    for (const key of keys) {
      try {
        const data = await redis.get(key);
        if (data) {
          let callData;
          if (typeof data === 'string') {
            callData = JSON.parse(data);
          } else if (typeof data === 'object' && data !== null) {
            callData = data;
          } else {
            continue;
          }
          calls.push(callData);
        }
      } catch (parseError) {
        console.warn(`Failed to parse call data for key ${key}:`, parseError);
      }
    }

    console.log(`📞 Retrieved ${calls.length} active calls from Redis`);
    return calls;
  } catch (error) {
    console.error('❌ Error getting all active calls:', error);
    return [];
  }
}

/**
 * Store temporary data with expiration (useful for webhook processing)
 * @param {string} key - Storage key
 * @param {Object} data - Data to store
 * @param {number} ttl - Time to live in seconds
 */
async function storeTemporaryData(key, data, ttl = 300) {
  try {
    await redis.setex(key, ttl, JSON.stringify(data));
    console.log(`💾 Stored temporary data with key ${key} (TTL: ${ttl}s)`);
  } catch (error) {
    console.error('❌ Error storing temporary data:', error);
    throw error;
  }
}

/**
 * Get temporary data from Redis
 * @param {string} key - Storage key
 */
async function getTemporaryData(key) {
  try {
    const data = await redis.get(key);
    if (!data) return null;

    if (typeof data === 'string') {
      return JSON.parse(data);
    } else if (typeof data === 'object' && data !== null) {
      return data;
    }

    return null;
  } catch (error) {
    console.error('❌ Error getting temporary data:', error);
    return null;
  }
}

/**
 * Health check for Redis connection
 */
async function healthCheck() {
  try {
    const result = await redis.ping();
    return result === 'PONG';
  } catch (error) {
    console.error('❌ Redis health check failed:', error);
    return false;
  }
}

/**
 * Returns a new Redis client instance for pub/sub subscriptions.
 * A separate client is required for subscribing to channels.
 */
function getRedisSubscriber() {
    return new Redis({
        url: process.env.UPSTASH_REDIS_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
}

/**
 * Returns a new, unconnected instance of a node-redis client.
 * This is used for services that need a dedicated pub/sub connection, like SSE.
 */
function getRawRedisClient() {
  const restUrl = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!restUrl || !token) {
    console.error('Upstash Redis credentials (URL and Token) are required for raw Redis client.');
    // Return a dummy object to prevent crashes on startup if env vars are missing
    return {
      connect: async () => console.error('Dummy Redis client connected (no-op).'),
      subscribe: async () => console.error('Dummy Redis client subscribed (no-op).'),
      on: () => {},
      isOpen: false,
      quit: async () => {}
    };
  }

  // Construct the correct rediss:// URL from the REST credentials
  const urlObject = new URL(restUrl);
  const redisUrl = `rediss://:${token}@${urlObject.host}`;
  
  return redisNode.createClient({ url: redisUrl });
}

module.exports = {
  redis,
  REDIS_CHANNELS,
  EVENT_TYPES,
  publishEvent,
  getRecentEvents,
  storeActiveCall,
  getActiveCall,
  removeActiveCall,
  getAllActiveCalls,
  storeTemporaryData,
  getTemporaryData,
  healthCheck,
  getRedisSubscriber,
  getRawRedisClient
};
