/**
 * LLM-based scam detection service using OpenRouter.ai and Meta's Llama 3.3 8B model
 */
const { OpenAI } = require('openai');
require('dotenv').config();

// Scam detection thresholds
const SCAM_DETECTION_THRESHOLDS = {
  // Minimum confidence score (0-100) for LLM-based scam detection
  MIN_LLM_CONFIDENCE: 70,
  // Minimum regex-based scam score for fallback detection
  MIN_REGEX_SCAM_SCORE: 5,
  // Minimum transcript length (characters) to consider for analysis
  MIN_TRANSCRIPT_LENGTH: 10,
  // Minimum recording duration (seconds) to consider for analysis
  MIN_RECORDING_DURATION: 1
};

// Initialize OpenAI client with OpenRouter.ai endpoint
const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://sipsentinel.example.com', // Required for billing
    'X-Title': 'SIPSentinel Scam Detector', // Shows in OpenRouter logs
    'Content-Type': 'application/json'
  },
  dangerouslyAllowBrowser: true
});

/**
 * Analyze a message using LLM to detect scams
 * @param {string} message - The message to analyze
 * @returns {Promise<Object>} - Analysis results
 */
async function analyzeMessageWithLLM(message) {
  try {
    console.log('Analyzing message with LLM:', message);
    console.log('Using OpenRouter API key:', process.env.OPENROUTER_API_KEY ? 'Key is set' : 'Key is not set');

    const prompt = `
You are a cybersecurity expert specializing in detecting scam messages, particularly voice and text scams.

Analyze the following message and determine:
1. Is this a scam message? (yes/no)
2. If it's a scam, what company or service is it impersonating?
3. What callback method is requested? (phone number to call back, press a key, etc.)
4. If there's a phone number in the message, extract it exactly as it appears
5. What type of scam is it? (crypto exchange, IT support, banking, etc.)
6. How confident are you in your assessment? (0-100%)

IMPORTANT INSTRUCTIONS:

1. Pay special attention to phone numbers in the message. Scammers often include a callback number that's different from the sender's number. Extract any phone numbers that appear in the message, even if they're formatted with spaces, dashes, or parentheses.

2. For the impersonatedCompany field, use the actual company name (e.g., "Kraken", "Coinbase", "Microsoft"). 

3. For the scamType field, use "crypto_exchange" for cryptocurrency exchanges like Kraken, Coinbase, Binance, etc.

4. Pay close attention to common transcription errors, e.g. "Crack and" should be interpreted as "Kraken".

5. The "impersonatedCompany" field must contain ONLY the corrected company name, without any extra text or explanation. E.g. only say "Kraken" and not "Crack and (corrected to) Kraken".

Message to analyze:
---
${message}
---

Respond with a JSON object in this exact format:
{
  "isScam": true/false,
  "impersonatedCompany": "company name or null if none",
  "callbackMethod": {
    "type": "phone_number" or "press_key" or "none",
    "details": "the actual phone number or key to press or null"
  },
  "phoneNumber": "the exact phone number from the message or null if none",
  "scamType": "crypto_exchange" or "it_support" or "banking" or "other" or "not_a_scam",
  "confidence": 85,
  "reasoning": "brief explanation of your analysis"
}
`;

    const response = await openai.chat.completions.create({
      model: 'meta-llama/llama-3.3-8b-instruct:free',
      messages: [
        { role: 'system', content: 'You are a cybersecurity expert specializing in scam detection.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1, // Low temperature for more deterministic responses
      max_tokens: 1000
      // Removed response_format parameter as it's not supported by this model
    });

    const analysisText = response.choices[0].message.content;
    console.log('LLM analysis response:', analysisText);

    try {
      // Extract JSON from the response (it might be wrapped in markdown code blocks)
      let jsonStr = analysisText;

      // Check if the response contains a JSON object wrapped in markdown code blocks
      const jsonMatch = analysisText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        jsonStr = jsonMatch[1];
        console.log('Extracted JSON from markdown code blocks:', jsonStr);
      }

      // Parse the JSON response
      const analysis = JSON.parse(jsonStr);

      // Post-processing to correct common LLM misclassifications.
      if (analysis.impersonatedCompany) {
        const companyLower = analysis.impersonatedCompany.toLowerCase();
        const cryptoCompanies = ['kraken', 'coinbase', 'binance'];
        if (cryptoCompanies.includes(companyLower)) {
          console.log(`Correcting scamType to 'crypto_exchange' for company: ${analysis.impersonatedCompany}`);
          analysis.scamType = 'crypto_exchange';
        }
      }
      
      // Validate the analysis object
      if (!analysis.isScam || !analysis.scamType || !analysis.impersonatedCompany) {
        console.warn('LLM analysis missing required fields:', analysis);
      }

      return analysis;
    } catch (parseError) {
      console.error('Error parsing LLM response as JSON:', parseError);
      console.log('Raw response:', analysisText);

      // Try to extract information from the response using regex
      try {
        console.log('Attempting to extract information using regex...');

        // Check if it contains "isScam": true or similar
        const isScam = /["']isScam["']\s*:\s*true/i.test(analysisText);

        // Try to extract the impersonated company
        let impersonatedCompany = null;
        const companyMatch = analysisText.match(/["']impersonatedCompany["']\s*:\s*["']([^"']+)["']/i);
        if (companyMatch && companyMatch[1]) {
          impersonatedCompany = companyMatch[1];
        }

        // Try to extract the callback method
        let callbackMethod = { type: 'none', details: null };
        const callbackTypeMatch = analysisText.match(/["']type["']\s*:\s*["']([^"']+)["']/i);
        if (callbackTypeMatch && callbackTypeMatch[1]) {
          callbackMethod.type = callbackTypeMatch[1];
        }

        // Try to extract the scam type
        let scamType = 'not_a_scam';
        const scamTypeMatch = analysisText.match(/["']scamType["']\s*:\s*["']([^"']+)["']/i);
        if (scamTypeMatch && scamTypeMatch[1]) {
          scamType = scamTypeMatch[1];
        }

        // Try to extract the confidence
        let confidence = 0;
        const confidenceMatch = analysisText.match(/["']confidence["']\s*:\s*(\d+)/i);
        if (confidenceMatch && confidenceMatch[1]) {
          confidence = parseInt(confidenceMatch[1], 10);
        }

        console.log('Extracted information using regex:', {
          isScam,
          impersonatedCompany,
          callbackMethod,
          scamType,
          confidence
        });

        return {
          isScam,
          impersonatedCompany,
          callbackMethod,
          scamType,
          confidence,
          reasoning: 'Extracted from LLM response using regex'
        };
      } catch (regexError) {
        console.error('Error extracting information using regex:', regexError);

        // Return a default response if all parsing fails
        return {
          isScam: false,
          impersonatedCompany: null,
          callbackMethod: {
            type: 'none',
            details: null
          },
          scamType: 'not_a_scam',
          confidence: 0,
          reasoning: 'Error parsing LLM response'
        };
      }
    }
  } catch (error) {
    console.error('Error analyzing message with LLM:', error);

    // Return a default response if the API call fails
    return {
      isScam: false,
      impersonatedCompany: null,
      callbackMethod: {
        type: 'none',
        details: null
      },
      scamType: 'not_a_scam',
      confidence: 0,
      reasoning: `Error calling LLM API: ${error.message}`
    };
  }
}

/**
 * Check if a message meets the criteria for engaging a scammer.
 * @param {Object} scamAnalysis - The scam analysis results
 * @param {string} messageText - The message/transcript text
 * @param {number} duration - The recording duration in seconds (optional)
 * @returns {boolean} - Whether the scammer should be engaged
 */
function shouldEngageScammer(scamAnalysis, messageText, duration = null) {
  // Check if transcript exists and has minimum length
  if (!messageText || messageText.trim().length < SCAM_DETECTION_THRESHOLDS.MIN_TRANSCRIPT_LENGTH) {
    console.log('Message filtered out: Empty or too short');
    return false;
  }

  // Check if recording has minimum duration (if duration is provided)
  if (duration !== null && duration < SCAM_DETECTION_THRESHOLDS.MIN_RECORDING_DURATION) {
    console.log(`Message filtered out: Duration ${duration}s below minimum ${SCAM_DETECTION_THRESHOLDS.MIN_RECORDING_DURATION}s`);
    return false;
  }

  // Check if scam analysis exists
  if (!scamAnalysis) {
    console.log('Message filtered out: No scam analysis available');
    return false;
  }

  // Check LLM-based detection first (if available)
  if (scamAnalysis.confidence !== undefined) {
    const meetsLLMThreshold = scamAnalysis.confidence >= SCAM_DETECTION_THRESHOLDS.MIN_LLM_CONFIDENCE;
    if (!meetsLLMThreshold) {
      console.log(`Message filtered out: LLM confidence ${scamAnalysis.confidence} below threshold ${SCAM_DETECTION_THRESHOLDS.MIN_LLM_CONFIDENCE}`);
      return false;
    }
  }

  // Check if it's classified as a scam
  if (scamAnalysis.isScam === false) {
    console.log('Message filtered out: Classified as non-scam');
    return false;
  }

  // For regex-based detection, check scam score
  if (scamAnalysis.details && scamAnalysis.details.scamScore !== undefined) {
    const meetsRegexThreshold = scamAnalysis.details.scamScore >= SCAM_DETECTION_THRESHOLDS.MIN_REGEX_SCAM_SCORE;
    if (!meetsRegexThreshold) {
      console.log(`Message filtered out: Regex scam score ${scamAnalysis.details.scamScore} below threshold ${SCAM_DETECTION_THRESHOLDS.MIN_REGEX_SCAM_SCORE}`);
      return false;
    }
  }

  // If we get here, the message meets all criteria
  console.log('Message passed filtering criteria for engagement');
  return true;
}

module.exports = {
  analyzeMessageWithLLM,
  shouldEngageScammer,
  SCAM_DETECTION_THRESHOLDS
};
