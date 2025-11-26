#!/bin/bash

# =============================================================================
# ezagentsdk Setup Script
# =============================================================================
# This script sets up everything you need to run the Claude Agent SDK on Cloudflare.
# 
# Prerequisites:
#   - Node.js 18+ installed
#   - Cloudflare account (free tier works)
#   - Anthropic API key (from console.anthropic.com)
#   - Clerk account (from clerk.com) for authentication
#
# Usage:
#   chmod +x scripts/setup.sh
#   ./scripts/setup.sh
# =============================================================================

set -e

echo ""
echo "╔═══════════════════════════════════════════════════════════════════════╗"
echo "║                     ezagentsdk Setup Script                           ║"
echo "║         Claude Agent SDK on Cloudflare - Reference Implementation     ║"
echo "╚═══════════════════════════════════════════════════════════════════════╝"
echo ""

# Check if wrangler is installed
if ! command -v npx &> /dev/null; then
    echo "❌ npx not found. Please install Node.js 18+ first."
    exit 1
fi

echo "📦 Step 1: Installing dependencies..."
npm run install:all

echo ""
echo "☁️  Step 2: Setting up Cloudflare resources..."
echo ""

# Check if logged into Cloudflare
echo "Checking Cloudflare authentication..."
if ! npx wrangler whoami &> /dev/null; then
    echo "You need to log in to Cloudflare first."
    npx wrangler login
fi

echo ""
echo "Creating D1 database..."
npx wrangler d1 create claude-agent-threads 2>/dev/null || echo "Database may already exist, continuing..."

echo ""
echo "Creating R2 bucket..."
npx wrangler r2 bucket create claude-agent-user-data 2>/dev/null || echo "Bucket may already exist, continuing..."

echo ""
echo "📝 Step 3: Environment setup"
echo ""

# Check for .dev.vars
if [ ! -f .dev.vars ]; then
    echo "Creating .dev.vars file..."
    cat > .dev.vars << 'ENVEOF'
# Anthropic API Key (required)
# Get yours at: https://console.anthropic.com/settings/keys
ANTHROPIC_API_KEY=sk-ant-your-key-here

# Model to use (optional, defaults to claude-sonnet-4-5-20250929)
MODEL=claude-sonnet-4-5-20250929

# API key for protected endpoints (optional)
API_KEY=your-secret-api-key

# Environment
ENVIRONMENT=development
ENVEOF
    echo "✅ Created .dev.vars - Please edit it with your Anthropic API key!"
else
    echo "✅ .dev.vars already exists"
fi

# Check for frontend .env.local
if [ ! -f frontend/.env.local ]; then
    echo ""
    echo "Creating frontend/.env.local..."
    cat > frontend/.env.local << 'ENVEOF'
# Clerk Authentication (required)
# Get yours at: https://dashboard.clerk.com
VITE_CLERK_PUBLISHABLE_KEY=pk_test_your-key-here
ENVEOF
    echo "✅ Created frontend/.env.local - Please edit it with your Clerk key!"
else
    echo "✅ frontend/.env.local already exists"
fi

echo ""
echo "🗄️  Step 4: Running database migrations..."
echo ""
echo "Note: Run these commands manually for remote database:"
echo "  npx wrangler d1 execute claude-agent-threads --remote --file=migrations/0001_initial.sql"
echo "  npx wrangler d1 execute claude-agent-threads --remote --file=migrations/0002_soft_delete.sql"

echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo ""
echo "  1. Edit .dev.vars and add your ANTHROPIC_API_KEY"
echo "     Get one at: https://console.anthropic.com/settings/keys"
echo ""
echo "  2. Edit frontend/.env.local and add your VITE_CLERK_PUBLISHABLE_KEY"
echo "     Get one at: https://dashboard.clerk.com"
echo ""
echo "  3. Start the development server:"
echo "     npm run dev:full"
echo ""
echo "  4. Open http://localhost:5173"
echo ""
echo "For production deployment, see the README.md"
echo ""
