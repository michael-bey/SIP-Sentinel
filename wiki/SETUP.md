# SIPSentinel Setup Guide

Welcome to SIPSentinel - an automated scam detection and response system that uses AI agents to waste scammers' time while protecting potential victims.

## 🚀 Quick Start

### Prerequisites

Before you begin, you'll need accounts with:
- **Twilio** (for phone numbers and webhooks)
- **VAPI** (for AI agents)
- **OpenRouter** (for LLM scam detection)
- **AWS** (for storage and transcription)

### 1. Clone and Install

```bash
git clone <repository-url>
cd sipsentinel
npm install
```

### 2. Interactive Setup

Run the setup wizard to configure your environment:

```bash
npm run setup
```

This will guide you through:
- Creating your `.env` file
- Configuring API keys
- Validating your setup
- Creating VAPI agents

### 3. Validate Configuration

```bash
npm run validate
```

### 4. Create AI Agents

```bash
npm run create-agents --all
```

### 5. Start the System

```bash
# Start with web dashboard
npm start

# Or start in headless mode (webhooks only)
npm run headless
```

## 📋 Manual Setup

If you prefer manual setup, follow these steps:

### 1. Environment Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your actual credentials:

```env
# Twilio Configuration
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890

# VAPI Configuration
VAPI_API_KEY=your_vapi_api_key

# OpenRouter Configuration
OPENROUTER_API_KEY=your_openrouter_api_key

# AWS Configuration
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-west-2

# Server Configuration
PORT=3000
```

### 2. Service Account Setup

#### Twilio Setup
1. Sign up at [twilio.com](https://twilio.com)
2. Get a phone number with voice and SMS capabilities
3. Note your Account SID and Auth Token from the console
4. Configure webhooks (see Webhook Configuration section)

#### VAPI Setup
1. Sign up at [vapi.ai](https://vapi.ai)
2. Get your API key from the dashboard
3. Optionally create custom agents (or use our templates)

#### OpenRouter Setup
1. Sign up at [openrouter.ai](https://openrouter.ai)
2. Get your API key
3. Add credits for LLM usage (Llama 3.3 8B is free)

#### AWS Setup
1. Create an AWS account
2. Create an IAM user with these permissions:
   - S3: Full access to your bucket
   - Transcribe: Basic transcription permissions
3. Note your access key and secret key

### 3. Webhook Configuration

Configure these URLs in your Twilio Console:

```
Voice URL: https://your-domain.com/voice
SMS URL: https://your-domain.com/sms
Recording Status Callback: https://your-domain.com/recording-status
Transcription Callback: https://your-domain.com/transcription
```

For local development, use ngrok or similar:

```bash
ngrok http 3000
# Then use the ngrok URL for webhooks
```

## 🤖 Agent Templates

The system includes pre-configured agent templates for different scam types:

### Available Templates

- **Coinbase Jim** - Crypto exchange scam response
- **Kraken Support Victim** - Kraken-specific scam response  
- **Binance User Sarah** - Binance-specific scam response
- **Microsoft Support Victim** - IT support scam response

### Creating Agents

```bash
# Create all agent templates
npm run create-agents --all

# Create specific template
npm run create-agents --template coinbase
```

### Custom Agent Configuration

Agent templates are defined in `bin/create-agents.js`. You can:

1. Modify existing templates
2. Add new templates for other companies
3. Customize voices, personalities, and responses
4. Adjust conversation strategies

## 🔧 Command Line Interface

The system supports multiple operation modes:

```bash
# Show help
sipsentinel help

# Interactive setup
sipsentinel setup

# Validate configuration
sipsentinel validate

# Create agents
sipsentinel create-agents --all

# Start with web UI (default)
sipsentinel start --web-ui

# Start in headless mode
sipsentinel start --headless

# Custom port
sipsentinel start --port 8080
```

## 🌐 Deployment

### Local Development

```bash
npm start
# Access dashboard at http://localhost:3000
```

### Vercel Deployment

```bash
npm install -g vercel
vercel --prod
```

Configure environment variables in Vercel dashboard.

### Netlify Deployment

```bash
npm install -g netlify-cli
netlify deploy --prod
```

Configure environment variables in Netlify dashboard.

## 🔍 Testing

### Test Scam Detection

```bash
# Test with your phone number
curl "http://localhost:3000/test-call?phone=+1234567890&scamType=crypto_exchange"

# Test Coinbase agent specifically
curl "http://localhost:3000/test-coinbase?phone=+1234567890"
```

### Test Webhooks

Call your Twilio phone number and leave a voicemail with scam-like content:

```
"Hello, this is Coinbase security. Your account has been compromised. 
Please call us back immediately at 1-800-555-0123 to verify your account."
```

The system should:
1. Detect the scam
2. Initiate a callback to the scammer's number
3. Display the interaction in the web dashboard

## 📊 Monitoring

### Web Dashboard

Access the web dashboard at your deployment URL to monitor:
- Recent scam detections
- Agent conversations
- Success metrics
- Call analytics

### API Endpoints

- `GET /health` - System health check
- `GET /api/dashboard` - Dashboard data
- `GET /vapi/analytics` - Call analytics
- `GET /deployment-info` - Configuration info

## 🛠️ Troubleshooting

### Common Issues

1. **Environment Variables Not Set**
   ```bash
   npm run validate
   ```

2. **Twilio Webhooks Not Working**
   - Check webhook URLs in Twilio console
   - Verify your deployment is accessible
   - Check server logs for errors

3. **VAPI Agents Not Responding**
   - Verify VAPI API key
   - Check agent creation logs
   - Test with simple agent first

4. **Scam Detection Not Working**
   - Check OpenRouter API key and credits
   - Verify LLM model availability
   - Test with known scam phrases

### Debug Mode

Enable debug logging:

```env
DEBUG=true
```

### Support

For issues and questions:
1. Check the troubleshooting section
2. Review server logs
3. Test individual components
4. Create an issue in the repository

## 🔒 Security Considerations

- Keep API keys secure and never commit them to git
- Use environment variables for all sensitive data
- Regularly rotate API keys
- Monitor usage and costs
- Review agent conversations for quality

## 📈 Scaling

For high-volume deployments:
- Use multiple VAPI phone numbers
- Implement rate limiting
- Monitor API usage and costs
- Consider using dedicated AWS resources
- Set up proper logging and monitoring
