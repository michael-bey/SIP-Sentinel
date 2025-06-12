# SIPSentinel Deployment Guide

## Deploy to Vercel (Recommended)

### Prerequisites
1. Install Vercel CLI: `npm install -g vercel`
2. Create a Vercel account at https://vercel.com
3. Have your environment variables ready

### Step 1: Deploy to Vercel

```bash
# Login to Vercel
vercel login

# Deploy the project
vercel

# Follow the prompts:
# - Set up and deploy? Y
# - Which scope? (select your account)
# - Link to existing project? N
# - Project name: sipsentinel
# - Directory: ./
# - Override settings? N
```

### Step 2: Set Environment Variables

In the Vercel dashboard or via CLI:

```bash
# Set environment variables
vercel env add TWILIO_ACCOUNT_SID
vercel env add TWILIO_AUTH_TOKEN  
vercel env add TWILIO_PHONE_NUMBER
vercel env add VAPI_API_KEY
vercel env add OPENROUTER_API_KEY
vercel env add AWS_ACCESS_KEY_ID
vercel env add AWS_SECRET_ACCESS_KEY
vercel env add AWS_REGION

# Redeploy with environment variables
vercel --prod
```

### Step 3: Configure Twilio Webhooks

Once deployed, you'll get a URL like: `https://sipsentinel-xxx.vercel.app`

Configure these webhooks in your Twilio Console:

1. **SMS Webhook**: `https://your-vercel-url.vercel.app/sms`
2. **Voice Webhook**: `https://your-vercel-url.vercel.app/voice`
3. **Recording Status Callback**: `https://your-vercel-url.vercel.app/recording-status`
4. **Transcription Callback**: `https://your-vercel-url.vercel.app/transcription`

### Step 4: Test the Deployment

1. Visit your Vercel URL to see the dashboard
2. Test scam detection: `POST https://your-vercel-url.vercel.app/test-detection`
3. Call your Twilio number to test the full flow

## Alternative: Deploy to Netlify

### Step 1: Install Netlify CLI
```bash
npm install -g netlify-cli
```

### Step 2: Create netlify.toml
```toml
[build]
  functions = "netlify/functions"
  publish = "public"

[functions]
  node_bundler = "esbuild"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/api/:splat"
  status = 200

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### Step 3: Deploy
```bash
netlify login
netlify deploy --prod
```

## Environment Variables Required

```
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=your_twilio_phone_number
VAPI_API_KEY=your_vapi_api_key
OPENROUTER_API_KEY=your_openrouter_api_key
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
AWS_REGION=us-west-2
```

## Testing After Deployment

1. **Health Check**: `GET https://your-url/health`
2. **Scam Detection**: `POST https://your-url/test-detection`
3. **VAPI Analytics**: `GET https://your-url/vapi/analytics`
4. **Dashboard**: Visit your URL in browser

## Troubleshooting

### Common Issues:
1. **Environment Variables**: Make sure all required env vars are set
2. **Twilio Webhooks**: Ensure URLs are HTTPS and publicly accessible
3. **CORS Issues**: The server includes CORS headers for cross-origin requests
4. **Timeout Issues**: Vercel functions have a 30-second timeout limit

### Logs:
- Vercel: `vercel logs`
- Netlify: Check the Functions tab in your Netlify dashboard

## Production Considerations

1. **Rate Limiting**: Consider adding rate limiting for production use
2. **Authentication**: Add API authentication for sensitive endpoints
3. **Monitoring**: Set up monitoring and alerting
4. **Scaling**: Both Vercel and Netlify auto-scale serverless functions
