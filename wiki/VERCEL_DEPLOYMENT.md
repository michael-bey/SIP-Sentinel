# Vercel Deployment Guide

## Fixed Issues

✅ **Resolved the `functions` and `builds` conflict error**
- Removed the legacy `builds` property from `vercel.json`
- Updated to use modern Vercel configuration with `functions` and `rewrites`
- Created proper serverless function structure in `/api/index.js`

## Deployment Steps

### 1. Environment Variables Setup

⚠️ **SECURITY WARNING**: Never commit actual API keys to version control!

You'll need to add these environment variables in your Vercel dashboard. Replace the placeholder values with your actual credentials:

```
TWILIO_ACCOUNT_SID=your_twilio_account_sid_here
TWILIO_AUTH_TOKEN=your_twilio_auth_token_here
TWILIO_PHONE_NUMBER=your_twilio_phone_number_here
VAPI_API_KEY=your_vapi_api_key_here
VAPI_PUBLIC_API_KEY=your_vapi_public_api_key_here
OPENROUTER_API_KEY=your_openrouter_api_key_here
AWS_ACCESS_KEY_ID=your_aws_access_key_id_here
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key_here
AWS_REGION=us-west-2
```

#### How to get these credentials:

- **Twilio**: Sign up at [twilio.com](https://twilio.com), get Account SID and Auth Token from Console Dashboard
- **VAPI**: Sign up at [vapi.ai](https://vapi.ai), get API keys from your dashboard
- **OpenRouter**: Sign up at [openrouter.ai](https://openrouter.ai), create an API key
- **AWS**: Create an IAM user with S3 permissions, generate access keys

### 2. Deploy to Vercel

#### Option A: Using Vercel CLI
```bash
# Install Vercel CLI if you haven't already
npm i -g vercel

# Deploy
vercel --prod
```

#### Option B: Using Git Integration
1. Push your changes to your connected Git repository
2. Vercel will automatically deploy

### 3. Configure Webhooks

Once deployed, update your Twilio webhooks with your new Vercel URL:

- **Voice URL**: `https://your-app.vercel.app/voice`
- **SMS URL**: `https://your-app.vercel.app/sms`
- **Recording Status Callback**: `https://your-app.vercel.app/recording-status`
- **Transcription Callback**: `https://your-app.vercel.app/transcription`

## File Changes Made

1. **`vercel.json`**: Updated to modern configuration format
2. **`src/index.js`**: Modified to export app for serverless deployment
3. **`api/index.js`**: Created serverless function entry point

## Testing

After deployment, test these endpoints:
- `GET /health` - Health check
- `GET /deployment-info` - Deployment configuration
- `POST /voice` - Twilio voice webhook
- `POST /sms` - Twilio SMS webhook

## Security Best Practices

🔒 **Important Security Notes:**

1. **Never commit secrets to git**: Always use environment variables for API keys
2. **Use different keys for development/production**: Keep your environments separate
3. **Rotate keys regularly**: Especially if you suspect they may have been compromised
4. **Limit permissions**: Use IAM roles with minimal required permissions for AWS
5. **Monitor usage**: Keep an eye on your API usage for unexpected activity

## Troubleshooting

If you encounter issues:
1. Check Vercel function logs in the dashboard
2. Verify all environment variables are set correctly
3. Ensure your domain is properly configured
4. Check that webhook URLs are updated in Twilio console
