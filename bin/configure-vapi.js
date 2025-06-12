/**
 * VAPI Webhook Configuration Module
 * Configures VAPI assistants with webhook URLs for Telegram audio uploads
 */

require('dotenv').config();
const { VapiClient } = require('@vapi-ai/server-sdk');
const inquirer = require('inquirer');

/**
 * Configure VAPI webhook URLs
 */
async function configureVapiWebhooks(options = {}) {
  console.log('🔗 VAPI Webhook Configuration\n');

  // Check for required environment variables
  if (!process.env.VAPI_API_KEY) {
    console.error('❌ VAPI_API_KEY not found in environment variables');
    console.error('   Please run "npm run setup" first to configure your environment');
    process.exit(1);
  }

  try {
    const vapiClient = new VapiClient({
      token: process.env.VAPI_API_KEY,
    });

    // Determine the webhook URL
    let webhookUrl = options.url;
    
    if (!webhookUrl) {
      // Ask user for deployment URL or use default
      const urlAnswer = await inquirer.prompt([
        {
          type: 'input',
          name: 'deploymentUrl',
          message: 'What is your deployment URL? (e.g., https://your-app.vercel.app)',
          default: 'https://sip-sentinel.vercel.app',
          validate: (input) => {
            if (!input.startsWith('http://') && !input.startsWith('https://')) {
              return 'Please enter a valid URL starting with http:// or https://';
            }
            return true;
          }
        }
      ]);
      
      webhookUrl = `${urlAnswer.deploymentUrl.replace(/\/$/, '')}/api/webhooks/vapi`;
    }

    console.log(`📡 Using webhook URL: ${webhookUrl}\n`);

    // Test webhook endpoint
    console.log('1️⃣ Testing webhook endpoint...');
    try {
      const axios = require('axios');
      const testResponse = await axios.get(webhookUrl.replace('/api/webhooks/vapi', '/health'), {
        timeout: 10000
      });
      console.log('   ✅ Webhook endpoint is reachable');
    } catch (error) {
      console.log('   ⚠️  Warning: Could not reach webhook endpoint');
      console.log(`   Error: ${error.message}`);
      
      const continueAnswer = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'continue',
          message: 'Continue with configuration anyway?',
          default: true
        }
      ]);
      
      if (!continueAnswer.continue) {
        console.log('❌ Configuration cancelled');
        return;
      }
    }

    // Get existing assistants
    console.log('\n2️⃣ Fetching VAPI assistants...');
    const assistants = await vapiClient.assistants.list();
    console.log(`   Found ${assistants.length} assistants`);

    if (assistants.length === 0) {
      console.log('\n⚠️  No VAPI assistants found.');
      console.log('   Run "npm run create-agents --all" to create agent templates first.');
      return;
    }

    // Show current webhook configuration
    console.log('\n📋 Current webhook configuration:');
    assistants.forEach((assistant, index) => {
      const currentUrl = assistant.serverUrl || 'Not configured';
      const status = assistant.serverUrl === webhookUrl ? '✅' : '❌';
      console.log(`   ${status} ${index + 1}. "${assistant.name}": ${currentUrl}`);
    });

    // Ask which assistants to update
    const updateChoices = assistants.map((assistant, index) => ({
      name: `${assistant.name} (${assistant.serverUrl ? 'has webhook' : 'no webhook'})`,
      value: assistant.id,
      checked: !assistant.serverUrl || assistant.serverUrl !== webhookUrl
    }));

    const updateAnswer = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'assistantsToUpdate',
        message: 'Select assistants to configure with webhook URL:',
        choices: updateChoices,
        validate: (answer) => {
          if (answer.length === 0) {
            return 'Please select at least one assistant to update';
          }
          return true;
        }
      }
    ]);

    // Update selected assistants
    console.log('\n3️⃣ Updating assistants...');
    let successCount = 0;
    let errorCount = 0;

    for (const assistantId of updateAnswer.assistantsToUpdate) {
      const assistant = assistants.find(a => a.id === assistantId);
      console.log(`\n   Updating "${assistant.name}"...`);
      
      try {
        await vapiClient.assistants.update(assistantId, {
          serverUrl: webhookUrl
        });
        console.log('   ✅ Updated successfully');
        successCount++;
      } catch (updateError) {
        console.error(`   ❌ Failed to update: ${updateError.message}`);
        errorCount++;
      }
    }

    // Show results
    console.log('\n📊 Configuration Results:');
    console.log(`   ✅ Successfully updated: ${successCount} assistants`);
    if (errorCount > 0) {
      console.log(`   ❌ Failed to update: ${errorCount} assistants`);
    }

    // Verify configuration
    console.log('\n4️⃣ Verifying configuration...');
    const updatedAssistants = await vapiClient.assistants.list();
    
    console.log('\n📋 Final webhook configuration:');
    updatedAssistants.forEach((assistant, index) => {
      const currentUrl = assistant.serverUrl || 'Not configured';
      const status = assistant.serverUrl === webhookUrl ? '✅' : '❌';
      console.log(`   ${status} ${index + 1}. "${assistant.name}": ${currentUrl}`);
    });

    // Show next steps
    console.log('\n🎉 VAPI webhook configuration complete!');
    console.log('\n💡 What happens now:');
    console.log('   • VAPI will send webhooks to your endpoint when calls start/end');
    console.log('   • Your system will receive call.start and call.end events');
    console.log('   • Telegram upload tasks will be queued when calls end');
    console.log('   • Audio recordings will be sent to your Telegram channel');
    
    console.log('\n🧪 Test the configuration:');
    console.log('   1. Make a test VAPI call');
    console.log('   2. Check your server logs for webhook events');
    console.log('   3. Verify Telegram receives both notification and audio file');

    console.log('\n📚 Alternative configuration methods:');
    console.log('   • VAPI Dashboard: https://dashboard.vapi.ai/assistants');
    console.log('   • Organization-wide: https://dashboard.vapi.ai/vapi-api');
    console.log(`   • Webhook URL: ${webhookUrl}`);

  } catch (error) {
    console.error('❌ Error configuring VAPI webhooks:', error.message);
    
    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      console.error('\n💡 This usually means:');
      console.error('   • VAPI_API_KEY is invalid or expired');
      console.error('   • Check your API key in the VAPI dashboard');
    }
    
    process.exit(1);
  }
}

module.exports = {
  configureVapiWebhooks
};
