# 📱 Telegram Integration for SIPSentinel

Get real-time notifications in Telegram when SIPSentinel detects scams and initiates agent calls to waste scammers' time.

## 🚀 Quick Setup

### 1. Create a Telegram Bot

1. **Message @BotFather** on Telegram
2. **Send `/newbot`** command
3. **Choose a name** for your bot (e.g., "SIPSentinel Alerts")
4. **Choose a username** for your bot (e.g., "sipsentinel_alerts_bot")
5. **Copy the bot token** (format: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Get Your Chat ID

**For Personal Notifications:**
1. **Message your bot** with any text (e.g., "Hello")
2. **Visit this URL** in your browser: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
3. **Find your chat ID** in the response (positive number)

**For Group Notifications:**
1. **Add your bot** to the group
2. **Send a message** mentioning the bot (e.g., "@your_bot_name hello")
3. **Visit the getUpdates URL** as above
4. **Find the group chat ID** (negative number)

**For Channel Notifications:**
1. **Add your bot** as an administrator to the channel
2. **Post a message** in the channel
3. **Visit the getUpdates URL** as above
4. **Find the channel chat ID** (negative number starting with -100)

### 3. Configure SIPSentinel

Add the bot configuration to your `.env` file:

```bash
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=-1001234567890
```

### 4. Test the Integration

```bash
# Check Telegram configuration
curl http://localhost:3000/telegram/config

# Send a test notification
curl -X POST http://localhost:3000/telegram/test
```

That's it! You'll now receive Telegram notifications for all agent call events.

## 📱 Notification Types

SIPSentinel sends different types of Telegram notifications:

### 🎯 Agent Call Initiated
When an AI agent call is started in response to a detected scam:

```
🎯 SCAMMER ENGAGEMENT INITIATED

🟠 Coinbase Jim is now calling a scammer who impersonated Coinbase

🤖 Agent: Coinbase Jim
🏢 Company: Coinbase
🚨 Scam Type: CRYPTO EXCHANGE
📞 Target: +12***567890

🕐 2:30 PM | 🛡️ SIPSentinel Defense System
```

### 📞 Agent Call Started
When the agent successfully connects:

```
📞 AGENT CALL STARTED

🟢 Coinbase Jim has successfully connected to the scammer

📊 Call Details:
• Call ID: call_abc123
• Duration: Just started
• Status: Active

🛡️ SIPSentinel | 2:30 PM
```

### 🎉 Agent Call Ended (Success)
When a call lasts 5+ minutes (successful engagement):

```
🎉 SUCCESSFUL ENGAGEMENT

📞 Coinbase Jim finished calling the scammer

📊 Call Summary:
• Duration: 8m 45s
• Company: Coinbase
• Result: Success (5+ minutes)

🎊 Great work keeping the scammer busy!

🛡️ SIPSentinel | 2:38 PM
```

### ⏱️ Agent Call Ended (Short)
When a call ends quickly:

```
⏱️ CALL COMPLETED

📞 Coinbase Jim finished calling the scammer

📊 Call Summary:
• Duration: 2m 15s
• Company: Coinbase
• Result: Short call

🛡️ SIPSentinel | 2:32 PM
```

### ❌ Agent Call Failed
When the agent can't reach the scammer:

```
📵 AGENT CALL FAILED

❌ Coinbase Jim could not reach the scammer

📊 Failure Details:
• Reason: busy
• Target: +12***567890
• Company: Coinbase

🔄 The system will continue monitoring for new scams

🛡️ SIPSentinel | 2:30 PM
```

### 🚨 Scam Detected
When a new scam is detected:

```
🚨 SCAM DETECTED

🎯 New scam detected with 85% confidence

📊 Detection Details:
• Company: Coinbase
• Type: CRYPTO EXCHANGE
• Confidence: 85% ████████░░
• Source: +12***567890

🤖 Preparing agent response...

🛡️ SIPSentinel | 2:29 PM
```

## 🎧 Audio Attachments

For successful agent calls (5+ minutes), SIPSentinel automatically sends the call recording as an audio file:

```
🎧 Agent conversation recording
📞 Coinbase Jim vs Coinbase scammer
```

This lets you listen to how the agent performed and learn from successful engagements.

## 🎨 Message Features

The Telegram messages use rich formatting with:
- **Bold Headers**: Prominent headers for important events
- **Company Emojis**: 🟠 Coinbase, 🐙 Kraken, 🟡 Binance, 🪟 Microsoft, etc.
- **Progress Bars**: Visual confidence indicators (████████░░)
- **Structured Layout**: Clean, organized information in easy-to-scan format
- **Smart Emojis**: Different emojis based on call outcomes (📵 busy, 🔇 no-answer)
- **Success Celebrations**: Special formatting for successful long calls with 🎉 headers
- **Audio Files**: Automatic recording attachments for completed calls

## 🧪 Testing

### Test Telegram Configuration

```bash
# Check if Telegram is configured (localhost only)
curl http://localhost:3000/telegram/config
```

Expected response:
```json
{
  "success": true,
  "telegram": {
    "configured": true,
    "status": "active"
  }
}
```

### Test Telegram Notifications

```bash
# Send a test notification (localhost only)
curl -X POST http://localhost:3000/telegram/test
```

Expected response:
```json
{
  "success": true,
  "message": "Test Telegram notification sent successfully",
  "status": "delivered"
}
```

### End-to-End Testing

1. **Call your honeypot number**: `+1234567890` (your Twilio number)
2. **Leave a scam voicemail**: "Your Coinbase account has been compromised. Call 1-800-555-0123"
3. **Watch your Telegram** for real-time notifications!

## 🔧 Troubleshooting

### No Notifications Received

1. **Check configuration**:
   ```bash
   curl http://localhost:3000/telegram/config
   ```

2. **Verify bot token** and chat ID:
   - Test your bot token: `https://api.telegram.org/bot<TOKEN>/getMe`
   - Get chat updates: `https://api.telegram.org/bot<TOKEN>/getUpdates`

3. **Test the bot directly**:
   ```bash
   curl -X POST "https://api.telegram.org/bot<TOKEN>/sendMessage" \
        -H "Content-Type: application/json" \
        -d '{"chat_id": "<CHAT_ID>", "text": "Test message from SIPSentinel"}'
   ```

### Bot Can't Send Messages

- **For groups**: Make sure the bot is added to the group
- **For channels**: Make sure the bot is an administrator
- **For private chats**: Make sure you've messaged the bot first

### Wrong Chat ID

- **Positive numbers**: Private chats with users
- **Negative numbers**: Groups (start with -) 
- **Channel IDs**: Usually start with -100

Visit `https://api.telegram.org/bot<TOKEN>/getUpdates` after sending a message to get the correct chat ID.

## 🔒 Security

- **Bot tokens** are kept secure in environment variables
- **Chat IDs** are not exposed in API responses
- **Phone numbers** are automatically masked in notifications
- **Admin endpoints** are restricted to localhost access only

## 🚀 Advanced Usage

### Multiple Chat Destinations

Currently, SIPSentinel supports one Telegram destination. For multiple destinations, you can:

1. **Use a group** and add multiple users
2. **Use a channel** and subscribe multiple users
3. **Set up multiple instances** with different configurations

### Custom Message Formatting

The message format is defined in `src/webhook-service.js` in the `createTelegramMessage()` function. You can customize:

- Message templates
- Emoji choices
- Information included
- Formatting style

### Integration with Other Tools

Telegram notifications work alongside:
- **Slack notifications** (both can be enabled simultaneously)
- **Generic webhooks** (for custom integrations)
- **Web dashboard** (real-time UI updates)

Happy scam hunting! 🕵️‍♂️
