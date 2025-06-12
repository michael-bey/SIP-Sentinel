# API Reference

Complete documentation for all SIPSentinel API endpoints.

## 🌐 Base URL

- **Local Development**: `http://localhost:3000`
- **Production**: `https://your-domain.com`

## 📞 Webhook Endpoints

### POST /voice
Handles incoming voice calls from Twilio.

**Request Body** (Twilio webhook format):
```json
{
  "CallSid": "string",
  "From": "string",
  "To": "string",
  "CallStatus": "string",
  "RecordingUrl": "string",
  "TranscriptionText": "string"
}
```

**Response**: TwiML XML for call handling

### POST /sms
Handles incoming SMS messages from Twilio.

**Request Body** (Twilio webhook format):
```json
{
  "MessageSid": "string",
  "From": "string",
  "To": "string",
  "Body": "string"
}
```

**Response**: TwiML XML for SMS response

### POST /recording-status
Handles recording status updates from Twilio.

**Request Body** (Twilio webhook format):
```json
{
  "CallSid": "string",
  "RecordingUrl": "string",
  "RecordingStatus": "string"
}
```

### POST /transcription
Handles transcription completion from Twilio.

**Request Body** (Twilio webhook format):
```json
{
  "CallSid": "string",
  "TranscriptionText": "string",
  "TranscriptionStatus": "string"
}
```

### POST /vapi/webhook
Handles VAPI call status updates.

**Request Body** (VAPI webhook format):
```json
{
  "type": "string",
  "call": {
    "id": "string",
    "status": "string",
    "startedAt": "string",
    "endedAt": "string"
  }
}
```

## 🧪 Testing Endpoints

### POST /test-detection
Test scam detection without making calls.

**Request Body**:
```json
{
  "message": "string"
}
```

**Response**:
```json
{
  "isScam": "boolean",
  "confidence": "number",
  "impersonatedCompany": "string",
  "scamType": "string",
  "callbackNumber": "string",
  "details": "object"
}
```

### GET /test-call
Test VAPI call creation.

**Query Parameters**:
- `phone` (required): Target phone number
- `scamType` (optional): Type of scam (crypto_exchange, it_support)

**Response**:
```json
{
  "success": "boolean",
  "callId": "string",
  "agentName": "string",
  "message": "string"
}
```

### GET /test-coinbase
Test Coinbase-specific agent.

**Query Parameters**:
- `phone` (required): Target phone number

### GET /test-voice/:agentName
Test voice configuration for specific agent.

**Path Parameters**:
- `agentName`: Name of the agent to test

### GET /simulate-scam
Simulate receiving a scam message.

**Query Parameters**:
- `phone` (required): Target phone number
- `type` (required): Scam type (crypto_exchange, it_support)

## 📊 Dashboard API

### GET /api/dashboard
Get dashboard data for web interface.

**Response**:
```json
{
  "recentCalls": [
    {
      "callSid": "string",
      "timestamp": "string",
      "company": "string",
      "phoneNumber": "string",
      "confidence": "number",
      "type": "string"
    }
  ],
  "analytics": {
    "totalCalls": "number",
    "successfulCalls": "number",
    "averageDuration": "number"
  }
}
```

### GET /api/calls/:callSid
Get detailed information about a specific call.

**Path Parameters**:
- `callSid`: Twilio call SID

**Response**:
```json
{
  "callSid": "string",
  "phoneNumber": "string",
  "timestamp": "string",
  "transcription": "string",
  "scamAnalysis": "object",
  "vapiCall": "object",
  "recordings": ["string"]
}
```

### GET /events
Server-Sent Events endpoint for real-time updates.

**Response**: SSE stream with events:
- `incoming_call`
- `scam_detected`
- `agent_call_initiated`
- `call_completed`

## 🔧 VAPI Integration

### GET /vapi/assistants
List available VAPI assistants.

**Response**:
```json
[
  {
    "id": "string",
    "name": "string",
    "model": "object",
    "voice": "object"
  }
]
```

### GET /vapi/phone-numbers
List available VAPI phone numbers.

**Response**:
```json
[
  {
    "id": "string",
    "number": "string",
    "provider": "string"
  }
]
```

### GET /vapi/calls
List recent VAPI calls.

**Query Parameters**:
- `limit` (optional): Number of calls to return (default: 10)

**Response**:
```json
[
  {
    "id": "string",
    "status": "string",
    "startedAt": "string",
    "endedAt": "string",
    "duration": "number"
  }
]
```

### GET /vapi/analytics
Get VAPI call analytics.

**Response**:
```json
{
  "totalCalls": "number",
  "successfulCalls": "number",
  "averageDuration": "number",
  "totalCost": "number",
  "callsByAgent": "object",
  "callsByCompany": "object"
}
```

## 🔔 Notification Testing

### POST /slack/test
Test Slack integration.

**Response**:
```json
{
  "success": "boolean",
  "message": "string"
}
```

### POST /telegram/test
Test Telegram integration.

**Response**:
```json
{
  "success": "boolean",
  "message": "string"
}
```

## 🔧 Admin Endpoints (Localhost Only)

### GET /webhooks/config
Get current webhook configuration.

**Response**:
```json
{
  "webhookUrls": ["string"],
  "slackWebhookUrl": "string",
  "telegramConfig": "object"
}
```

### POST /webhooks/test
Test webhook delivery.

**Request Body**:
```json
{
  "url": "string"
}
```

### GET /deployment-info
Get deployment and configuration information.

**Response**:
```json
{
  "environment": "string",
  "version": "string",
  "services": {
    "twilio": "boolean",
    "vapi": "boolean",
    "openrouter": "boolean",
    "aws": "boolean"
  }
}
```

## 📈 Health and Status

### GET /health
System health check.

**Response**:
```json
{
  "status": "healthy|degraded|unhealthy",
  "timestamp": "string",
  "services": {
    "twilio": "boolean",
    "vapi": "boolean",
    "openrouter": "boolean",
    "aws": "boolean"
  },
  "uptime": "number"
}
```

### GET /
Main landing page with system status and sample scam messages.

## 🔒 Authentication

Most endpoints are public for webhook functionality. Admin endpoints are restricted to localhost access only for security.

## 📝 Error Responses

All endpoints return consistent error responses:

```json
{
  "error": "string",
  "message": "string",
  "timestamp": "string"
}
```

Common HTTP status codes:
- `200` - Success
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden (admin endpoints from non-localhost)
- `404` - Not Found
- `500` - Internal Server Error

## 🔄 Rate Limiting

- No rate limiting on webhook endpoints (Twilio/VAPI)
- Testing endpoints limited to prevent abuse
- Admin endpoints restricted to localhost

## 📊 Response Formats

All API responses are in JSON format unless otherwise specified (TwiML endpoints return XML).

Timestamps are in ISO 8601 format: `2024-01-15T10:30:00.000Z`

Phone numbers are in E.164 format: `+1234567890`
