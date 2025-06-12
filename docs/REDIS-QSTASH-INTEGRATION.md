# Redis & QStash Integration Guide

This document explains the new real-time event system using Upstash Redis for SSE broadcasting and Upstash QStash for background task processing.

## Overview

The integration replaces in-memory processing with cloud-based services that work seamlessly in serverless environments:

- **Upstash Redis**: Real-time event broadcasting for SSE connections
- **Upstash QStash**: Background task queuing for async processing
- **Node-cache**: Local caching for dashboard data

## Architecture

```
Twilio Webhook → Redis Events → SSE/Polling → Dashboard
                     ↓
                QStash Tasks → Background Processing → Results to Redis
```

## New Endpoints

### `/api/live-updates`
- **SSE Mode**: Maintains connection for 9 seconds, then closes
- **Polling Mode**: `GET /api/live-updates?mode=poll&since=<timestamp>`
- Uses Redis for real-time event broadcasting
- Automatic fallback to polling when SSE times out

### `/api/twilio-webhook`
- Handles all Twilio webhooks with signature verification
- Publishes events to Redis for real-time updates
- Queues background tasks to QStash
- Routes: `?type=voice|recording-status|transcription|sms`

### `/api/process-transcription`
- Processes QStash background tasks
- Handles transcription, scam analysis, VAPI calls
- Publishes results back to Redis
- Includes QStash signature verification

### `/api/dashboard` (Enhanced)
- Added 30-second caching with node-cache
- Includes active calls from Redis
- Cache bypass with `?nocache=true`

## Environment Variables

Add these to your `.env` file:

```bash
# Upstash Redis
UPSTASH_REDIS_URL=https://your-redis-url.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-redis-token

# Upstash QStash
QSTASH_URL=https://qstash.upstash.io
QSTASH_TOKEN=your-qstash-token
QSTASH_CURRENT_SIGNING_KEY=your-current-key
QSTASH_NEXT_SIGNING_KEY=your-next-key
```

## Event Types

### Redis Events
- `incoming_call`: New call received
- `call_status_update`: Call status changed
- `scam_detected`: Scam analysis completed
- `call_processed`: Call processing finished
- `vapi_call_started`: Agent call initiated
- `vapi_call_ended`: Agent call completed
- `vapi_call_failed`: Agent call failed

### QStash Tasks
- `process_transcription`: Transcribe audio
- `analyze_scam`: Run scam detection
- `trigger_vapi_call`: Initiate agent callback
- `send_notifications`: Send alerts

## Client-Side Changes

The Dashboard component now:
1. Attempts SSE connection first
2. Automatically falls back to polling after 9 seconds
3. Polls `/api/live-updates?mode=poll` every 5 seconds
4. Handles both real-time events and polling data

## Security Features

- **Twilio Signature Verification**: Validates webhook authenticity
- **QStash Signature Verification**: Validates task queue requests
- **Environment-based Security**: Skips verification in development
- **Phone Number Redaction**: Maintains privacy in all outputs

## Free Tier Optimization

### Upstash Redis
- Uses REST API (no persistent connections)
- Events expire after 5 minutes
- Keeps only last 100 events per channel
- Active calls have 1-hour TTL

### Upstash QStash
- 3 retries per task (configurable)
- Efficient task batching
- Minimal payload sizes
- Smart delay configuration

### Vercel Functions
- 9-second SSE timeout (under 60s limit)
- Cached dashboard responses (30s)
- Optimized concurrent requests
- Minimal function count

## Testing

Run the integration test:

```bash
node test/redis-qstash-integration.js
```

This verifies:
- Redis connectivity and operations
- QStash configuration
- Event publishing/retrieval
- Active call storage

## Deployment

1. **Install Dependencies**:
   ```bash
   npm install @upstash/redis node-cache
   ```

2. **Configure Environment Variables** in Vercel dashboard

3. **Update Twilio Webhooks** to use new endpoints:
   ```
   Voice: https://your-domain.com/api/twilio-webhook?type=voice
   Recording: https://your-domain.com/api/twilio-webhook?type=recording-status
   Transcription: https://your-domain.com/api/twilio-webhook?type=transcription
   SMS: https://your-domain.com/api/twilio-webhook?type=sms
   ```

4. **Deploy to Vercel**:
   ```bash
   vercel --prod
   ```

## Monitoring

### Redis Monitoring
- Event publishing success/failure
- Active call count
- Event retrieval performance

### QStash Monitoring
- Task queue success rate
- Processing latency
- Retry attempts

### Dashboard Performance
- Cache hit/miss ratio
- SSE connection duration
- Polling frequency

## Troubleshooting

### SSE Connection Issues
- Check browser console for connection errors
- Verify Redis health endpoint
- Ensure proper CORS headers

### Task Processing Delays
- Check QStash dashboard for failed tasks
- Verify webhook signature configuration
- Monitor Vercel function logs

### Cache Issues
- Use `?nocache=true` to bypass cache
- Check node-cache TTL settings
- Monitor memory usage

## Migration Notes

This integration maintains full backward compatibility:
- All existing functionality preserved
- Existing utility functions reused
- Same UI/UX experience
- No breaking changes to API responses

The system gracefully degrades:
- SSE → Polling fallback
- Redis unavailable → Local processing
- QStash unavailable → Synchronous processing
