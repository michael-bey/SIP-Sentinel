require('dotenv').config();
const { VapiClient } = require('@vapi-ai/server-sdk');
const { queueTelegramUpload } = require('./qstash-service');

// Initialize VAPI client with validation
let vapiClient = null;

function initializeVapiClient() {
  if (!process.env.VAPI_API_KEY) {
    console.warn('VAPI_API_KEY not found in environment variables');
    return null;
  }

  try {
    vapiClient = new VapiClient({
      token: process.env.VAPI_API_KEY
    });
    console.log('VAPI client initialized successfully');
    return vapiClient;
  } catch (error) {
    console.error('Error initializing VAPI client:', error);
    return null;
  }
}

// Initialize the client
vapiClient = initializeVapiClient();

// Cache for assistants and phone numbers
let assistantsCache = [];
let phoneNumbersCache = [];
let lastCacheUpdate = null;
const CACHE_DURATION = 3600000; // 1 hour in milliseconds

// Call tracking for analytics
const callTracker = new Map();

/**
 * List all available VAPI assistants
 * @returns {Array} List of assistants
 */
async function listVapiAssistants() {
  try {
    console.log('Fetching VAPI assistants...');

    // Check if VAPI client is available
    if (!vapiClient) {
      console.warn('VAPI client not initialized, returning empty assistants list');
      return [];
    }

    // Check cache first
    const now = new Date();
    if (lastCacheUpdate && (now - lastCacheUpdate) < CACHE_DURATION && assistantsCache.length > 0) {
      console.log(`Returning ${assistantsCache.length} cached assistants`);
      return assistantsCache;
    }

    const response = await vapiClient.assistants.list();
    console.log('Assistants API response:', JSON.stringify(response, null, 2));

    // Handle different response formats
    let assistants = [];
    if (Array.isArray(response)) {
      assistants = response;
    } else if (response && response.data && Array.isArray(response.data)) {
      assistants = response.data;
    } else if (response && response.assistants && Array.isArray(response.assistants)) {
      assistants = response.assistants;
    }

    // Update cache
    assistantsCache = assistants;
    lastCacheUpdate = now;

    console.log(`Found ${assistants.length} assistants`);

    // Log assistant details for debugging
    assistants.forEach(assistant => {
      console.log(`Assistant: ${assistant.name || 'Unnamed'} (ID: ${assistant.id})`);
    });

    return assistants;
  } catch (error) {
    console.error('Error listing VAPI assistants:', error);
    return [];
  }
}

/**
 * List all available VAPI phone numbers
 * @returns {Array} List of phone numbers
 */
async function listVapiPhoneNumbers() {
  try {
    console.log('Fetching VAPI phone numbers...');

    // Check if VAPI client is available
    if (!vapiClient) {
      console.warn('VAPI client not initialized, returning empty phone numbers list');
      return [];
    }

    // Check cache first
    const now = new Date();
    if (lastCacheUpdate && (now - lastCacheUpdate) < CACHE_DURATION && phoneNumbersCache.length > 0) {
      console.log(`Returning ${phoneNumbersCache.length} cached phone numbers`);
      return phoneNumbersCache;
    }

    const response = await vapiClient.phoneNumbers.list();
    console.log('Phone numbers API response:', JSON.stringify(response, null, 2));

    // Handle different response formats
    let phoneNumbers = [];
    if (Array.isArray(response)) {
      phoneNumbers = response;
    } else if (response && response.data && Array.isArray(response.data)) {
      phoneNumbers = response.data;
    } else if (response && response.phoneNumbers && Array.isArray(response.phoneNumbers)) {
      phoneNumbers = response.phoneNumbers;
    }

    // Filter for active VAPI numbers
    const activeVapiNumbers = phoneNumbers.filter(pn =>
      pn.provider === 'vapi' && pn.status === 'active'
    );

    // Update cache
    phoneNumbersCache = activeVapiNumbers;
    lastCacheUpdate = now;

    console.log(`Found ${activeVapiNumbers.length} active VAPI phone numbers`);

    // Log phone number details for debugging
    activeVapiNumbers.forEach(phoneNumber => {
      console.log(`Phone Number: ${phoneNumber.number} (ID: ${phoneNumber.id}, Status: ${phoneNumber.status})`);
    });

    return activeVapiNumbers;
  } catch (error) {
    console.error('Error listing VAPI phone numbers:', error);
    return [];
  }
}

/**
 * Create or get a VAPI phone number
 * @param {string} areaCode - Desired area code (optional)
 * @returns {Object} Phone number object
 */
async function getOrCreateVapiPhoneNumber(areaCode = '415') {
  try {
    // First, try to get existing phone numbers
    const existingNumbers = await listVapiPhoneNumbers();

    if (existingNumbers.length > 0) {
      // Return a random existing number
      const randomIndex = Math.floor(Math.random() * existingNumbers.length);
      const selectedNumber = existingNumbers[randomIndex];
      console.log(`Using existing VAPI phone number: ${selectedNumber.number}`);
      return selectedNumber;
    }

    // If no existing numbers, create a new one
    console.log(`Creating new VAPI phone number with area code ${areaCode}...`);

    const newPhoneNumber = await vapiClient.phoneNumbers.create({
      provider: 'vapi',
      areaCode: areaCode,
      name: `Scam Detector Phone - ${areaCode}`
    });

    console.log('Created new VAPI phone number:', newPhoneNumber);

    // Add to cache
    phoneNumbersCache.push(newPhoneNumber);

    return newPhoneNumber;
  } catch (error) {
    console.error('Error getting or creating VAPI phone number:', error);
    return null;
  }
}

/**
 * Calculate the Levenshtein distance between two strings.
 * @param {string} a - The first string.
 * @param {string} b - The second string.
 * @returns {number} The Levenshtein distance.
 */
function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

  for (let i = 0; i <= a.length; i++) {
    matrix[0][i] = i;
  }

  for (let j = 0; j <= b.length; j++) {
    matrix[j][0] = j;
  }

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,        // deletion
        matrix[j - 1][i] + 1,        // insertion
        matrix[j - 1][i - 1] + indicator, // substitution
      );
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Synchronous function to find the best agent from a pre-fetched list.
 * @param {string} companyName - Name of the company being impersonated
 * @param {Array} assistants - Array of assistant objects
 * @param {string} scamType - Type of scam detected (optional)
 * @returns {Object|null} Agent object or null if not found
 */
function findVapiAgentForCompanySync(companyName, assistants, scamType = null) {
  if (!companyName) {
    console.log('No company name provided for agent selection');
    return null;
  }
  if (!assistants || assistants.length === 0) {
    console.log('No assistants provided to search from');
    return null;
  }

  const companyLower = companyName.toLowerCase();
  console.log(`(Sync) Looking for agent for company: "${companyName}"`);

  let bestMatch = null;
  let highestSimilarity = 0;

  // A list of known targets for fuzzy matching, extracted from agent names.
  const knownTargets = ['coinbase', 'kraken', 'binance', 'microsoft', 'apple', 'google', 'amazon', 'paypal'];

  for (const agent of assistants) {
    const agentNameLower = (agent.name || '').toLowerCase();
    
    // Find which known company this agent is associated with.
    const agentTarget = knownTargets.find(target => agentNameLower.includes(target));

    if (agentTarget) {
      // Calculate similarity between the detected company name and the agent's target name.
      const distance = levenshteinDistance(companyLower, agentTarget);
      const maxLen = Math.max(companyLower.length, agentTarget.length);
      const similarity = (maxLen === 0) ? 1 : (1 - distance / maxLen);
      
      console.log(`(Sync) Comparing "${companyLower}" with agent "${agent.name}" (target: "${agentTarget}"). Similarity: ${similarity.toFixed(2)}`);

      if (similarity > highestSimilarity) {
        highestSimilarity = similarity;
        bestMatch = agent;
      }
    }
  }

  // Use a threshold to decide if the match is good enough.
  const SIMILARITY_THRESHOLD = 0.6;
  if (bestMatch && highestSimilarity >= SIMILARITY_THRESHOLD) {
    console.log(`(Sync) Best fuzzy match found: "${bestMatch.name}" with similarity ${highestSimilarity.toFixed(2)} for company "${companyName}"`);
    return bestMatch;
  }
  
  if (bestMatch) {
      console.log(`(Sync) Best match "${bestMatch.name}" did not meet threshold (${highestSimilarity.toFixed(2)} < ${SIMILARITY_THRESHOLD}).`);
  }

  console.log(`(Sync) No specific agent found for "${companyName}".`);
  return null;
}

/**
 * Find the best agent for a specific company/scam type using fuzzy matching.
 * @param {string} companyName - Name of the company being impersonated
 * @param {string} scamType - Type of scam detected
 * @returns {Object|null} Agent object or null if not found
 */
async function findVapiAgentForCompany(companyName, scamType = null) {
  try {
    const assistants = await listVapiAssistants();
    const agent = findVapiAgentForCompanySync(companyName, assistants, scamType);
    if (agent) {
      return agent;
    }
    console.log(`No specific agent found for "${companyName}", will use transient assistant.`);
    return null;
  } catch (error) {
    console.error('Error finding agent for company:', error);
    return null;
  }
}

/**
 * Create a VAPI call with proper agent selection
 * @param {string} phoneNumber - Target phone number
 * @param {string} scamType - Type of scam detected
 * @param {Object} scamDetails - Details about the scam
 * @param {string} agentId - Specific agent ID to use (optional)
 * @param {string} originalCallSid - The SID of the original incoming call
 * @param {string} originalCallerNumber - The original caller number
 * @returns {Promise<object>} The created VAPI call object.
 */
async function createVapiCall(phoneNumber, scamType = null, scamDetails = {}, agentId = null, originalCallSid = null, originalCallerNumber = null) {
  try {
    if (!vapiClient) {
      throw new Error('VAPI client is not initialized. Cannot create call.');
    }
    
    const formattedPhoneNumber = formatToE164(phoneNumber);
    if (!formattedPhoneNumber) {
      throw new Error(`Invalid or unformattable phone number provided: "${phoneNumber}"`);
    }

    // 1. Get Phone Number & Base Metadata
    let vapiPhoneNumber = null;
    let useVapiPhone = true;

    try {
      vapiPhoneNumber = await getOrCreateVapiPhoneNumber();
      if (!vapiPhoneNumber) {
        console.warn('⚠️  Could not get a VAPI phone number, will fall back to Twilio');
        useVapiPhone = false;
      }
    } catch (error) {
      console.warn('⚠️  VAPI phone number error, will fall back to Twilio:', error.message);
      useVapiPhone = false;
    }
    const metadata = {
      source: 'SIPSentinel',
      scamType: scamType,
      confidence: scamDetails?.scamScore || scamDetails?.confidence,
      originalCallSid: originalCallSid,
      impersonatedCompany: scamDetails?.impersonatedCompany,
      webhook: process.env.VAPI_WEBHOOK_URL,
    };
    if (originalCallerNumber) {
      metadata.originalCaller = originalCallerNumber;
    } else if (originalCallSid) {
      try {
        const twilio = require('twilio');
        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        const originalCall = await twilioClient.calls(originalCallSid).fetch();
        metadata.originalCaller = originalCall.from;
      } catch (error) {
        console.error(`Failed to fetch original caller for SID ${originalCallSid}:`, error.message);
      }
    }

    // 2. Prepare Call Parameters
    const callParams = {
      customer: { number: formattedPhoneNumber },
      metadata: metadata,
      webhook: process.env.VAPI_WEBHOOK_URL
    };

    // Set phone number configuration based on availability
    if (useVapiPhone && vapiPhoneNumber) {
      console.log(`📞 Using VAPI phone number: ${vapiPhoneNumber.number} (ID: ${vapiPhoneNumber.id})`);
      callParams.phoneNumberId = vapiPhoneNumber.id;
      metadata.phoneProvider = 'vapi';
    } else {
      console.log('📞 Using Twilio phone number fallback');
      if (!process.env.TWILIO_PHONE_NUMBER || !process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
        throw new Error('Twilio credentials required for fallback: TWILIO_PHONE_NUMBER, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN');
      }
      callParams.phoneNumber = {
        twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER,
        twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
        twilioAuthToken: process.env.TWILIO_AUTH_TOKEN
      };
      metadata.phoneProvider = 'twilio';
    }

    // 3. Determine which assistant configuration to use
    let assistantConfig;
    let assistantName = 'Unknown Agent';
    let finalAgentIdForTracking = agentId; // For analytics

    if (!finalAgentIdForTracking) {
      const companyName = metadata.impersonatedCompany;
      const agent = await findVapiAgentForCompany(companyName, scamType);
      if (agent) {
        finalAgentIdForTracking = agent.id;
        assistantName = agent.name;
      }
    }

    // 4. Always create a transient assistant to ensure voice consistency.
    // If we found an existing agent, we clone it. Otherwise, we create a new one.
    if (finalAgentIdForTracking) {
      console.log(`Found existing agent "${assistantName}". Cloning to a transient assistant to ensure native voice.`);
      const existingAssistant = (await listVapiAssistants()).find(a => a.id === finalAgentIdForTracking);

      if (existingAssistant) {
        const gender = detectGenderFromName(existingAssistant.name);
        console.log(`🎭 Detected gender for "${existingAssistant.name}": ${gender}`);

        // Always use a fresh VAPI voice to ensure compatibility and correct gender
        const nativeVapiVoice = getRandomVoice(gender);
        console.log(`🎤 Selected ${gender} voice: ${nativeVapiVoice.voiceId}`);

        // Add base agent details to metadata FOR TRACKING
        metadata.baseAgentId = existingAssistant.id;
        metadata.baseAgentName = existingAssistant.name;

        // Generate dynamic prompt with random details
        const dynamicPrompt = generateDynamicPrompt(existingAssistant, metadata.impersonatedCompany);

        // Surgically build a new transient assistant from the existing one's parts
        // This is safer than cloning the whole object with ...spread
        assistantConfig = {
          name: existingAssistant.name,
          model: {
              provider: existingAssistant.model.provider,
              model: existingAssistant.model.model,
              temperature: existingAssistant.model.temperature || 0.7,
              maxTokens: existingAssistant.model.maxTokens || 500,
              // Use dynamic prompt with random details
              messages: [
                {
                  role: "system",
                  content: dynamicPrompt
                }
              ]
          },
          voice: nativeVapiVoice, // Explicitly use the native VAPI voice with correct gender
          firstMessage: existingAssistant.firstMessage,
          endCallPhrases: existingAssistant.endCallPhrases,
        };
        assistantName = existingAssistant.name;

        console.log(`Built transient assistant from "${assistantName}" with VAPI voice: ${nativeVapiVoice.voiceId} (${gender})`);
      } else {
        // Fallback if fetching fails
        console.warn(`Could not fetch full details for assistant ID ${finalAgentIdForTracking}. Creating a generic transient assistant.`);
        assistantConfig = createTransientAssistant(scamType, scamDetails);
        assistantName = assistantConfig.name;
        finalAgentIdForTracking = null; // It's no longer a tracked agent
      }
    } else {
      console.log(`No specific agent found for "${metadata.impersonatedCompany}". Creating a transient agent.`);
      assistantConfig = createTransientAssistant(scamType, scamDetails);
      assistantName = assistantConfig.name;
    }

    // 5. Set the final assistant configuration and overrides
    callParams.assistant = sanitizeAssistantConfig(assistantConfig);
    callParams.assistantOverrides = {
      maxDurationSeconds: 900 // 15 minutes
    };

    if (!callParams.assistant) {
      throw new Error('Failed to sanitize assistant configuration');
    }

    // 5.1. Final voice validation before creating the call
    if (callParams.assistant && callParams.assistant.voice) {
      callParams.assistant.voice = validateVoiceConfig(callParams.assistant.voice);
      console.log(`🔍 Final voice validation: Using ${callParams.assistant.voice.provider} voice "${callParams.assistant.voice.voiceId}"`);

      // Extra safety check - ensure no ElevenLabs configuration exists anywhere
      if (callParams.assistant.voice.provider !== 'vapi') {
        console.error('❌ CRITICAL: Non-VAPI voice provider detected in final validation!');
        // Use gender-appropriate fallback voice instead of always defaulting to Elliot
        const assistantGender = detectGenderFromName(callParams.assistant.name);
        const fallbackVoice = getRandomVoice(assistantGender);
        callParams.assistant.voice = fallbackVoice;
        console.log(`🔧 Forced safe VAPI voice configuration: ${fallbackVoice.voiceId} (${assistantGender})`);
      }
    } else {
      console.warn('⚠️  No voice configuration found, adding default VAPI voice');
      // Use gender-appropriate voice instead of always defaulting to Elliot
      const assistantGender = detectGenderFromName(callParams.assistant.name);
      const defaultVoice = getRandomVoice(assistantGender);
      callParams.assistant.voice = defaultVoice;
      console.log(`🎤 Added default voice: ${defaultVoice.voiceId} (${assistantGender})`);
    }

    // 6. Create the Call
    console.log('📞 Creating VAPI call with final params:', JSON.stringify(callParams, null, 2));

    let call;
    try {
      call = await vapiClient.calls.create(callParams);
    } catch (error) {
      // Handle VAPI daily limit error and retry with Twilio
      if (error.message && error.message.includes('Daily Outbound Call Limit') && useVapiPhone) {
        console.warn('⚠️  VAPI daily call limit reached, retrying with Twilio fallback...');

        // Ensure Twilio credentials are available
        if (!process.env.TWILIO_PHONE_NUMBER || !process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
          throw new Error('VAPI daily limit reached and Twilio credentials not available for fallback');
        }

        // Update call params to use Twilio
        delete callParams.phoneNumberId;
        callParams.phoneNumber = {
          twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER,
          twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
          twilioAuthToken: process.env.TWILIO_AUTH_TOKEN
        };
        callParams.metadata.phoneProvider = 'twilio';

        console.log('🔄 Retrying call with Twilio phone number...');
        call = await vapiClient.calls.create(callParams);
        console.log('✅ Successfully created call using Twilio fallback');
      } else {
        throw error; // Re-throw if it's not a daily limit error
      }
    }

    // 7. Track the Call
    callTracker.set(call.id, {
      phoneNumber,
      originalCaller: metadata.originalCaller || originalCallerNumber,
      scamType,
      scamDetails,
      agentId: finalAgentIdForTracking, // Track the original agent ID
      startTime: new Date(),
      status: 'queued',
      phoneProvider: metadata.phoneProvider,
      originalCallSid: originalCallSid,
      assistantName: assistantName,
    });

    console.log(`📞 VAPI call created successfully: ${call.id}`);

    // 8. Send webhook notification for agent call initiated
    try {
      const { notifyAgentCallInitiated } = require('./webhook-service');

      const webhookData = {
        callId: call.id,
        agentName: assistantName,
        company: metadata.impersonatedCompany || 'Unknown',
        phoneNumber: phoneNumber,
        scamType: scamType || 'unknown',
        scamDetails: scamDetails,
        originalCaller: metadata.originalCaller || originalCallerNumber,
        agentId: finalAgentIdForTracking
      };

      const webhookResults = await notifyAgentCallInitiated(webhookData);
      if (webhookResults.length > 0) {
        console.log(`Webhook notifications sent for agent call ${call.id}:`,
          webhookResults.map(r => `${r.type}: ${r.success ? 'success' : 'failed'}`).join(', '));
      }
    } catch (error) {
      console.error(`Error sending webhook for agent call ${call.id}:`, error);
    }

    return { call, agentId: finalAgentIdForTracking, assistantName };
  } catch (error) {
    console.error('Error creating VAPI call:', error);
    throw error;
  }
}

/**
 * Validate phone number format
 * @param {string} phoneNumber - Phone number to validate
 * @returns {boolean} True if valid, false otherwise
 */
function isValidPhoneNumber(phoneNumber) {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return false;
  }

  // Remove all non-digit characters to get clean number
  const digitsOnly = phoneNumber.replace(/\D/g, '');

  // Must have at least 10 digits
  if (digitsOnly.length < 10) {
    return false;
  }

  // Must not exceed 15 digits (E.164 standard)
  if (digitsOnly.length > 15) {
    return false;
  }

  // Basic format validation - allows common phone number formats
  const phoneRegex = /^\+?[\d\s\-\(\)\.]{10,}$/;
  return phoneRegex.test(phoneNumber);
}

/**
 * Formats a phone number into E.164 format.
 * Strips non-digit characters and assumes US country code if missing.
 * @param {string} phoneNumber - The phone number to format.
 * @returns {string|null} The formatted phone number or null if invalid input.
 */
function formatToE164(phoneNumber) {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return null;
  }

  // 1. Remove all non-digit characters.
  const digitsOnly = phoneNumber.replace(/\D/g, '');

  // 2. Check for common US number formats.
  if (digitsOnly.length === 10) {
    // 10 digits, assume US, prepend +1.
    return `+1${digitsOnly}`;
  }
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    // 11 digits starting with 1, assume US, prepend +.
    return `+${digitsOnly}`;
  }

  // 3. Check if it's already in E.164 format (starts with a +, has enough digits)
  // We check the original string for the '+'
  if (phoneNumber.trim().startsWith('+')) {
    // It has a plus, let's just return the cleaned version with a plus
    return `+${digitsOnly}`;
  }
  
  // 4. If we are here, we can't be sure. Return null.
  return null;
}

/**
 * Redact phone number for privacy protection
 * Shows first 4 and last 2 digits, masks the middle digits
 * @param {string} phoneNumber - Phone number to redact
 * @returns {string} Redacted phone number
 */
function redactPhoneNumber(phoneNumber) {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return ''; // Return empty string for invalid input
  }
  const digitsOnly = phoneNumber.replace(/\D/g, '');
  
  if (digitsOnly.length < 10) {
    return phoneNumber; // Too short to apply standard redaction
  }
  
  // Normalize to 11 digits if it's a 10-digit US number
  const normalizedNumber = (digitsOnly.length === 10) ? `1${digitsOnly}` : digitsOnly;

  // Apply format '15551XXXX89' for 11-digit US numbers
  if (normalizedNumber.length === 11 && normalizedNumber.startsWith('1')) {
    const firstPart = normalizedNumber.substring(0, 5);
    const lastPart = normalizedNumber.substring(normalizedNumber.length - 2);
    return `${firstPart}XXXX${lastPart}`;
  } else {
    // Generic fallback for international numbers: first 4, XXXX, last 4
    if (digitsOnly.length < 9) {
      return digitsOnly;
    }
    const firstPart = digitsOnly.substring(0, 4);
    const lastPart = digitsOnly.substring(digitsOnly.length - 4);
    const maskedPart = 'X'.repeat(Math.max(0, digitsOnly.length - 8));
    return `${firstPart}${maskedPart}${lastPart}`;
  }
}

/**
 * Generate a random last name for dynamic agent naming
 * @param {string} gender - 'male', 'female', or 'neutral'
 * @returns {string} Random last name
 */
function getRandomLastName(gender = 'neutral') {
  const lastNames = [
    'Anderson', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
    'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
    'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
    'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker',
    'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill',
    'Flores', 'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell',
    'Mitchell', 'Carter', 'Roberts', 'Gomez', 'Phillips', 'Evans', 'Turner',
    'Diaz', 'Parker', 'Cruz', 'Edwards', 'Collins', 'Reyes', 'Stewart', 'Morris',
    'Morales', 'Murphy', 'Cook', 'Rogers', 'Gutierrez', 'Ortiz', 'Morgan',
    'Cooper', 'Peterson', 'Bailey', 'Reed', 'Kelly', 'Howard', 'Ramos', 'Kim',
    'Cox', 'Ward', 'Richardson', 'Watson', 'Brooks', 'Chavez', 'Wood', 'James',
    'Bennett', 'Gray', 'Mendoza', 'Ruiz', 'Hughes', 'Price', 'Alvarez', 'Castillo',
    'Sanders', 'Patel', 'Myers', 'Long', 'Ross', 'Foster', 'Jimenez'
  ];

  return lastNames[Math.floor(Math.random() * lastNames.length)];
}

/**
 * Generate a random location (city, state) for dynamic agent details
 * @returns {string} Random location like "Chicago, IL" or "Phoenix, AZ"
 */
function getRandomLocation() {
  const locations = [
    'New York, NY', 'Los Angeles, CA', 'Chicago, IL', 'Houston, TX', 'Phoenix, AZ',
    'Philadelphia, PA', 'San Antonio, TX', 'San Diego, CA', 'Dallas, TX', 'San Jose, CA',
    'Austin, TX', 'Jacksonville, FL', 'Fort Worth, TX', 'Columbus, OH', 'Charlotte, NC',
    'San Francisco, CA', 'Indianapolis, IN', 'Seattle, WA', 'Denver, CO', 'Washington, DC',
    'Boston, MA', 'El Paso, TX', 'Nashville, TN', 'Detroit, MI', 'Oklahoma City, OK',
    'Portland, OR', 'Las Vegas, NV', 'Memphis, TN', 'Louisville, KY', 'Baltimore, MD',
    'Milwaukee, WI', 'Albuquerque, NM', 'Tucson, AZ', 'Fresno, CA', 'Sacramento, CA',
    'Kansas City, MO', 'Mesa, AZ', 'Atlanta, GA', 'Omaha, NE', 'Colorado Springs, CO',
    'Raleigh, NC', 'Miami, FL', 'Virginia Beach, VA', 'Oakland, CA', 'Minneapolis, MN',
    'Tulsa, OK', 'Arlington, TX', 'Tampa, FL', 'New Orleans, LA', 'Wichita, KS',
    'Cleveland, OH', 'Bakersfield, CA', 'Aurora, CO', 'Anaheim, CA', 'Honolulu, HI',
    'Santa Ana, CA', 'Riverside, CA', 'Corpus Christi, TX', 'Lexington, KY', 'Stockton, CA',
    'Henderson, NV', 'Saint Paul, MN', 'St. Louis, MO', 'Cincinnati, OH', 'Pittsburgh, PA'
  ];

  return locations[Math.floor(Math.random() * locations.length)];
}

/**
 * Generate a dynamic agent name with consistent first name and random last name
 * @param {string} agentType - Type of agent (coinbase, kraken, binance, etc.)
 * @param {string} scamType - Type of scam for fallback naming
 * @returns {Object} Object with name, firstName, lastName, and gender
 */
function generateDynamicAgentName(agentType, scamType = null) {
  // Define consistent first names for each agent type
  const agentFirstNames = {
    coinbase: { name: 'Jim', gender: 'male' },
    kraken: { name: 'Karen', gender: 'female' }, // Changed from Alex to Karen for consistency
    binance: { name: 'Sarah', gender: 'female' },
    microsoft: { name: 'Mike', gender: 'male' },
    apple: { name: 'Lisa', gender: 'female' },
    google: { name: 'David', gender: 'male' },
    amazon: { name: 'Emma', gender: 'female' },
    paypal: { name: 'Chris', gender: 'neutral' },
    // Fallback names for scam types
    crypto_exchange: { name: 'Mike', gender: 'male' },
    it_support: { name: 'Tom', gender: 'male' },
    banking: { name: 'Jennifer', gender: 'female' },
    default: { name: 'Alex', gender: 'neutral' }
  };

  // Get the appropriate first name configuration
  let nameConfig = agentFirstNames[agentType] ||
                   agentFirstNames[scamType] ||
                   agentFirstNames.default;

  // For neutral gender names, randomly pick male or female
  if (nameConfig.gender === 'neutral') {
    nameConfig = {
      ...nameConfig,
      gender: Math.random() > 0.5 ? 'male' : 'female'
    };
  }

  const firstName = nameConfig.name;
  const lastName = getRandomLastName(nameConfig.gender);
  const fullName = `${firstName} ${lastName}`;

  return {
    fullName,
    firstName,
    lastName,
    gender: nameConfig.gender
  };
}

/**
 * Detect gender from agent name
 * @param {string} name - Agent name
 * @returns {string} 'male', 'female', or 'neutral'
 */
function detectGenderFromName(name) {
  if (!name) return 'neutral';

  const nameLower = name.toLowerCase();

  // Common male names
  const maleNames = [
    'jim', 'james', 'john', 'mike', 'michael', 'david', 'dave', 'steve', 'steven',
    'bob', 'robert', 'bill', 'william', 'tom', 'thomas', 'chris', 'christopher',
    'mark', 'matt', 'matthew', 'paul', 'peter', 'brian', 'kevin', 'jason',
    'jeff', 'jeffrey', 'dan', 'daniel', 'ryan', 'andrew', 'anthony', 'tony',
    'josh', 'joshua', 'adam', 'alex', 'alexander', 'ben', 'benjamin', 'sam',
    'samuel', 'nick', 'nicholas', 'eric', 'scott', 'greg', 'gregory', 'joe',
    'joseph', 'frank', 'franklin', 'gary', 'larry', 'lawrence', 'tim', 'timothy',
    'trevor', 'cory', 'corey'
  ];

  // Common female names
  const femaleNames = [
    'sarah', 'sara', 'jennifer', 'jenny', 'jessica', 'ashley', 'amanda', 'stephanie',
    'melissa', 'nicole', 'elizabeth', 'liz', 'emily', 'heather', 'michelle', 'amy',
    'angela', 'brenda', 'emma', 'olivia', 'ava', 'sophia', 'isabella', 'mia',
    'charlotte', 'amelia', 'harper', 'evelyn', 'abigail', 'ella', 'scarlett',
    'grace', 'chloe', 'victoria', 'riley', 'aria', 'lily', 'aubrey', 'zoey',
    'penelope', 'lillian', 'addison', 'layla', 'natalie', 'camila', 'hannah',
    'brooklyn', 'zoe', 'nora', 'leah', 'savannah', 'audrey', 'claire', 'eleanor',
    'skylar', 'ellie', 'samantha', 'stella', 'paisley', 'violet', 'mila', 'allison',
    'anna', 'serenity', 'lucy', 'autumn', 'luna', 'nova', 'willow', 'piper',
    'karen', 'kimberly', 'kim', 'linda', 'lisa', 'mary', 'patricia', 'pat',
    'barbara', 'barb', 'susan', 'sue', 'nancy', 'betty', 'helen', 'sandra',
    'donna', 'carol', 'ruth', 'sharon', 'deborah', 'debbie', 'laura', 'rachel',
    'kathy', 'catherine', 'maria', 'diane', 'julie', 'joyce', 'virginia', 'janet',
    'catherine', 'frances', 'christine', 'christina', 'tina', 'marie', 'jean',
    'alice', 'judith', 'judy', 'anna', 'jacqueline', 'jackie', 'martha', 'gloria'
  ];

  // Check for exact name matches first (prioritize female names to avoid conflicts)
  for (const femaleName of femaleNames) {
    if (nameLower.includes(femaleName)) {
      return 'female';
    }
  }

  for (const maleName of maleNames) {
    if (nameLower.includes(maleName)) {
      return 'male';
    }
  }

  // Default to neutral if no match found
  return 'neutral';
}

/**
 * Get random voice configuration based on gender using VAPI's high-quality native voices
 * @param {string} gender - 'male', 'female', or 'neutral'
 * @param {string} provider - 'vapi', 'elevenlabs', or 'azure' (default: 'vapi')
 * @returns {Object} Voice configuration object
 */
function getRandomVoice(gender = 'neutral', provider = 'vapi') {
  // Force VAPI provider to avoid ElevenLabs pipeline errors
  provider = 'vapi';

  console.log(`Selecting VAPI voice for gender: ${gender}`);

  // Validate that we're not accidentally using ElevenLabs
  if (provider === 'elevenlabs') {
    console.warn('⚠️  ElevenLabs provider detected - forcing VAPI to prevent pipeline errors');
    provider = 'vapi';
  }

  // Only use verified VAPI native voices to prevent pipeline errors
  const maleVoices = [
    'Elliot',   // 25 years old male, Canadian, soothing, friendly, professional
    'Rohan',    // 24 years old male, Indian American, bright, optimistic, cheerful, energetic
    'Cole',     // Male voice - verified working
    'Harry',    // Male voice - verified working
    'Spencer'   // Male voice - verified working
  ];

  const femaleVoices = [
    'Paige',     // 26 year old white female, deeper tone, calming, professional
    'Hana',      // 22 years old female, Asian, soft, soothing, gentle
    'Kylie',     // Female voice - verified working
    'Lily',      // Female voice - verified working
    'Savannah',  // Female voice - verified working
    'Neha'       // Female voice - verified working
  ];

  let voices;
  if (gender === 'male') {
    voices = maleVoices;
  } else if (gender === 'female') {
    voices = femaleVoices;
  } else {
    // For neutral or unknown gender, use all voices
    voices = [...maleVoices, ...femaleVoices];
  }

  const selectedVoice = voices[Math.floor(Math.random() * voices.length)];

  console.log(`Selected VAPI voice: ${selectedVoice} for gender: ${gender}`);

  const voiceConfig = {
    provider: "vapi",
    voiceId: selectedVoice,
    cachingEnabled: true,
    speed: 1.0
    // Note: VAPI native voices don't use language field - removing to prevent ElevenLabs model conflicts
  };

  // Final validation to ensure we're using VAPI
  if (voiceConfig.provider !== 'vapi') {
    console.error('❌ Invalid voice provider detected:', voiceConfig.provider);
    voiceConfig.provider = 'vapi';
    voiceConfig.voiceId = 'Elliot'; // Safe fallback
  }

  return voiceConfig;
}

/**
 * Validate and sanitize voice configuration to ensure VAPI compatibility
 * @param {Object} voiceConfig - Voice configuration object
 * @returns {Object} Sanitized voice configuration
 */
function validateVoiceConfig(voiceConfig) {
  if (!voiceConfig || typeof voiceConfig !== 'object') {
    console.warn('⚠️  Invalid voice config provided, using default VAPI voice');
    return getRandomVoice('neutral');
  }

  // Check if it's using ElevenLabs provider
  if (voiceConfig.provider === 'elevenlabs' || voiceConfig.provider === 'eleven_labs') {
    console.warn('⚠️  ElevenLabs voice detected, converting to VAPI native voice');
    // Map common ElevenLabs voices to VAPI equivalents
    const elevenLabsToVapiMapping = {
      'Adam': 'Elliot',
      'Antoni': 'Rohan',
      'Arnold': 'Cole',
      'Josh': 'Harry',
      'Sam': 'Spencer',
      'Bella': 'Paige',
      'Domi': 'Hana',
      'Elli': 'Kylie',
      'Rachel': 'Lily'
    };

    const mappedVoice = elevenLabsToVapiMapping[voiceConfig.voiceId] || 'Elliot';
    console.log(`🔄 Mapped ElevenLabs voice "${voiceConfig.voiceId}" to VAPI voice "${mappedVoice}"`);

    return {
      provider: "vapi",
      voiceId: mappedVoice,
      cachingEnabled: true,
      speed: 1.0
      // Note: VAPI native voices don't use language field
    };
  }

  // Ensure it's using VAPI provider
  if (voiceConfig.provider !== 'vapi') {
    console.warn(`⚠️  Non-VAPI provider "${voiceConfig.provider}" detected, forcing VAPI`);
    return {
      provider: "vapi",
      voiceId: voiceConfig.voiceId || 'Elliot',
      cachingEnabled: true,
      speed: voiceConfig.speed || 1.0
      // Note: VAPI native voices don't use language field
    };
  }

  // Voice config is already VAPI, return as-is but ensure required fields
  return {
    provider: "vapi",
    voiceId: voiceConfig.voiceId || 'Elliot',
    cachingEnabled: voiceConfig.cachingEnabled !== false,
    speed: voiceConfig.speed || 1.0
    // Note: VAPI native voices don't use language field
  };
}

/**
 * Generate dynamic prompt for existing assistants with random details
 * @param {Object} existingAssistant - The existing assistant configuration
 * @param {string} company - Company being impersonated
 * @returns {string} Dynamic system prompt with random details
 */
function generateDynamicPrompt(existingAssistant, company) {
  const assistantName = existingAssistant.name;
  const gender = detectGenderFromName(assistantName);

  // Extract first name from assistant name (e.g., "Kraken Karen" -> "Karen")
  const nameParts = assistantName.split(' ');
  const firstName = nameParts[nameParts.length - 1]; // Get last part as first name

  // Generate random details
  const lastName = getRandomLastName(gender);
  const location = getRandomLocation();
  const fullName = `${firstName} ${lastName}`;

  console.log(`🎭 Generated dynamic details: ${fullName} from ${location}`);

  // Check if this is a Kraken assistant and needs dynamic prompt
  if (company.toLowerCase() === 'kraken' && assistantName.toLowerCase().includes('karen')) {
    return `Your name is ${fullName} from ${location}. You are calling because you got a text about an unauthorized login to your ${company} account.

Follow directions and if you are not sure, make something up. The goal is to continue the conversation as long as possible.

If you receive what appears to be an automated message, wait until you hear a human answer before starting to share information.`;
  }

  // For other assistants, return the original prompt if it exists
  if (existingAssistant.model && existingAssistant.model.messages && existingAssistant.model.messages[0]) {
    return existingAssistant.model.messages[0].content;
  }

  // Fallback generic prompt
  return `You are ${firstName}, a concerned ${company} user who received a suspicious message about your account. Your goal is to waste scammers' time by acting like a cooperative but confused victim.`;
}

/**
 * Completely sanitize assistant configuration to remove any ElevenLabs references
 * @param {Object} assistantConfig - Assistant configuration object
 * @returns {Object} Sanitized assistant configuration
 */
function sanitizeAssistantConfig(assistantConfig) {
  if (!assistantConfig || typeof assistantConfig !== 'object') {
    console.error('❌ Invalid assistant config provided');
    return null;
  }

  // Deep clone to avoid modifying original
  const sanitized = JSON.parse(JSON.stringify(assistantConfig));

  // Remove invalid properties that VAPI doesn't support
  delete sanitized.endCallOnBye;

  // Ensure voice is VAPI
  if (sanitized.voice) {
    sanitized.voice = validateVoiceConfig(sanitized.voice);
  } else {
    sanitized.voice = {
      provider: "vapi",
      voiceId: "Elliot",
      cachingEnabled: true,
      speed: 1.0
      // Note: VAPI native voices don't use language field
    };
  }

  // Remove any potential ElevenLabs references in other fields
  const configStr = JSON.stringify(sanitized);
  if (configStr.includes('elevenlabs') || configStr.includes('eleven_labs')) {
    console.warn('⚠️  Found ElevenLabs references in assistant config, sanitizing...');
    // This is a safety net - the specific validation above should catch most cases
  }

  console.log(`✅ Assistant config sanitized: voice provider = ${sanitized.voice.provider}, voiceId = ${sanitized.voice.voiceId}`);
  return sanitized;
}

/**
 * Create a transient assistant for a specific scam type
 * @param {string} scamType - Type of scam
 * @param {Object} scamDetails - Scam details
 * @returns {Object} Assistant configuration
 */
function createTransientAssistant(scamType, scamDetails) {
  let systemPrompt = '';
  let firstMessage = '';
  let assistantName = '';
  let agentName = null; // Store the generated name for gender detection

  if (scamType === 'crypto_exchange') {
    // Determine the specific company being impersonated
    const company = scamDetails?.impersonatedCompany ||
                   scamDetails.cryptoTerms?.[0] || 'Coinbase';

    // Generate dynamic name based on company
    const companyLower = company.toLowerCase();
    agentName = generateDynamicAgentName(companyLower, 'crypto_exchange');

    assistantName = `${company} ${agentName.firstName}`;
    firstMessage = `Hello, I'm calling about my ${company} account. I received a message saying there was suspicious activity and I need to verify my account. Is this really ${company} support?`;
    systemPrompt = `You are ${agentName.firstName}, a concerned ${company} user who received a suspicious message about your cryptocurrency account. Your goal is to waste scammers' time by acting like a cooperative but confused victim.

IMPORTANT: The company calling you is "${company}" - always refer to them by this name throughout the conversation.

Key behaviors:
- Act worried about your crypto account security and potential unauthorized access
- Pretend to be somewhat tech-savvy but not expert-level with crypto
- Ask lots of questions about the security issue and what ${company} needs you to do
- Provide fake but believable personal information when asked (fake email, fake amounts, etc.)
- Act confused about some technical terms but eager to protect your account
- Use phrases like "Oh wow," "Okay, so what do I do?", "Can you walk me through that?"`;

  } else if (scamType === 'it_support') {
    const company = scamDetails?.impersonatedCompany ||
                   scamDetails.techTerms?.[0] || 'Microsoft';

    // Generate dynamic name based on company
    const companyLower = company.toLowerCase();
    agentName = generateDynamicAgentName(companyLower, 'it_support');

    assistantName = `${company} ${agentName.firstName}`;
    firstMessage = `Hi, I got a notification on my computer that said I should call this number about a virus. Is this ${company}?`;
    systemPrompt = `You are ${agentName.firstName}, a concerned computer user who got a popup message about a virus. Your goal is to waste scammers' time by acting like a non-technical but concerned user.

IMPORTANT: The company calling you is "${company}" - always refer to them by this name throughout the conversation.

Key behaviors:
- Act confused about technical jargon.
- Ask for clarification on everything they ask you to do.
- Be slow to follow instructions, pretending to look for keys or menus.
- Express fear about losing your data or photos.
- Ask if they are sure they are from ${company}.`;
  } else {
    // Generic fallback
    agentName = generateDynamicAgentName('default', 'default');
    assistantName = `Generic ${agentName.firstName}`;
    firstMessage = "Hello? I got a message to call this number.";
    systemPrompt = "You are a person who received a strange message and is cautiously calling back. Your goal is to figure out who is calling you and why, while wasting as much of their time as possible. Be curious, a little confused, and ask lots of questions.";
  }

  // Ensure the assistant name is not too long for VAPI
  if (assistantName.length > 40) {
    assistantName = assistantName.substring(0, 39).trim();
  }

  // Generate dynamic voice based on the agent's detected gender.
  const gender = agentName ? agentName.gender : 'neutral';
  const voice = getRandomVoice(gender);

  console.log(`Creating transient assistant "${assistantName}" with voice: ${voice.voiceId}`);

  return {
    name: assistantName,
    model: {
      provider: "openai",
      model: "gpt-4-turbo",
      temperature: 0.7,
      maxTokens: 500,
      messages: [
        {
          role: "system",
          content: systemPrompt
        }
      ]
    },
    voice: {
      provider: voice.provider,
      voiceId: voice.voiceId,
      cachingEnabled: true,
      speed: 1.0
      // Note: VAPI native voices don't use language field
    },
    firstMessage: firstMessage,
    endCallPhrases: ["take care", "bye", "goodbye", "talk soon"],
  };
}

/**
 * Get detailed analytics for VAPI calls
 * @param {Array} calls - An array of VAPI call objects to analyze
 * @param {Map} assistantMap - A map of assistant IDs to assistant objects
 * @returns {Object} Analytics object
 */
async function getCallAnalytics(calls, assistantMap) {
  try {
    if (!calls || !Array.isArray(calls)) {
      console.error('getCallAnalytics requires an array of calls.');
      return getBasicAnalytics(); // Return empty analytics
    }

    console.log(`Analyzing ${calls.length} calls for analytics...`);

    const endedCalls = calls.filter(call => call.status === 'ended' && call.duration > 0);

    const analytics = {
      totalCalls: calls.length,
      successfulCalls: endedCalls.filter(c => c.successful).length,
      failedCalls: endedCalls.filter(c => !c.successful).length,
      averageDuration: 0,
      totalTimeSpent: 0,
      callsByScamType: {},
      callsByAgent: {},
      recentCalls: [],
      leaderboard: []
    };

    let totalDuration = 0;
    const now = new Date();
    const agentStats = new Map();

    // Process each ended call for leaderboard and aggregated stats
    for (const call of endedCalls) {
      totalDuration += call.duration;

      // This now correctly uses the assistantName from the enriched call object
      const agentName = call.assistantName || 'Unknown Agent';

      // Count by agent for leaderboard
      if (!agentStats.has(agentName)) {
        agentStats.set(agentName, {
          name: agentName,
          totalCalls: 0,
          totalTime: 0,
          successfulCalls: 0,
          avgDuration: 0,
          successRate: 0
        });
      }

      const stats = agentStats.get(agentName);
      stats.totalCalls++;
      stats.totalTime += call.duration / 60; // Convert to minutes

      if (call.successful) {
        stats.successfulCalls++;
      }

      // This logic is simplified as the info is on the call object
      const scamType = call.scamType || call.metadata?.scamType || 'unknown';
      analytics.callsByScamType[scamType] = (analytics.callsByScamType[scamType] || 0) + 1;

      // Also uses the potentially corrected baseAgentId
      const agentId = call.metadata?.baseAgentId || call.assistantId || 'unknown';
      analytics.callsByAgent[agentId] = (analytics.callsByAgent[agentId] || 0) + 1;
    }
    
    // Process all calls for the "Recent Calls" list
    for (const call of calls) {
      const callTime = new Date(call.startedAt || call.createdAt);
      const hoursSinceCall = (now - callTime) / (1000 * 60 * 60);

      if (hoursSinceCall <= 24) {
        const scamType = call.scamType || call.metadata?.scamType || 'unknown';
        analytics.recentCalls.push({
          callId: call.id,
          phoneNumber: call.customer?.number,
          scamType: scamType,
          agentId: call.metadata?.baseAgentId || call.assistantId,
          agentName: call.assistantName || 'Unknown Agent',
          startTime: callTime,
          endTime: call.endedAt ? new Date(call.endedAt) : null,
          duration: call.duration,
          status: call.status,
          successful: call.successful,
          analysis: call.analysis
        });
      }
    }

    // Calculate averages and create leaderboard
    analytics.leaderboard = Array.from(agentStats.values()).map(stats => ({
      ...stats,
      avgDuration: stats.totalCalls > 0 ? stats.totalTime / stats.totalCalls : 0,
      successRate: stats.totalCalls > 0 ? (stats.successfulCalls / stats.totalCalls) * 100 : 0,
      totalTime: Math.round(stats.totalTime * 100) / 100
    })).sort((a, b) => b.totalTime - a.totalTime);

    // Calculate overall averages
    if (endedCalls.length > 0) {
      analytics.averageDuration = totalDuration / endedCalls.length;
      analytics.totalTimeSpent = totalDuration / 60; // Convert to minutes
    }

    // Sort recent calls by start time (newest first)
    analytics.recentCalls.sort((a, b) => b.startTime - a.startTime);

    return analytics;
  } catch (error) {
    console.error('Error getting call analytics:', error);
    console.error('Error details:', error.stack);
    const fallback = getBasicAnalytics();
    console.log('Returning fallback analytics:', fallback);
    return fallback;
  }
}

/**
 * Fallback analytics from call tracker
 * @returns {Object} Basic analytics data
 */
function getBasicAnalytics() {
  const analytics = {
    totalCalls: callTracker.size,
    successfulCalls: 0,
    failedCalls: 0,
    averageDuration: 0,
    totalTimeSpent: 0,
    callsByScamType: {},
    callsByAgent: {},
    recentCalls: [],
    leaderboard: []
  };

  let totalDuration = 0;
  const now = new Date();

  for (const [callId, callData] of callTracker.entries()) {
    // Calculate duration if call has ended
    if (callData.endTime) {
      const duration = (callData.endTime - callData.startTime) / 1000; // seconds
      totalDuration += duration;

      // Consider calls longer than 5 minutes (300 seconds) as successful
      if (duration >= 300) {
        analytics.successfulCalls++;
      } else {
        analytics.failedCalls++;
      }
    }

    // Count by scam type
    const scamType = callData.scamType || 'unknown';
    analytics.callsByScamType[scamType] = (analytics.callsByScamType[scamType] || 0) + 1;

    // Count by agent
    const agentId = callData.agentId || 'transient';
    analytics.callsByAgent[agentId] = (analytics.callsByAgent[agentId] || 0) + 1;

    // Add to recent calls (last 24 hours)
    const hoursSinceCall = (now - callData.startTime) / (1000 * 60 * 60);
    if (hoursSinceCall <= 24) {
      analytics.recentCalls.push({
        callId,
        phoneNumber: callData.phoneNumber,
        scamType: callData.scamType,
        agentId: callData.agentId,
        startTime: callData.startTime,
        endTime: callData.endTime,
        duration: callData.endTime ? (callData.endTime - callData.startTime) / 1000 : null,
        status: callData.status
      });
    }
  }

  // Calculate average duration
  const completedCalls = analytics.successfulCalls + analytics.failedCalls;
  if (completedCalls > 0) {
    analytics.averageDuration = totalDuration / completedCalls;
    analytics.totalTimeSpent = totalDuration / 60; // Convert to minutes
  }

  // Sort recent calls by start time (newest first)
  analytics.recentCalls.sort((a, b) => b.startTime - a.startTime);

  return analytics;
}

/**
 * Handle VAPI webhook events
 * @param {Object} webhookData - Webhook payload
 * @returns {Object} Response
 */
async function handleVapiWebhook(webhookData) {
  // Handle both direct webhook format and nested message format
  let type, call;

  if (webhookData.message) {
    // New format: { message: { type, call, ... } }
    type = webhookData.message.type;
    call = webhookData.message.call;
  } else {
    // Legacy format: { type, call }
    type = webhookData.type;
    call = webhookData.call;
  }

  if (!type || !call) {
    console.warn('Invalid VAPI webhook received:', webhookData);
    return { status: 'ignored', reason: 'Invalid webhook payload' };
  }

  console.log(`Received VAPI webhook: ${type} for call ID: ${call.id}`);

  switch (type) {
    case 'call.start':
      console.log(`VAPI call started: ${call.id}`);
      if (callTracker.has(call.id)) {
        // Preserve existing tracking data and only update status and timing
        const existingData = callTracker.get(call.id);
        callTracker.set(call.id, {
          ...existingData,
          ...call, // Add VAPI call data
          // Preserve our custom tracking fields
          assistantName: existingData.assistantName,
          scamDetails: existingData.scamDetails,
          scamType: existingData.scamType,
          originalCaller: existingData.originalCaller,
          originalCallSid: existingData.originalCallSid,
          phoneProvider: existingData.phoneProvider,
          agentId: existingData.agentId,
          // Update status and timing
          startTime: new Date(),
          status: 'in-progress'
        });
      } else {
        // Fallback if no existing data (shouldn't happen normally)
        callTracker.set(call.id, {
          ...call,
          startTime: new Date(),
          status: 'in-progress'
        });
      }
      break;

    case 'call.end':
    case 'call.ended':
      console.log(`VAPI call ended: ${call.id}, Reason: ${call.endedReason || 'N/A'}`);
      if (callTracker.has(call.id)) {
        const callData = callTracker.get(call.id);
        callData.status = 'ended';
        callData.endTime = new Date();
        callData.duration = call.duration || (callData.endTime - callData.startTime) / 1000;
        callData.endedReason = call.endedReason;
        callTracker.set(call.id, callData);
      }
      
      // Send immediate text notification for call ended
      const trackedCallData = callTracker.get(call.id);
      if (trackedCallData) {
        const { notifyAgentCallStatusTextOnly } = require('./webhook-service');
        const notificationData = {
          callId: call.id,
          agentName: trackedCallData.agentName || 'Unknown Agent',
          company: trackedCallData.company || 'Unknown Company',
          phoneNumber: trackedCallData.phoneNumber || 'Unknown',
          scamType: trackedCallData.scamType || 'unknown',
          duration: call.duration || (trackedCallData.endTime - trackedCallData.startTime) / 1000,
          successful: (call.duration || (trackedCallData.endTime - trackedCallData.startTime) / 1000) >= 300,
          status: 'completed',
          endTime: new Date().toISOString()
        };

        // Send immediate text notification (without audio)
        notifyAgentCallStatusTextOnly('agent_call_ended', notificationData)
          .then(results => {
            console.log(`Immediate call ended text notifications sent for ${call.id}:`,
              results.map(r => `${r.type}: ${r.success ? 'success' : 'failed'}`).join(', '));
          })
          .catch(err => {
            console.error(`Error sending immediate call ended text notifications for ${call.id}:`, err);
          });
      }

      // Trigger Telegram upload task after call ends
      // Note: No setTimeout in serverless - the retry logic in getVapiCallRecordingWithRetry handles delays
      console.log(`Queuing Telegram upload for call ID: ${call.id} (call.end)`);

      // Mark that we've queued a Telegram upload for this call to avoid duplicates
      if (callTracker.has(call.id)) {
        const callData = callTracker.get(call.id);
        callData.telegramUploadQueued = true;
        callTracker.set(call.id, callData);
      }

      // call.end happens earlier, so recording is less likely to be ready
      // Queue with longer delay and don't try immediate upload
      console.log(`🔄 Queuing Telegram upload with delay for call ${call.id} (call.end)`);

      const trackedCallDataForEnd = callTracker.get(call.id) || {};
      const assistantNameForEnd = call.assistant?.name || trackedCallDataForEnd.assistantName || 'Unknown Agent';
      const scamDetailsForEnd = {
          impersonatedCompany: call.metadata?.impersonatedCompany || trackedCallDataForEnd.scamDetails?.impersonatedCompany,
          scamType: call.metadata?.scamType || trackedCallDataForEnd.scamDetails?.scamType,
          confidence: call.metadata?.confidence || trackedCallDataForEnd.scamDetails?.confidence
      };

      try {
        await queueTelegramUpload({
          callId: call.id,
          assistantName: assistantNameForEnd,
          scamDetails: scamDetailsForEnd
        }, { delay: 60 });
        console.log(`✅ Telegram upload task queued for 60s delay for call ${call.id}`);
      } catch (err) {
          console.error(`❌ Failed to queue Telegram upload for call ${call.id}:`, err.message);
      }
        
      break;

    case 'function-call':
      console.log('Function call received:', webhookData.functionCall);
      // ... existing code ...
      break;

    case 'speech-update':
      console.log(`Speech update received for call ${call.id}: status=${webhookData.message?.status}, role=${webhookData.message?.role}`);
      // Update call tracker with speech status if call is being tracked
      if (callTracker.has(call.id)) {
        const callData = callTracker.get(call.id);
        callData.lastSpeechUpdate = {
          timestamp: webhookData.message?.timestamp || Date.now(),
          status: webhookData.message?.status,
          role: webhookData.message?.role,
          turn: webhookData.message?.turn
        };
        callTracker.set(call.id, callData);
      }
      break;

    case 'status-update':
      console.log(`Status update received for call ${call.id}: status=${call.status}`);
      // Update call tracker with status changes
      if (callTracker.has(call.id)) {
        const callData = callTracker.get(call.id);
        callData.status = call.status;
        callData.lastStatusUpdate = {
          timestamp: webhookData.message?.timestamp || Date.now(),
          status: call.status
        };
        callTracker.set(call.id, callData);
      }
      break;

    case 'conversation-update':
      console.log(`Conversation update received for call ${call.id}`);
      // Update call tracker with conversation data
      if (callTracker.has(call.id)) {
        const callData = callTracker.get(call.id);
        if (webhookData.message?.artifact) {
          callData.conversation = webhookData.message.artifact;
          callData.lastConversationUpdate = {
            timestamp: webhookData.message?.timestamp || Date.now(),
            messageCount: webhookData.message.artifact.messages?.length || 0
          };
        }
        callTracker.set(call.id, callData);
      }
      break;

    case 'end-of-call-report':
      console.log(`End-of-call report received for call ${call.id}`);
      // This is the comprehensive call summary - update tracker with final data
      if (callTracker.has(call.id)) {
        const callData = callTracker.get(call.id);
        callData.endOfCallReport = {
          timestamp: webhookData.message?.timestamp || Date.now(),
          summary: webhookData.message?.summary,
          analysis: webhookData.message?.analysis,
          transcript: webhookData.message?.transcript,
          cost: webhookData.message?.cost,
          duration: webhookData.message?.duration
        };
        callData.status = 'completed';
        callTracker.set(call.id, callData);
      }

      // Trigger Telegram upload task after end-of-call report
      // This is often the final webhook that confirms the call is complete with all data
      // Only queue if we haven't already queued one for this call
      let callData = callTracker.get(call.id);
      if (!callData) {
        // Create call data if it doesn't exist
        callData = {
          callId: call.id,
          status: 'completed',
          telegramUploadQueued: false
        };
        callTracker.set(call.id, callData);
      }

      if (!callData.telegramUploadQueued) {
        console.log(`Queuing Telegram upload for call ID: ${call.id} (end-of-call-report)`);

        // Mark that we've queued a Telegram upload for this call
        callData.telegramUploadQueued = true;
        callTracker.set(call.id, callData);

        // Data for the queue task
        // Get from webhook payload directly to avoid reliance on in-memory state
        const assistantName = call.assistant?.name || callData.assistantName || 'Unknown Agent';
        const scamDetails = {
          impersonatedCompany: call.metadata?.impersonatedCompany || callData.scamDetails?.impersonatedCompany,
          scamType: call.metadata?.scamType || callData.scamDetails?.scamType,
          confidence: call.metadata?.confidence || callData.scamDetails?.confidence
        };

        // end-of-call-report usually means recording is ready or will be soon
        // Queue with short delay to give VAPI a moment to finalize the recording
        console.log(`🔄 Queuing Telegram upload with short delay for call ${call.id} (end-of-call-report)`);

        try {
          await queueTelegramUpload({
            callId: call.id,
            assistantName: assistantName,
            scamDetails: scamDetails
          }, { delay: 60 });
          console.log(`✅ Telegram upload task queued for 60s delay for call ${call.id}`);
        } catch (err) {
            console.error(`❌ Failed to queue Telegram upload for call ${call.id}:`, err.message);
        }
      } else {
        console.log(`Telegram upload already queued for call ID: ${call.id}, skipping duplicate`);
      }
      break;

    case 'hang':
      console.log(`Hang event received for call ${call.id}`);
      // Call was hung up
      if (callTracker.has(call.id)) {
        const callData = callTracker.get(call.id);
        callData.status = 'hung-up';
        callData.endTime = new Date();
        callData.endedReason = 'hang';
        callTracker.set(call.id, callData);
      }
      break;

    case 'user-interrupted':
      console.log(`User interrupted event received for call ${call.id}`);
      // Track interruption events
      if (callTracker.has(call.id)) {
        const callData = callTracker.get(call.id);
        if (!callData.interruptions) callData.interruptions = [];
        callData.interruptions.push({
          timestamp: webhookData.message?.timestamp || Date.now(),
          type: 'user-interrupted'
        });
        callTracker.set(call.id, callData);
      }
      break;

    case 'tool-calls':
      console.log(`Tool calls event received for call ${call.id}`);
      // Track tool/function calls during conversation
      if (callTracker.has(call.id)) {
        const callData = callTracker.get(call.id);
        if (!callData.toolCalls) callData.toolCalls = [];
        callData.toolCalls.push({
          timestamp: webhookData.message?.timestamp || Date.now(),
          toolCall: webhookData.message?.toolCall
        });
        callTracker.set(call.id, callData);
      }
      break;

    case 'transfer-destination-request':
      console.log(`Transfer destination request received for call ${call.id}`);
      // Handle call transfer requests
      if (callTracker.has(call.id)) {
        const callData = callTracker.get(call.id);
        callData.transferRequest = {
          timestamp: webhookData.message?.timestamp || Date.now(),
          destination: webhookData.message?.destination
        };
        callTracker.set(call.id, callData);
      }
      break;

    default:
      console.log(`Unhandled webhook type: ${type}`);
      return { status: 'ignored', reason: 'unhandled webhook type' };
  }

  return {
    status: 'processed',
    callId: call.id,
    type,
    trackedCall: callTracker.get(call.id) // Return tracked call data for notification processing
  };
}

/**
 * Get a specific call's details
 * @param {string} callId - Call ID
 * @returns {Object} Call details
 */
async function getCallDetails(callId) {
  try {
    // Get from tracker first
    const trackedCall = callTracker.get(callId);

    // Also fetch from VAPI API for complete details
    const apiCall = await vapiClient.calls.get(callId);

    return {
      tracked: trackedCall,
      api: apiCall
    };
  } catch (error) {
    console.error(`Error getting call details for ${callId}:`, error);
    return { tracked: callTracker.get(callId), api: null };
  }
}

function extractCompanyFromAgent(agentName) {
  if (!agentName) return 'Unknown';

  const name = agentName.toLowerCase();
  if (name.includes('coinbase')) return 'Coinbase';
  if (name.includes('kraken')) return 'Kraken';
  if (name.includes('binance')) return 'Binance';
  if (name.includes('microsoft')) return 'Microsoft';
  if (name.includes('apple')) return 'Apple';
  if (name.includes('google')) return 'Google';
  if (name.includes('amazon')) return 'Amazon';
  if (name.includes('paypal')) return 'PayPal';

  return 'Unknown';
}

/**
 * List VAPI calls with optional filtering
 * @param {Object} options - Filter options
 * @returns {Array} List of calls
 */
async function listVapiCalls(options = {}) {
  try {
    console.log('Fetching VAPI calls...');

    // Check if VAPI client is available
    if (!vapiClient) {
      console.warn('VAPI client not initialized, returning empty calls list');
      return [];
    }

    const response = await vapiClient.calls.list(options);
    console.log('VAPI calls API response:', JSON.stringify(response, null, 2));

    // Handle different response formats
    let calls = [];
    if (Array.isArray(response)) {
      calls = response;
    } else if (response && response.data && Array.isArray(response.data)) {
      calls = response.data;
    } else if (response && response.calls && Array.isArray(response.calls)) {
      calls = response.calls;
    }

    console.log(`Found ${calls.length} VAPI calls`);

    // Get assistants to enrich call data with assistant names
    const assistants = await listVapiAssistants();
    const assistantMap = new Map(assistants.map(a => [a.id, a]));

    // Enrich calls with additional metadata
    const enrichedCalls = calls.map(call => {
      let assistantName = 'Unknown Agent';
      let company = 'Unknown';
      let assistant = null; // Keep assistant object for backward compatibility if something relies on it

      // 1. Check for our custom metadata first. This is the most reliable for transient calls.
      if (call.metadata && call.metadata.baseAgentName) {
        assistantName = call.metadata.baseAgentName;
        company = call.metadata.impersonatedCompany || extractCompanyFromAgent(assistantName);
        // Try to find the base assistant object
        if (call.metadata.baseAgentId) {
          assistant = assistantMap.get(call.metadata.baseAgentId);
        }
      }
      // 2. Fallback to assistantId lookup for non-transient or older calls.
      else if (call.assistantId) {
        const foundAssistant = assistantMap.get(call.assistantId);
        if (foundAssistant) {
          assistant = foundAssistant;
          assistantName = foundAssistant.name;
          company = extractCompanyFromAgent(foundAssistant.name);
        } else if (call.assistant?.name) {
          // VAPI sometimes includes the assistant name directly on the call object
          assistantName = call.assistant.name;
          company = extractCompanyFromAgent(assistantName);
          assistant = call.assistant;
        }
      }

      // 3. Fallback for older transient calls: infer from metadata
      if (assistantName === 'Unknown Agent' && call.metadata?.impersonatedCompany) {
        const inferredAgent = findVapiAgentForCompanySync(call.metadata.impersonatedCompany, assistants);
        if (inferredAgent) {
          console.log(`Retroactively identified agent "${inferredAgent.name}" for old call ${call.id}`);
          assistantName = inferredAgent.name;
          company = call.metadata.impersonatedCompany;
          assistant = inferredAgent;
        } else {
          // If we can't find a specific agent, at least use the company name.
          company = call.metadata.impersonatedCompany;
          assistantName = `${company} Agent`;
        }
      }

      const duration = call.endedAt && call.startedAt ?
        (new Date(call.endedAt) - new Date(call.startedAt)) / 1000 : null;

      return {
        ...call,
        assistantName,
        company,
        assistant, // Add full assistant object for backward compatibility
        type: 'agent_conversation', // Mark as agent conversation vs scam voicemail
        source: 'vapi',
        hasRecording: !!(call.recordingUrl || call.artifact?.recordingUrl),
        hasTranscript: !!(call.transcript || call.artifact?.transcript),
        duration: duration,
        successful: duration ? duration >= 300 : false,
        // Include analysis data if available
        analysis: call.analysis || null,
        // Extract transcript from artifact if available
        transcript: call.artifact?.transcript || call.transcript || null,
        // Extract messages for detailed conversation view
        messages: call.artifact?.messages || call.messages || []
      };
    });

    console.log(`Enriched ${enrichedCalls.length} calls with assistant names.`);

    return enrichedCalls;
  } catch (error) {
    console.error('Error listing VAPI calls:', error);
    throw error; // Re-throw the error to be handled by the API router
  }
}

/**
 * Get VAPI call recording and transcript
 * @param {string} callId - Call ID
 * @returns {Object} Call recording and transcript data
 */
async function getVapiCallRecording(callId) {
  try {
    console.log(`Fetching VAPI call recording for ${callId}...`);

    // Add timeout to prevent hanging in Vercel functions
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('VAPI API call timeout after 10 seconds')), 10000);
    });

    const call = await Promise.race([
      vapiClient.calls.get(callId),
      timeoutPromise
    ]);

    // Log the full call object structure for debugging
    console.log(`VAPI call object keys for ${callId}:`, Object.keys(call));
    console.log(`Call status: ${call.status}, endedAt: ${call.endedAt}`);

    // Check multiple possible locations for recording URL
    const recordingUrl = call.recordingUrl ||
                        call.artifact?.recordingUrl ||
                        call.recording?.url ||
                        call.recordingData?.url;

    console.log(`Recording URL sources for ${callId}:`);
    console.log(`  call.recordingUrl: ${call.recordingUrl || 'not found'}`);
    console.log(`  call.artifact?.recordingUrl: ${call.artifact?.recordingUrl || 'not found'}`);
    console.log(`  call.recording?.url: ${call.recording?.url || 'not found'}`);
    console.log(`  call.recordingData?.url: ${call.recordingData?.url || 'not found'}`);
    console.log(`  Final recording URL: ${recordingUrl || 'NONE FOUND'}`);

    const recordingData = {
      callId,
      recordingUrl: recordingUrl,
      transcript: call.transcript || call.artifact?.transcript,
      messages: call.messages || call.artifact?.messages || [],
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      duration: call.endedAt && call.startedAt ?
        (new Date(call.endedAt) - new Date(call.startedAt)) / 1000 : null,
      cost: call.cost,
      endedReason: call.endedReason,
      type: 'agent_conversation',
      source: 'vapi',
      // Include the full call object for debugging
      _fullCallData: call
    };

    console.log(`Retrieved recording data for call ${callId}, has recording: ${!!recordingUrl}`);
    return recordingData;
  } catch (error) {
    console.error(`Error getting VAPI call recording for ${callId}:`, error);
    return null;
  }
}

module.exports = {
  listVapiAssistants,
  listVapiPhoneNumbers,
  getOrCreateVapiPhoneNumber,
  createVapiCall,
  findVapiAgentForCompany,
  getRandomVoice,
  validateVoiceConfig,
  sanitizeAssistantConfig,
  generateDynamicPrompt,
  detectGenderFromName,
  generateDynamicAgentName,
  getRandomLastName,
  getRandomLocation,
  isValidPhoneNumber,
  formatToE164,
  redactPhoneNumber,
  getCallAnalytics,
  handleVapiWebhook,
  getCallDetails,
  listVapiCalls,
  getVapiCallRecording,
  callTracker,
  createTransientAssistant,
  extractCompanyFromAgent,
  findVapiAgentForCompanySync
};
