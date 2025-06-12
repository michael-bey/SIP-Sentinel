require('dotenv').config();
const { Redis } = require('@upstash/redis');

// Initialize Redis client from environment variables
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function clearActiveCalls() {
  console.log('Connecting to Redis to clear active calls...');

  try {
    // Find all keys matching the active_call:* pattern
    const keys = await redis.keys('active_call:*');

    if (keys.length === 0) {
      console.log('✅ No active calls found to clear.');
      return;
    }

    console.log(`Found ${keys.length} active call keys to delete...`);
    
    // Delete all the found keys
    await redis.del(...keys);

    console.log(`✅ Successfully deleted ${keys.length} stale active call entries.`);

  } catch (error) {
    console.error('❌ Error clearing active calls from Redis:', error);
  }
}

clearActiveCalls(); 