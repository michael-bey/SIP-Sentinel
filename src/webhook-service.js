const axios = require('axios');
const crypto = require('crypto');
const TelegramBot = require('node-telegram-bot-api');
const FormData = require('form-data');

/**
 * Webhook Service for SIPSentinel
 * Handles outgoing webhook notifications when agent calls are initiated or status changes
 */

// Configuration
const WEBHOOK_CONFIG = {
  timeout: 10000, // 10 seconds
  retryAttempts: 3,
  retryDelay: 1000, // 1 second initial delay
  maxRetryDelay: 30000, // 30 seconds max delay
};

// Webhook event types
const WEBHOOK_EVENTS = {
  AGENT_CALL_INITIATED: 'agent_call_initiated',
  AGENT_CALL_STARTED: 'agent_call_started',
  AGENT_CALL_ENDED: 'agent_call_ended',
  AGENT_CALL_FAILED: 'agent_call_failed',
  SCAM_DETECTED: 'scam_detected'
};

/**
 * Generate webhook signature for security
 * @param {string} payload - JSON payload
 * @param {string} secret - Webhook secret
 * @returns {string} Signature
 */
function generateSignature(payload, secret) {
  if (!secret) return null;
  
  return crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex');
}

/**
 * Send webhook with retry logic
 * @param {string} url - Webhook URL
 * @param {Object} payload - Webhook payload
 * @param {string} secret - Optional webhook secret for signature
 * @param {number} attempt - Current attempt number
 * @returns {Promise<Object>} Response object
 */
async function sendWebhookWithRetry(url, payload, secret = null, attempt = 1) {
  try {
    const payloadString = JSON.stringify(payload);
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'SIPSentinel-Webhook/1.0'
    };

    // Add signature if secret is provided
    if (secret) {
      const signature = generateSignature(payloadString, secret);
      headers['X-SIPSentinel-Signature'] = `sha256=${signature}`;
    }

    console.log(`Sending webhook to ${url} (attempt ${attempt}/${WEBHOOK_CONFIG.retryAttempts})`);
    
    const response = await axios.post(url, payload, {
      headers,
      timeout: WEBHOOK_CONFIG.timeout,
      validateStatus: (status) => status >= 200 && status < 300
    });

    console.log(`Webhook delivered successfully to ${url}: ${response.status}`);
    return {
      success: true,
      status: response.status,
      attempt,
      url
    };

  } catch (error) {
    console.error(`Webhook delivery failed to ${url} (attempt ${attempt}):`, error.message);

    // If this was the last attempt, return failure
    if (attempt >= WEBHOOK_CONFIG.retryAttempts) {
      return {
        success: false,
        error: error.message,
        attempt,
        url,
        finalAttempt: true
      };
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(
      WEBHOOK_CONFIG.retryDelay * Math.pow(2, attempt - 1),
      WEBHOOK_CONFIG.maxRetryDelay
    );

    console.log(`Retrying webhook to ${url} in ${delay}ms...`);
    
    // Wait before retry
    await new Promise(resolve => setTimeout(resolve, delay));
    
    // Retry
    return sendWebhookWithRetry(url, payload, secret, attempt + 1);
  }
}

/**
 * Send webhook to multiple URLs
 * @param {Array<string>} urls - Array of webhook URLs
 * @param {Object} payload - Webhook payload
 * @param {string} secret - Optional webhook secret
 * @returns {Promise<Array>} Array of response objects
 */
async function sendWebhooks(urls, payload, secret = null) {
  if (!urls || urls.length === 0) {
    console.log('No webhook URLs configured, skipping webhook delivery');
    return [];
  }

  console.log(`Sending webhooks to ${urls.length} URL(s) for event: ${payload.event}`);

  // Send to all URLs in parallel
  const promises = urls.map(url => sendWebhookWithRetry(url, payload, secret));
  const results = await Promise.allSettled(promises);

  return results.map((result, index) => ({
    url: urls[index],
    ...(result.status === 'fulfilled' ? result.value : { success: false, error: result.reason.message })
  }));
}

/**
 * Create webhook payload for agent call initiated event
 * @param {Object} callData - Call data
 * @returns {Object} Webhook payload
 */
function createAgentCallInitiatedPayload(callData) {
  return {
    event: WEBHOOK_EVENTS.AGENT_CALL_INITIATED,
    timestamp: new Date().toISOString(),
    data: {
      callId: callData.callId,
      agentName: callData.agentName,
      company: callData.company,
      phoneNumber: callData.phoneNumber ? maskPhoneNumber(callData.phoneNumber) : null,
      scamType: callData.scamType,
      scamDetails: callData.scamDetails,
      originalCaller: callData.originalCaller ? maskPhoneNumber(callData.originalCaller) : null,
      agentId: callData.agentId
    }
  };
}

/**
 * Create webhook payload for agent call status events
 * @param {string} event - Event type
 * @param {Object} callData - Call data
 * @returns {Object} Webhook payload
 */
function createAgentCallStatusPayload(event, callData) {
  const basePayload = {
    event,
    timestamp: new Date().toISOString(),
    data: {
      callId: callData.callId,
      status: callData.status
    }
  };

  // Add additional data based on event type
  switch (event) {
    case WEBHOOK_EVENTS.AGENT_CALL_STARTED:
      basePayload.data.startTime = callData.startTime;
      break;
      
    case WEBHOOK_EVENTS.AGENT_CALL_ENDED:
      basePayload.data.endTime = callData.endTime;
      basePayload.data.duration = callData.duration;
      basePayload.data.successful = callData.successful;
      break;
      
    case WEBHOOK_EVENTS.AGENT_CALL_FAILED:
      basePayload.data.failureReason = callData.failureReason;
      basePayload.data.endTime = callData.endTime;
      break;
  }

  return basePayload;
}

/**
 * Create webhook payload for scam detected event
 * @param {Object} scamData - Scam detection data
 * @returns {Object} Webhook payload
 */
function createScamDetectedPayload(scamData) {
  return {
    event: WEBHOOK_EVENTS.SCAM_DETECTED,
    timestamp: new Date().toISOString(),
    data: {
      callerNumber: scamData.callerNumber ? maskPhoneNumber(scamData.callerNumber) : null,
      scamType: scamData.scamType,
      confidence: scamData.confidence,
      impersonatedCompany: scamData.impersonatedCompany,
      callSid: scamData.callSid,
      transcriptionUrl: scamData.transcriptionUrl,
      recordingUrl: scamData.recordingUrl
    }
  };
}

/**
 * Mask phone number for privacy
 * @param {string} phoneNumber - Phone number to mask
 * @returns {string} Masked phone number
 */
function maskPhoneNumber(phoneNumber) {
  if (!phoneNumber || phoneNumber.length < 4) return phoneNumber;

  // Keep first 3 and last 2 digits, mask the rest
  const visible = phoneNumber.slice(0, 3) + '*'.repeat(phoneNumber.length - 5) + phoneNumber.slice(-2);
  return visible;
}

/**
 * Get emoji for company
 * @param {string} company - Company name
 * @returns {string} Emoji
 */
function getCompanyEmoji(company) {
  const companyLower = (company || '').toLowerCase();

  if (companyLower.includes('coinbase')) return '🟠';
  if (companyLower.includes('kraken')) return '🐙';
  if (companyLower.includes('binance')) return '🟡';
  if (companyLower.includes('microsoft')) return '🪟';
  if (companyLower.includes('apple')) return '🍎';
  if (companyLower.includes('google')) return '🔍';
  if (companyLower.includes('amazon')) return '📦';
  if (companyLower.includes('paypal')) return '💳';

  return '🏢'; // Default company emoji
}

/**
 * Get emoji for scam type
 * @param {string} scamType - Scam type
 * @returns {string} Emoji
 */
function getScamTypeEmoji(scamType) {
  if (scamType === 'crypto_exchange') return '₿';
  if (scamType === 'it_support') return '💻';
  if (scamType === 'banking') return '🏦';

  return '⚠️'; // Default scam emoji
}

/**
 * Get emoji for failure reason
 * @param {string} reason - Failure reason
 * @returns {string} Emoji
 */
function getFailureEmoji(reason) {
  const reasonLower = (reason || '').toLowerCase();

  if (reasonLower.includes('busy')) return '📵';
  if (reasonLower.includes('no-answer')) return '🔇';
  if (reasonLower.includes('failed')) return '❌';
  if (reasonLower.includes('timeout')) return '⏰';

  return '📞'; // Default phone emoji
}

/**
 * Get confidence bar visualization
 * @param {number} confidence - Confidence percentage
 * @returns {string} Visual confidence bar
 */
function getConfidenceBar(confidence) {
  const bars = Math.floor(confidence / 10);
  const filled = '█'.repeat(bars);
  const empty = '░'.repeat(10 - bars);

  if (confidence >= 90) return `🔴 ${filled}${empty}`;
  if (confidence >= 70) return `🟠 ${filled}${empty}`;
  if (confidence >= 50) return `🟡 ${filled}${empty}`;

  return `🟢 ${filled}${empty}`;
}

/**
 * Get webhook URLs from environment
 * @returns {Array<string>} Array of webhook URLs
 */
function getWebhookUrls() {
  const urls = [];

  // Primary webhook URL
  if (process.env.WEBHOOK_URL) {
    urls.push(process.env.WEBHOOK_URL);
  }

  // Additional webhook URLs (comma-separated)
  if (process.env.WEBHOOK_URLS) {
    const additionalUrls = process.env.WEBHOOK_URLS.split(',').map(url => url.trim()).filter(url => url);
    urls.push(...additionalUrls);
  }

  return urls;
}

/**
 * Get Slack webhook URL from environment
 * @returns {string|null} Slack webhook URL
 */
function getSlackWebhookUrl() {
  return process.env.SLACK_WEBHOOK_URL || null;
}

/**
 * Get Telegram bot configuration from environment
 * @returns {Object|null} Telegram configuration
 */
function getTelegramConfig() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return null;
  }

  return {
    botToken,
    chatId
  };
}

/**
 * Create Slack message payload for agent call events
 * @param {string} event - Event type
 * @param {Object} data - Event data
 * @returns {Object} Slack message payload
 */
function createSlackMessage(event, data) {
  const timestamp = Math.floor(Date.now() / 1000);

  switch (event) {
    case WEBHOOK_EVENTS.AGENT_CALL_INITIATED:
      const scamTypeFormatted = data.scamType.replace('_', ' ').toUpperCase();
      const companyEmoji = getCompanyEmoji(data.company);

      return {
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "🎯 Scammer Engagement Initiated",
              emoji: true
            }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `${companyEmoji} *${data.agentName}* is now calling a scammer who impersonated *${data.company}*`
            }
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: `*🤖 Agent:*\n${data.agentName}`
              },
              {
                type: "mrkdwn",
                text: `*🏢 Company:*\n${data.company}`
              },
              {
                type: "mrkdwn",
                text: `*🚨 Scam Type:*\n${scamTypeFormatted}`
              },
              {
                type: "mrkdwn",
                text: `*📞 Target:*\n${data.phoneNumber}`
              }
            ]
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `🕐 ${new Date().toLocaleTimeString()} | 🛡️ SIPSentinel Defense System`
              }
            ]
          }
        ]
      };

    case WEBHOOK_EVENTS.AGENT_CALL_STARTED:
      return {
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "📞 *Agent Connected!* The scammer picked up the phone."
            }
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: `*🆔 Call ID:*\n\`${data.callId}\``
              },
              {
                type: "mrkdwn",
                text: "*📊 Status:*\n🟢 In Progress"
              }
            ]
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: "⏱️ Time-wasting session has begun! Let's see how long we can keep them busy..."
              }
            ]
          }
        ]
      };

    case WEBHOOK_EVENTS.AGENT_CALL_ENDED:
      const duration = Math.floor(data.duration / 60);
      const seconds = data.duration % 60;
      const durationText = duration > 0 ? `${duration}m ${seconds}s` : `${seconds}s`;

      if (data.successful) {
        return {
          blocks: [
            {
              type: "header",
              text: {
                type: "plain_text",
                text: "🎉 MISSION ACCOMPLISHED!",
                emoji: true
              }
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `🏆 *Excellent work!* Our agent successfully wasted *${durationText}* of a scammer's time!`
              }
            },
            {
              type: "section",
              fields: [
                {
                  type: "mrkdwn",
                  text: `*🆔 Call ID:*\n\`${data.callId}\``
                },
                {
                  type: "mrkdwn",
                  text: `*⏱️ Duration:*\n${durationText}`
                },
                {
                  type: "mrkdwn",
                  text: "*🎯 Result:*\n✅ SUCCESS (>5 min)"
                },
                {
                  type: "mrkdwn",
                  text: "*💰 Value:*\n🔥 Time Wasted!"
                }
              ]
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: "🛡️ Another scammer neutralized! Every minute counts in protecting potential victims."
                }
              ]
            }
          ]
        };
      } else {
        return {
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "⏱️ *Agent call ended* - Scammer hung up quickly"
              }
            },
            {
              type: "section",
              fields: [
                {
                  type: "mrkdwn",
                  text: `*🆔 Call ID:*\n\`${data.callId}\``
                },
                {
                  type: "mrkdwn",
                  text: `*⏱️ Duration:*\n${durationText}`
                },
                {
                  type: "mrkdwn",
                  text: "*📊 Result:*\n⚡ Short call"
                }
              ]
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: "🤔 They caught on quickly this time. Our agents will get them next time!"
                }
              ]
            }
          ]
        };
      }

    case WEBHOOK_EVENTS.AGENT_CALL_FAILED:
      const failureEmoji = getFailureEmoji(data.failureReason);

      return {
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `${failureEmoji} *Agent call failed* - Scammer didn't answer`
            }
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: `*🆔 Call ID:*\n\`${data.callId}\``
              },
              {
                type: "mrkdwn",
                text: `*❌ Reason:*\n${data.failureReason || 'Unknown'}`
              }
            ]
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: "🎯 No worries! We'll catch them next time they try to scam someone."
              }
            ]
          }
        ]
      };

    case WEBHOOK_EVENTS.SCAM_DETECTED:
      const scamEmoji = getScamTypeEmoji(data.scamType);
      const confidenceBar = getConfidenceBar(data.confidence);
      const scamCompanyEmoji = getCompanyEmoji(data.impersonatedCompany);

      return {
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "🚨 SCAM ALERT DETECTED",
              emoji: true
            }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `${scamEmoji} *Scammer detected!* Someone is impersonating ${scamCompanyEmoji} *${data.impersonatedCompany}*`
            }
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: `*🎭 Scam Type:*\n${data.scamType.replace('_', ' ').toUpperCase()}`
              },
              {
                type: "mrkdwn",
                text: `*🏢 Impersonating:*\n${scamCompanyEmoji} ${data.impersonatedCompany}`
              },
              {
                type: "mrkdwn",
                text: `*🎯 Confidence:*\n${confidenceBar} ${data.confidence}%`
              },
              {
                type: "mrkdwn",
                text: `*📞 Scammer Number:*\n${data.callerNumber}`
              }
            ]
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: "🤖 Deploying AI agent to waste their time and protect potential victims..."
              }
            ]
          }
        ]
      };

    default:
      return {
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `📡 *SIPSentinel Event:* ${event}`
            }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `\`\`\`${JSON.stringify(data, null, 2)}\`\`\``
            }
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `🛡️ SIPSentinel | ${new Date().toLocaleTimeString()}`
              }
            ]
          }
        ]
      };
  }
}

/**
 * Create Telegram message payload for agent call events
 * @param {string} event - Event type
 * @param {Object} data - Event data
 * @returns {Object} Telegram message payload
 */
function createTelegramMessage(event, data) {
  switch (event) {
    case WEBHOOK_EVENTS.AGENT_CALL_INITIATED:
      const scamTypeFormatted = (data.scamType || 'unknown').replace('_', ' ').toUpperCase();
      const companyEmoji = getCompanyEmoji(data.company || 'Unknown');

      return {
        text: `🎯 SCAMMER ENGAGEMENT INITIATED

${companyEmoji} ${data.agentName || 'Unknown Agent'} is now calling a scammer who impersonated ${data.company || 'Unknown Company'}

🤖 Agent: ${data.agentName || 'Unknown Agent'}
🏢 Company: ${data.company || 'Unknown Company'}
🚨 Scam Type: ${scamTypeFormatted}
📞 Target: ${data.phoneNumber ? maskPhoneNumber(data.phoneNumber) : 'Unknown'}

🕐 ${new Date().toLocaleTimeString()} | 🛡️ SIPSentinel Defense System`
      };

    case WEBHOOK_EVENTS.AGENT_CALL_STARTED:
      return {
        text: `📞 *AGENT CALL STARTED*

🟢 *${data.agentName || 'Unknown Agent'}* has successfully connected to the scammer

📊 *Call Details:*
• Call ID: \`${data.callId || 'Unknown'}\`
• Duration: ${data.duration || 'Just started'}
• Status: Active

🛡️ SIPSentinel | ${new Date().toLocaleTimeString()}`,
        parse_mode: 'Markdown'
      };

    case WEBHOOK_EVENTS.AGENT_CALL_ENDED:
      const duration = data.duration || 0;
      const isSuccess = duration >= 300; // 5 minutes
      const statusEmoji = isSuccess ? '🎉' : '⏱️';
      const statusText = isSuccess ? 'SUCCESSFUL ENGAGEMENT' : 'CALL COMPLETED';

      return {
        text: `${statusEmoji} *${statusText}*

📞 *${data.agentName || 'Unknown Agent'}* finished calling the scammer

📊 *Call Summary:*
• Duration: ${Math.floor(duration / 60)}m ${duration % 60}s
• Company: ${data.company || 'Unknown Company'}
• Result: ${isSuccess ? 'Success (5+ minutes)' : 'Short call'}

${isSuccess ? '🎊 Great work keeping the scammer busy!' : ''}

🛡️ SIPSentinel | ${new Date().toLocaleTimeString()}`,
        parse_mode: 'Markdown'
      };

    case WEBHOOK_EVENTS.AGENT_CALL_FAILED:
      const reason = data.failureReason || 'Unknown';
      const reasonEmoji = reason.includes('busy') ? '📵' :
                         reason.includes('no-answer') ? '🔇' :
                         reason.includes('invalid') ? '❌' : '⚠️';

      return {
        text: `${reasonEmoji} AGENT CALL FAILED

❌ ${data.agentName || 'Unknown Agent'} could not reach the scammer

📊 Failure Details:
• Reason: ${reason}
• Target: ${data.phoneNumber ? maskPhoneNumber(data.phoneNumber) : 'Unknown'}
• Company: ${data.company || 'Unknown Company'}

🔄 The system will continue monitoring for new scams

🛡️ SIPSentinel | ${new Date().toLocaleTimeString()}`
      };

    case WEBHOOK_EVENTS.SCAM_DETECTED:
      const confidence = data.confidence || 0;

      return {
        text: `🚨 SCAM DETECTED

🎯 New scam detected with ${confidence}% confidence

📊 Detection Details:
• Company: ${data.company || 'Unknown Company'}
• Type: ${(data.scamType || 'unknown').replace('_', ' ').toUpperCase()}
• Confidence: ${confidence}% [${Math.floor(confidence / 10)}/10]
• Source: ${data.phoneNumber ? maskPhoneNumber(data.phoneNumber) : 'Unknown'}

🤖 Preparing agent response...

🛡️ SIPSentinel | ${new Date().toLocaleTimeString()}`
      };

    default:
      return {
        text: `🛡️ *SIPSentinel Event*

Event: ${event}
Data: \`${JSON.stringify(data, null, 2)}\`

🛡️ SIPSentinel | ${new Date().toLocaleTimeString()}`,
        parse_mode: 'Markdown'
      };
  }
}

/**
 * Send notification to Slack
 * @param {string} event - Event type
 * @param {Object} data - Event data
 * @returns {Promise<Object>} Response object
 */
async function sendSlackNotification(event, data) {
  const slackUrl = getSlackWebhookUrl();

  if (!slackUrl) {
    console.log('No Slack webhook URL configured, skipping Slack notification');
    return { success: false, reason: 'no_slack_url' };
  }

  try {
    const slackMessage = createSlackMessage(event, data);

    console.log(`Sending Slack notification for event: ${event}`);

    const response = await axios.post(slackUrl, slackMessage, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: WEBHOOK_CONFIG.timeout
    });

    console.log(`Slack notification sent successfully: ${response.status}`);
    return {
      success: true,
      status: response.status
    };

  } catch (error) {
    console.error('Error sending Slack notification:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Send only text notification to Telegram (no audio)
 * @param {string} event - Event type
 * @param {Object} data - Event data
 * @returns {Promise<Object>} Response object
 */
async function sendTelegramTextOnly(event, data) {
  const telegramConfig = getTelegramConfig();

  if (!telegramConfig) {
    console.log('No Telegram configuration found, skipping Telegram text notification');
    return { success: false, reason: 'no_telegram_config' };
  }

  try {
    const message = createTelegramMessage(event, data);
    const telegramApiUrl = `https://api.telegram.org/bot${telegramConfig.botToken}`;

    console.log(`Sending Telegram text-only notification for event: ${event}`);
    console.log(`Message text length: ${message.text.length}`);
    console.log(`Parse mode: ${message.parse_mode}`);

    // Send text message only
    const requestData = {
      chat_id: telegramConfig.chatId,
      text: message.text
    };

    // Only add parse_mode if it's specified
    if (message.parse_mode) {
      requestData.parse_mode = message.parse_mode;
    }

    const textResponse = await axios.post(`${telegramApiUrl}/sendMessage`, requestData, {
      timeout: 30000, // 30 second timeout
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log(`Telegram text-only notification sent successfully: ${textResponse.status}`);

    return {
      success: true,
      status: textResponse.status,
      audioSent: false
    };

  } catch (error) {
    console.error('Error sending Telegram text-only notification:', error.message);
    console.error('Error details:', error.response?.data || 'No additional details');
    return {
      success: false,
      error: error.message,
      details: error.response?.data
    };
  }
}

/**
 * Send notification to Telegram
 * @param {string} event - Event type
 * @param {Object} data - Event data
 * @param {string|null} audioUrl - Optional audio file URL to attach
 * @returns {Promise<Object>} Response object
 */
async function sendTelegramNotification(event, data, audioUrl = null) {
  const telegramConfig = getTelegramConfig();

  if (!telegramConfig) {
    console.log('No Telegram configuration found, skipping Telegram notification');
    return { success: false, reason: 'no_telegram_config' };
  }

  try {
    const message = createTelegramMessage(event, data);
    const telegramApiUrl = `https://api.telegram.org/bot${telegramConfig.botToken}`;

    console.log(`Sending Telegram notification for event: ${event}`);
    console.log(`Message text length: ${message.text.length}`);
    console.log(`Parse mode: ${message.parse_mode}`);
    console.log(`Audio URL provided: ${!!audioUrl}, Event: ${event}, Will send audio: ${!!(audioUrl && event === WEBHOOK_EVENTS.AGENT_CALL_ENDED)}`);

    // Send text message first
    const requestData = {
      chat_id: telegramConfig.chatId,
      text: message.text
    };

    // Only add parse_mode if it's specified
    if (message.parse_mode) {
      requestData.parse_mode = message.parse_mode;
    }

    const textResponse = await axios.post(`${telegramApiUrl}/sendMessage`, requestData, {
      timeout: 30000, // 30 second timeout
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log(`Telegram text notification sent successfully: ${textResponse.status}`);

    // Send audio file if provided and it's a call ended event
    // Include audio for any call that has a recording, regardless of duration
    let audioResponse = null;
    if (audioUrl && event === WEBHOOK_EVENTS.AGENT_CALL_ENDED) {
      try {
        console.log(`🎧 Attempting to send audio file for Telegram`);
        console.log(`📊 Audio URL: ${audioUrl}`);
        console.log(`📊 Event: ${event}`);
        console.log(`📊 Call duration: ${data.duration || 0}s`);
        console.log(`📊 Call successful: ${data.successful || false}`);
        console.log(`📊 Agent name: ${data.agentName || 'Unknown'}`);
        console.log(`📊 Company: ${data.company || 'Unknown'}`);

        // Validate the audio URL format
        if (!audioUrl.startsWith('http')) {
          throw new Error(`Invalid audio URL format: ${audioUrl}`);
        }

        // Download the audio file first
        console.log(`📥 Downloading audio file from: ${audioUrl}`);
        const audioFileResponse = await axios.get(audioUrl, {
          responseType: 'stream',
          timeout: 30000,
          headers: {
            'User-Agent': 'SIPSentinel/1.0'
          }
        });

        console.log(`📥 Audio download response: ${audioFileResponse.status}, Content-Type: ${audioFileResponse.headers['content-type']}, Content-Length: ${audioFileResponse.headers['content-length']}`);

        // Create FormData for file upload
        const form = new FormData();

        form.append('chat_id', telegramConfig.chatId);
        form.append('audio', audioFileResponse.data, {
          filename: `agent_call_${data.callId || Date.now()}.wav`,
          contentType: 'audio/wav'
        });
        const duration = data.duration || 0;
        const minutes = Math.floor(duration / 60);
        const seconds = String(duration % 60).padStart(2, '0');
        const isSuccessful = duration >= 300;
        const successIcon = isSuccessful ? '🎉' : '⏱️';

        form.append('caption', `🎧 Agent conversation recording ${successIcon}\n📞 ${data.agentName || 'Agent'} vs ${data.company || 'Unknown'} scammer\n⏱️ Duration: ${minutes}:${seconds}${isSuccessful ? ' (SUCCESS!)' : ''}\n🆔 Call ID: ${data.callId || 'Unknown'}`);
        form.append('title', `${data.agentName || 'Agent'} vs ${data.company || 'Unknown'} Scammer`);
        form.append('performer', 'SIPSentinel');

        // Upload to Telegram
        console.log(`📤 Uploading audio to Telegram chat: ${telegramConfig.chatId}`);
        console.log(`📤 Audio file size: ${audioFileResponse.headers['content-length'] || 'unknown'} bytes`);
        audioResponse = await axios.post(`${telegramApiUrl}/sendAudio`, form, {
          timeout: 120000, // 2 minute timeout for file uploads
          headers: {
            ...form.getHeaders()
          }
        });

        console.log(`✅ Telegram audio notification sent successfully: ${audioResponse.status}`);
        console.log(`📧 Audio message ID: ${audioResponse.data?.result?.message_id || 'unknown'}`);
      } catch (audioError) {
        console.error('❌ Error sending Telegram audio:', audioError.message);
        console.error('❌ Audio URL that failed:', audioUrl);
        console.error('❌ Error stack:', audioError.stack);

        if (audioError.response) {
          console.error('❌ Telegram API error response:', audioError.response.status, audioError.response.data);
        } else if (audioError.code === 'ECONNABORTED') {
          console.error('❌ Audio upload timeout - file may be too large or connection slow');
        } else if (audioError.code === 'ENOTFOUND' || audioError.code === 'ECONNREFUSED') {
          console.error('❌ Network error downloading audio file from:', audioUrl);
        } else if (audioError.code === 'ECONNRESET') {
          console.error('❌ Connection reset while downloading audio file');
        } else {
          console.error('❌ Unexpected audio error:', audioError);
        }
        // Don't fail the whole notification if audio fails
      }
    } else {
      console.log(`🔇 No audio to send - audioUrl: ${!!audioUrl}, event: ${event}, expected event: ${WEBHOOK_EVENTS.AGENT_CALL_ENDED}`);
    }

    return {
      success: true,
      status: textResponse.status,
      audioSent: !!audioResponse
    };

  } catch (error) {
    console.error('Error sending Telegram notification:', error.message);
    console.error('Error details:', error.response?.data || 'No additional details');
    return {
      success: false,
      error: error.message,
      details: error.response?.data
    };
  }
}

/**
 * Downloads an audio file from a URL and sends it to Telegram as an audio file.
 * @param {string} audioUrl - The URL of the audio file to send.
 * @param {string} caption - The text caption to send with the audio.
 * @returns {Promise<boolean>} - True if sent successfully, false otherwise.
 */
async function sendTelegramAudio(audioUrl, caption) {
  const { botToken, chatId } = getTelegramConfig();
  if (!botToken || !chatId) {
    console.warn('Telegram bot not configured, skipping audio upload');
    return;
  }

  try {
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('audio', audioUrl);
    formData.append('caption', caption);

    await axios.post(`https://api.telegram.org/bot${botToken}/sendAudio`, formData, {
      headers: formData.getHeaders(),
    });

    console.log(`🎤 Audio from ${audioUrl} sent to Telegram channel ${chatId}`);
  } catch (error) {
    console.error(`❌ Failed to send audio to Telegram:`, error.response ? error.response.data : error.message);
  }
}

/**
 * Send only audio file to Telegram without text notification (for queue worker)
 * @param {Object} data - Call data
 * @param {string} audioUrl - Audio file URL
 * @returns {Promise<Object>} Response object
 */
async function sendTelegramAudioOnly(data, audioUrl) {
  const telegramConfig = getTelegramConfig();

  if (!telegramConfig) {
    console.log('No Telegram configuration found, skipping Telegram audio upload');
    return { success: false, reason: 'no_telegram_config' };
  }

  if (!audioUrl) {
    console.log('No audio URL provided, skipping Telegram audio upload');
    return { success: false, reason: 'no_audio_url' };
  }

  try {
    const telegramApiUrl = `https://api.telegram.org/bot${telegramConfig.botToken}`;

    console.log(`🎧 Sending audio file only to Telegram for call: ${data.callId}`);
    console.log(`📊 Audio URL: ${audioUrl}`);
    console.log(`📊 Call duration: ${data.duration || 0}s`);
    console.log(`📊 Agent name: ${data.agentName || 'Unknown'}`);
    console.log(`📊 Company: ${data.company || 'Unknown'}`);

    // Validate the audio URL format
    if (!audioUrl.startsWith('http')) {
      throw new Error(`Invalid audio URL format: ${audioUrl}`);
    }

    // Download the audio file first
    console.log(`📥 Downloading audio file from: ${audioUrl}`);
    const audioFileResponse = await axios.get(audioUrl, {
      responseType: 'stream',
      timeout: 30000,
      headers: {
        'User-Agent': 'SIPSentinel/1.0'
      }
    });

    console.log(`📥 Audio download response: ${audioFileResponse.status}, Content-Type: ${audioFileResponse.headers['content-type']}, Content-Length: ${audioFileResponse.headers['content-length']}`);

    // Create FormData for file upload
    const form = new FormData();

    form.append('chat_id', telegramConfig.chatId);
    form.append('audio', audioFileResponse.data, {
      filename: `agent_call_${data.callId || Date.now()}.wav`,
      contentType: 'audio/wav'
    });
    const duration = data.duration || 0;
    const minutes = Math.floor(duration / 60);
    const seconds = String(duration % 60).padStart(2, '0');
    const isSuccessful = duration >= 300;
    const successIcon = isSuccessful ? '🎉' : '⏱️';

    form.append('caption', `🎧 Agent conversation recording ${successIcon}\n📞 ${data.agentName || 'Agent'} vs ${data.company || 'Unknown'} scammer\n⏱️ Duration: ${minutes}:${seconds}${isSuccessful ? ' (SUCCESS!)' : ''}\n🆔 Call ID: ${data.callId || 'Unknown'}`);
    form.append('title', `${data.agentName || 'Agent'} vs ${data.company || 'Unknown'} Scammer`);
    form.append('performer', 'SIPSentinel');

    // Upload to Telegram
    console.log(`📤 Uploading audio to Telegram chat: ${telegramConfig.chatId}`);
    console.log(`📤 Audio file size: ${audioFileResponse.headers['content-length'] || 'unknown'} bytes`);
    const audioResponse = await axios.post(`${telegramApiUrl}/sendAudio`, form, {
      timeout: 120000, // 2 minute timeout for file uploads
      headers: {
        ...form.getHeaders()
      }
    });

    console.log(`✅ Telegram audio-only upload sent successfully: ${audioResponse.status}`);
    console.log(`📧 Audio message ID: ${audioResponse.data?.result?.message_id || 'unknown'}`);

    return {
      success: true,
      status: audioResponse.status,
      audioSent: true
    };

  } catch (error) {
    console.error('❌ Error sending Telegram audio-only:', error.message);
    console.error('❌ Audio URL that failed:', audioUrl);
    console.error('❌ Error stack:', error.stack);

    if (error.response) {
      console.error('❌ Telegram API error response:', error.response.status, error.response.data);
    } else if (error.code === 'ECONNABORTED') {
      console.error('❌ Audio upload timeout - file may be too large or connection slow');
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      console.error('❌ Network error downloading audio file from:', audioUrl);
    } else if (error.code === 'ECONNRESET') {
      console.error('❌ Connection reset while downloading audio file');
    } else {
      console.error('❌ Unexpected audio error:', error);
    }

    return {
      success: false,
      error: error.message,
      details: error.response?.data
    };
  }
}

/**
 * Get webhook secret from environment
 * @returns {string|null} Webhook secret
 */
function getWebhookSecret() {
  return process.env.WEBHOOK_SECRET || null;
}

/**
 * Main webhook notification function for agent call initiated
 * @param {Object} callData - Call data
 * @returns {Promise<Array>} Array of response objects
 */
async function notifyAgentCallInitiated(callData) {
  try {
    console.log('Sending agent call initiated notifications...');

    const results = [];

    // Send webhook notifications
    const webhookUrls = getWebhookUrls();
    const webhookSecret = getWebhookSecret();
    const payload = createAgentCallInitiatedPayload(callData);

    if (webhookUrls.length > 0) {
      const webhookResults = await sendWebhooks(webhookUrls, payload, webhookSecret);
      results.push(...webhookResults);
    }

    // Send Slack notification
    const slackResult = await sendSlackNotification(WEBHOOK_EVENTS.AGENT_CALL_INITIATED, callData);
    results.push({ type: 'slack', ...slackResult });

    // Send Telegram notification
    const telegramResult = await sendTelegramNotification(WEBHOOK_EVENTS.AGENT_CALL_INITIATED, callData);
    results.push({ type: 'telegram', ...telegramResult });

    return results;
  } catch (error) {
    console.error('Error sending agent call initiated notifications:', error);
    return [{ type: 'error', success: false, error: error.message }];
  }
}

/**
 * Main webhook notification function for agent call status events
 * @param {string} event - Event type
 * @param {Object} callData - Call data
 * @param {string|null} recordingUrl - Optional recording URL
 * @returns {Promise<Array>} Array of response objects
 */
async function notifyAgentCallStatus(event, callData, recordingUrl = null) {
  try {
    console.log(`Sending agent call status notifications for event: ${event}...`);

    const results = [];

    // Send webhook notifications
    const webhookUrls = getWebhookUrls();
    const webhookSecret = getWebhookSecret();
    const payload = createAgentCallStatusPayload(event, callData);

    if (webhookUrls.length > 0) {
      const webhookResults = await sendWebhooks(webhookUrls, payload, webhookSecret);
      results.push(...webhookResults);
    }

    // Send Slack notification
    const slackResult = await sendSlackNotification(event, callData);
    results.push({ type: 'slack', ...slackResult });

    // Send Telegram notification (with audio for ended calls)
    const telegramResult = await sendTelegramNotification(event, callData, recordingUrl);
    results.push({ type: 'telegram', ...telegramResult });

    return results;
  } catch (error) {
    console.error('Error sending agent call status notifications:', error);
    return [{ type: 'error', success: false, error: error.message }];
  }
}

/**
 * Main webhook notification function for scam detected events
 * @param {Object} scamData - Scam detection data
 * @returns {Promise<Array>} Array of response objects
 */
async function notifyScamDetected(scamData) {
  try {
    console.log('Sending scam detected notifications...');

    const results = [];

    // Send webhook notifications
    const webhookUrls = getWebhookUrls();
    const webhookSecret = getWebhookSecret();
    const payload = createScamDetectedPayload(scamData);

    if (webhookUrls.length > 0) {
      const webhookResults = await sendWebhooks(webhookUrls, payload, webhookSecret);
      results.push(...webhookResults);
    }

    // Send Slack notification
    const slackResult = await sendSlackNotification(WEBHOOK_EVENTS.SCAM_DETECTED, scamData);
    results.push({ type: 'slack', ...slackResult });

    // Send Telegram notification
    const telegramResult = await sendTelegramNotification(WEBHOOK_EVENTS.SCAM_DETECTED, scamData);
    results.push({ type: 'telegram', ...telegramResult });

    return results;
  } catch (error) {
    console.error('Error sending scam detected notifications:', error);
    return [{ type: 'error', success: false, error: error.message }];
  }
}

async function notifyCallEnded(callSid) {
  if (!callSid) return;
  console.log(`Broadcasting call end for ${callSid}`);
  broadcastToSSEClients({
    type: 'call_ended',
    data: { callSid }
  });
}

/**
 * Send text-only notifications (Slack + Telegram text, no audio)
 * @param {string} event - Event type
 * @param {Object} callData - Call data
 * @returns {Promise<Array>} Array of response objects
 */
async function notifyAgentCallStatusTextOnly(event, callData) {
  try {
    console.log(`Sending text-only notifications for event: ${event}...`);

    const results = [];

    // Send webhook notifications
    const webhookUrls = getWebhookUrls();
    const webhookSecret = getWebhookSecret();
    const payload = createAgentCallStatusPayload(event, callData);

    if (webhookUrls.length > 0) {
      const webhookResults = await sendWebhooks(webhookUrls, payload, webhookSecret);
      results.push(...webhookResults);
    }

    // Send Slack notification
    const slackResult = await sendSlackNotification(event, callData);
    results.push({ type: 'slack', ...slackResult });

    // Send Telegram text-only notification (no audio)
    const telegramResult = await sendTelegramTextOnly(event, callData);
    results.push({ type: 'telegram', ...telegramResult });

    return results;
  } catch (error) {
    console.error('Error sending text-only notifications:', error);
    return [{ type: 'error', success: false, error: error.message }];
  }
}

module.exports = {
  WEBHOOK_EVENTS,
  notifyAgentCallInitiated,
  notifyAgentCallStatus,
  notifyAgentCallStatusTextOnly,
  notifyScamDetected,
  notifyCallEnded,
  getWebhookUrls,
  getWebhookSecret,
  getSlackWebhookUrl,
  getTelegramConfig,
  sendSlackNotification,
  sendTelegramNotification,
  sendTelegramTextOnly,
  sendTelegramAudio,
  sendTelegramAudioOnly,
  createTelegramMessage // Export for testing
};
