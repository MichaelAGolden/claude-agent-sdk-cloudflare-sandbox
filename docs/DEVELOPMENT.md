# Development Setup Guide

This monorepo contains the Claude Agent SDK integrated with Cloudflare Sandbox + a React frontend.

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
│   └── .env.example
├── scripts/
│   └── setup-r2.sh         # R2 bucket setup script
├── Dockerfile              # Sandbox container image
├── server.ts               # Cloudflare Worker (Hono)
├── wrangler.toml           # Worker configuration
└── package.json            # Root monorepo scripts
```

## Architecture

```
┌─────────────────┐
│ Frontend (5173) │  React + Socket.IO client
└────────┬────────┘
         │ Proxy
         ▼
┌─────────────────┐
│ Worker (8787)   │  Hono + getSandbox()
└────────┬────────┘
         │ wsConnect()
         ▼
┌─────────────────┐
│ Sandbox (3001)  │  Express + Socket.IO + Claude Agent SDK
└─────────────────┘
```

## Quick Start

### 1. Install Dependencies

```bash
npm run install:all
```

This installs dependencies for:
- Root (Worker)
- `container/` (Agent SDK)
- `frontend/` (React app)

### 2. Set Up Environment Variables

**Root `.dev.vars`** (for Worker):
```env
ANTHROPIC_API_KEY=sk-ant-...
API_KEY=your-worker-api-key
ENVIRONMENT=development
```

**Frontend `.env`** (leave empty - uses proxy):
```env
# Development uses proxy in vite.config.ts
# No API keys needed here
```

### 3. Set Up R2 (Optional - for persistent storage)

```bash
npm run setup:r2
```

### 4. Run Development Servers

**Option A: Run backend only**
```bash
npm run dev
```
- Worker: http://localhost:8787
- Health check: http://localhost:8787/health

**Option B: Run frontend + backend together**
```bash
npm run dev:full
```
- Frontend: http://localhost:5173
- Worker: http://localhost:8787

### 5. Test the Setup

Visit http://localhost:5173 and:
1. The frontend should load
2. It will connect to the worker via the `/ws` endpoint
3. The worker proxies to the agent SDK in the sandbox
4. You can start chatting with Claude

## Development Workflow

### Backend Development (Worker + Agent SDK)

1. Edit `server.ts` (Worker logic)
2. Edit `container/agent-sdk.ts` (Agent logic)
3. Hot reload happens automatically with `wrangler dev`

### Frontend Development

1. Edit files in `frontend/src/`
2. Vite hot reload updates instantly
3. API calls proxy to `localhost:8787`

### Testing Locally

```bash
# Test Worker health
curl http://localhost:8787/health

# Upload a test skill
curl -X POST http://localhost:8787/users/test-user/skills \
  -H "Authorization: Bearer test-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test.md",
    "content": "# Test Skill"
  }'

# Setup sandbox
curl -X POST "http://localhost:8787/setup/test-session?userId=test-user" \
  -H "Authorization: Bearer test-key"

# Test WebSocket via frontend
# Open http://localhost:5173
```

## Port Reference

| Service | Port | Description |
|---------|------|-------------|
| Frontend (Vite) | 5173 | React dev server |
| Worker (Wrangler) | 8787 | Cloudflare Worker local dev |
| Agent (Container) | 3001 | Socket.IO + Agent SDK |

## Common Issues

### "Cannot connect to Worker"

**Symptom**: Frontend shows connection error

**Solution**:
1. Ensure `npm run dev` is running
2. Check http://localhost:8787/health
3. Verify `.dev.vars` has `ANTHROPIC_API_KEY`

### "Sandbox not starting"

**Symptom**: Worker connects but sandbox fails

**Solution**:
1. Ensure Docker is running
2. Check container build: `wrangler dev` logs
3. Verify `container/agent-sdk.ts` compiled: `cd container && npm run build`

### "WebSocket connection failed"

**Symptom**: Frontend connects but WebSocket fails

**Solution**:
1. Check `frontend/vite.config.ts` proxy is set to port 8787
2. Ensure Worker `/ws` endpoint is working: test with curl
3. Check `container/agent-sdk.ts` is listening on port 3001

### "API Key not found"

**Symptom**: "ANTHROPIC_API_KEY not found" error

**Solution**:
1. Create `.dev.vars` in project root
2. Add: `ANTHROPIC_API_KEY=sk-ant-...`
3. Restart `npm run dev`

## Building for Production

```bash
# Build everything
npm run build

# Deploy to Cloudflare
npm run deploy
```

The frontend builds to `public/` and is served by the Worker in production.

## Useful Scripts

| Command | Description |
|---------|-------------|
| `npm run install:all` | Install all dependencies |
| `npm run dev` | Run Worker only |
| `npm run dev:frontend` | Run frontend only |
| `npm run dev:full` | Run both (recommended) |
| `npm run build` | Build all |
| `npm run deploy` | Deploy to Cloudflare |
| `npm run setup:r2` | Create R2 bucket |

## Monorepo Structure

This is a simple monorepo without a tool like Turborepo:

- **Root**: Worker code (`server.ts`)
- **container/**: Agent SDK (runs in sandbox)
- **frontend/**: React app

Each has its own `package.json` and `node_modules`.

## Environment Variables Reference

### Root `.dev.vars` (Worker)

```env
ANTHROPIC_API_KEY=sk-ant-...      # Required: Your Anthropic API key
API_KEY=your-key                   # Optional: Auth for /users endpoints
ENVIRONMENT=development            # dev | production
MODEL=claude-sonnet-4-5-20250929  # Optional: Default model
```

### Frontend `.env` (Not needed for development)

Development uses vite proxy. Only needed for production builds with custom API URL.

## Next Steps

1. ✅ Run `npm run install:all`
2. ✅ Create `.dev.vars` with your `ANTHROPIC_API_KEY`
3. ✅ Run `npm run dev:full`
4. ✅ Open http://localhost:5173
5. 🎉 Start building!

For R2 persistent storage, see [README-R2-SETUP.md](./README-R2-SETUP.md)
