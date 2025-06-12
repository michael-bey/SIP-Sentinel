# Environment Variables

Complete reference for all SIPSentinel configuration options.

## 📋 Required Variables

### Twilio Configuration
```env
# Your Twilio Account SID (starts with AC...)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Your Twilio Auth Token
TWILIO_AUTH_TOKEN=your_twilio_auth_token

# Your Twilio phone number in E.164 format
TWILIO_PHONE_NUMBER=+17816787111
```

### VAPI Configuration
```env
# Your VAPI API key
VAPI_API_KEY=your_vapi_api_key
```

### OpenRouter Configuration
```env
# Your OpenRouter API key for LLM access
OPENROUTER_API_KEY=your_openrouter_api_key
```

### AWS Configuration
```env
# AWS credentials for S3 storage
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-west-2

# S3 bucket name (optional - will be created if not exists)
S3_BUCKET_NAME=sipsentinel-data
```

## 🔧 Optional Variables

### Server Configuration
```env
# Port for the web server (default: 3000)
PORT=3000

# Node environment (development/production)
NODE_ENV=production

# Enable debug logging
DEBUG=true
```

### Webhook Configuration
```env
# Primary webhook URL for external integrations
WEBHOOK_URL=https://your-webhook-endpoint.com/sipsentinel

# Additional webhook URLs (comma-separated)
WEBHOOK_URLS=https://webhook1.com/events,https://webhook2.com/events

# Webhook secret for signature verification
WEBHOOK_SECRET=your_webhook_secret_here
```

### Notification Integrations
```env
# Slack webhook URL for notifications
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK

# Telegram bot configuration
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=-1001234567890
```

### Scam Detection Tuning
```env
# Minimum confidence score for LLM-based scam detection (0-100)
MIN_LLM_CONFIDENCE=70

# Minimum regex-based scam score for fallback detection
MIN_REGEX_SCAM_SCORE=5

# Minimum transcript length to consider for analysis
MIN_TRANSCRIPT_LENGTH=10

# Minimum recording duration to consider for analysis (seconds)
MIN_RECORDING_DURATION=1
```

### VAPI Advanced Settings
```env
# Preferred VAPI voice provider (optional)
VAPI_VOICE_PROVIDER=playht

# Default voice for male agents
VAPI_MALE_VOICE=ryan

# Default voice for female agents  
VAPI_FEMALE_VOICE=paige

# VAPI phone number provider preference
VAPI_PHONE_PROVIDER=vapi
```

## 📁 Configuration Files

### .env.example
The repository includes a `.env.example` file with all available options:

```bash
cp .env.example .env
# Edit .env with your actual values
```

### Environment Validation
Use the validation script to check your configuration:

```bash
npm run validate
```

This will verify:
- All required variables are set
- API keys are valid
- Services are accessible
- Permissions are correct

## 🔒 Security Best Practices

### API Key Management
- Never commit `.env` files to git
- Use different keys for development and production
- Rotate keys regularly
- Monitor usage and costs

### Access Control
- Restrict AWS IAM permissions to minimum required
- Use separate AWS users for different environments
- Enable MFA on service accounts where possible

### Webhook Security
- Always use HTTPS for webhook URLs
- Set webhook secrets for signature verification
- Validate webhook payloads
- Monitor webhook delivery logs

## 🌐 Deployment-Specific Configuration

### Vercel
Set environment variables in the Vercel dashboard:
1. Go to your project settings
2. Navigate to Environment Variables
3. Add each variable with appropriate scope (Production/Preview/Development)

### Netlify
Set environment variables in the Netlify dashboard:
1. Go to Site settings
2. Navigate to Environment variables
3. Add each variable

### Local Development
For local development, use a `.env` file in the project root:

```bash
# Copy example file
cp .env.example .env

# Edit with your values
nano .env

# Validate configuration
npm run validate
```

## 🔄 Dynamic Configuration

Some settings can be changed at runtime through environment variables:

### Feature Flags
```env
# Enable/disable specific features
ENABLE_SLACK_NOTIFICATIONS=true
ENABLE_TELEGRAM_NOTIFICATIONS=true
ENABLE_WEBHOOK_NOTIFICATIONS=true
ENABLE_SCAM_DETECTION=true
```

### Performance Tuning
```env
# Adjust timeouts and limits
WEBHOOK_TIMEOUT=10000
MAX_CONCURRENT_CALLS=5
TRANSCRIPTION_TIMEOUT=30000
```

## 📊 Monitoring Variables

### Logging Configuration
```env
# Log level (error, warn, info, debug)
LOG_LEVEL=info

# Enable structured logging
STRUCTURED_LOGS=true

# Log file path (optional)
LOG_FILE=/var/log/sipsentinel.log
```

### Analytics
```env
# Enable analytics collection
ENABLE_ANALYTICS=true

# Analytics provider configuration
ANALYTICS_PROVIDER=custom
ANALYTICS_ENDPOINT=https://your-analytics.com/events
```

## 🧪 Testing Configuration

### Test Environment Variables
```env
# Test phone number for development
TEST_PHONE_NUMBER=+1234567890

# Enable test mode (uses mock services)
TEST_MODE=true

# Test webhook URL for development
TEST_WEBHOOK_URL=https://webhook.site/your-test-id
```

### Development Overrides
```env
# Override service endpoints for testing
TWILIO_API_BASE=https://api.twilio.com
VAPI_API_BASE=https://api.vapi.ai
OPENROUTER_API_BASE=https://openrouter.ai/api/v1
```

## 🔍 Troubleshooting Variables

### Debug Configuration
```env
# Enable verbose logging
VERBOSE=true

# Debug specific components
DEBUG_TWILIO=true
DEBUG_VAPI=true
DEBUG_LLM=true
DEBUG_WEBHOOKS=true
```

### Error Handling
```env
# Retry configuration
MAX_RETRIES=3
RETRY_DELAY=1000

# Error reporting
ERROR_REPORTING_ENABLED=true
ERROR_WEBHOOK_URL=https://your-error-tracker.com/webhook
```

## 📝 Variable Validation

The system validates environment variables on startup:

### Required Checks
- All required variables are present
- API keys have correct format
- Phone numbers are in E.164 format
- URLs are valid and accessible

### Optional Checks
- Service connectivity tests
- Permission validation
- Resource availability checks

### Validation Errors
Common validation errors and solutions:

```bash
# Missing required variable
❌ TWILIO_ACCOUNT_SID: Missing
# Solution: Add the variable to your .env file

# Invalid format
❌ TWILIO_PHONE_NUMBER: Invalid format
# Solution: Use E.164 format (+1234567890)

# Service unreachable
❌ VAPI: Connection failed
# Solution: Check API key and network connectivity
```
