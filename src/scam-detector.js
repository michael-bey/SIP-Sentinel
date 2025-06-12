/**
 * Scam Detection Service
 * Provides functions for detecting scams in messages using regex and heuristics.
 */

// Thresholds for scam detection
const SCAM_DETECTION_THRESHOLDS = {
    MIN_REGEX_SCAM_SCORE: 5,
};

// Keywords for detecting crypto exchange scams
const CRYPTO_EXCHANGES = [
    'kraken',
    'coinbase',
    'binance',
    'gemini',
    'kucoin',
    'crypto.com',
    'uphold',
    'bitstamp',
    'etoro',
    'bitcoin',
    'ethereum',
    'dogecoin',
    'litecoin',
    'xrp',
    'cardano',
    'solana',
    'tether',
    'usdc',
    'stablecoin',
    'cryptocurrency',
    'crypto currency',
    'digital asset',
    'virtual currency',
    'blockchain',
    'wallet',
    'withdrawal',
    'deposit',
    'trade',
    'order'
];

// Keywords for detecting IT support scams
const IT_SERVICES = [
    'microsoft',
    'apple',
    'google',
    'windows',
    'amazon',
    'aws',
    'geek squad',
    'best buy',
    'norton',
    'mcafee',
    'kaspersky',
    'webroot',
    'lenovo',
    'hp',
    'dell',
    'technical support',
    'tech support',
    'customer support',
    'support team',
    'security alert',
    'virus',
    'malware',
    'suspicious activity',
    'unusual activity',
    'account compromised',
    'subscription',
    'auto-renewal',
    'renewal',
    'invoice',
    'receipt',
    'order',
    'purchase'
];

// Keywords indicating urgency or alerts
const ALERT_TERMS = [
    'urgent',
    'immediate',
    'action required',
    'security alert',
    'suspicious',
    'unusual',
    'compromised',
    'unauthorized',
    'warning',
    'final notice',
    'important',
    'critical'
];

// Keywords indicating a required action
const ACTION_TERMS = [
    'call us',
    'contact us',
    'dial',
    'reach us',
    'talk to',
    'speak to',
    'connect to',
    'helpline',
    'support line',
    'toll-free',
    'customer service'
];

// Keywords for interactive prompts
const INTERACTIVE_PROMPTS = [
    'press 1',
    'press one',
    'press 2',
    'press two',
    'press 3',
    'press three',
    'press 4',
    'press four',
    'press 5',
    'press five',
    'press 6',
    'press six',
    'press 7',
    'press seven',
    'press 8',
    'press eight',
    'press 9',
    'press nine',
    'press 0',
    'press zero',
    'press the number',
    'press any key',
    'press pound',
    'press star',
    'press hashtag',
    'press #',
    'press *',
    'if this was not you',
    'if this wasn\'t you',
    'if you did not',
    'if you didn\'t',
    'to speak with',
    'to talk to',
    'to connect with',
    'to be connected',
    'for more information',
    'for assistance',
    'for help',
    'to verify',
    'to confirm'
];

/**
 * Detects if a message is likely a crypto/exchange or IT support scam based on keywords and heuristics.
 * @param {string} message - The message to analyze.
 * @returns {{isScam: boolean, scamType: string|null, scamDetails: Object}}
 */
function isLikelyScam(message) {
  if (!message || typeof message !== 'string') {
    return { isScam: false, scamType: null, scamDetails: {} };
  }

  const lowerMessage = message.toLowerCase();

  const phoneNumberPattern = /(\+\d{1,3})?[-.,\s]?\(?\d{3}\)?[-.,\s]?\d{3}[-.,\s]?\d{4}/g;
  const textNumberPattern = /\b(one|two|three|four|five|six|seven|eight|nine|zero|oh)[-\s](one|two|three|four|five|six|seven|eight|nine|zero|oh)[-\s](one|two|three|four|five|six|seven|eight|nine|zero|oh)/i;
  const digitSequencePattern = /\d{3}[-.,\s]?\d{3}[-.,\s]?\d{4}/g;

  const hasPhoneNumber = phoneNumberPattern.test(lowerMessage) ||
                         textNumberPattern.test(lowerMessage) ||
                         digitSequencePattern.test(lowerMessage);

  const cryptoTermsFound = CRYPTO_EXCHANGES.filter(term => lowerMessage.includes(term.toLowerCase()));
  const itTermsFound = IT_SERVICES.filter(term => lowerMessage.includes(term.toLowerCase()));
  const alertTermsFound = ALERT_TERMS.filter(term => lowerMessage.includes(term.toLowerCase()));
  const actionTermsFound = ACTION_TERMS.filter(term => lowerMessage.includes(term.toLowerCase()));
  const interactivePromptsFound = INTERACTIVE_PROMPTS.filter(prompt => lowerMessage.includes(prompt.toLowerCase()));

  const hasInteractivePrompts = interactivePromptsFound.length > 0;
  const hasCryptoTerms = cryptoTermsFound.length > 0;
  const hasITTerms = itTermsFound.length > 0;
  const hasAlertTerms = alertTermsFound.length > 0;
  const hasActionTerms = actionTermsFound.length > 0;
  const hasCallbackMention = lowerMessage.includes('representative') || lowerMessage.includes('agent') || lowerMessage.includes('will call') || lowerMessage.includes('calling you');

  let scamType = null;
  if (hasCryptoTerms) {
    scamType = 'crypto_exchange';
  } else if (hasITTerms) {
    scamType = 'it_support';
  }

  let scamScore = 0;
  if (hasCryptoTerms) scamScore += 3;
  if (hasITTerms) scamScore += 2;
  if (hasAlertTerms) scamScore += 2;
  if (hasActionTerms) scamScore += 2;
  if (hasPhoneNumber) scamScore += 3;
  if (hasCallbackMention) scamScore += 2;
  if (hasInteractivePrompts) scamScore += 3;

  scamScore += Math.min(cryptoTermsFound.length - 1, 2);
  scamScore += Math.min(itTermsFound.length - 1, 2);
  scamScore += Math.min(alertTermsFound.length - 1, 2);
  scamScore += Math.min(actionTermsFound.length - 1, 2);

  const isScam = scamScore >= SCAM_DETECTION_THRESHOLDS.MIN_REGEX_SCAM_SCORE;

  const scamDetails = {
    cryptoTerms: cryptoTermsFound,
    itTerms: itTermsFound,
    alertTerms: alertTermsFound,
    actionTerms: actionTermsFound,
    interactivePrompts: interactivePromptsFound,
    hasPhoneNumber,
    hasCallbackMention,
    hasInteractivePrompts,
    scamType,
    scamScore
  };

  return { isScam, scamType, scamDetails };
}

module.exports = {
  isLikelyScam,
  SCAM_DETECTION_THRESHOLDS,
  CRYPTO_EXCHANGES,
  IT_SERVICES,
  ALERT_TERMS,
  ACTION_TERMS,
  INTERACTIVE_PROMPTS
}; 