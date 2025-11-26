# R2 Integration Setup Guide

This guide explains how to set up and use R2 for persistent storage of user skills, conversations, and settings.

## Architecture

```
User Data R2 Bucket (claude-agent-user-data)
├── users/
│   └── {userId}/
│       ├── skills/
│       │   ├── debugging.md
│       │   └── testing.md
│       ├── conversations/
│       │   ├── conv-123.json
│       │   └── conv-456.json
│       └── settings/
│           └── preferences.json
```

## Environment Modes

### Development (`wrangler dev`)
- **R2 Mounting**: ❌ Not available (FUSE not supported)
- **Skill Loading**: Skills loaded from R2 via `sandbox.writeFile()`
- **Benefit**: Test R2 integration locally

### Production (deployed)
- **R2 Mounting**: ✅ Available
- **Skill Loading**: R2 bucket mounted as `/workspace/.claude/` filesystem
- **Benefit**: Better performance, no per-request file loading

## Setup Steps

### 1. Create R2 Bucket

```bash
# Run the setup script
chmod +x scripts/setup-r2.sh
./scripts/setup-r2.sh

# Or manually:
npx wrangler r2 bucket create claude-agent-user-data
```

### 2. Set Environment Variable

Add to your `.dev.vars` file for local development:

```env
ANTHROPIC_API_KEY=your_api_key
API_KEY=your_worker_api_key
ENVIRONMENT=development
```

For production, set via Wrangler:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put API_KEY
```

### 3. Deploy

```bash
npm run deploy
```

## API Usage

### 1. Upload Skills to R2

Store skills in R2 for a user:

```bash
curl -X POST https://your-worker.workers.dev/users/user-123/skills \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "debugging.md",
    "content": "# Debugging Skill\n\nWhen debugging..."
  }'
```

### 2. List User's Skills

```bash
curl https://your-worker.workers.dev/users/user-123/skills \
  -H "Authorization: Bearer YOUR_API_KEY"
```

Response:
```json
{
  "userId": "user-123",
  "skills": ["debugging.md", "testing.md"],
  "count": 2
}
```

### 3. Setup Sandbox with Skills

Before connecting, call setup to load user's skills:

```bash
curl -X POST "https://your-worker.workers.dev/setup/session-abc?userId=user-123" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

Response (development):
```json
{
  "status": "ready",
  "sessionId": "session-abc",
  "userId": "user-123",
  "setupMethod": "r2_load_dev",
  "skillsLoaded": [
    "/workspace/.claude/skills/debugging.md",
    "/workspace/.claude/skills/testing.md"
  ],
  "message": "Sandbox prepared. Connect via WebSocket to /ws?sessionId=session-abc"
}
```

Response (production):
```json
{
  "status": "ready",
  "sessionId": "session-abc",
  "userId": "user-123",
  "setupMethod": "r2_mount",
  "message": "Sandbox prepared. Connect via WebSocket to /ws?sessionId=session-abc"
}
```

### 4. Connect to Agent

```javascript
const socket = io('wss://your-worker.workers.dev/ws?sessionId=session-abc');

socket.on('connect', () => {
  console.log('Connected to agent');

  socket.emit('start', {
    maxTurns: 50,
    model: 'claude-sonnet-4-5-20250929'
  });
});

socket.on('message', (data) => {
  console.log('Agent message:', data);
});

// Send user message
socket.emit('message', {
  prompt: 'Help me debug this issue',
  options: {}
});
```

### 5. Save Conversation

Save conversation history to R2:

```bash
curl -X POST https://your-worker.workers.dev/users/user-123/conversations \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "conv-123",
    "messages": [
      { "role": "user", "content": "Hello" },
      { "role": "assistant", "content": "Hi!" }
    ],
    "metadata": {
      "startedAt": "2025-01-15T10:00:00Z",
      "endedAt": "2025-01-15T10:15:00Z"
    }
  }'
```

### 6. Retrieve Conversation

```bash
curl https://your-worker.workers.dev/users/user-123/conversations/conv-123 \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Complete Example Flow

```bash
# 1. Upload skills for a user
curl -X POST https://api.example.com/users/alice/skills \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"name": "debugging.md", "content": "..."}'

# 2. Setup sandbox with user's skills
curl -X POST https://api.example.com/setup/session-1?userId=alice \
  -H "Authorization: Bearer ${API_KEY}"

# 3. Connect via WebSocket (in client code)
const socket = io('wss://api.example.com/ws?sessionId=session-1');

# 4. After conversation, save to R2
curl -X POST https://api.example.com/users/alice/conversations \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"conversationId": "conv-1", "messages": [...]}'
```

## Troubleshooting

### R2 Bucket Not Found

```bash
# List buckets
npx wrangler r2 bucket list

# Create if missing
npx wrangler r2 bucket create claude-agent-user-data
```

### Skills Not Loading

Check the setup response to see which method was used:

- `setupMethod: "r2_mount"` - Production, R2 mounted successfully
- `setupMethod: "r2_load_dev"` - Development, loaded via writeFile
- `setupMethod: "r2_load_fallback"` - Production mount failed, using fallback

### Permission Errors

Ensure your Worker has R2 permissions:

```toml
# wrangler.toml
[[r2_buckets]]
binding = "USER_DATA"
bucket_name = "claude-agent-user-data"
```

## Cost Considerations

- **Storage**: $0.015/GB-month
- **Class A Operations** (write, list): $4.50 per million
- **Class B Operations** (read): $0.36 per million
- **Egress**: $0 (free)

Estimated costs for 1000 users with 5 skills each:
- Storage: ~5MB * 1000 = 5GB = $0.075/month
- Reads (1000 users * 5 skills * 30 days): 150k operations = $0.05/month
- **Total**: ~$0.13/month

## Next Steps

1. Run `chmod +x scripts/setup-r2.sh && ./scripts/setup-r2.sh` to create the R2 bucket
2. Set environment variables in `.dev.vars` for local development
3. Test locally with `npm run dev`
4. Deploy to production with `npm run deploy`
5. Integrate with your frontend application
6. Monitor R2 usage via Cloudflare dashboard
