# AWS External Storage Configuration

This guide explains how to configure SIPSentinel with AWS external storage for recordings and transcriptions.

## Overview

With AWS external storage enabled in Twilio:
- ✅ Recordings are stored directly in your S3 bucket
- ✅ You have full control over the audio files
- ✅ Lower costs for storage and bandwidth
- ❌ Twilio doesn't send recording completion webhooks
- ❌ Need alternative method to detect new recordings

## Current Twilio Configuration ✅

Your Twilio setup is correct:

### Voice Configuration
- **Voice URL**: `https://sip-sentinel.vercel.app/api/twilio-webhook?type=voice` ✅
- **Method**: POST ✅

### External Storage
- **Enabled**: ✅
- **S3 Bucket**: `sip-sentinel.s3.us-west-2.amazonaws.com` ✅
- **AWS Credentials**: Configured ✅

## Required Webhook Configuration

Since you're using AWS external storage, you only need **ONE** webhook:

### ✅ Voice Webhook (Already Configured)
```
URL: https://sip-sentinel.vercel.app/api/twilio-webhook?type=voice
Method: POST
```

### ❌ NOT Needed with AWS External Storage
- Recording Status Callback (Twilio doesn't send this)
- Transcription Callback (Using AWS Transcribe instead)

## Recording Processing Flow

### Traditional Flow (Without External Storage)
```
Call → Record → Twilio Webhook → Process
```

### AWS External Storage Flow
```
Call → Record → S3 Storage → Polling/Detection → Process
```

## Processing Methods

### Method 1: Polling (Recommended)
Use the built-in polling system to check for new recordings:

```bash
# Single poll for new recordings
npm run poll-s3-once

# Continuous polling (for development)
npm run poll-s3-start

# Test the polling endpoint
node scripts/poll-s3-recordings.js test
```

### Method 2: Manual Processing
Process specific recordings manually:

```bash
# Process a specific recording by SID
node scripts/poll-s3-recordings.js process RE1234567890abcdef
```

### Method 3: S3 Event Notifications (Advanced)
Configure S3 to send events to your endpoint when new files are created:

1. **S3 Bucket Configuration**:
   - Go to S3 Console → `sip-sentinel` bucket
   - Properties → Event notifications
   - Create notification for `s3:ObjectCreated:*`
   - Destination: `https://sip-sentinel.vercel.app/api/s3-recording-processor`

## Deployment Steps

### 1. Deploy Updated Code
```bash
npm run deploy-redis-qstash
```

**Note**: All new functionality has been consolidated into the existing `api/index.js` to stay within Vercel's 12 function limit on the Hobby plan.

### 2. Verify Twilio Configuration
- ✅ Voice webhook: `https://sip-sentinel.vercel.app/api/twilio-webhook?type=voice`
- ✅ External storage enabled
- ✅ S3 bucket configured

### 3. Test Recording Processing
```bash
# Test the S3 processor endpoint
node scripts/poll-s3-recordings.js test
```

### 4. Set Up Polling (Choose One)

#### Option A: Manual Polling
Run polling manually when needed:
```bash
npm run poll-s3-once
```

#### Option B: Scheduled Polling
Set up a cron job or scheduled task:
```bash
# Every 2 minutes
*/2 * * * * cd /path/to/sipsentinel && npm run poll-s3-once
```

#### Option C: Continuous Polling (Development)
For development/testing:
```bash
npm run poll-s3-start
```

## S3 Recording Structure

Recordings are stored in S3 with this structure:
```
sip-sentinel/
├── AC1d2863e2eae04cf181ba7215d55aa0d5/
│   ├── RE1234567890abcdef.wav
│   ├── RE2345678901bcdefg.wav
│   └── ...
```

Where:
- `AC1d2863e2eae04cf181ba7215d55aa0d5` = Your Twilio Account SID
- `RE1234567890abcdef.wav` = Recording SID + .wav extension

## Processing Workflow

1. **Call Received** → Voice webhook triggers
2. **Recording Stored** → S3 receives .wav file
3. **Detection** → Polling finds new recording
4. **Processing** → QStash queues transcription task
5. **Transcription** → AWS Transcribe processes audio
6. **Analysis** → LLM analyzes for scams
7. **Action** → VAPI callback if scam detected
8. **Updates** → Redis broadcasts real-time events

## Monitoring

### Check for New Recordings
```bash
# Test polling
node scripts/poll-s3-recordings.js test

# Single poll
node scripts/poll-s3-recordings.js single
```

### Monitor Processing
- Check Vercel function logs
- Monitor Redis events in dashboard
- Check QStash task queue

### Debug Issues
```bash
# Process specific recording
node scripts/poll-s3-recordings.js process RE1234567890abcdef

# Check S3 bucket contents
aws s3 ls s3://sip-sentinel/AC1d2863e2eae04cf181ba7215d55aa0d5/
```

## Troubleshooting

### No Recordings Detected
1. Check S3 bucket for new .wav files
2. Verify AWS credentials
3. Test polling endpoint
4. Check Vercel function logs

### Processing Failures
1. Check recording URL accessibility
2. Verify AWS Transcribe permissions
3. Monitor QStash task status
4. Check Redis event publishing

### Real-time Updates Not Working
1. Verify Redis connection
2. Check SSE/polling in browser
3. Monitor dashboard for events
4. Test with manual processing

## Cost Optimization

### S3 Storage
- Recordings auto-expire (configure lifecycle rules)
- Use S3 Intelligent Tiering
- Monitor storage costs

### AWS Transcribe
- Only transcribe detected recordings
- Use appropriate audio format
- Monitor transcription costs

### Vercel Functions
- Efficient polling intervals
- Batch processing when possible
- Monitor function execution time

## Security

### S3 Access
- Use IAM roles with minimal permissions
- Enable S3 bucket logging
- Monitor access patterns

### Webhook Security
- Twilio signature verification enabled
- HTTPS-only endpoints
- Environment variable protection

## Next Steps

1. **Deploy the updated system**
2. **Test with a real call**
3. **Set up polling schedule**
4. **Monitor for 24 hours**
5. **Optimize polling frequency based on call volume**

The system is now optimized for AWS external storage while maintaining all real-time capabilities through Redis and QStash integration.
