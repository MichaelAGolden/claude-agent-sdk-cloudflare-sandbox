# ezagentsdk - Claude Agent SDK on Cloudflare

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Live Demo](https://img.shields.io/badge/Demo-ezagentsdk.com-orange.svg)](https://ezagentsdk.com)

A production-ready reference implementation showing how easy it is to deploy the Claude Agent SDK on Cloudflare's edge infrastructure. Features persistent conversations, real-time streaming, and cloudflare stack of Workers, R2, D1, and the Sandbox SDK.

**Live Demo:** [ezagentsdk.com](https://ezagentsdk.com)

> This project was inspired by and extended from [receipting/claude-agent-sdk-cloudflare](https://github.com/receipting/claude-agent-sdk-cloudflare).

## Why Cloudflare Sandbox?

Cloudflare containers are a perfect fit for Claude Agent SDK because they work differently than other container solutions. Instead of just a container, you get three components:

- **Worker** (serverless compute) - Fast request routing and context setup
- **Durable Object** (stateful coordination) - Session management and container orchestration
- **Container** (isolated Agent runtime) - Secure Claude Agent SDK execution

This architecture lets you triage requests at the Worker level (SQL queries, caching, etc.) before even starting a container. Fast, economical, and scales automatically.

## Features

- **Real-time WebSocket streaming** via Socket.IO
- **Persistent R2 storage** for user skills, conversations, and settings
- **React frontend** with modern UI (Vite + TypeScript)
- **Hybrid dev/prod modes** (file writes in dev, R2 mounting in production)
- **Monorepo structure** with unified scripts
- **Skills system** with runtime loading from R2
- **Session management** per user with Durable Objects

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/MichaelAGolden/claude-agent-sdk-cloudflare-sandbox
cd claude-agent-sdk-cloudflare-sandbox

# 2. Run the setup script (creates resources, installs deps)
npm run setup

# 3. Add your API keys to the created files:
#    - .dev.vars: Add your ANTHROPIC_API_KEY
#    - frontend/.env.local: Add your VITE_CLERK_PUBLISHABLE_KEY

# 4. Start the development server
npm run dev:full
```

**Then open:** http://localhost:5174

**You'll need:**
- [Anthropic API key](https://console.anthropic.com/settings/keys) - for Claude
- [Clerk account](https://clerk.com) - for authentication (free tier works)

For detailed setup instructions, see **[docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)**

## Architecture

```
┌─────────────────┐
│ Frontend (5174) │  React + Socket.IO client
└────────┬────────┘
         │ Vite Proxy
         ▼
┌─────────────────┐
│ Worker (8787)   │  Hono + getSandbox()
└────────┬────────┘
         │ wsConnect()
         ▼
┌─────────────────┐
│ Sandbox (3001)  │  Express + Socket.IO + Claude Agent SDK
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ R2 Storage      │  User skills, conversations, settings
└─────────────────┘
```

**Request flow:**
1. User interacts with React frontend (port 5174)
2. Frontend connects via WebSocket to Worker (port 8787)
3. Worker uses `sandbox.wsConnect()` to proxy to container (port 3001)
4. Container runs Claude Agent SDK with Socket.IO
5. User data loads from R2 (mount in prod, writeFile in dev)

**Port Reference:**
- `5174` - Vite dev server (frontend)
- `8787` - Wrangler dev server (Worker)
- `3001` - Agent SDK Socket.IO server (container)
- `3000` - Reserved for Cloudflare control plane

## Project Structure

```
claude-agent-sdk-cloudflare-sandbox/
├── container/               # Agent SDK code (runs inside sandbox)
│   ├── agent-sdk.ts        # Socket.IO server for Claude Agent SDK
│   ├── package.json
│   └── dist/               # Built output
├── frontend/               # React + Vite frontend
│   ├── src/
│   ├── package.json
│   └── .env
├── scripts/
│   └── setup-r2.sh         # R2 bucket setup script
├── Dockerfile              # Sandbox container image
├── server.ts               # Cloudflare Worker (Hono)
├── wrangler.toml           # Worker configuration
└── package.json            # Root monorepo scripts
```

## Documentation

- **[docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)** - Complete development setup guide
- **[docs/README-R2-SETUP.md](./docs/README-R2-SETUP.md)** - R2 storage configuration and usage
- **[docs/API-REFERENCE.md](./docs/API-REFERENCE.md)** - Complete API documentation
- **[docs/IMPLEMENTATION-SUMMARY.md](./docs/IMPLEMENTATION-SUMMARY.md)** - Technical implementation overview

## Troubleshooting

See **[docs/DEVELOPMENT.md - Common Issues](./docs/DEVELOPMENT.md#common-issues)** for detailed troubleshooting, including:

- "Cannot connect to Worker"
- "Sandbox not starting"
- "WebSocket connection failed"
- "API Key not found"

Quick checks:
1. Ensure Docker is running
2. Check `.dev.vars` has `ANTHROPIC_API_KEY`
3. Verify `npm run dev:full` shows both servers running
4. Check http://localhost:8787/health returns healthy status

## Agent Skills

Skills are modular capabilities that transform Claude from a general-purpose assistant into a domain specialist. This repo demonstrates how to:

1. **Store skills in R2** - User skills persist in R2 object storage
2. **Load at runtime** - Skills load as filesystem objects before agent starts
3. **Per-user isolation** - Each user has their own skill collection

**How it works:**

```typescript
// Development: Write skills to sandbox filesystem
await sandbox.writeFile('/workspace/.claude/skills/my-skill.md', content);

// Production: Mount entire R2 bucket
await sandbox.mountBucket("claude-agent-user-data", "/workspace/.claude");
```

Skills must exist as **real filesystem objects** at `/workspace/.claude/skills/` before the agent starts, as the SDK discovers them during initialization.

**Managing skills:**

```bash
# Upload a skill for a user
curl -X POST http://localhost:8787/users/test-user/skills \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-skill.md", "content": "# My Skill\nInstructions..."}'

# List user skills
curl http://localhost:8787/users/test-user/skills \
  -H "Authorization: Bearer your-api-key"
```

For complete API documentation, see **[docs/API-REFERENCE.md](./docs/API-REFERENCE.md)**

For R2 setup and configuration, see **[docs/README-R2-SETUP.md](./docs/README-R2-SETUP.md)**

## Deploy to Production

```bash
# 1. Set up R2 bucket (if not already done)
npm run setup:r2

# 2. Build everything (container + frontend)
npm run build

# 3. Set production secrets
wrangler secret put ANTHROPIC_API_KEY    # Your Anthropic API key
wrangler secret put API_KEY              # Auth key for API endpoints
wrangler secret put ENVIRONMENT          # Set to "production"

# Optional secrets
wrangler secret put MODEL                # Defaults to claude-sonnet-4-5-20250929

# 4. Deploy
npm run deploy
```

**What gets deployed:**
- Worker with Hono server (`server.ts`)
- Durable Object for session management
- Container with Claude Agent SDK
- Frontend built to `public/` (served by Worker)
- R2 bucket binding for persistent storage

**Production endpoints:**
- `https://your-worker.workers.dev/` - Frontend (React app)
- `https://your-worker.workers.dev/health` - Health check
- `https://your-worker.workers.dev/ws` - WebSocket connection
- `https://your-worker.workers.dev/users/:userId/skills` - Skills API

## Configuration

### Environment Variables

**Development** (`.dev.vars` file):
```bash
ANTHROPIC_API_KEY=sk-ant-...           # Required: Anthropic API key
API_KEY=your-secret-key-here           # Required: Auth for API endpoints
ENVIRONMENT=development                # Required: dev | production
MODEL=claude-sonnet-4-5-20250929      # Optional: Default Claude model
```

**Production** (`wrangler secret`):
```bash
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put API_KEY
wrangler secret put ENVIRONMENT
wrangler secret put MODEL  # Optional
```

### Alternative: OAuth Token

For Claude Code OAuth tokens (requires Anthropic approval):

```bash
# Install Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Get OAuth token
claude setup-token

# Add to .dev.vars
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-your-oauth-token-here

# Deploy
wrangler secret put CLAUDE_CODE_OAUTH_TOKEN
```

Note: Most users should use `ANTHROPIC_API_KEY` instead.

### Container Configuration

Edit `wrangler.toml` to adjust container resources:

```toml
instance_type = "standard-2"  # basic | standard-1/2/3/4
max_instances = 60            # Max concurrent containers
```

Edit `server.ts` to adjust container lifecycle:

```typescript
sleepAfter: "5m"  // How long containers stay warm (5 minutes default)
```

## License

MIT
