# SIPSentinel

**AI-powered scam detection and response system that automatically deploys conversational agents to waste scammers' time.**

## Problem Statement

Scammers increasingly target victims through phone calls and text messages, impersonating legitimate companies like crypto exchanges (Coinbase, Kraken) and tech support (Microsoft, Apple). These scams cost billions annually and harm vulnerable populations. Traditional blocking approaches are reactive and ineffective against evolving tactics.

SIPSentinel flips the script by:
- **Detecting scams in real-time** using advanced LLM analysis
- **Automatically deploying AI agents** to engage scammers in time-wasting conversations
- **Protecting potential victims** by occupying scammers' time and resources
- **Gathering intelligence** on scam operations for analysis and prevention

## System Components / Tech Stack

### Core Technologies
- **Node.js/Express** - Web server and API endpoints
- **Twilio** - Phone number provisioning, SMS/voice webhooks, transcription
- **VAPI** - AI voice agents for automated scammer engagement
- **OpenRouter + Llama 3.3** - LLM-powered scam detection and analysis
- **AWS S3** - Storage for call recordings, transcripts, and metadata
- **AWS Transcribe** - Backup transcription service

### Serverless & Background Processing
- **Vercel** - Serverless deployment platform with optimized functions
- **Upstash Redis** - Real-time event broadcasting and SSE updates
- **Upstash QStash** - Background task queuing for async processing
- **Queue-based Architecture** - Optimized for serverless function time limits

### Frontend & Monitoring
- **Real-time Web Dashboard** - Live monitoring with SSE updates and polling fallback
- **Slack/Telegram Integration** - Real-time notifications with audio attachments
- **Webhook System** - External integrations and event notifications

### AI Agent System
- **Dynamic Agent Selection** - Matches agents to detected scam types
- **Pre-configured Templates** - Specialized agents for different companies
- **Voice Synthesis** - Gender-appropriate VAPI native voices with realistic personas
- **Conversation Analytics** - Success metrics and performance tracking

## System Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐
│   Scammer       │───▶│   Twilio Phone   │───▶│  Vercel Serverless  │
│ Calls/Texts     │    │     Number       │    │    Functions        │
└─────────────────┘    └──────────────────┘    └─────────────────────┘
                                                         │
                       ┌─────────────────────────────────┼─────────────────────────────────┐
                       │                                 ▼                                 │
                       │                    ┌─────────────────────┐                       │
                       │                    │   Quick Response    │                       │
                       │                    │   (< 1 second)      │                       │
                       │                    └─────────────────────┘                       │
                       │                                 │                                 │
                       │                                 ▼                                 │
                       │                    ┌─────────────────────┐                       │
                       │                    │   QStash Queue      │                       │
                       │                    │ Background Tasks    │                       │
                       │                    └─────────────────────┘                       │
                       │                                 │                                 │
                       │                                 ▼                                 │
┌─────────────────┐    │    ┌─────────────────────┐    ┌─────────────────────┐    ┌──────────────┐
│   Web Dashboard │◀───┼────│   Redis Events &    │    │   VAPI AI Agent     │───▶│   Scammer    │
│   (SSE/Polling) │    │    │   S3 Storage        │    │   Calls Back        │    │   Engaged    │
└─────────────────┘    │    └─────────────────────┘    └─────────────────────┘    └──────────────┘
                       │                                         │                         │
┌─────────────────┐    │                                         ▼                         │
│ Slack/Telegram  │◀───┼────────────────────────────────────────────────────────────────────┘
│  Notifications  │    │
└─────────────────┘    └─────────────────────────────────────────────────────────────────┘
```

## How It Works

### 1. **Serverless Scam Detection Pipeline**
- Scammer calls/texts honeypot Twilio number (+17816787111)
- Vercel function responds instantly (< 1 second) to avoid timeouts
- Background tasks queued via QStash for async processing
- LLM (Llama 3.3) identifies scam patterns and extracts callback numbers
- Confidence scoring determines if response is warranted

### 2. **Queue-based Background Processing**
- Transcription analysis queued for background processing
- Scam detection runs asynchronously with timeout protection
- VAPI call creation handled in separate background task
- Redis events broadcast real-time updates to dashboard

### 3. **Intelligent Agent Deployment**
- System selects appropriate AI agent based on impersonated company
- VAPI creates realistic voice agent with company-specific knowledge
- Agent calls back using extracted callback number (not original caller)
- Dynamic personas with randomized names and locations for realism

### 4. **Real-time Monitoring with Fallbacks**
- Web dashboard uses SSE for real-time updates with polling fallback
- Success metrics track call duration (5+ minutes = success)
- All interactions stored in S3 for analysis and evidence
- Phone numbers redacted for privacy in all displays

### 5. **Multi-channel Notifications**
- Slack/Telegram alerts when agents engage scammers
- Audio recordings automatically uploaded to Telegram channels
- Webhook system enables external integrations
- Two-stage notifications: call start alert + completion with audio

## Quickstart

### Prerequisites
You'll need accounts with:
- **Twilio** (phone numbers and webhooks)
- **VAPI** (AI voice agents)
- **OpenRouter** (LLM access for meta-llama/llama-3.3-8b-instruct:free)
- **AWS** (S3 storage - **required for audio playback**)
- **Upstash** (Redis for real-time events, QStash for background tasks)

### Installation

```bash
# Clone and install
git clone https://github.com/michael-bey/SIPSentinel.git
cd SIPSentinel
npm install

# Interactive setup wizard
npm run setup

# Validate configuration
npm run validate

# Create AI agent templates
npm run create-agents

# Start the system
npm start
```

The setup wizard guides you through:
- Service account configuration
- Environment variable setup
- Webhook URL configuration
- AI agent template creation
- Testing and validation

### CLI Commands

```bash
# Available modes
sipsentinel start --web-ui     # Start with dashboard (default)
sipsentinel start --headless   # Webhooks only, no UI
sipsentinel start --port 8080  # Custom port

# Setup and configuration
sipsentinel setup              # Interactive setup wizard
sipsentinel validate           # Check configuration
sipsentinel create-agents --all # Create all agent templates
sipsentinel configure-vapi     # Configure VAPI webhooks

# Testing
npm test                       # Run all tests
npm run test:unit             # Unit tests (scam detection, agent selection)
npm run test:integration      # Integration tests (Telegram, VAPI, QStash)
npm run test:e2e              # End-to-end tests (system health)
npm run test:scam             # Scam detection tests only
npm run test:telegram         # Telegram integration tests
npm run test:vapi             # VAPI integration tests
npm run debug:make-call       # Make test VAPI call

# Debug and development tools
npm run debug:call-status     # Monitor VAPI call status and errors
npm run debug:microsoft-agents # Debug Microsoft agent configuration
npm run debug:vercel          # Test Vercel deployment endpoints
npm run tools:fix-assistants  # Fix VAPI assistant configurations
npm run tools:set-webhook-url # Configure webhook URLs
```

### Quick Test

```bash
# Test scam detection
curl "http://localhost:3000/test-call?phone=+1234567890&scamType=crypto_exchange"

# Test specific agent
curl "http://localhost:3000/test-coinbase?phone=+1234567890"

# Check system health
curl "http://localhost:3000/health"
```

### Deployment

**Vercel (Recommended):**
```bash
# Interactive deployment
npm run deploy

# Automated deployment with testing
npm run deploy-and-test

# Optimized for free tier
npm run deploy-optimized

# Or manual deployment
git push origin main  # Auto-deploys via GitHub integration
```

**Local Development:**
```bash
npm start              # Full system with web UI
npm run headless       # Webhooks only
npm run dev            # Development mode with auto-reload
```

## Key Features

### 🎯 **Scam Detection**
- **LLM-powered analysis** using Llama 3.3 for high accuracy
- **Callback number extraction** from voicemails and texts
- **Company identification** (Coinbase, Kraken, Microsoft, Apple, etc.)
- **Confidence scoring** with configurable thresholds

### 🤖 **AI Agent System**
- **Dynamic agent selection** based on impersonated company
- **Realistic personas** with randomized names and locations
- **VAPI native voices** with gender-appropriate selection
- **Success metrics** tracking (5+ minute calls = success)

### ⚡ **Serverless Architecture**
- **Vercel deployment** optimized for free tier limits
- **Queue-based processing** via Upstash QStash
- **Real-time events** via Upstash Redis with SSE/polling fallback
- **Function consolidation** to stay under 12-function limit

### 📱 **Monitoring & Notifications**
- **Real-time dashboard** with SoundCloud-like interface
- **Live call tracking** with waveform visualizations
- **Telegram integration** with automatic audio uploads
- **Slack webhooks** for team notifications
- **Phone number redaction** for privacy protection

## Further Documentation

📚 **[Complete documentation available in the Wiki →](wiki/)**

### Key Resources:
- **[Quick Start Guide](wiki/Quick-Start.md)** - Get running in minutes
- **[Setup Guide](wiki/Setup-Guide.md)** - Detailed installation and configuration
- **[System Architecture](wiki/System-Architecture.md)** - Technical overview
- **[API Reference](wiki/API-Reference.md)** - Complete endpoint documentation
- **[Troubleshooting](wiki/Troubleshooting.md)** - Common issues and solutions

### Integration Guides:
- **[Redis & QStash Integration](docs/REDIS-QSTASH-INTEGRATION.md)** - Background processing setup
- **[AWS External Storage](docs/AWS-EXTERNAL-STORAGE-SETUP.md)** - S3 configuration
- **[Vercel Deployment](wiki/VERCEL_DEPLOYMENT.md)** - Serverless deployment guide
- **[Environment Variables](wiki/Environment-Variables.md)** - Configuration reference

### Advanced Topics:
- **[Vercel Optimization](VERCEL_OPTIMIZATION.md)** - Performance tuning
- **[Telegram Integration](wiki/Telegram-Integration.md)** - Bot setup and audio uploads
- **[VAPI Configuration](wiki/VAPI-Setup.md)** - Agent creation and voice selection

### Other Considerations:
- This application is designed to rotate free numbers on your VAPI account to prevent attackers from blocking your outgoing number. However, VAPI limits outgoing calls to 10 per day. A twilio number is recommended for heavy use
- Twilio filters what appear to be OTP codes in text messages, so it's possible that some messages with callbacks never make it to the system.
- The system randomly generates last names but the first names are consistent for tracking.
- This was primarily tested serverless on Vercel but should work hosted with small modifications.
- If you want your instance to be linked here, just ask! The goal is to turn this into a communitiy project.

---

**⚠️ Disclaimer:** This tool is for educational and defensive purposes only. Use responsibly and in compliance with local laws.

**🏗️ Production URL:** [sip-sentinel.vercel.app](https://sip-sentinel.vercel.app)

Created for the #BuildWithVAPI hackathon.
