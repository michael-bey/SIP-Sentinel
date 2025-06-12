#!/bin/bash

# Deploy SIPSentinel with Redis & QStash Integration
# This script helps deploy the updated system with all required configurations

set -e

echo "🚀 SIPSentinel Redis & QStash Deployment Script"
echo "================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️ $1${NC}"
}

# Check if required tools are installed
check_dependencies() {
    print_info "Checking dependencies..."
    
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed"
        exit 1
    fi
    
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed"
        exit 1
    fi
    
    if ! command -v vercel &> /dev/null; then
        print_warning "Vercel CLI not found. Installing..."
        npm install -g vercel
    fi
    
    print_status "Dependencies check complete"
}

# Install project dependencies
install_dependencies() {
    print_info "Installing project dependencies..."
    
    npm install
    
    # Ensure Redis and QStash packages are installed
    npm install @upstash/redis @upstash/qstash node-cache
    
    print_status "Dependencies installed"
}

# Check environment variables
check_environment() {
    print_info "Checking environment variables..."
    
    # Load .env file if it exists
    if [ -f .env ]; then
        source .env
    fi
    
    # Required variables
    required_vars=(
        "TWILIO_ACCOUNT_SID"
        "TWILIO_AUTH_TOKEN"
        "VAPI_API_KEY"
        "UPSTASH_REDIS_URL"
        "UPSTASH_REDIS_REST_TOKEN"
        "QSTASH_TOKEN"
        "QSTASH_CURRENT_SIGNING_KEY"
        "QSTASH_NEXT_SIGNING_KEY"
    )
    
    missing_vars=()
    
    for var in "${required_vars[@]}"; do
        if [ -z "${!var}" ]; then
            missing_vars+=("$var")
        fi
    done
    
    if [ ${#missing_vars[@]} -ne 0 ]; then
        print_error "Missing required environment variables:"
        for var in "${missing_vars[@]}"; do
            echo "  - $var"
        done
        print_info "Please add these to your .env file or Vercel environment variables"
        exit 1
    fi
    
    print_status "Environment variables check complete"
}

# Run integration tests
run_tests() {
    print_info "Running integration tests..."
    
    if node test/redis-qstash-integration.js; then
        print_status "Integration tests passed"
    else
        print_error "Integration tests failed"
        print_info "Please fix the issues before deploying"
        exit 1
    fi
}

# Deploy to Vercel
deploy_to_vercel() {
    print_info "Deploying to Vercel..."
    
    # Check if this is a git repository
    if [ ! -d .git ]; then
        print_warning "Not a git repository. Initializing..."
        git init
        git add .
        git commit -m "Initial commit with Redis & QStash integration"
    fi
    
    # Deploy to production
    if vercel --prod --yes; then
        print_status "Deployment successful"
        
        # Get deployment URL
        DEPLOYMENT_URL=$(vercel --prod --yes 2>/dev/null | grep -o 'https://[^[:space:]]*' | head -1)
        
        if [ -n "$DEPLOYMENT_URL" ]; then
            print_status "Deployment URL: $DEPLOYMENT_URL"
            
            # Update webhook URLs
            print_info "Update your Twilio webhook URLs to:"
            echo "  Voice: $DEPLOYMENT_URL/api/twilio-webhook?type=voice"
            echo "  Recording: $DEPLOYMENT_URL/api/twilio-webhook?type=recording-status"
            echo "  Transcription: $DEPLOYMENT_URL/api/twilio-webhook?type=transcription"
            echo "  SMS: $DEPLOYMENT_URL/api/twilio-webhook?type=sms"
        fi
    else
        print_error "Deployment failed"
        exit 1
    fi
}

# Test deployed endpoints
test_deployment() {
    print_info "Testing deployed endpoints..."
    
    # Get the deployment URL
    DEPLOYMENT_URL=$(vercel --prod --yes 2>/dev/null | grep -o 'https://[^[:space:]]*' | head -1)
    
    if [ -z "$DEPLOYMENT_URL" ]; then
        print_warning "Could not determine deployment URL"
        return
    fi
    
    # Test health endpoint
    if curl -s "$DEPLOYMENT_URL/health" > /dev/null; then
        print_status "Health endpoint responding"
    else
        print_warning "Health endpoint not responding"
    fi
    
    # Test dashboard endpoint
    if curl -s "$DEPLOYMENT_URL/api/dashboard" > /dev/null; then
        print_status "Dashboard endpoint responding"
    else
        print_warning "Dashboard endpoint not responding"
    fi
    
    # Test live updates endpoint
    if curl -s "$DEPLOYMENT_URL/api/live-updates?mode=poll" > /dev/null; then
        print_status "Live updates endpoint responding"
    else
        print_warning "Live updates endpoint not responding"
    fi
}

# Main deployment flow
main() {
    echo
    print_info "Starting deployment process..."
    echo
    
    check_dependencies
    echo
    
    install_dependencies
    echo
    
    check_environment
    echo
    
    run_tests
    echo
    
    deploy_to_vercel
    echo
    
    test_deployment
    echo
    
    print_status "Deployment complete!"
    print_info "Your SIPSentinel instance is now running with Redis & QStash integration"
    echo
    print_info "Next steps:"
    echo "1. Update Twilio webhook URLs (shown above)"
    echo "2. Test the system with a real call"
    echo "3. Monitor the dashboard for real-time updates"
    echo "4. Check Vercel function logs for any issues"
}

# Handle script arguments
case "${1:-}" in
    --help|-h)
        echo "Usage: $0 [options]"
        echo
        echo "Options:"
        echo "  --help, -h     Show this help message"
        echo "  --test-only    Run tests only, skip deployment"
        echo "  --no-tests     Skip tests, deploy directly"
        echo
        echo "This script deploys SIPSentinel with Redis & QStash integration."
        exit 0
        ;;
    --test-only)
        check_dependencies
        install_dependencies
        check_environment
        run_tests
        print_status "Tests completed successfully"
        exit 0
        ;;
    --no-tests)
        check_dependencies
        install_dependencies
        check_environment
        deploy_to_vercel
        test_deployment
        print_status "Deployment completed (tests skipped)"
        exit 0
        ;;
    "")
        main
        ;;
    *)
        print_error "Unknown option: $1"
        echo "Use --help for usage information"
        exit 1
        ;;
esac
