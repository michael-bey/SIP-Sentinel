# Security Guidelines

## Environment Variables

### ⚠️ NEVER commit sensitive credentials to git!

This project requires several API keys and credentials. Follow these guidelines:

### 1. Local Development Setup

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Fill in your actual credentials in `.env`:
   ```bash
   # Edit .env with your real values
   nano .env
   ```

3. **NEVER** commit the `.env` file to git (it's already in `.gitignore`)

### 2. Required Environment Variables

| Variable | Description | Where to get it |
|----------|-------------|-----------------|
| `TWILIO_ACCOUNT_SID` | Twilio Account SID | [Twilio Console](https://console.twilio.com/) |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token | [Twilio Console](https://console.twilio.com/) |
| `TWILIO_PHONE_NUMBER` | Your Twilio phone number | [Twilio Phone Numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/incoming) |
| `VAPI_API_KEY` | VAPI API Key | [VAPI Dashboard](https://dashboard.vapi.ai/) |
| `VAPI_PUBLIC_API_KEY` | VAPI Public Key | [VAPI Dashboard](https://dashboard.vapi.ai/) |
| `OPENROUTER_API_KEY` | OpenRouter API Key | [OpenRouter](https://openrouter.ai/keys) |
| `AWS_ACCESS_KEY_ID` | AWS Access Key | [AWS IAM Console](https://console.aws.amazon.com/iam/) |
| `AWS_SECRET_ACCESS_KEY` | AWS Secret Key | [AWS IAM Console](https://console.aws.amazon.com/iam/) |
| `AWS_REGION` | AWS Region | Usually `us-west-2` |

### 3. Deployment Environment Variables

#### Vercel Deployment
When deploying to Vercel, use these exact variable names (some are different from local):

```bash
# Use these names in Vercel dashboard
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN  
TWILIO_PHONE_NUMBER
VAPI_API_KEY
VAPI_PUBLIC_API_KEY
OPENROUTER_API_KEY
AWS_ACCESS_KEY_ID      # ← Note: Similar to protected variable on Vercel
AWS_SECRET_ACCESS_KEY  # ← Note: Similar to protected variable on Vercel  
AWS_REGION
```

**Why different?** Vercel reserves `AWS_ACCESS_KEY` and `AWS_SECRET_KEY`, so we use the standard AWS names.

### 4. Security Best Practices

- ✅ Use `.env.example` to document required variables
- ✅ Keep `.env` in `.gitignore`
- ✅ Use different credentials for development/production
- ✅ Rotate credentials regularly
- ✅ Use least-privilege AWS IAM policies
- ❌ Never hardcode credentials in source code
- ❌ Never commit `.env` files
- ❌ Never share credentials in chat/email
- ❌ Never use production credentials in development

### 5. AWS IAM Policy

For AWS credentials, create an IAM user with minimal permissions:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::sip-sentinel",
                "arn:aws:s3:::sip-sentinel/*"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "transcribe:StartTranscriptionJob",
                "transcribe:GetTranscriptionJob"
            ],
            "Resource": "*"
        }
    ]
}
```

### 6. Monitoring

- Monitor AWS CloudTrail for unusual activity
- Check Twilio usage logs
- Monitor VAPI usage dashboard
- Set up billing alerts

## Contact

If you discover a security vulnerability, please contact the maintainer immediately.
