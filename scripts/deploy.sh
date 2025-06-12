#!/bin/bash

# SIPSentinel Deployment Script
echo "🚀 SIPSentinel Deployment Script"
echo "=================================="

# Check if Vercel CLI is installed
if command -v vercel &> /dev/null; then
    echo "✅ Vercel CLI found"
    VERCEL_AVAILABLE=true
else
    echo "❌ Vercel CLI not found"
    VERCEL_AVAILABLE=false
fi

# Check if Netlify CLI is installed
if command -v netlify &> /dev/null; then
    echo "✅ Netlify CLI found"
    NETLIFY_AVAILABLE=true
else
    echo "❌ Netlify CLI not found"
    NETLIFY_AVAILABLE=false
fi

echo ""

# If neither is available, provide installation instructions
if [ "$VERCEL_AVAILABLE" = false ] && [ "$NETLIFY_AVAILABLE" = false ]; then
    echo "❌ No deployment CLI found. Please install one:"
    echo ""
    echo "For Vercel:"
    echo "  npm install -g vercel"
    echo ""
    echo "For Netlify:"
    echo "  npm install -g netlify-cli"
    echo ""
    exit 1
fi

# Ask user which platform to deploy to
echo "Which platform would you like to deploy to?"
if [ "$VERCEL_AVAILABLE" = true ]; then
    echo "1) Vercel (Recommended)"
fi
if [ "$NETLIFY_AVAILABLE" = true ]; then
    echo "2) Netlify"
fi
echo "3) Exit"
echo ""

read -p "Enter your choice (1-3): " choice

case $choice in
    1)
        if [ "$VERCEL_AVAILABLE" = true ]; then
            echo ""
            echo "🚀 Deploying to Vercel..."
            echo ""
            echo "📋 Required Environment Variables:"
            echo "   - TWILIO_ACCOUNT_SID"
            echo "   - TWILIO_AUTH_TOKEN"
            echo "   - TWILIO_PHONE_NUMBER"
            echo "   - VAPI_API_KEY"
            echo "   - OPENROUTER_API_KEY"
            echo "   - AWS_ACCESS_KEY_ID"
            echo "   - AWS_SECRET_ACCESS_KEY"
            echo "   - AWS_REGION"
            echo ""
            read -p "Have you set all environment variables in Vercel? (y/n): " env_ready
            
            if [ "$env_ready" = "y" ] || [ "$env_ready" = "Y" ]; then
                echo "Deploying to production..."
                vercel --prod
                echo ""
                echo "✅ Deployment complete!"
                echo "📞 Don't forget to update your Twilio webhook URLs with the new domain!"
            else
                echo "Please set your environment variables first:"
                echo "  vercel env add TWILIO_ACCOUNT_SID"
                echo "  vercel env add TWILIO_AUTH_TOKEN"
                echo "  # ... (repeat for all variables)"
                echo ""
                echo "Then run this script again."
            fi
        else
            echo "❌ Vercel CLI not available"
        fi
        ;;
    2)
        if [ "$NETLIFY_AVAILABLE" = true ]; then
            echo ""
            echo "🚀 Deploying to Netlify..."
            echo ""
            echo "📋 Required Environment Variables:"
            echo "   Set these in your Netlify dashboard under Site settings > Environment variables"
            echo ""
            read -p "Have you set all environment variables in Netlify? (y/n): " env_ready
            
            if [ "$env_ready" = "y" ] || [ "$env_ready" = "Y" ]; then
                echo "Deploying to production..."
                netlify deploy --prod
                echo ""
                echo "✅ Deployment complete!"
                echo "📞 Don't forget to update your Twilio webhook URLs with the new domain!"
            else
                echo "Please set your environment variables in the Netlify dashboard first."
            fi
        else
            echo "❌ Netlify CLI not available"
        fi
        ;;
    3)
        echo "Deployment cancelled."
        exit 0
        ;;
    *)
        echo "Invalid choice. Exiting."
        exit 1
        ;;
esac

echo ""
echo "🎉 Next steps:"
echo "1. Copy your deployment URL"
echo "2. Go to your Twilio Console"
echo "3. Update webhook URLs:"
echo "   - Voice: https://your-domain.vercel.app/voice"
echo "   - SMS: https://your-domain.vercel.app/sms"
echo "   - Recording Status: https://your-domain.vercel.app/recording-status"
echo "   - Transcription: https://your-domain.vercel.app/transcription"
echo "4. Test by calling your Twilio number!"
