#!/usr/bin/env node

require('dotenv').config();
const { listVapiAssistants, findAgentForCompany, createVapiCall } = require('../src/vapi-service');

async function debugMicrosoftAgents() {
  console.log('🔍 Debugging Microsoft/IT Support Agent Issues...\n');

  try {
    // Step 1: List all assistants
    console.log('1. Fetching all VAPI assistants...');
    const assistants = await listVapiAssistants();
    console.log(`Found ${assistants.length} total assistants:`);
    
    assistants.forEach(a => {
      console.log(`  - ${a.name} (ID: ${a.id})`);
    });

    // Step 2: Look for Microsoft/IT support agents
    console.log('\n2. Filtering for Microsoft/IT Support agents...');
    const microsoftAgents = assistants.filter(a => {
      const name = a.name.toLowerCase();
      return name.includes('microsoft') || 
             name.includes('support') || 
             name.includes('it') ||
             name.includes('apple') ||
             name.includes('google');
    });

    if (microsoftAgents.length === 0) {
      console.log('❌ No Microsoft/IT support agents found!');
      console.log('\n💡 This is likely the issue. You need to create Microsoft agents first.');
      console.log('Run: node bin/create-agents.js --template microsoft');
    } else {
      console.log(`✅ Found ${microsoftAgents.length} Microsoft/IT support agents:`);
      microsoftAgents.forEach(a => {
        console.log(`  - ${a.name} (ID: ${a.id})`);
      });
    }

    // Step 3: Test agent selection for Microsoft
    console.log('\n3. Testing agent selection for Microsoft...');
    const selectedAgent = await findAgentForCompany('Microsoft', 'it_support');
    
    if (selectedAgent) {
      console.log(`✅ Agent selection works: ${selectedAgent.name} (ID: ${selectedAgent.id})`);
    } else {
      console.log('❌ Agent selection failed - no agent found for Microsoft');
    }

    // Step 4: Test with different company variations
    console.log('\n4. Testing agent selection with variations...');
    const testCompanies = ['microsoft', 'Microsoft', 'MICROSOFT', 'Microsoft Support'];
    
    for (const company of testCompanies) {
      const agent = await findAgentForCompany(company, 'it_support');
      console.log(`  ${company}: ${agent ? `✅ ${agent.name}` : '❌ No agent found'}`);
    }

    // Step 5: Test creating a Microsoft scam call (dry run)
    console.log('\n5. Testing Microsoft scam call creation (dry run)...');
    
    const testScamDetails = {
      itTerms: ['microsoft', 'support'],
      alertTerms: ['virus', 'security'],
      actionTerms: ['call', 'verify'],
      hasPhoneNumber: true,
      hasCallbackMention: true,
      llmAnalysis: {
        isScam: true,
        impersonatedCompany: 'Microsoft',
        scamType: 'it_support',
        confidence: 95,
        phoneNumber: '+15551234567' // Test number
      }
    };

    console.log('Test scam details:', JSON.stringify(testScamDetails, null, 2));

    // Don't actually create the call, just test the logic
    console.log('\n📋 Summary:');
    console.log(`- Total assistants: ${assistants.length}`);
    console.log(`- Microsoft/IT agents: ${microsoftAgents.length}`);
    console.log(`- Agent selection working: ${selectedAgent ? 'Yes' : 'No'}`);
    
    if (microsoftAgents.length === 0) {
      console.log('\n🚨 ISSUE IDENTIFIED: No Microsoft agents exist!');
      console.log('SOLUTION: Create Microsoft agents using:');
      console.log('  node bin/create-agents.js --template microsoft');
      console.log('  OR');
      console.log('  node bin/create-agents.js --all');
    }

  } catch (error) {
    console.error('❌ Error during debugging:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Run the debug function
debugMicrosoftAgents().catch(console.error);
