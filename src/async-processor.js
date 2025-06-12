/**
 * Async processor for heavy operations to avoid Vercel timeouts
 * Handles LLM analysis, VAPI calls, and webhooks asynchronously
 * Optimized for Vercel's 60-second timeout limit
 */

const { analyzeMessageWithLLM } = require('./llm-scam-detector');
const { createVapiCall } = require('./vapi-service');
const {
  notifyAgentCallStatus,
  notifyScamDetected,
  notifyOnCallEnded,
  notifyOnCallInitiated
} = require('./webhook-service');
const { queueTelegramUpload } = require('./qstash-service');
const { removeActiveCall } = require('./redis-service');

// Timeout configurations optimized for Vercel
const TIMEOUTS = {
  LLM_ANALYSIS: 15000,      // 15 seconds for LLM analysis
  VAPI_CALL_CREATION: 10000, // 10 seconds for VAPI call creation
  WEBHOOK_NOTIFICATIONS: 5000, // 5 seconds for webhooks
  TOTAL_PROCESSING: 45000   // 45 seconds total (15s buffer for Vercel)
};

/**
 * Timeout wrapper for async operations
 */
async function withTimeout(promise, timeoutMs, operation) {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

/**
 * Process scam detection and callback asynchronously with timeout protection
 * This runs after the main webhook response to avoid timeouts
 */
async function processScamDetectionAsync(transcriptionText, callerNumber, callSid, regexAnalysis) {
  const startTime = Date.now();

  try {
    console.log('🔄 Starting async scam processing with timeout protection...');

    // Check if we have enough time to process
    if (Date.now() - startTime > TIMEOUTS.TOTAL_PROCESSING) {
      throw new Error('Processing started too late, skipping to avoid timeout');
    }

    // Step 1: LLM Analysis with timeout protection
    let llmAnalysis = null;
    try {
      console.log('🤖 Running LLM analysis with timeout...');
      const llmPromise = analyzeMessageWithLLM(transcriptionText);
      llmAnalysis = await withTimeout(llmPromise, TIMEOUTS.LLM_ANALYSIS, 'LLM Analysis');
      console.log('✅ LLM analysis complete:', {
        isScam: llmAnalysis.isScam,
        confidence: llmAnalysis.confidence,
        timeElapsed: Date.now() - startTime
      });
    } catch (error) {
      console.error('❌ LLM analysis failed or timed out:', error.message);
      // Continue with regex-only analysis
    }

    // Step 2: Combine analysis results
    const finalIsScam = llmAnalysis?.isScam || regexAnalysis.isScam;
    const finalScamType = llmAnalysis?.scamType || regexAnalysis.scamType;
    const finalConfidence = llmAnalysis?.confidence || (regexAnalysis.scamDetails?.scamScore * 10) || 0;
    
    console.log('📊 Final analysis:', { 
      isScam: finalIsScam, 
      scamType: finalScamType, 
      confidence: finalConfidence 
    });

    // Step 3: Send scam detection notification (fast)
    if (finalIsScam) {
      try {
        // Extract and normalize company name
        let impersonatedCompany = llmAnalysis?.impersonatedCompany || 'Unknown';

        if (!llmAnalysis?.impersonatedCompany) {
          // If LLM didn't provide company, extract from regex analysis
          const rawCompany = regexAnalysis.scamDetails?.cryptoTerms?.[0] ||
                           regexAnalysis.scamDetails?.itTerms?.[0];

          if (rawCompany) {
            // Normalize company names to proper case
            const normalized = rawCompany.toLowerCase();
            if (normalized === 'kraken' || normalized === 'crack' || normalized === 'crackin' || normalized === 'cracken' || normalized === 'kracken') {
              impersonatedCompany = 'Kraken';
            } else if (normalized === 'coinbase' || normalized === 'coin base') {
              impersonatedCompany = 'Coinbase';
            } else if (normalized === 'binance') {
              impersonatedCompany = 'Binance';
            } else if (normalized === 'microsoft' || normalized === 'micro soft') {
              impersonatedCompany = 'Microsoft';
            } else if (normalized === 'apple') {
              impersonatedCompany = 'Apple';
            } else if (normalized === 'google') {
              impersonatedCompany = 'Google';
            } else {
              // Capitalize first letter for other companies
              impersonatedCompany = rawCompany.charAt(0).toUpperCase() + rawCompany.slice(1).toLowerCase();
            }
          }
        }

        await notifyScamDetected({
          callerNumber: callerNumber,
          scamType: finalScamType,
          confidence: finalConfidence,
          company: impersonatedCompany, // Use 'company' instead of 'impersonatedCompany' for consistency
          impersonatedCompany: impersonatedCompany, // Keep both for backward compatibility
          callSid: callSid,
          transcriptionUrl: null,
          recordingUrl: null
        });
      } catch (error) {
        console.error('❌ Error sending scam detection notification:', error);
      }
    }

    // Step 4: Create VAPI call if scam detected with timeout protection
    if (finalIsScam && callerNumber && finalConfidence >= 70) {
      // Check if we have enough time left for VAPI call creation
      const timeElapsed = Date.now() - startTime;
      if (timeElapsed > TIMEOUTS.TOTAL_PROCESSING - TIMEOUTS.VAPI_CALL_CREATION) {
        console.log('⏰ Not enough time left for VAPI call creation, skipping to avoid timeout');
        return {
          success: true,
          scamDetected: true,
          confidence: finalConfidence,
          reason: 'timeout_protection_vapi_skipped'
        };
      }

      try {
        console.log('📞 Creating VAPI agent callback with timeout protection...');

        const finalScamDetails = {
          ...regexAnalysis.scamDetails,
          llmAnalysis: llmAnalysis
        };

        const vapiPromise = createVapiCall(callerNumber, finalScamType, finalScamDetails);
        const call = await withTimeout(vapiPromise, TIMEOUTS.VAPI_CALL_CREATION, 'VAPI Call Creation');
        console.log('✅ VAPI call created:', call.id, 'Time elapsed:', Date.now() - startTime);

        // Note: createVapiCall() already sends the 'agent call initiated' notification
        // No need to send duplicate notification here
        console.log('✅ VAPI call created and notification sent by createVapiCall():', call.id);

        return {
          success: true,
          callId: call.id,
          scamDetected: true,
          confidence: finalConfidence
        };

      } catch (error) {
        console.error('❌ Error creating VAPI call:', error);
        return {
          success: false,
          error: error.message,
          scamDetected: true,
          confidence: finalConfidence
        };
      }
    } else {
      console.log('ℹ️ No callback triggered:', {
        isScam: finalIsScam,
        hasCallerNumber: !!callerNumber,
        confidence: finalConfidence,
        meetsThreshold: finalConfidence >= 70
      });
      
      return {
        success: true,
        scamDetected: finalIsScam,
        confidence: finalConfidence,
        reason: !finalIsScam ? 'not_a_scam' : 
                !callerNumber ? 'no_caller_number' : 
                'confidence_too_low'
      };
    }

  } catch (error) {
    console.error('❌ Error in async scam processing:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Process webhook notifications asynchronously
 * This can be called after the main response to avoid blocking
 */
async function processWebhooksAsync(event, data, recordingUrl = null) {
  try {
    console.log(`🔔 Processing webhooks for event: ${event}`);
    
    const results = [];
    
    // Send notifications in parallel for speed
    const [agentResult, statusResult] = await Promise.allSettled([
      event === 'agent_call_initiated' ? notifyAgentCallInitiated(data) : Promise.resolve(null),
      event !== 'agent_call_initiated' ? notifyAgentCallStatus(event, data, recordingUrl) : Promise.resolve(null)
    ]);

    if (agentResult.status === 'fulfilled' && agentResult.value) {
      results.push({ type: 'agent_initiated', success: true, data: agentResult.value });
    } else if (agentResult.status === 'rejected') {
      results.push({ type: 'agent_initiated', success: false, error: agentResult.reason });
    }

    if (statusResult.status === 'fulfilled' && statusResult.value) {
      results.push({ type: 'status_update', success: true, data: statusResult.value });
    } else if (statusResult.status === 'rejected') {
      results.push({ type: 'status_update', success: false, error: statusResult.reason });
    }

    console.log('✅ Webhook processing complete');
    return results;

  } catch (error) {
    console.error('❌ Error processing webhooks:', error);
    return [{ type: 'error', success: false, error: error.message }];
  }
}

async function handleVapiEvent(event) {
  try {
    const { type, call } = event.message;

    // We only care about call-related events
    if (!type.startsWith('call.')) return;

    console.log(`Processing VAPI event: ${type}`);

    // When the agent call ends, notify via webhooks
    if (type === 'call.ended') {
      const { notifyOnCallEnded } = require('./webhook-service');
      const { queueTelegramUpload } = require('./qstash-service');
      const { removeActiveCall } = require('./redis-service');

      const callData = call;
      console.log('Call ended data for notification:', callData);
      
      // Enqueue a task to handle the recording upload to Telegram
      await queueTelegramUpload({ callId: callData.id });
      console.log(`Enqueued Telegram upload task for call ${callData.id}`);

      // Send other (non-audio) notifications immediately
      await notifyOnCallEnded(callData, { sendAudio: false });

      // Clean up the call from Redis
      if (callData.id) {
        await removeActiveCall(callData.id);
        console.log(`Removed active call ${callData.id} from Redis.`);
      }
    }

    // When an agent call is initiated, send a notification
    if (type === 'call.started') {
      await notifyOnCallInitiated(call);
    }

  } catch (error) {
    console.error('Error handling VAPI event:', error.message);
  }
}

/**
 * Main function to start the async processor.
 */
async function startAsyncProcessor() {
  // Implementation of startAsyncProcessor function
}

module.exports = {
  processScamDetectionAsync,
  processWebhooksAsync,
  handleVapiEvent,
  startAsyncProcessor
};
