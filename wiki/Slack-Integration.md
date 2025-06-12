# Slack Integration for SIPSentinel

Get real-time Slack notifications when AI agent calls are happening! SIPSentinel can send beautiful, formatted notifications to your Slack workspace whenever scams are detected and agent calls are initiated.

## 🚀 Quick Setup

### 1. Create a Slack Webhook

1. Go to [Slack API: Incoming Webhooks](https://api.slack.com/messaging/webhooks)
2. Click "Create your Slack app"
3. Choose "From scratch"
4. Name your app (e.g., "SIPSentinel") and select your workspace
5. Go to "Incoming Webhooks" and toggle it on
6. Click "Add New Webhook to Workspace"
7. Choose the channel where you want notifications (e.g., #security-alerts)
8. Copy the webhook URL (starts with `https://hooks.slack.com/services/...`)

### 2. Configure SIPSentinel

Add the webhook URL to your `.env` file:

```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
```

### 3. Test the Integration

```bash
# Check Slack configuration
curl http://localhost:3000/slack/config

# Send a test notification
curl -X POST http://localhost:3000/slack/test
```

That's it! You'll now receive Slack notifications for all agent call events.

## 📱 Notification Types

SIPSentinel sends different types of Slack notifications:

### 🎯 Agent Call Initiated
When an AI agent call is started in response to a detected scam:

```
🎯 SCAMMER ENGAGEMENT INITIATED

🟠 Coinbase Jim is now calling a scammer who impersonated Coinbase

🤖 Agent:           🏢 Company:
Coinbase Jim        Coinbase

🚨 Scam Type:       📞 Target:
CRYPTO EXCHANGE     +12***567890

🕐 2:30 PM | 🛡️ SIPSentinel Defense System
```

### 📞 Agent Call Connected
When the agent successfully connects to the scammer:

```
📞 Agent Connected! The scammer picked up the phone.

🆔 Call ID:         📊 Status:
call_abc123         🟢 In Progress

⏱️ Time-wasting session has begun! Let's see how long we can keep them busy...
```

### 🎉 Agent Call Completed (Success)
When an agent call lasts longer than 5 minutes (successful time-wasting):

```
🎉 MISSION ACCOMPLISHED!

🏆 Excellent work! Our agent successfully wasted 7m 23s of a scammer's time!

🆔 Call ID:         ⏱️ Duration:
call_abc123         7m 23s

🎯 Result:          💰 Value:
✅ SUCCESS (>5 min) 🔥 Time Wasted!

🛡️ Another scammer neutralized! Every minute counts in protecting potential victims.
```

### ⏱️ Agent Call Completed (Short)
When an agent call ends quickly (less than 5 minutes):

```
⏱️ Agent call ended - Scammer hung up quickly

🆔 Call ID:         ⏱️ Duration:        📊 Result:
call_abc123         2m 15s              ⚡ Short call

🤔 They caught on quickly this time. Our agents will get them next time!
```

### 📵 Agent Call Failed
When an agent call fails to connect:

```
📵 Agent call failed - Scammer didn't answer

🆔 Call ID:         ❌ Reason:
call_abc123         busy

🎯 No worries! We'll catch them next time they try to scam someone.
```

### 🚨 Scam Detected
When a scam is detected in incoming messages or voicemails:

```
🚨 SCAM ALERT DETECTED

₿ Scammer detected! Someone is impersonating 🟠 Coinbase

🎭 Scam Type:           🏢 Impersonating:
CRYPTO EXCHANGE         🟠 Coinbase

🎯 Confidence:          📞 Scammer Number:
🔴 ██████████ 95%      +19***123456

🤖 Deploying AI agent to waste their time and protect potential victims...
```

## 🎨 Customization

### Channel Configuration

You can send notifications to different channels by creating multiple webhooks:

```bash
# Main security alerts
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/.../security-alerts

# Or use multiple webhooks for different channels (future feature)
```

### Message Formatting

The Slack messages use rich, modern block formatting with:
- **Visual Headers**: Bold, prominent headers for important events
- **Company Emojis**: 🟠 Coinbase, 🐙 Kraken, 🟡 Binance, 🪟 Microsoft, etc.
- **Confidence Bars**: Visual progress bars showing scam detection confidence
- **Contextual Messages**: Encouraging messages that make monitoring fun
- **Structured Layout**: Clean, organized information in easy-to-scan blocks
- **Smart Emojis**: Different emojis based on call failure reasons (📵 busy, 🔇 no-answer)
- **Success Celebrations**: Special formatting for successful long calls with 🎉 headers

## 🧪 Testing

### Test Slack Configuration

```bash
# Check if Slack is configured (localhost only)
curl http://localhost:3000/slack/config

# Expected response:
{
  "success": true,
  "slack": {
    "configured": true,
    "status": "active"
  }
}
```

### Send Test Notification

```bash
# Send a test agent call notification (localhost only)
curl -X POST http://localhost:3000/slack/test

# Expected response:
{
  "success": true,
  "message": "Test Slack notification sent successfully",
  "status": "delivered"
}
```

**Security Notes**:
- Admin endpoints (`/slack/config`, `/slack/test`, `/webhooks/config`, `/webhooks/test`) are only accessible from localhost
- Test endpoints are rate-limited to 5 requests per minute to prevent spam

### Trigger Real Notifications

1. **Call your Twilio number** and leave a scam-like voicemail:
   ```
   "Hello, this is Coinbase security. Your account has been compromised. 
   Please call us back immediately at 1-800-555-0123."
   ```

2. **Send a scam SMS** to your Twilio number:
   ```
   "URGENT: Unauthorized login attempt on your Kraken account. 
   Call +1-888-555-1234 to secure your funds."
   ```

3. **Watch your Slack channel** for real-time notifications!

## 🔧 Troubleshooting

### No Notifications Received

1. **Check configuration**:
   ```bash
   curl http://localhost:3000/slack/config
   ```

2. **Verify webhook URL** in Slack:
   - Go to your Slack app settings
   - Check "Incoming Webhooks" section
   - Ensure the webhook is active

3. **Test the webhook directly**:
   ```bash
   curl -X POST YOUR_SLACK_WEBHOOK_URL \
        -H "Content-Type: application/json" \
        -d '{"text": "Test message from SIPSentinel"}'
   ```

### Webhook URL Issues

- Ensure the URL starts with `https://hooks.slack.com/services/`
- Check for extra spaces or characters in the `.env` file
- Restart SIPSentinel after changing the environment variable

### Permission Issues

- Make sure your Slack app has permission to post to the selected channel
- Check if the channel is private and the app needs to be invited

## 🔒 Security

- **Webhook URLs are sensitive**: Keep your `SLACK_WEBHOOK_URL` secret
- **Phone numbers are masked**: All phone numbers in notifications are automatically masked for privacy
- **No sensitive data**: Notifications don't include full transcripts or recordings

## 📊 Monitoring

Monitor Slack notification delivery in SIPSentinel logs:

```
Sending Slack notification for event: agent_call_initiated
Slack notification sent successfully: 200
```

Failed notifications are also logged:

```
Error sending Slack notification: timeout
```

## 🎯 Use Cases

### Security Teams
- Get immediate alerts when scammers are being engaged
- Monitor agent performance and success rates
- Track scam detection patterns

### Incident Response
- Real-time awareness of active scam attempts
- Coordinate response efforts across team members
- Document successful scammer time-wasting

### Analytics
- Track agent call success rates
- Monitor scam detection accuracy
- Measure response times

## 🚀 Advanced Configuration

### Multiple Channels (Future)
While currently supporting one Slack webhook, you could set up multiple SIPSentinel instances or use Slack's workflow builder to route notifications to different channels based on content.

### Custom Formatting (Future)
The message format is currently optimized for security monitoring, but could be customized for different use cases.

### Integration with Other Tools
Slack notifications can trigger additional workflows:
- Create tickets in your ticketing system
- Update security dashboards
- Trigger additional monitoring tools

---

**Need help?** Check the main [README.md](README.md) or [WEBHOOKS.md](WEBHOOKS.md) for more integration options.
