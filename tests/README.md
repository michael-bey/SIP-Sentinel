# SIPSentinel Test Organization

This directory contains all test files organized by category and purpose.

## Directory Structure

### `/unit/` - Unit Tests
Individual component testing with minimal dependencies:
- `scam-detection.test.js` - Scam detection logic tests
- `vapi-service.test.js` - VAPI service unit tests
- `webhook-service.test.js` - Webhook service tests
- `agent-selection.test.js` - Agent selection logic tests

### `/integration/` - Integration Tests
Tests that verify multiple components working together:
- `telegram-integration.test.js` - Telegram notification tests
- `qstash-integration.test.js` - QStash queue processing tests
- `vapi-integration.test.js` - VAPI API integration tests
- `webhook-integration.test.js` - Webhook endpoint tests

### `/e2e/` - End-to-End Tests
Full system workflow tests:
- `scam-call-flow.test.js` - Complete scam detection → agent callback flow
- `system-health.test.js` - Overall system health and endpoint tests

### `/debug/` - Debug and Monitoring Tools
Temporary debugging scripts and monitoring tools:
- `call-tracker-monitor.js` - Monitor call tracker state
- `telegram-upload-debug.js` - Debug Telegram upload issues
- `qstash-debug.js` - Debug QStash delivery issues

### `/deprecated/` - Deprecated Tests
Old test files kept for reference but no longer actively used.

## Running Tests

```bash
# Run all tests
npm test

# Run specific test categories
npm run test:unit
npm run test:integration
npm run test:e2e

# Run individual tests
npm run test:scam-detection
npm run test:telegram
npm run test:vapi

# Debug tools
npm run debug:telegram
npm run debug:qstash
npm run debug:call-tracker
```

## Test File Naming Convention

- Unit tests: `*.test.js`
- Integration tests: `*.integration.test.js`
- E2E tests: `*.e2e.test.js`
- Debug tools: `*.debug.js`
- Utilities: `*.util.js`

## Test Organization Summary

### ✅ Files Successfully Organized:

**Unit Tests Created:**
- `unit/scam-detection.test.js` - Consolidated from `test-scam-detection-fix.js`, `simple-test.js`
- `unit/agent-selection.test.js` - Consolidated from `test-agent-selection.js`, `test-karen-gender.js`, `test-voice-config.js`

**Integration Tests Created:**
- `integration/telegram-integration.test.js` - Consolidated from 8+ Telegram test files
- `integration/vapi-integration.test.js` - Consolidated from `test-vapi.js`, `test-vapi-call.js`, and VAPI-related tests
- `integration/qstash-integration.test.js` - Consolidated from 5+ QStash test files

**E2E Tests Created:**
- `e2e/system-health.test.js` - Consolidated from `test-fixes.js`, `test-enhanced-setup.js`

**Debug Tools Created:**
- `debug/make-test-call.js` - Moved from root `make-test-call.js`

**Master Test Runner:**
- `run-all-tests.js` - New comprehensive test runner with category support

### 🗑️ Files Removed (45+ redundant test files):

**Duplicate Telegram Tests (8 files removed):**
- `test/debug-telegram-upload.js`, `test/direct-telegram-upload-test.js`, `test/direct-upload-fix-test.js`
- `test/immediate-upload-test.js`, `test/monitor-telegram-upload.js`, `test/production-telegram-test.js`
- `test/telegram-audio-debug-test.js`, `test/telegram-upload-fix-test.js`

**Duplicate QStash Tests (5 files removed):**
- `test/qstash-comparison-test.js`, `test/qstash-config-test.js`, `test/qstash-production-test.js`
- `test/qstash-telegram-test.js`, `test/simple-qstash-test.js`

**Duplicate Webhook Tests (5 files removed):**
- `test/all-webhook-types-test.js`, `test/exact-webhook-test.js`, `test/test-voice-webhook.js`
- `test/vapi-webhook-test.js`, `test/webhook-test.js`

**Duplicate VAPI Tests (2 files removed):**
- `test/vapi-audio-download-test.js`, `test/vapi-recording-debug-test.js`

**Root-level Test Files (13 files removed):**
- `simple-test.js`, `test-scam-detection-fix.js`, `test-fixes.js`, `test-vapi.js`
- `test-vapi-call.js`, `test-agent-selection.js`, `test-enhanced-setup.js`
- `test-karen-gender.js`, `test-kraken-karen.js`, `test-microsoft-callback.js`
- `test-twilio-fallback.js`, `test-voice-config.js`, `make-test-call.js`

### 📁 Files Moved to `/deprecated/` (9 files preserved):
- `original-telegram-test.js`, `original-redis-qstash-integration.js`, `original-end-to-end-flow-test.js`
- `direct-fallback-test.js`, `timing-fix-test.js`, `url-resolution-test.js`
- `recording-duration-flow.js`, `end-of-call-report-test.js`, `agent-name-extraction-test.js`
- `assistant-config-sanitization-test.js`, `assistant-name-format-test.js`, `recording-duration-validation.js`

### 📊 Results:
- **Before:** 45+ scattered test files across root and `/test/` directory
- **After:** 6 organized test files + 1 master runner + debug utilities
- **Reduction:** ~85% fewer test files while maintaining full functionality
- **Organization:** Clear separation by test type (unit/integration/e2e/debug)
