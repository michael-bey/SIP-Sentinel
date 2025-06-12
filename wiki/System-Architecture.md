# System Architecture

Detailed technical overview of SIPSentinel's architecture and components.

## 🏗️ High-Level Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Scammer       │───▶│   Twilio Phone   │───▶│  SIPSentinel    │
│ Calls/Texts     │    │     Number       │    │    Server       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                         │
                       ┌─────────────────────────────────┼─────────────────────────────────┐
                       │                                 ▼                                 │
                       │                    ┌─────────────────────┐                       │
                       │                    │   Scam Detection    │                       │
                       │                    │   (LLM Analysis)    │                       │
                       │                    └─────────────────────┘                       │
                       │                                 │                                 │
                       │                                 ▼                                 │
                       │                    ┌─────────────────────┐                       │
                       │                    │  Agent Selection    │                       │
                       │                    │   & Deployment      │                       │
                       │                    └─────────────────────┘                       │
                       │                                 │                                 │
                       │                                 ▼                                 │
┌─────────────────┐    │    ┌─────────────────────┐    ┌─────────────────────┐    ┌──────────────┐
│   Web Dashboard │◀───┼────│   S3 Storage        │    │   VAPI AI Agent     │───▶│   Scammer    │
│   Monitoring    │    │    │   (Recordings &     │    │   Calls Back        │    │   Engaged    │
└─────────────────┘    │    │    Transcripts)     │    └─────────────────────┘    └──────────────┘
                       │    └─────────────────────┘                                       │
┌─────────────────┐    │                                                                  │
│ Slack/Telegram  │◀───┼──────────────────────────────────────────────────────────────────┘
│  Notifications  │    │
└─────────────────┘    └─────────────────────────────────────────────────────────────────┘
```

## 🔧 Core Components

### 1. Express.js Web Server (`src/index.js`)
- **Purpose**: Main application server handling webhooks and API endpoints
- **Key Features**:
  - Twilio webhook handlers (`/voice`, `/sms`, `/recording-status`, `/transcription`)
  - VAPI webhook handler (`/vapi/webhook`)
  - Web dashboard serving static files
  - Real-time SSE (Server-Sent Events) for live updates
  - API endpoints for testing and monitoring

### 2. Scam Detection Engine (`src/llm-scam-detector.js`)
- **Purpose**: Analyzes incoming messages and voicemails for scam patterns
- **Technology**: OpenRouter.ai with Meta Llama 3.3 8B model
- **Features**:
  - Dual-layer detection (regex + LLM)
  - Confidence scoring (0-100)
  - Company identification (Coinbase, Kraken, Microsoft, etc.)
  - Callback number extraction
  - Scam type classification

### 3. VAPI Service (`src/vapi-service.js`)
- **Purpose**: Manages AI agent creation and call orchestration
- **Features**:
  - Dynamic agent selection based on detected company
  - Phone number management (VAPI-first with Twilio fallback)
  - Voice synthesis with gender-appropriate selection
  - Call tracking and analytics
  - Agent template system

### 4. Background Processor (`src/background-processor.js`)
- **Purpose**: Handles time-intensive operations asynchronously
- **Task Types**:
  - Transcription and analysis
  - LLM analysis
  - VAPI callback creation
  - Webhook notifications
- **Features**:
  - In-memory task queue
  - Priority-based processing
  - Error handling and retries

### 5. Storage Service (`src/s3-storage-service.js`)
- **Purpose**: Manages persistent storage of call data and transcripts
- **Technology**: AWS S3 with AWS SDK v3
- **Data Stored**:
  - Call metadata (confidence scores, company, phone numbers)
  - Audio transcriptions
  - Call recordings
  - Analytics data

### 6. Transcription Service (`src/transcription-service.js`)
- **Purpose**: Converts audio to text for analysis
- **Technology**: 
  - Primary: Twilio's built-in transcription
  - Fallback: AWS Transcribe
- **Features**:
  - Automatic transcription of voicemails
  - Caching to avoid duplicate processing
  - Error handling and fallback mechanisms

### 7. Webhook Service (`src/webhook-service.js`)
- **Purpose**: External integrations and notifications
- **Integrations**:
  - Slack webhooks with formatted messages
  - Telegram bot with audio attachments
  - Generic webhook system for external services
- **Security**: HMAC-SHA256 signature verification

## 🔄 Data Flow

### Incoming Scam Detection Flow

1. **Scammer Action**: Calls or texts honeypot Twilio number
2. **Twilio Processing**: 
   - Voice: Records voicemail, triggers transcription
   - SMS: Immediately forwards message content
3. **Initial Analysis**: Regex-based quick scam detection
4. **Async Processing**: If regex detects scam, queue for LLM analysis
5. **LLM Analysis**: 
   - Confidence scoring
   - Company identification
   - Callback number extraction
6. **Agent Selection**: Choose appropriate AI agent based on company
7. **VAPI Call Creation**: Deploy agent to call back scammer
8. **Storage**: Store all data in S3 for analysis
9. **Notifications**: Send alerts via Slack/Telegram/webhooks

### Agent Conversation Flow

1. **VAPI Call Initiated**: Agent calls extracted callback number
2. **Conversation Management**: VAPI handles voice synthesis and conversation
3. **Real-time Updates**: Webhook notifications for call status changes
4. **Recording Storage**: Completed calls stored in S3
5. **Analytics**: Success metrics calculated and displayed

## 🗄️ Data Models

### Call Metadata
```json
{
  "callSid": "string",
  "phoneNumber": "string",
  "timestamp": "ISO8601",
  "scamAnalysis": {
    "isScam": "boolean",
    "confidence": "number",
    "impersonatedCompany": "string",
    "scamType": "string",
    "callbackNumber": "string"
  },
  "vapiCallId": "string",
  "agentName": "string",
  "duration": "number",
  "success": "boolean"
}
```

### Transcription Data
```json
{
  "callSid": "string",
  "transcriptionText": "string",
  "confidence": "number",
  "source": "twilio|aws",
  "timestamp": "ISO8601"
}
```

## 🔌 External Integrations

### Twilio Integration
- **Phone Numbers**: Honeypot numbers for receiving scam calls/texts
- **Webhooks**: Real-time notifications for incoming communications
- **Transcription**: Built-in voicemail transcription service
- **SMS**: Text message handling and response

### VAPI Integration
- **AI Agents**: Voice-based conversational AI
- **Phone Numbers**: Outbound calling capabilities
- **Webhooks**: Call status and completion notifications
- **Voice Synthesis**: High-quality text-to-speech

### AWS Integration
- **S3 Storage**: Persistent data storage
- **Transcribe**: Backup transcription service
- **IAM**: Secure access management

### OpenRouter Integration
- **LLM Access**: Meta Llama 3.3 8B model
- **Scam Analysis**: Advanced pattern recognition
- **Cost Optimization**: Free tier usage

## 🚀 Deployment Architecture

### Serverless (Vercel/Netlify)
- **Advantages**: Auto-scaling, zero maintenance, cost-effective
- **Limitations**: 60-second function timeout, cold starts
- **Best For**: Low to medium volume deployments

### Traditional Server
- **Advantages**: No timeout limits, persistent connections
- **Limitations**: Requires server management
- **Best For**: High-volume or enterprise deployments

## 🔒 Security Considerations

### API Security
- Admin endpoints restricted to localhost
- HMAC signature verification for webhooks
- Environment variable protection
- Phone number redaction in logs and UI

### Data Protection
- Encrypted storage in AWS S3
- Secure API key management
- No sensitive data in git repository
- Regular credential rotation

## 📊 Performance Characteristics

### Scalability Limits
- **Twilio**: Rate limits on API calls and SMS
- **VAPI**: Daily call limits on free tier
- **OpenRouter**: Rate limits on LLM requests
- **AWS**: Virtually unlimited storage

### Optimization Strategies
- Async processing for heavy operations
- Caching of transcriptions and analysis
- Background task queuing
- Efficient data storage patterns

## 🔧 Configuration Management

### Environment Variables
- Service API keys and credentials
- Feature flags and thresholds
- Webhook URLs and secrets
- Storage configuration

### Agent Templates
- Pre-configured AI personalities
- Company-specific knowledge bases
- Voice and conversation settings
- Success metrics and goals

## 📈 Monitoring and Analytics

### Real-time Metrics
- Active call tracking
- Scam detection rates
- Agent performance
- System health

### Historical Analytics
- Success rate trends
- Company-specific statistics
- Call duration analysis
- Cost tracking

## 🔄 Future Architecture Considerations

### Horizontal Scaling
- Multiple server instances
- Load balancing
- Distributed task queues
- Database clustering

### Enhanced AI
- Custom model training
- Multi-modal analysis
- Predictive scam detection
- Advanced conversation strategies
