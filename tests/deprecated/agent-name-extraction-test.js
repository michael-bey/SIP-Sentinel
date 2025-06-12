#!/usr/bin/env node

/**
 * Test agent name extraction logic
 */

// Import the function we need to test
// Since it's defined in queue-worker.js, we'll copy it here for testing
function extractAgentName(assistantName, company) {
  if (!assistantName) return 'Unknown Agent';
  
  // Handle new format: "Coinbase Jim" -> "Coinbase Jim"
  // But not if it has more than 2 words (like "Kraken Karen Wilson")
  if (assistantName.includes(' ') && !assistantName.includes('User') && !assistantName.includes('Support Call')) {
    const words = assistantName.split(' ');
    if (words.length === 2) {
      return assistantName;
    }
  }
  
  // Handle old format: "Coinbase User Jim Smith" -> "Coinbase Jim"
  if (assistantName.includes('User ')) {
    const parts = assistantName.split('User ');
    if (parts.length > 1) {
      const companyPart = parts[0].trim();
      const namePart = parts[1].split(' ')[0]; // Get first name only
      return `${companyPart} ${namePart}`;
    }
  }
  
  // Handle IT support format: "Microsoft Support Call - Mike Johnson" -> "Microsoft Mike"
  if (assistantName.includes('Support Call - ')) {
    const parts = assistantName.split('Support Call - ');
    if (parts.length > 1) {
      const companyPart = parts[0].trim();
      const namePart = parts[1].split(' ')[0]; // Get first name only
      return `${companyPart} ${namePart}`;
    }
  }
  
  // Handle generic format: "Generic Alex" -> "Generic Alex"
  if (assistantName.startsWith('Generic ')) {
    return assistantName;
  }
  
  // Fallback: try to extract company + first name
  if (company && assistantName.toLowerCase().includes(company.toLowerCase())) {
    // For names like "Kraken Karen Wilson", extract the first name after company
    const words = assistantName.split(' ');
    const companyIndex = words.findIndex(word => word.toLowerCase() === company.toLowerCase());
    if (companyIndex >= 0 && companyIndex + 1 < words.length) {
      const firstName = words[companyIndex + 1];
      return `${company} ${firstName}`;
    }
    // If company is not a separate word, extract first name from the end
    const firstName = words[words.length - 1];
    return `${company} ${firstName}`;
  }
  
  return assistantName;
}

function testAgentNameExtraction() {
  console.log('🧪 Testing Agent Name Extraction...\n');

  const testCases = [
    {
      input: { assistantName: 'Coinbase Jim', company: 'Coinbase' },
      expected: 'Coinbase Jim',
      description: 'New format - already clean'
    },
    {
      input: { assistantName: 'Coinbase User Jim Smith', company: 'Coinbase' },
      expected: 'Coinbase Jim',
      description: 'Old format - with User'
    },
    {
      input: { assistantName: 'Microsoft Support Call - Mike Johnson', company: 'Microsoft' },
      expected: 'Microsoft Mike',
      description: 'IT support format'
    },
    {
      input: { assistantName: 'Generic Alex', company: 'Unknown' },
      expected: 'Generic Alex',
      description: 'Generic format'
    },
    {
      input: { assistantName: 'Kraken Karen Wilson', company: 'Kraken' },
      expected: 'Kraken Karen',
      description: 'Fallback extraction'
    },
    {
      input: { assistantName: '', company: 'Coinbase' },
      expected: 'Unknown Agent',
      description: 'Empty assistant name'
    },
    {
      input: { assistantName: 'Some Random Name', company: 'Coinbase' },
      expected: 'Some Random Name',
      description: 'Unrecognized format - return as-is'
    }
  ];

  let passedTests = 0;
  let totalTests = testCases.length;

  for (const testCase of testCases) {
    const result = extractAgentName(testCase.input.assistantName, testCase.input.company);
    const passed = result === testCase.expected;
    
    console.log(`📋 ${testCase.description}`);
    console.log(`   Input: "${testCase.input.assistantName}" + "${testCase.input.company}"`);
    console.log(`   Expected: "${testCase.expected}"`);
    console.log(`   Got: "${result}"`);
    console.log(`   ${passed ? '✅ PASS' : '❌ FAIL'}`);
    console.log('');
    
    if (passed) passedTests++;
  }

  console.log(`📊 Test Results: ${passedTests}/${totalTests} tests passed`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All tests passed!');
    return true;
  } else {
    console.log('❌ Some tests failed');
    return false;
  }
}

// Run the test
if (require.main === module) {
  testAgentNameExtraction();
}

module.exports = { extractAgentName, testAgentNameExtraction };
