/**
 * Interactive Setup Wizard for SIPSentinel
 * Guides users through initial configuration
 */

const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');

/**
 * Run the interactive setup wizard
 */
async function runSetupWizard() {
  console.log(`
🎯 Welcome to SIPSentinel Setup Wizard!

This wizard will help you configure your scam detection and response system.
You'll need accounts with:
- Twilio (for phone numbers and webhooks)
- VAPI (for AI agents)
- OpenRouter (for LLM scam detection)
- AWS (for storage and transcription)

Let's get started!
  `);

  const answers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'hasAccounts',
      message: 'Do you have accounts set up with Twilio, VAPI, OpenRouter, and AWS?',
      default: false
    }
  ]);

  if (!answers.hasAccounts) {
    console.log(`
📋 Please create accounts with the following services:

1. Twilio (https://twilio.com)
   - Sign up for a free account
   - Get a phone number with voice and SMS capabilities
   - Note your Account SID and Auth Token

2. VAPI (https://vapi.ai)
   - Sign up for an account
   - Get your API key from the dashboard
   - Optionally create custom agents

3. OpenRouter (https://openrouter.ai)
   - Sign up for an account
   - Get your API key
   - Add credits for LLM usage

4. AWS (https://aws.amazon.com)
   - Create an AWS account
   - Create an IAM user with S3 and Transcribe permissions
   - Note your access key and secret key

Once you have these accounts, run the setup wizard again.
    `);
    return;
  }

  // Collect configuration
  const config = await inquirer.prompt([
    {
      type: 'input',
      name: 'TWILIO_ACCOUNT_SID',
      message: 'Enter your Twilio Account SID:',
      validate: (input) => input.length > 0 || 'Account SID is required'
    },
    {
      type: 'password',
      name: 'TWILIO_AUTH_TOKEN',
      message: 'Enter your Twilio Auth Token:',
      validate: (input) => input.length > 0 || 'Auth Token is required'
    },
    {
      type: 'input',
      name: 'TWILIO_PHONE_NUMBER',
      message: 'Enter your Twilio phone number (with +1):',
      validate: (input) => {
        if (!input.startsWith('+')) {
          return 'Phone number must start with + (e.g., +15551234567)';
        }
        return true;
      }
    },
    {
      type: 'password',
      name: 'VAPI_API_KEY',
      message: 'Enter your VAPI API key:',
      validate: (input) => input.length > 0 || 'VAPI API key is required'
    },
    {
      type: 'password',
      name: 'OPENROUTER_API_KEY',
      message: 'Enter your OpenRouter API key:',
      validate: (input) => input.length > 0 || 'OpenRouter API key is required'
    },
    {
      type: 'input',
      name: 'AWS_ACCESS_KEY_ID',
      message: 'Enter your AWS Access Key ID:',
      validate: (input) => input.length > 0 || 'AWS Access Key ID is required'
    },
    {
      type: 'password',
      name: 'AWS_SECRET_ACCESS_KEY',
      message: 'Enter your AWS Secret Access Key:',
      validate: (input) => input.length > 0 || 'AWS Secret Access Key is required'
    },
    {
      type: 'list',
      name: 'AWS_REGION',
      message: 'Select your AWS region:',
      choices: [
        'us-east-1',
        'us-west-1', 
        'us-west-2',
        'eu-west-1',
        'eu-central-1',
        'ap-southeast-1',
        'ap-northeast-1'
      ],
      default: 'us-west-2'
    },
    {
      type: 'input',
      name: 'PORT',
      message: 'Enter the port to run the server on:',
      default: '3000'
    }
  ]);

  // Ask about optional integrations
  console.log('\n📱 Optional Integrations');
  console.log('Configure notification channels to receive alerts when scams are detected:');

  const optionalConfig = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'setupSlack',
      message: 'Would you like to configure Slack notifications?',
      default: false
    },
    {
      type: 'input',
      name: 'SLACK_WEBHOOK_URL',
      message: 'Enter your Slack webhook URL:',
      when: (answers) => answers.setupSlack,
      validate: (input) => {
        if (!input.startsWith('https://hooks.slack.com/')) {
          return 'Please enter a valid Slack webhook URL';
        }
        return true;
      }
    },
    {
      type: 'confirm',
      name: 'setupTelegram',
      message: 'Would you like to configure Telegram notifications?',
      default: false
    },
    {
      type: 'input',
      name: 'TELEGRAM_BOT_TOKEN',
      message: 'Enter your Telegram bot token (from @BotFather):',
      when: (answers) => answers.setupTelegram,
      validate: (input) => {
        if (!input.includes(':')) {
          return 'Please enter a valid Telegram bot token (format: 123456789:ABC...)';
        }
        return true;
      }
    },
    {
      type: 'input',
      name: 'TELEGRAM_CHAT_ID',
      message: 'Enter your Telegram chat ID (user/group/channel ID):',
      when: (answers) => answers.setupTelegram,
      validate: (input) => {
        if (!input || input.length === 0) {
          return 'Please enter a valid Telegram chat ID';
        }
        return true;
      }
    }
  ]);

  // Merge configurations
  const allConfig = { ...config, ...optionalConfig };

  // Remove setup flags from the final config
  delete allConfig.setupSlack;
  delete allConfig.setupTelegram;

  // Create .env file
  const envContent = Object.entries(allConfig)
    .filter(([key, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const envPath = path.join(process.cwd(), '.env');
  
  try {
    fs.writeFileSync(envPath, envContent);
    console.log(`✅ Environment configuration saved to ${envPath}`);
  } catch (error) {
    console.error('❌ Failed to save environment file:', error.message);
    return;
  }

  // Ask about next steps
  const nextSteps = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'validateNow',
      message: 'Would you like to validate your configuration now?',
      default: true
    },
    {
      type: 'confirm',
      name: 'createAgents',
      message: 'Would you like to create VAPI agents from templates?',
      default: true
    }
  ]);

  if (nextSteps.validateNow) {
    console.log('\n🔍 Validating configuration...');
    try {
      const validateModule = require('./validate.js');
      await validateModule.validateEnvironment();
    } catch (error) {
      console.error('❌ Validation failed:', error.message);
    }
  }

  if (nextSteps.createAgents) {
    console.log('\n🤖 Creating VAPI agents...');
    try {
      const agentModule = require('./create-agents.js');
      await agentModule.createAgents({ all: true });

      // Ask about configuring VAPI webhooks
      const webhookAnswer = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'configureWebhooks',
          message: 'Would you like to configure VAPI webhooks for Telegram audio uploads?',
          default: true
        }
      ]);

      if (webhookAnswer.configureWebhooks) {
        console.log('\n🔗 Configuring VAPI webhooks...');
        try {
          const vapiModule = require('./configure-vapi.js');
          await vapiModule.configureVapiWebhooks();
        } catch (error) {
          console.error('❌ VAPI webhook configuration failed:', error.message);
          console.log('💡 You can configure this later with: npm run configure-vapi');
        }
      }

    } catch (error) {
      console.error('❌ Agent creation failed:', error.message);
    }
  }

  console.log(`
🎉 Setup complete!

Next steps:
1. Configure Twilio webhooks in your Twilio console
2. Test your setup with: npm run validate
3. Start the server with: npm start

For webhook URLs, use:
- Voice: https://your-domain.com/voice
- SMS: https://your-domain.com/sms
- Recording Status: https://your-domain.com/recording-status
- Transcription: https://your-domain.com/transcription

${allConfig.SLACK_WEBHOOK_URL ? '✅ Slack notifications configured' : ''}
${allConfig.TELEGRAM_BOT_TOKEN ? '✅ Telegram notifications configured' : ''}

Test your notification channels:
- Slack: curl -X POST http://localhost:3000/slack/test
- Telegram: curl -X POST http://localhost:3000/telegram/test

Happy scam hunting! 🕵️‍♂️
  `);
}

module.exports = {
  runSetupWizard
};
