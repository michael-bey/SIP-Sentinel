# SIPSentinel Development Tools

This directory contains development and maintenance tools for SIPSentinel.

## 🔧 Debug Tools

### `check-call-status.js`
**Purpose**: Monitor and debug VAPI call status and errors
**Usage**: 
```bash
node tools/check-call-status.js [callId]
npm run debug:call-status [callId]
```
**Features**:
- Checks call status, duration, and errors
- Analyzes voice configuration issues
- Detects ElevenLabs pipeline errors
- Provides troubleshooting suggestions

### `debug-microsoft-agents.js`
**Purpose**: Debug Microsoft/IT support agent configuration issues
**Usage**:
```bash
node tools/debug-microsoft-agents.js
npm run debug:microsoft-agents
```
**Features**:
- Lists all available agents
- Tests agent selection for Microsoft/IT support
- Identifies missing agent configurations
- Provides setup instructions

### `debug-vercel.js`
**Purpose**: Test Vercel deployment endpoints and webhooks
**Usage**:
```bash
node tools/debug-vercel.js
npm run debug:vercel
```
**Features**:
- Tests voice, recording, and transcription webhooks
- Validates basic API endpoints
- Simulates scam detection scenarios
- Provides deployment troubleshooting

## 🛠️ Maintenance Tools

### `fix-existing-assistants.js`
**Purpose**: Fix problematic VAPI assistant configurations
**Usage**:
```bash
node tools/fix-existing-assistants.js
npm run tools:fix-assistants
```
**Features**:
- Converts ElevenLabs voices to VAPI native voices
- Removes problematic language fields
- Batch updates all assistants
- Provides detailed fix summary

### `set-vapi-server-url.js`
**Purpose**: Configure VAPI webhook URLs for all assistants
**Usage**:
```bash
node tools/set-vapi-server-url.js
npm run tools:set-webhook-url
```
**Features**:
- Updates all assistants with webhook URL
- Verifies configuration changes
- Sets up proper event handling
- Enables Telegram upload functionality

## 📋 Usage Examples

### Debug a Failed Call
```bash
# Check specific call status
npm run debug:call-status d5b7772c-8647-487a-b879-169fc74a3e10

# Debug Microsoft agent issues
npm run debug:microsoft-agents

# Test Vercel deployment
npm run debug:vercel
```

### Fix Configuration Issues
```bash
# Fix all assistant voice configurations
npm run tools:fix-assistants

# Set webhook URLs for all assistants
npm run tools:set-webhook-url
```

### Development Workflow
```bash
# 1. Test deployment
npm run debug:vercel

# 2. Fix any assistant issues
npm run tools:fix-assistants

# 3. Configure webhooks
npm run tools:set-webhook-url

# 4. Test a specific call
npm run debug:call-status [callId]
```

## 🚨 When to Use These Tools

### `check-call-status.js`
- Call fails immediately or has short duration
- ElevenLabs voice pipeline errors
- Need to analyze call performance
- Troubleshooting voice configuration

### `debug-microsoft-agents.js`
- Microsoft/IT support scams not triggering agents
- Agent selection returning null
- Missing agent configurations
- Testing agent creation

### `debug-vercel.js`
- Deployment issues or webhook failures
- Testing endpoint functionality
- Verifying scam detection pipeline
- Production troubleshooting

### `fix-existing-assistants.js`
- ElevenLabs voice errors persisting
- Voice configuration issues
- After updating voice settings
- Batch maintenance operations

### `set-vapi-server-url.js`
- Webhook events not being received
- Telegram uploads not working
- After changing deployment URL
- Initial setup configuration

## 🔗 Integration with Main App

These tools are designed to work with the main SIPSentinel application:

- **Environment**: Uses same `.env` configuration
- **Services**: Integrates with VAPI, Twilio, and other services
- **Logging**: Provides detailed debug output
- **Safety**: Read-only operations where possible

## 📝 Adding New Tools

When adding new development tools:

1. Place them in this `tools/` directory
2. Add appropriate npm scripts to `package.json`
3. Include usage documentation in this README
4. Follow the existing naming convention
5. Include proper error handling and logging
