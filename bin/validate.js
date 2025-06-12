/**
 * Environment Validation for SIPSentinel
 * Validates configuration and service connectivity
 */

require('dotenv').config();
const twilio = require('twilio');
const { VapiClient } = require('@vapi-ai/server-sdk');
const { OpenAI } = require('openai');
const { S3Client, ListBucketsCommand } = require('@aws-sdk/client-s3');

/**
 * Validate environment configuration and service connectivity
 */
async function validateEnvironment() {
  console.log('🔍 Validating SIPSentinel configuration...\n');

  const results = {
    environment: {},
    services: {},
    overall: true
  };

  // Check required environment variables
  const requiredVars = [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN', 
    'TWILIO_PHONE_NUMBER',
    'VAPI_API_KEY',
    'OPENROUTER_API_KEY',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_REGION'
  ];

  console.log('📋 Checking environment variables...');
  for (const varName of requiredVars) {
    const value = process.env[varName];
    const isSet = !!value;
    results.environment[varName] = isSet;
    
    if (isSet) {
      console.log(`✅ ${varName}: Set`);
    } else {
      console.log(`❌ ${varName}: Missing`);
      results.overall = false;
    }
  }

  // Test Twilio connectivity
  console.log('\n📞 Testing Twilio connectivity...');
  try {
    const twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    
    const account = await twilioClient.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
    console.log(`✅ Twilio: Connected (Account: ${account.friendlyName})`);
    
    // Test phone number
    try {
      const phoneNumber = await twilioClient.incomingPhoneNumbers.list({
        phoneNumber: process.env.TWILIO_PHONE_NUMBER
      });
      
      if (phoneNumber.length > 0) {
        console.log(`✅ Twilio Phone Number: ${process.env.TWILIO_PHONE_NUMBER} found`);
        results.services.twilio = true;
      } else {
        console.log(`⚠️  Twilio Phone Number: ${process.env.TWILIO_PHONE_NUMBER} not found in account`);
        results.services.twilio = false;
      }
    } catch (phoneError) {
      console.log(`⚠️  Twilio Phone Number: Could not verify ${process.env.TWILIO_PHONE_NUMBER}`);
      results.services.twilio = false;
    }
  } catch (error) {
    console.log(`❌ Twilio: Connection failed - ${error.message}`);
    results.services.twilio = false;
    results.overall = false;
  }

  // Test VAPI connectivity
  console.log('\n🤖 Testing VAPI connectivity...');
  try {
    const vapiClient = new VapiClient({
      token: process.env.VAPI_API_KEY
    });
    
    const assistants = await vapiClient.assistants.list();
    console.log(`✅ VAPI: Connected (${assistants.length || 0} assistants found)`);
    results.services.vapi = true;
  } catch (error) {
    console.log(`❌ VAPI: Connection failed - ${error.message}`);
    results.services.vapi = false;
    results.overall = false;
  }

  // Test OpenRouter connectivity
  console.log('\n🧠 Testing OpenRouter connectivity...');
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1'
    });
    
    const models = await openai.models.list();
    console.log(`✅ OpenRouter: Connected (${models.data?.length || 0} models available)`);
    results.services.openrouter = true;
  } catch (error) {
    console.log(`❌ OpenRouter: Connection failed - ${error.message}`);
    results.services.openrouter = false;
    results.overall = false;
  }

  // Test AWS connectivity
  console.log('\n☁️  Testing AWS connectivity...');
  try {
    const s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });
    
    const buckets = await s3Client.send(new ListBucketsCommand({}));
    console.log(`✅ AWS S3: Connected (${buckets.Buckets?.length || 0} buckets accessible)`);
    results.services.aws = true;
  } catch (error) {
    console.log(`❌ AWS: Connection failed - ${error.message}`);
    results.services.aws = false;
    results.overall = false;
  }

  // Summary
  console.log('\n📊 Validation Summary:');
  console.log('='.repeat(50));
  
  const envCount = Object.values(results.environment).filter(Boolean).length;
  const serviceCount = Object.values(results.services).filter(Boolean).length;
  
  console.log(`Environment Variables: ${envCount}/${requiredVars.length} configured`);
  console.log(`Service Connectivity: ${serviceCount}/4 services connected`);
  
  if (results.overall) {
    console.log('\n🎉 All validations passed! Your SIPSentinel is ready to run.');
    console.log('\nNext steps:');
    console.log('1. Configure Twilio webhooks in your Twilio console');
    console.log('2. Create VAPI agents: npm run create-agents --all');
    console.log('3. Start the server: npm start');
  } else {
    console.log('\n⚠️  Some validations failed. Please fix the issues above before proceeding.');
    console.log('\nCommon fixes:');
    console.log('- Check your .env file for missing or incorrect values');
    console.log('- Verify your API keys are correct and have proper permissions');
    console.log('- Ensure your Twilio phone number is in E.164 format (+1234567890)');
    console.log('- Check your AWS credentials have S3 and Transcribe permissions');
  }

  return results;
}

module.exports = {
  validateEnvironment
};
