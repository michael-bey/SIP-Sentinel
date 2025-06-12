/**
 * API Endpoint for Dashboard Data
 *
 * Provides a consolidated endpoint for the frontend dashboard to fetch initial data
 * Fetches, processes, and returns all data required for the dashboard.
 * Includes caching for improved performance.
 */
const NodeCache = require('node-cache');
const { listRecentCallMetadata, getCallMetadata } = require('../src/s3-storage-service');
const { listVapiCalls, redactPhoneNumber } = require('../src/vapi-service');
const { shouldEngageScammer } = require('../src/llm-scam-detector');
const { getAllActiveCalls } = require('../src/redis-service');

// Initialize cache with 30 second TTL for dashboard data
const dashboardCache = new NodeCache({
  stdTTL: 30, // 30 seconds
  checkperiod: 60, // Check for expired keys every 60 seconds
  useClones: false // Don't clone objects for better performance
});

/**
 * Redact phone numbers from transcript text for privacy protection
 * Handles various phone number formats including spaced digits
 * @param {string} text - Text to redact phone numbers from
 * @returns {string} Text with phone numbers redacted
 */
function redactPhoneNumbersFromTranscript(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }

  let redactedText = text;

  // Pattern 1: Spaced digits like "3 3 0 9 7 8 8 9 4 7" (common in voicemail transcripts)
  // Matches 10-11 digits with spaces between them
  const spacedDigitsPattern = /\b(\d\s){9,10}\d\b/g;
  redactedText = redactedText.replace(spacedDigitsPattern, (match) => {
    const digits = match.replace(/\s/g, '');
    return redactPhoneNumber(digits);
  });

  // Pattern 2: Standard phone number formats
  const phonePatterns = [
    // US formats with country code
    /\+?1[-.\s]?(\d{3})[-.\s]?(\d{3})[-.\s]?(\d{4})\b/g,
    // US formats without country code:
    /\b(\d{3})[-.\s]?(\d{3})[-.\s]?(\d{4})\b/g,
    // Parentheses format:
    /\(\d{3}\)\s?-?\d{3}-?\d{4}\b/g,
    // Long format without separators
    /\b1?\d{10}\b/g
  ];

  phonePatterns.forEach(pattern => {
    redactedText = redactedText.replace(pattern, (match) => {
      // Extract just the digits
      const digits = match.replace(/\D/g, '');
      // Only redact if it looks like a valid phone number (10-11 digits)
      if (digits.length >= 10 && digits.length <= 11) {
        return redactPhoneNumber(digits);
      }
      return match; // Return original if not a valid phone number
    });
  });

  return redactedText;
}

/**
 * Format transcript for beautiful display with proper speaker styling
 * @param {string} transcript - Raw transcript text
 * @param {string} transcriptType - Type of transcript ('scam_voicemail' or 'agent_conversation')
 * @returns {string} Formatted HTML transcript
 */
function formatTranscriptForDisplay(transcript, transcriptType = 'scam_voicemail') {
  if (!transcript) return 'No transcript available';

  // Clean up the transcript but be more conservative about removing content
  let formatted = transcript.trim();

  // Redact phone numbers first
  formatted = redactPhoneNumbersFromTranscript(formatted);

  // Remove the header if it exists (added by backend formatting)
  formatted = formatted.replace(/^=== VOICEMAIL TRANSCRIPT ===[\s\S]*?\n\n/, '');

  // For voicemails, treat the entire content as coming from the caller
  if (transcriptType === 'scam_voicemail') {
    // Remove any existing speaker labels that might have been added
    formatted = formatted.replace(/^(AI|Agent|User|Caller):\s*/gmi, '');

    // Split into sentences or natural breaks, but preserve all content
    const sentences = formatted.split(/(?<=[.!?])\s+/).filter(s => s.trim());

    if (sentences.length > 0) {
      // Group sentences into logical chunks (every 2-3 sentences)
      const chunks = [];
      for (let i = 0; i < sentences.length; i += 2) {
        const chunk = sentences.slice(i, i + 2).join(' ').trim();
        if (chunk) {
          chunks.push(`<strong class="speaker-user">Caller:</strong> ${chunk}`);
        }
      }
      formatted = chunks.join('<br>');
    } else {
      // If no sentences found, treat as single block
      formatted = `<strong class="speaker-user">Caller:</strong> ${formatted}`;
    }
  } else {
    // For agent conversations, use the existing speaker detection logic
    const lines = formatted.split(/\r?\n/).filter(line => line.trim());
    const processedLines = [];

    for (const line of lines) {
      if (!line.trim()) continue;

      if (line.match(/^(AI|Agent):/i)) {
        const content = line.replace(/^(AI|Agent):\s*/i, '');
        processedLines.push(`<strong class="speaker-ai">Agent:</strong> ${content}`);
      } else if (line.match(/^(User|Caller):/i)) {
        const content = line.replace(/^(User|Caller):\s*/i, '');
        processedLines.push(`<strong class="speaker-user">Caller:</strong> ${content}`);
      } else {
        // Determine speaker based on content for agent conversations
        if (line.match(/^(Hello|Hi|Hey|Thank you|Please|All of our calls|To Coinbase)/i)) {
          processedLines.push(`<strong class="speaker-ai">Agent:</strong> ${line}`);
        } else {
          processedLines.push(`<strong class="speaker-user">Caller:</strong> ${line}`);
        }
      }
    }

    formatted = processedLines.join('<br>');
  }

  // If no content after processing, add default
  if (!formatted.trim()) {
    if (transcriptType === 'scam_voicemail') {
      formatted = '<strong class="speaker-user">Caller:</strong> No transcript available';
    } else {
      formatted = '<strong class="speaker-ai">Agent:</strong> No transcript available';
    }
  }

  // Return properly formatted transcript with CSS classes
  return `<div class="transcript-content">
    <div class="transcript-body">
      ${formatted}
    </div>
  </div>`;
}

module.exports = async (req, res) => {
  try {
    // Check cache first
    const cacheKey = 'dashboard_data';
    const cachedData = dashboardCache.get(cacheKey);

    if (cachedData && !req.query.nocache) {
      console.log('📋 Serving dashboard data from cache');
      return res.status(200).json({
        ...cachedData,
        cached: true,
        cacheTimestamp: cachedData.serverTime
      });
    }

    console.log('📋 Fetching fresh dashboard data');

    // Fetch data from S3, VAPI, and Redis concurrently
    const [s3CallData, vapiCalls, activeCalls] = await Promise.all([
      listRecentCallMetadata(20),
      listVapiCalls({ limit: 20 }),
      getAllActiveCalls().catch(error => {
        console.warn('Failed to get active calls from Redis:', error);
        return [];
      })
    ]);

    // Process S3 voicemails
    const scamVoicemails = s3CallData
      .filter(call => {
        const isLongEnough = (call.recordingDuration || 0) >= 30;
        const shouldDisplay = shouldEngageScammer(call.scamAnalysis, call.transcriptionText, call.recordingDuration);
        const hasValidRecordingSid = call.recordingSid && call.recordingSid !== 'undefined';
        return isLongEnough && shouldDisplay && hasValidRecordingSid;
      })
      .map(call => {
        const scamAnalysis = call.scamAnalysis || {};

        // Get phone numbers with redaction
        const originalCaller = call.callerNumber || call.from || null;
        const callbackNumber = scamAnalysis.phoneNumber || null; // Extracted callback number from scam
        const redactedOriginalCaller = originalCaller ? redactPhoneNumber(originalCaller) : null;
        const redactedCallbackNumber = callbackNumber ? redactPhoneNumber(callbackNumber) : null;

        // Format transcript with beautiful speaker styling
        const fullFormattedTranscript = formatTranscriptForDisplay(call.transcriptionText || '', 'scam_voicemail');
        // Create a truncated preview for the list view
        const plainText = (call.transcriptionText || '').replace(/\n/g, ' ').trim();
        const redactedPlainText = redactPhoneNumbersFromTranscript(plainText);
        const truncatedMessage = redactedPlainText.substring(0, 150) + (redactedPlainText.length > 150 ? '...' : '');

        return {
          id: call.callSid,
          company: scamAnalysis.company || 'Unknown',
          scamType: scamAnalysis.scamType || 'unknown',
          message: truncatedMessage,
          timestamp: new Date(call.timestamp),
          confidence: scamAnalysis.confidence || 0,
          audioUrl: `/api/audio/${call.recordingSid}`,
          transcriptUrl: `/api/transcriptions/${call.callSid}/${call.recordingSid}`, // For full transcript access
          transcript: fullFormattedTranscript, // Full formatted transcript for immediate display
          type: 'scam_voicemail',
          // Phone number information with redaction
          originalCaller: originalCaller, // Original caller (who called our Twilio number)
          redactedOriginalCaller: redactedOriginalCaller, // For display
          callbackNumber: callbackNumber, // Extracted callback number from scam message
          redactedCallbackNumber: redactedCallbackNumber // For display
        };
      });

    // Process VAPI agent conversations
    const agentConversations = await Promise.all(
      vapiCalls
        .filter(call => (call.duration || 0) >= 30)
        .map(async call => {
        // Get phone numbers with redaction
        const callbackNumber = call.customer?.number || call.phoneNumber;
        const redactedCallbackNumber = redactPhoneNumber(callbackNumber);

        // For now, we don't have the original caller number in VAPI calls
        // This would need to be stored when the call is initiated
        const originalCallerNumber = call.metadata?.originalCaller || null;
        const redactedOriginalCaller = originalCallerNumber ? redactPhoneNumber(originalCallerNumber) : null;

        // Format transcript with beautiful speaker styling
        let fullFormattedTranscript = `Agent conversation with ${redactedCallbackNumber}`;
        let truncatedMessage = fullFormattedTranscript;

        if (call.transcript) {
          // Create full formatted transcript with beautiful styling
          fullFormattedTranscript = formatTranscriptForDisplay(call.transcript, 'agent_conversation');

          // Create truncated preview for list view
          const plainText = call.transcript.replace(/\n/g, ' ').trim();
          const redactedPlainText = redactPhoneNumbersFromTranscript(plainText);
          truncatedMessage = redactedPlainText.substring(0, 150) + (redactedPlainText.length > 150 ? '...' : '');
        }

        // Get the original confidence score from metadata, with fallback to S3 lookup
        let confidence = 60; // Default fallback
        if (call.metadata?.confidence !== undefined) {
          confidence = call.metadata.confidence;
        } else if (call.metadata?.originalCallSid) {
          // Try to look up the original scam detection data from S3
          try {
            const originalCallMetadata = await getCallMetadata(call.metadata.originalCallSid);
            if (originalCallMetadata?.scamAnalysis?.confidence !== undefined) {
              confidence = originalCallMetadata.scamAnalysis.confidence;
            } else if (call.successful) {
              confidence = 95;
            }
          } catch (error) {
            console.warn(`Failed to lookup original confidence for call ${call.id}:`, error.message);
            confidence = call.successful ? 95 : 60;
          }
        } else if (call.successful) {
          confidence = 95;
        }

        return {
          id: call.id,
          company: call.assistant?.name?.split(' ')[0] || 'Unknown',
          agentName: call.assistant?.name || 'Unknown Agent',
          scamType: 'agent_conversation',
          message: truncatedMessage,
          timestamp: new Date(call.startedAt || call.createdAt),
          confidence: confidence,
          successful: !!call.successful,      // <-- keep for later stats
          audioUrl: call.recordingUrl ? `/api/vapi-audio/${encodeURIComponent(call.recordingUrl)}` : null,
          transcript: fullFormattedTranscript, // Full formatted transcript for immediate display
          duration: call.duration,
          type: 'agent_conversation',
          // Phone number information with redaction
          phoneNumber: callbackNumber, // Keep original for internal use
          redactedPhoneNumber: redactedCallbackNumber, // For display
          originalCaller: originalCallerNumber, // Original caller (if available)
          redactedOriginalCaller: redactedOriginalCaller, // For display
        };
      })
    );

    // Combine and sort all items
    const recentScams = [...scamVoicemails, ...agentConversations]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 20);

    // Calculate stats
    const successfulConversations = agentConversations.filter(c => c.successful);
    const successRate = agentConversations.length > 0
      ? Math.round((successfulConversations.length / agentConversations.length) * 100)
      : 0;
    
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const scamsThisWeek = scamVoicemails.filter(scam => new Date(scam.timestamp) >= oneWeekAgo).length;

    const responseData = {
      status: 'ok',
      stats: {
        scamsDetectedThisWeek: scamsThisWeek,
        agentConversations: agentConversations.length,
        successfulConversations: successfulConversations.length,
        activeCalls: activeCalls.length, // Use Redis active calls count
        detectionStatus: 'active',
        successRate: successRate,
      },
      recentScams: recentScams,
      activeCalls: activeCalls, // Include active calls data
      serverTime: new Date().toISOString(),
    };

    // Cache the response data
    dashboardCache.set(cacheKey, responseData);
    console.log('📋 Dashboard data cached for 30 seconds');

    res.status(200).json(responseData);
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch dashboard data',
      error: error.message
    });
  }
}; 