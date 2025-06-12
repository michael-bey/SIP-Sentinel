#!/bin/bash

# Utility script to reliably get the current Vercel deployment URL
# Can be used standalone or sourced by other scripts

set -e

echo "🔍 Finding Vercel deployment URL..."

# Function to extract URL from various sources
get_deployment_url() {
    local url=""
    
    # Method 1: Check recent deployments
    echo "📋 Checking recent deployments..." >&2
    if command -v vercel >/dev/null 2>&1; then
        VERCEL_LS_OUTPUT=$(vercel ls 2>/dev/null || true)
        if [ $? -eq 0 ] && [ ! -z "$VERCEL_LS_OUTPUT" ]; then
            url=$(echo "$VERCEL_LS_OUTPUT" | grep -oE 'https://[a-zA-Z0-9.-]+\.vercel\.app' | head -1)
            if [ ! -z "$url" ]; then
                echo "✅ Found URL from recent deployments: $url" >&2
                echo "$url"
                return 0
            fi
        fi
    fi

    # Method 2: Try to get project info
    echo "📝 Checking project configuration..." >&2
    if command -v vercel >/dev/null 2>&1; then
        PROJECT_INFO=$(vercel project ls 2>/dev/null || true)
        if [ $? -eq 0 ] && [ ! -z "$PROJECT_INFO" ]; then
            PROJECT_NAME=$(echo "$PROJECT_INFO" | grep -E '^\s*[a-zA-Z0-9-]+' | head -1 | awk '{print $1}')
            if [ ! -z "$PROJECT_NAME" ]; then
                url="https://${PROJECT_NAME}.vercel.app"
                echo "🔧 Constructed URL from project name: $url" >&2
                echo "$url"
                return 0
            fi
        fi
    fi

    # Method 3: Check for custom domains
    echo "🌐 Checking for custom domains..." >&2
    if command -v vercel >/dev/null 2>&1; then
        DOMAINS_OUTPUT=$(vercel domains ls 2>/dev/null || true)
        if [ $? -eq 0 ] && [ ! -z "$DOMAINS_OUTPUT" ]; then
            CUSTOM_DOMAIN=$(echo "$DOMAINS_OUTPUT" | grep -oE '[a-zA-Z0-9.-]+\.(com|org|net|io|app)' | head -1)
            if [ ! -z "$CUSTOM_DOMAIN" ]; then
                url="https://${CUSTOM_DOMAIN}"
                echo "🌐 Found custom domain: $url" >&2
                echo "$url"
                return 0
            fi
        fi
    fi

    # Method 4: Check vercel.json for project name
    echo "📄 Checking vercel.json..." >&2
    if [ -f "vercel.json" ]; then
        # Try to extract project name from vercel.json if it exists
        if command -v jq >/dev/null 2>&1; then
            PROJECT_NAME=$(jq -r '.name // empty' vercel.json 2>/dev/null || true)
            if [ ! -z "$PROJECT_NAME" ] && [ "$PROJECT_NAME" != "null" ]; then
                url="https://${PROJECT_NAME}.vercel.app"
                echo "📄 Constructed URL from vercel.json: $url" >&2
                echo "$url"
                return 0
            fi
        fi
    fi

    # Method 5: Check package.json for project name
    echo "📦 Checking package.json..." >&2
    if [ -f "package.json" ]; then
        if command -v jq >/dev/null 2>&1; then
            PACKAGE_NAME=$(jq -r '.name // empty' package.json 2>/dev/null || true)
            if [ ! -z "$PACKAGE_NAME" ] && [ "$PACKAGE_NAME" != "null" ]; then
                # Clean up package name for URL (remove scopes, special chars)
                CLEAN_NAME=$(echo "$PACKAGE_NAME" | sed 's/@.*\///g' | sed 's/[^a-zA-Z0-9-]/-/g')
                url="https://${CLEAN_NAME}.vercel.app"
                echo "📦 Constructed URL from package.json: $url" >&2
                echo "$url"
                return 0
            fi
        fi
    fi

    echo "❌ Could not determine deployment URL automatically" >&2
    return 1
}

# Function to validate URL
validate_url() {
    local url="$1"
    echo "🔍 Validating URL: $url"
    
    if curl -s -f --max-time 10 "$url/health" > /dev/null 2>&1; then
        echo "✅ URL is responding correctly"
        return 0
    else
        echo "⚠️  URL is not responding (may still be deploying)"
        return 1
    fi
}

# Main execution
main() {
    if ! command -v vercel >/dev/null 2>&1; then
        echo "❌ Vercel CLI not found. Please install it first:"
        echo "   npm install -g vercel"
        exit 1
    fi
    
    # Get the URL (capture output to avoid mixed messages)
    URL_OUTPUT=$(get_deployment_url 2>&1)
    DEPLOYMENT_URL=$(echo "$URL_OUTPUT" | grep -oE 'https://[a-zA-Z0-9.-]+\.(vercel\.app|com|org|net|io)' | head -1)

    # Show the detection process
    echo "$URL_OUTPUT"

    if [ -z "$DEPLOYMENT_URL" ]; then
        echo ""
        echo "❌ Could not automatically determine deployment URL."
        echo "💡 Suggestions:"
        echo "   1. Run 'vercel ls' to see your deployments"
        echo "   2. Check your Vercel dashboard: https://vercel.com/dashboard"
        echo "   3. Make sure you're in the correct project directory"
        exit 1
    fi

    echo ""
    echo "🎯 Deployment URL: $DEPLOYMENT_URL"
    
    # Optionally validate the URL
    if [ "$1" = "--validate" ] || [ "$1" = "-v" ]; then
        echo ""
        validate_url "$DEPLOYMENT_URL"
    fi
    
    # If sourced, export the variable
    if [ "${BASH_SOURCE[0]}" != "${0}" ]; then
        export DEPLOYMENT_URL
        echo "✅ DEPLOYMENT_URL exported for use in other scripts"
    fi
    
    echo ""
    echo "📋 Quick test commands:"
    echo "   curl $DEPLOYMENT_URL/health"
    echo "   curl $DEPLOYMENT_URL/deployment-info"
    echo "   node scripts/test-optimization.js $DEPLOYMENT_URL"
}

# Run main function if script is executed directly
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    main "$@"
fi
