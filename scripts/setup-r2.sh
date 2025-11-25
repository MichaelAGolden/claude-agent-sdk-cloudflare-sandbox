#!/bin/bash

# Setup script for R2 buckets
# Run this once to create the necessary R2 bucket

echo "📦 Setting up R2 buckets for Claude Agent SDK..."

# Create the main user data bucket
echo "Creating claude-agent-user-data bucket..."
npx wrangler r2 bucket create claude-agent-user-data

# Verify bucket was created
echo ""
echo "✅ Verifying bucket creation..."
npx wrangler r2 bucket list

echo ""
echo "📝 Bucket structure:"
echo "  /users/{userId}/skills/        - User's custom Claude skills"
echo "  /users/{userId}/conversations/ - Conversation history"
echo "  /users/{userId}/settings/      - User settings"
echo ""
echo "✅ R2 setup complete!"
echo ""
echo "Next steps:"
echo "1. Run 'npm run dev' to test locally (uses writeFile)"
echo "2. Run 'npm run deploy' to deploy with R2 mounting"
