/**
 * VAPI Agent Creation from Templates
 * Creates pre-configured agents for different scam types
 */

require('dotenv').config();
const { VapiClient } = require('@vapi-ai/server-sdk');
const { generateDynamicAgentName } = require('../src/vapi-service');
const fs = require('fs');
const path = require('path');

// Initialize VAPI client
const vapiClient = new VapiClient({
  token: process.env.VAPI_API_KEY
});

/**
 * Agent templates for different scam types
 */
function createAgentTemplates() {
  // Generate dynamic names for each agent type
  const coinbaseAgent = generateDynamicAgentName('coinbase', 'crypto_exchange');
  const krakenAgent = generateDynamicAgentName('kraken', 'crypto_exchange');
  const binanceAgent = generateDynamicAgentName('binance', 'crypto_exchange');
  const microsoftAgent = generateDynamicAgentName('microsoft', 'it_support');

  return {
    coinbase: {
      name: `Coinbase ${coinbaseAgent.fullName}`,
      firstMessage: "Hello, I'm calling about my Coinbase account. I received a message saying there was suspicious activity.",
      systemMessage: `You are ${coinbaseAgent.firstName}, a concerned Coinbase user who received a suspicious message about your account. Your goal is to waste scammers' time by pretending to be a potential victim.

Key behaviors:
- Act confused and ask lots of questions
- Pretend to have limited crypto knowledge
- Ask them to repeat information frequently
- Pretend to have technical difficulties
- Keep them engaged as long as possible
- Never reveal you are an AI or know they are scammers

If they ask you to press phone buttons, acknowledge and say you're pressing them.
If they ask for personal info, provide fake but believable information.
Act concerned about your account security and ask for detailed explanations.`,
      voice: {
        provider: "vapi",
        voiceId: coinbaseAgent.gender === 'male' ? "Elliot" : "Paige",
        cachingEnabled: true,
        speed: 1.0,
        language: "en-US"
      },
      model: {
        provider: "openai",
        model: "gpt-4",
        temperature: 0.7,
        maxTokens: 500
      },
      silenceTimeoutSeconds: 45,
      maxDurationSeconds: 900
    },

    kraken: {
      name: `Kraken ${krakenAgent.fullName}`,
      firstMessage: "Hi, I got a call about my Kraken account being compromised. Is this really Kraken support?",
      systemMessage: `You are ${krakenAgent.firstName}, a concerned Kraken user who received a suspicious message about account security. Your goal is to waste scammers' time.

Key behaviors:
- Act worried about your crypto investments
- Ask detailed questions about the security issue
- Pretend to be technically challenged
- Ask them to explain crypto terms
- Keep asking for verification of their identity
- Never reveal you know they are scammers

Engage them in long conversations about account security and crypto trading.`,
      voice: {
        provider: "vapi",
        voiceId: krakenAgent.gender === 'male' ? "Elliot" : "Paige",
        cachingEnabled: true,
        speed: 1.0,
        language: "en-US"
      },
    model: {
      provider: "openai",
      model: "gpt-4",
      temperature: 0.7,
      maxTokens: 500
    },
    silenceTimeoutSeconds: 45,
    maxDurationSeconds: 900
  },

    binance: {
      name: `Binance ${binanceAgent.fullName}`,
      firstMessage: "Hello? I received a message about my Binance account. Something about unauthorized access?",
      systemMessage: `You are ${binanceAgent.firstName}, a Binance user concerned about account security. Waste scammers' time by acting like a confused victim.

Key behaviors:
- Act panicked about potential account compromise
- Ask many questions about the security process
- Pretend to have trouble with technology
- Ask them to walk you through everything step by step
- Express confusion about crypto terminology
- Keep them on the line as long as possible

Never reveal you are an AI or that you know they are scammers.`,
      voice: {
        provider: "vapi",
        voiceId: binanceAgent.gender === 'male' ? "Elliot" : "Hana",
        cachingEnabled: true,
        speed: 1.0,
        language: "en-US"
      },
    model: {
      provider: "openai",
      model: "gpt-4",
      temperature: 0.7,
      maxTokens: 500
    },
    silenceTimeoutSeconds: 45,
    maxDurationSeconds: 900
  },

    microsoft: {
      name: `Microsoft ${microsoftAgent.fullName}`,
      firstMessage: "Hello, I got a call saying my computer has a virus. Is this really Microsoft?",
      systemMessage: `You are ${microsoftAgent.firstName}, a concerned computer user who received a message about computer problems. Waste IT support scammers' time.

Key behaviors:
- Act worried about computer security
- Pretend to be not tech-savvy
- Ask lots of questions about the computer problem
- Pretend to have trouble following technical instructions
- Ask them to repeat things multiple times
- Express confusion about computer terms

Keep them engaged by acting like a confused but cooperative victim.`,
      voice: {
        provider: "vapi",
        voiceId: microsoftAgent.gender === 'male' ? "Rohan" : "Paige",
        cachingEnabled: true,
        speed: 1.0,
        language: "en-US"
      },
    model: {
      provider: "openai",
      model: "gpt-4",
      temperature: 0.7,
      maxTokens: 500
    },
      silenceTimeoutSeconds: 45,
      maxDurationSeconds: 900
    }
  };
}

/**
 * Create VAPI agents from templates
 */
async function createAgents(options = {}) {
  console.log('🤖 Creating VAPI agents from templates...\n');

  // Generate fresh templates with dynamic names
  const AGENT_TEMPLATES = createAgentTemplates();

  const templatesToCreate = options.template
    ? [options.template]
    : options.all
    ? Object.keys(AGENT_TEMPLATES)
    : [];

  if (templatesToCreate.length === 0) {
    console.log('❌ No templates specified. Use --template <name> or --all');
    return;
  }

  const results = [];

  for (const templateName of templatesToCreate) {
    const template = AGENT_TEMPLATES[templateName];
    
    if (!template) {
      console.log(`❌ Template '${templateName}' not found`);
      continue;
    }

    try {
      console.log(`Creating agent: ${template.name}...`);
      
      const agent = await vapiClient.assistants.create({
        name: template.name,
        firstMessage: template.firstMessage,
        model: {
          provider: template.model.provider,
          model: template.model.model,
          temperature: template.model.temperature,
          maxTokens: template.model.maxTokens,
          messages: [
            {
              role: "system",
              content: template.systemMessage
            }
          ]
        },
        voice: template.voice,
        silenceTimeoutSeconds: template.silenceTimeoutSeconds,
        maxDurationSeconds: template.maxDurationSeconds,
        backgroundSound: "office",
        backchannelingEnabled: true,
        backgroundDenoisingEnabled: true,
        modelOutputInMessagesEnabled: true
      });

      console.log(`✅ Created agent: ${template.name} (ID: ${agent.id})`);
      results.push({
        template: templateName,
        name: template.name,
        id: agent.id,
        success: true
      });

    } catch (error) {
      console.log(`❌ Failed to create agent ${template.name}: ${error.message}`);
      results.push({
        template: templateName,
        name: template.name,
        error: error.message,
        success: false
      });
    }
  }

  // Save agent IDs to a config file
  const configPath = path.join(process.cwd(), 'agent-config.json');
  const config = {};
  
  results.forEach(result => {
    if (result.success) {
      config[result.template] = result.id;
    }
  });

  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`\n📝 Agent configuration saved to ${configPath}`);
  } catch (error) {
    console.log(`⚠️  Could not save agent configuration: ${error.message}`);
  }

  // Summary
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log('\n📊 Agent Creation Summary:');
  console.log('='.repeat(40));
  console.log(`✅ Successfully created: ${successful} agents`);
  console.log(`❌ Failed to create: ${failed} agents`);

  if (successful > 0) {
    console.log('\n🎉 Agents created successfully!');
    console.log('You can now start the honeypot server and begin detecting scams.');
    console.log('\nNext steps:');
    console.log('1. Start the server: npm start');
    console.log('2. Configure Twilio webhooks');
    console.log('3. Test with a scam call to your Twilio number');
  }

  return results;
}

module.exports = {
  createAgents,
  createAgentTemplates
};
