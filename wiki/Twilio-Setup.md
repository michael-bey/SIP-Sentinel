# Twilio Setup Guide

Complete guide for configuring Twilio with SIPSentinel.

## 📱 Account Setup

### 1. Create Twilio Account
1. Sign up at [twilio.com](https://twilio.com)
2. Verify your phone number
3. Complete account verification
4. Note your Account SID and Auth Token

### 2. Get Phone Number
1. Go to Phone Numbers → Manage → Buy a number
2. Choose a number with **Voice** and **SMS** capabilities
3. Purchase the number
4. Note the phone number in E.164 format (e.g., +17816787111)

### 3. Find Account Credentials
1. Go to Console Dashboard
2. Copy your **Account SID** (starts with AC...)
3. Copy your **Auth Token** (click to reveal)
4. Add these to your `.env` file:
   ```env
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your_auth_token_here
   TWILIO_PHONE_NUMBER=+17816787111
   ```

## 🔗 Webhook Configuration

### 1. Configure Voice Webhooks
1. Go to Phone Numbers → Manage → Active numbers
2. Click on your phone number
3. In the **Voice Configuration** section:
   - **Webhook URL**: `https://your-domain.com/voice`
   - **HTTP Method**: POST
   - **Primary Handler Fails**: `https://your-domain.com/voice` (same URL)

### 2. Configure SMS Webhooks
1. In the **Messaging Configuration** section:
   - **Webhook URL**: `https://your-domain.com/sms`
   - **HTTP Method**: POST
   - **Primary Handler Fails**: `https://your-domain.com/sms` (same URL)

### 3. Configure Recording Webhooks
1. In the **Voice Configuration** section:
   - **Recording Status Callback**: `https://your-domain.com/recording-status`
   - **HTTP Method**: POST

### 4. Configure Transcription Webhooks
1. In the **Voice Configuration** section:
   - **Transcription Callback**: `https://your-domain.com/transcription`
   - **HTTP Method**: POST

## 🎙️ Recording and Transcription Settings

### Enable Recording
1. Go to Voice → Configure → General
2. Enable **Record Calls**
3. Set **Recording Channels** to "dual"
4. Enable **Transcribe Recordings**

### Transcription Configuration
1. Go to Voice → Configure → Transcription
2. Enable **Transcription**
3. Set **Language** to "en-US"
4. Enable **Profanity Filter** (optional)
5. Set **Transcription Callback URL**: `https://your-domain.com/transcription`

### External Storage Configuration (Important!)
If you have **Twilio External Storage** enabled (recordings stored in your S3 bucket):

1. **AWS Credentials Required**: The audio endpoint requires AWS credentials to access recordings:
   ```env
   AWS_ACCESS_KEY_ID=your_aws_access_key
   AWS_SECRET_ACCESS_KEY=your_aws_secret_key
   AWS_REGION=us-west-2
   ```

2. **S3 Bucket Setup**: Ensure your S3 bucket allows the IAM user to read objects:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["s3:GetObject", "s3:HeadObject"],
         "Resource": "arn:aws:s3:::your-bucket-name/*"
       }
     ]
   }
   ```

3. **Recording Path**: Recordings are stored as `{AccountSid}/{RecordingSid}` in your S3 bucket

**⚠️ Without proper AWS credentials, audio playback will fail with 404 errors in the web UI.**

## 🌐 Local Development Setup

### Using ngrok
For local development, use ngrok to expose your local server:

```bash
# Install ngrok
npm install -g ngrok

# Start your local server
npm start

# In another terminal, expose port 3000
ngrok http 3000
```

Use the ngrok HTTPS URL for your webhooks:
```
Voice URL: https://abc123.ngrok.io/voice
SMS URL: https://abc123.ngrok.io/sms
Recording Status: https://abc123.ngrok.io/recording-status
Transcription: https://abc123.ngrok.io/transcription
```

### Alternative: localtunnel
```bash
# Install localtunnel
npm install -g localtunnel

# Expose port 3000
lt --port 3000 --subdomain sipsentinel
```

## 🧪 Testing Configuration

### Test Voice Webhooks
1. Call your Twilio number
2. Leave a voicemail
3. Check your server logs for webhook calls
4. Verify recording and transcription webhooks

### Test SMS Webhooks
1. Send an SMS to your Twilio number
2. Check server logs for SMS webhook
3. Verify response is sent back

### Webhook Testing Tools
```bash
# Test webhook endpoint manually
curl -X POST https://your-domain.com/voice \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "CallSid=test&From=+1234567890&To=+17816787111"

# Test SMS endpoint
curl -X POST https://your-domain.com/sms \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "MessageSid=test&From=+1234567890&Body=test message"
```

## 🔒 Security Configuration

### Webhook Authentication
Enable webhook authentication in Twilio Console:
1. Go to Account → Security → Webhook Authentication
2. Enable **Primary** and **Secondary** validation
3. SIPSentinel automatically validates Twilio signatures

### IP Access Control Lists
For production, consider restricting webhook access:
1. Go to Account → Security → IP Access Control Lists
2. Create a new list with your server IPs
3. Apply to your phone number configuration

## 📊 Monitoring and Logs

### Twilio Console Logs
1. Go to Monitor → Logs → Calls
2. View call details and webhook delivery status
3. Check for failed webhooks or errors

### Webhook Debugging
1. Go to Monitor → Logs → Webhooks
2. View webhook request/response details
3. Check for delivery failures

### Error Handling
Common webhook errors and solutions:

**11200 - HTTP retrieval failure**
- Check webhook URL is accessible
- Verify HTTPS certificate is valid
- Ensure server is responding

**11205 - HTTP connection failure**
- Check server is running
- Verify firewall settings
- Test URL accessibility

## 🔧 Advanced Configuration

### Custom Recording Settings
```javascript
// In your voice webhook handler
const twiml = new VoiceResponse();
twiml.record({
  transcribe: true,
  transcribeCallback: 'https://your-domain.com/transcription',
  recordingStatusCallback: 'https://your-domain.com/recording-status',
  maxLength: 120, // 2 minutes max
  playBeep: true
});
```

### SMS Auto-Reply Configuration
```javascript
// In your SMS webhook handler
const twiml = new MessagingResponse();
twiml.message('Thank you for your message. We will process your request.');
```

### Call Forwarding (Optional)
To forward calls to another number:
```javascript
const twiml = new VoiceResponse();
twiml.dial('+1234567890'); // Forward to this number
```

## 💰 Cost Optimization

### Phone Number Costs
- Local numbers: ~$1/month
- Toll-free numbers: ~$2/month
- International numbers: varies by country

### Usage Costs
- Voice calls: $0.0085/minute (US)
- SMS messages: $0.0075/message (US)
- Recording storage: $0.0025/minute
- Transcription: $0.05/minute

### Cost Monitoring
1. Go to Usage → Voice/SMS
2. Set up usage alerts
3. Monitor monthly spending
4. Consider usage-based pricing plans

## 🚨 Troubleshooting

### Common Issues

**Webhooks not being called:**
- Verify webhook URLs are correct
- Check server is publicly accessible
- Test URLs manually with curl

**Recording not working:**
- Enable recording in phone number configuration
- Check recording webhook URL
- Verify sufficient account balance

**Transcription failing:**
- Enable transcription in voice settings
- Check transcription webhook URL
- Verify recording duration > 2 seconds

**SMS not working:**
- Verify SMS capability on phone number
- Check SMS webhook configuration
- Test with simple message first

### Debug Commands
```bash
# Test Twilio credentials
curl -u $TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN \
     https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID.json

# List phone numbers
curl -u $TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN \
     https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/IncomingPhoneNumbers.json

# Test webhook delivery
curl -X POST https://your-domain.com/voice \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "CallSid=test&From=+1234567890"
```

## 📞 Support

For Twilio-specific issues:
1. Check [Twilio Documentation](https://www.twilio.com/docs)
2. Use [Twilio Console Debugger](https://www.twilio.com/console/debugger)
3. Contact [Twilio Support](https://support.twilio.com)

For SIPSentinel integration issues:
1. Check the [Troubleshooting Guide](Troubleshooting.md)
2. Verify webhook endpoints are working
3. Review server logs for errors
