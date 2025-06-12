# Quick Start Guide

Get SIPSentinel up and running in minutes.

## ⚡ Prerequisites

You'll need accounts with these services:
- **[Twilio](https://twilio.com)** - Phone numbers and webhooks
- **[VAPI](https://vapi.ai)** - AI voice agents  
- **[OpenRouter](https://openrouter.ai)** - LLM for scam detection
- **[AWS](https://aws.amazon.com)** - Storage and transcription

## 🚀 Installation

### 1. Clone Repository
```bash
git clone https://github.com/michael-bey/SIPSentinel.git
cd SIPSentinel
npm install
```

### 2. Interactive Setup
```bash
npm run setup
```

The setup wizard will:
- Create your `.env` file
- Guide you through service configuration
- Validate your setup
- Create AI agent templates

### 3. Start the System
```bash
npm start
```

Access the dashboard at: `http://localhost:3000`

## 🧪 Quick Test

### Test Scam Detection
```bash
curl -X POST http://localhost:3000/test-detection \
     -H "Content-Type: application/json" \
     -d '{"message": "URGENT: Your Coinbase account compromised. Call 1-800-555-0123"}'
```

### Test Agent Call
```bash
curl "http://localhost:3000/test-call?phone=+1234567890&scamType=crypto_exchange"
```

### Simulate Full Scam Response
```bash
curl "http://localhost:3000/simulate-scam?phone=+1234567890&type=crypto_exchange"
```

## 🌐 Deploy to Production

### Vercel (Recommended)
```bash
npm install -g vercel
vercel --prod
```

### Netlify
```bash
npm install -g netlify-cli
netlify deploy --prod
```

## 🔧 Configure Webhooks

In your Twilio Console, set these webhook URLs:

```
Voice URL: https://your-domain.com/voice
SMS URL: https://your-domain.com/sms
Recording Status: https://your-domain.com/recording-status
Transcription: https://your-domain.com/transcription
```

## 📱 Test with Real Calls

1. Call your Twilio number
2. Leave a scam-like voicemail:
   ```
   "Hello, this is Coinbase security. Your account has been compromised. 
   Please call us back immediately at 1-800-555-0123."
   ```
3. Watch the dashboard for scam detection
4. Observe the AI agent callback

## 🔔 Set Up Notifications (Optional)

### Slack
1. Create webhook at [api.slack.com/messaging/webhooks](https://api.slack.com/messaging/webhooks)
2. Add to `.env`:
   ```env
   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
   ```

### Telegram
1. Create bot with @BotFather
2. Add to `.env`:
   ```env
   TELEGRAM_BOT_TOKEN=your_bot_token
   TELEGRAM_CHAT_ID=your_chat_id
   ```

## 🛠️ Troubleshooting

### Common Issues

**Environment variables not set:**
```bash
npm run validate
```

**Webhooks not working:**
- Check Twilio Console webhook URLs
- Verify deployment is publicly accessible
- Test webhook endpoints manually

**No agents found:**
```bash
npm run create-agents --all
```

**Scam detection not working:**
- Verify OpenRouter API key
- Check account credits
- Test with known scam phrases

## 📚 Next Steps

1. **Explore the Dashboard** - Monitor scam detections and agent conversations
2. **Customize Agents** - Modify agent templates for your use case
3. **Set Up Monitoring** - Configure Slack/Telegram notifications
4. **Review Analytics** - Track success metrics and performance
5. **Scale Up** - Add more phone numbers and optimize for volume

## 🔗 Useful Links

- **[Complete Setup Guide](Setup-Guide.md)** - Detailed configuration
- **[API Reference](API-Reference.md)** - All endpoints documented
- **[Troubleshooting](Troubleshooting.md)** - Common issues and solutions
- **[System Architecture](System-Architecture.md)** - Technical overview

## 💡 Tips for Success

1. **Start Small** - Test with one scam type first
2. **Monitor Costs** - Keep track of API usage across services
3. **Iterate Agents** - Improve agent responses based on performance
4. **Security First** - Never commit API keys to git
5. **Scale Gradually** - Add features and capacity incrementally

---

**Need help?** Check the [Troubleshooting Guide](Troubleshooting.md) or create an issue on GitHub.
