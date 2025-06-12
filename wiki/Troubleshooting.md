# SIPSentinel Troubleshooting Guide

This guide helps you diagnose and fix common issues with the SIPSentinel system.

## 🔍 Quick Diagnostics

### 1. Run System Validation

```bash
npm run validate
```

This checks:
- Environment variables
- Service connectivity
- API key validity
- Account permissions

### 2. Check Server Health

```bash
curl http://localhost:3000/health
```

Or visit the health endpoint in your browser.

### 3. View Server Logs

```bash
# If running locally
npm start

# Check deployment logs
vercel logs  # For Vercel
netlify logs # For Netlify
```

## 🚨 Common Issues

### Environment Configuration

#### Issue: "Environment variable not set"
```
❌ TWILIO_ACCOUNT_SID: Missing
```

**Solution:**
1. Check your `.env` file exists
2. Verify variable names match exactly
3. Ensure no extra spaces around values
4. Restart the server after changes

#### Issue: "Invalid API key format"
```
Error: Invalid API key
```

**Solution:**
1. Copy API keys directly from service dashboards
2. Check for hidden characters or line breaks
3. Verify key hasn't expired
4. Test key with service's API directly

### Twilio Integration

#### Issue: "Webhooks not receiving calls"
```
No webhook calls received
```

**Solution:**
1. Verify webhook URLs in Twilio Console
2. Check deployment is accessible publicly
3. Test webhook URL manually:
   ```bash
   curl -X POST https://your-domain.com/voice
   ```
4. Check Twilio webhook logs in console

#### Issue: "Recording transcription failed"
```
Twilio transcription failed. Using our custom transcription service...
```

**Solution:**
1. Enable transcription in Twilio recording settings
2. Check recording duration (must be > 2 seconds)
3. Verify audio quality
4. AWS Transcribe will be used as fallback

#### Issue: "Phone number not found"
```
Twilio Phone Number: +1234567890 not found in account
```

**Solution:**
1. Verify phone number format (+1234567890)
2. Check number is active in Twilio Console
3. Ensure number has voice and SMS capabilities
4. Try with a different number

### VAPI Integration

#### Issue: "No VAPI assistants found"
```
Found 0 assistants
```

**Solution:**
1. Verify VAPI API key is correct
2. Create agents using:
   ```bash
   npm run create-agents --all
   ```
3. Check VAPI dashboard for existing agents
4. Test API key with VAPI directly

#### Issue: "VAPI call creation failed"
```
Error creating VAPI call: Invalid phone number
```

**Solution:**
1. Ensure phone number is in E.164 format (+1234567890)
2. Check VAPI account has calling credits
3. Verify phone number is valid and reachable
4. Try with a known working number

#### Issue: "Agent voice not working"
```
Agent created but voice sounds wrong
```

**Solution:**
1. Check agent gender detection:
   ```bash
   curl http://localhost:3000/test-voice/YourAgentName
   ```
2. Verify voice provider settings
3. Test with different voice options
4. Check VAPI voice availability

### OpenRouter/LLM Issues

#### Issue: "LLM analysis failed"
```
Error analyzing message with LLM: API key invalid
```

**Solution:**
1. Verify OpenRouter API key
2. Check account has credits
3. Test with curl:
   ```bash
   curl -H "Authorization: Bearer $OPENROUTER_API_KEY" \
        https://openrouter.ai/api/v1/models
   ```
4. Try different model if current one is unavailable

#### Issue: "Scam detection not working"
```
No scam detected in transcription
```

**Solution:**
1. Test with known scam phrases:
   ```bash
   curl -X POST http://localhost:3000/test-detection \
        -H "Content-Type: application/json" \
        -d '{"message": "Your Coinbase account has been compromised. Call 1-800-555-0123"}'
   ```
2. Check LLM response format
3. Verify confidence thresholds
4. Review scam detection patterns

### AWS Integration

#### Issue: "AWS S3 connection failed"
```
AWS: Connection failed - Access Denied
```

**Solution:**
1. Verify AWS credentials are correct
2. Check IAM user has S3 permissions
3. Ensure bucket exists or can be created
4. Test AWS CLI access:
   ```bash
   aws s3 ls --region us-west-2
   ```

#### Issue: "Transcription storage failed"
```
Error storing transcription in S3
```

**Solution:**
1. Check S3 bucket permissions
2. Verify bucket name in configuration
3. Ensure region matches AWS_REGION
4. Test bucket write access

### Deployment Issues

#### Issue: "Vercel deployment fails"
```
Error: Build failed
```

**Solution:**
1. Check environment variables in Vercel dashboard
2. Verify all dependencies are in package.json
3. Check build logs for specific errors
4. Test locally first:
   ```bash
   npm run build
   ```

#### Issue: "Netlify functions timeout"
```
Function execution timed out
```

**Solution:**
1. Optimize function performance
2. Increase timeout in netlify.toml
3. Check for infinite loops
4. Use async/await properly

### Web Dashboard Issues

#### Issue: "Dashboard shows no data"
```
No recent scams or calls displayed
```

**Solution:**
1. Check API endpoint:
   ```bash
   curl http://localhost:3000/api/dashboard
   ```
2. Verify data sources are connected
3. Test with sample data
4. Check browser console for errors

#### Issue: "Audio playback not working"
```
Audio files won't play
```

**Solution:**
1. **Check AWS credentials** - If Twilio External Storage is enabled, AWS credentials are required:
   ```env
   AWS_ACCESS_KEY_ID=your_aws_access_key
   AWS_SECRET_ACCESS_KEY=your_aws_secret_key
   AWS_REGION=us-west-2
   ```
2. Verify S3 bucket permissions (IAM user needs S3 read access)
3. Test audio endpoint directly:
   ```bash
   curl -I "https://your-domain.com/api/audio/RECORDING_SID"
   ```
4. Check browser console for 404/403 errors
5. Verify Twilio External Storage configuration

## 🔧 Advanced Debugging

### Enable Debug Mode

Add to your `.env`:
```
DEBUG=true
NODE_ENV=development
```

### Test Individual Components

```bash
# Test scam detection only
curl -X POST http://localhost:3000/test-detection \
     -H "Content-Type: application/json" \
     -d '{"message": "Your account has been compromised"}'

# Test VAPI call creation
curl "http://localhost:3000/test-call?phone=+1234567890"

# Test agent selection
curl "http://localhost:3000/vapi/find-agent?company=coinbase"
```

### Check Service Status

```bash
# VAPI service status
curl -H "Authorization: Bearer $VAPI_API_KEY" \
     https://api.vapi.ai/assistants

# OpenRouter status
curl -H "Authorization: Bearer $OPENROUTER_API_KEY" \
     https://openrouter.ai/api/v1/models

# Twilio status
curl -u $TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN \
     https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID.json
```

### Performance Monitoring

Monitor these metrics:
- Response times for webhook endpoints
- VAPI call success rates
- LLM analysis accuracy
- Storage usage and costs

## 📞 Getting Help

### Before Asking for Help

1. Run `npm run validate`
2. Check this troubleshooting guide
3. Review server logs
4. Test individual components
5. Search existing issues

### When Reporting Issues

Include:
- Error messages (full stack trace)
- Environment details (OS, Node version)
- Configuration (without sensitive data)
- Steps to reproduce
- Expected vs actual behavior

### Support Channels

1. GitHub Issues (preferred)
2. Documentation and guides
3. Community forums
4. Service provider support (Twilio, VAPI, etc.)

## 🛠️ Maintenance

### Regular Tasks

1. **Monitor API Usage**
   - Check VAPI call costs
   - Monitor OpenRouter credits
   - Review AWS S3 storage

2. **Update Dependencies**
   ```bash
   npm audit
   npm update
   ```

3. **Rotate API Keys**
   - Update keys in environment
   - Test after rotation
   - Update deployment configs

4. **Review Logs**
   - Check for errors
   - Monitor success rates
   - Analyze scam patterns

### Performance Optimization

1. **Reduce Latency**
   - Use CDN for static assets
   - Optimize database queries
   - Cache frequently accessed data

2. **Scale Resources**
   - Add more VAPI phone numbers
   - Increase server capacity
   - Use load balancing

3. **Cost Optimization**
   - Monitor API usage
   - Optimize call durations
   - Use efficient storage tiers
