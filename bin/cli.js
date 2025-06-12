#!/usr/bin/env node

/**
 * SIPSentinel CLI
 * Command line interface for managing the SIPSentinel scam detection system
 */

const { Command } = require('commander');
const path = require('path');
const fs = require('fs');

// Set up the CLI program
const program = new Command();

program
  .name('sipsentinel')
  .description('SIPSentinel - Scam Detection and Response System')
  .version('1.0.0');

// Global options
program
  .option('--web-ui', 'Start with web dashboard UI (default)')
  .option('--headless', 'Run in headless mode (webhooks only, no UI)')
  .option('--port <port>', 'Port to run the server on', '3000')
  .option('--env <file>', 'Path to environment file', '.env');

// Setup command
program
  .command('setup')
  .description('Interactive setup wizard for first-time configuration')
  .action(async () => {
    console.log('🚀 Starting SIPSentinel setup wizard...');
    try {
      const setupModule = require('./setup.js');
      await setupModule.runSetupWizard();
    } catch (error) {
      console.error('❌ Setup failed:', error.message);
      process.exit(1);
    }
  });

// Validate command
program
  .command('validate')
  .description('Validate environment configuration and service connectivity')
  .action(async () => {
    console.log('🔍 Validating environment configuration...');
    try {
      const validateModule = require('./validate.js');
      await validateModule.validateEnvironment();
    } catch (error) {
      console.error('❌ Validation failed:', error.message);
      process.exit(1);
    }
  });

// Create agents command
program
  .command('create-agents')
  .description('Create VAPI agents from templates')
  .option('--template <name>', 'Specific template to create (coinbase, kraken, binance, etc.)')
  .option('--all', 'Create all available agent templates')
  .action(async (options) => {
    console.log('🤖 Creating VAPI agents...');
    try {
      const agentModule = require('./create-agents.js');
      await agentModule.createAgents(options);
    } catch (error) {
      console.error('❌ Agent creation failed:', error.message);
      process.exit(1);
    }
  });

// Configure VAPI webhooks command
program
  .command('configure-vapi')
  .description('Configure VAPI webhook URLs for Telegram audio uploads')
  .option('--url <url>', 'Custom webhook URL (defaults to production URL)')
  .action(async (options) => {
    console.log('🔗 Configuring VAPI webhook URLs...');
    try {
      const vapiModule = require('./configure-vapi.js');
      await vapiModule.configureVapiWebhooks(options);
    } catch (error) {
      console.error('❌ VAPI configuration failed:', error.message);
      process.exit(1);
    }
  });

// Start command (default)
program
  .command('start', { isDefault: true })
  .description('Start the SIPSentinel server')
  .action(async () => {
    const options = program.opts();
    
    // Load environment variables
    const envPath = path.resolve(options.env);
    if (fs.existsSync(envPath)) {
      require('dotenv').config({ path: envPath });
    } else {
      require('dotenv').config();
    }

    // Set runtime mode based on flags
    if (options.headless) {
      process.env.SIPSENTINEL_MODE = 'headless';
      console.log('🔧 Starting in headless mode (webhooks only)...');
    } else {
      process.env.SIPSENTINEL_MODE = 'web-ui';
      console.log('🌐 Starting with web dashboard UI...');
    }

    // Set port
    process.env.PORT = options.port;

    // Start the main application
    try {
      require('../src/index.js');
    } catch (error) {
      console.error('❌ Failed to start server:', error.message);
      process.exit(1);
    }
  });

// Help command
program
  .command('help')
  .description('Show detailed help and setup instructions')
  .action(() => {
    console.log(`
🎯 SIPSentinel - Scam Detection and Response System

QUICK START:
1. Run setup wizard:     npm run setup
2. Validate config:      npm run validate
3. Create agents:        npm run create-agents --all
4. Configure webhooks:   npm run configure-vapi
5. Start with UI:        npm start
6. Start headless:       npm run headless

COMMANDS:
  setup                  Interactive setup wizard
  validate              Validate environment and services
  create-agents         Create VAPI agents from templates
  configure-vapi        Configure VAPI webhook URLs for Telegram uploads
  start                 Start the server (default command)
  help                  Show this help message

OPTIONS:
  --web-ui              Start with web dashboard (default)
  --headless            Run webhooks only, no UI
  --port <port>         Server port (default: 3000)
  --env <file>          Environment file path (default: .env)

EXAMPLES:
  sipsentinel setup                    # Run setup wizard
  sipsentinel validate                 # Check configuration
  sipsentinel create-agents --all      # Create all agent templates
  sipsentinel start --web-ui           # Start with dashboard
  sipsentinel start --headless         # Start without UI
  sipsentinel --port 8080              # Start on port 8080

ENVIRONMENT VARIABLES:
  TWILIO_ACCOUNT_SID     Twilio account SID
  TWILIO_AUTH_TOKEN      Twilio auth token
  TWILIO_PHONE_NUMBER    Twilio honeypot phone number (displayed prominently)
  VAPI_API_KEY          VAPI API key
  OPENROUTER_API_KEY    OpenRouter API key for LLM
  AWS_ACCESS_KEY_ID     AWS access key
  AWS_SECRET_ACCESS_KEY AWS secret key
  AWS_REGION            AWS region (default: us-west-2)

For more information, visit: https://github.com/your-repo/sipsentinel
    `);
  });

// Parse command line arguments
program.parse();
