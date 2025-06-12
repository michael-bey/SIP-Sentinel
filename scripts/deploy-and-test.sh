#!/bin/bash

# Deploy and Test Script for SIPSentinel Fixes
# This script deploys the fixes and runs tests to verify functionality

set -e

echo "🚀 SIPSentinel Fix Deployment and Testing"
echo "========================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the right directory
if [ ! -f "vercel.json" ]; then
    print_error "vercel.json not found. Please run this script from the project root."
    exit 1
fi

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    print_error "Vercel CLI not found. Please install it with: npm i -g vercel"
    exit 1
fi

# Check if Node.js is available for testing
if ! command -v node &> /dev/null; then
    print_error "Node.js not found. Please install Node.js to run tests."
    exit 1
fi

print_status "Starting deployment process..."

# Deploy to Vercel
print_status "Deploying to Vercel..."
if vercel --prod --yes; then
    print_success "Deployment completed successfully!"
else
    print_error "Deployment failed!"
    exit 1
fi

# Get the deployment URL
print_status "Getting deployment URL..."
DEPLOYMENT_URL=$(vercel --prod --yes 2>/dev/null | grep -o 'https://[^[:space:]]*' | head -1)

if [ -z "$DEPLOYMENT_URL" ]; then
    # Fallback method to get URL
    DEPLOYMENT_URL=$(vercel ls --prod 2>/dev/null | grep -o 'https://[^[:space:]]*' | head -1)
fi

if [ -z "$DEPLOYMENT_URL" ]; then
    print_warning "Could not automatically detect deployment URL."
    echo "Please manually set the URL for testing:"
    read -p "Enter your deployment URL: " DEPLOYMENT_URL
fi

print_success "Deployment URL: $DEPLOYMENT_URL"

# Wait a moment for deployment to be ready
print_status "Waiting for deployment to be ready..."
sleep 10

# Run tests
print_status "Running functionality tests..."

# Set the test URL
export TEST_URL="$DEPLOYMENT_URL"

# Check if test script exists
if [ ! -f "test-fixes.js" ]; then
    print_error "test-fixes.js not found. Cannot run tests."
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ] || [ ! -f "node_modules/node-fetch/package.json" ]; then
    print_status "Installing test dependencies..."
    npm install node-fetch
fi

# Run the tests
print_status "Executing test suite..."
if node test-fixes.js; then
    print_success "All tests passed! 🎉"
    echo ""
    echo "✅ Active calls display should now be working"
    echo "✅ Scam detection callbacks should be triggered"
    echo "✅ Live updates should be functional"
    echo ""
    echo "🌐 Dashboard URL: $DEPLOYMENT_URL"
    echo "📊 Health Check: $DEPLOYMENT_URL/health"
    echo "📡 Live Updates: $DEPLOYMENT_URL/api/live-updates"
else
    print_warning "Some tests failed. Check the output above for details."
    echo ""
    echo "The deployment was successful, but some functionality may not be working as expected."
    echo "Please check the Vercel function logs for more details."
fi

# Display useful information
echo ""
print_status "Deployment Summary:"
echo "==================="
echo "🌐 Dashboard: $DEPLOYMENT_URL"
echo "🔧 Health Check: $DEPLOYMENT_URL/health"
echo "📊 API Dashboard: $DEPLOYMENT_URL/api/dashboard"
echo "📡 Live Updates: $DEPLOYMENT_URL/api/live-updates"
echo ""
echo "📋 Webhook URLs for Twilio:"
echo "  Voice: $DEPLOYMENT_URL/voice"
echo "  SMS: $DEPLOYMENT_URL/sms"
echo "  Recording: $DEPLOYMENT_URL/recording-status"
echo "  Transcription: $DEPLOYMENT_URL/transcription"
echo "  VAPI: $DEPLOYMENT_URL/vapi/webhook"
echo ""

# Check if environment variables are set
print_status "Environment Variable Check:"
if [ -n "$TWILIO_PHONE_NUMBER" ]; then
    print_success "TWILIO_PHONE_NUMBER is set"
else
    print_warning "TWILIO_PHONE_NUMBER not set in environment"
fi

if [ -n "$VAPI_API_KEY" ]; then
    print_success "VAPI_API_KEY is set"
else
    print_warning "VAPI_API_KEY not set in environment"
fi

if [ -n "$QSTASH_TOKEN" ]; then
    print_success "QSTASH_TOKEN is set (queue processing enabled)"
else
    print_warning "QSTASH_TOKEN not set (will use fallback processing)"
fi

echo ""
print_status "Next Steps:"
echo "1. Update Twilio webhook URLs if needed"
echo "2. Test with a real scam call to verify end-to-end functionality"
echo "3. Monitor Vercel function logs for any issues"
echo "4. Check the dashboard for active calls display"

print_success "Deployment and testing completed!"
