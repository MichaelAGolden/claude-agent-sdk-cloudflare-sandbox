# API Reference

Complete API reference for the Claude Agent SDK Cloudflare Worker.

## Authentication

All endpoints (except `/health` and `/ws`) require Bearer token authentication:

```
Authorization: Bearer YOUR_API_KEY
```

Set `API_KEY` via Wrangler secret:
```bash
npx wrangler secret put API_KEY
```

---

## Endpoints

### Health Check

**GET** `/health`

Check Worker status and configuration.

**Response:**
```json
{
  "status": "healthy",
  "environment": "development",
  "hasApiKey": true,
  "hasSandbox": true,
  "hasR2": true,
  "timestamp": "2025-01-15T10:00:00.000Z"
}
```

---

### Setup Sandbox

**POST** `/setup/:sessionId?userId={userId}`

Prepare a sandbox with user's skills from R2.

**Parameters:**
- `sessionId` (path): Unique session identifier
- `userId` (query): User ID for loading skills

**Response (Development):**
```json
{
  "status": "ready",
  "sessionId": "session-123",
  "userId": "user-456",
  "setupMethod": "r2_load_dev",
  "skillsLoaded": [
    "/workspace/.claude/skills/debugging.md"
  ],
  "message": "Sandbox prepared. Connect via WebSocket to /ws?sessionId=session-123"
}
```

**Response (Production):**
```json
{
  "status": "ready",
  "sessionId": "session-123",
  "userId": "user-456",
  "setupMethod": "r2_mount",
  "message": "Sandbox prepared. Connect via WebSocket to /ws?sessionId=session-123"
}
```

---

### WebSocket Connection

**GET** `/ws?sessionId={sessionId}`

Upgrade to WebSocket for agent communication.

**Parameters:**
- `sessionId` (query): Session ID from setup call

**WebSocket Events:**

#### Client → Server

**`start`** - Initialize agent session
```javascript
socket.emit('start', {
  maxTurns: 50,
  model: 'claude-sonnet-4-5-20250929',
  systemPrompt: 'You are a helpful assistant',
  // ... other Options from Claude Agent SDK
});
```

**`message`** - Send user message
```javascript
socket.emit('message', {
  prompt: 'Help me debug this code',
  options: {}  // Optional overrides
});
```

**`interrupt`** - Stop current execution
```javascript
socket.emit('interrupt');
```

**`clear`** - Clear session history
```javascript
socket.emit('clear');
```

#### Server → Client

**`status`** - Status updates
```javascript
socket.on('status', (data) => {
  console.log(data); // { type: "info", message: "Session initialized" }
});
```

**`message`** - Agent messages
```javascript
socket.on('message', (data) => {
  console.log(data); // { role: "assistant", content: [...], uuid: "..." }
});
```

**`stream`** - Streaming text
```javascript
socket.on('stream', (data) => {
  console.log(data); // { type: "text", content: "Hello" }
});
```

**`result`** - Final result
```javascript
socket.on('result', (data) => {
  console.log(data); // { type: "result", cost_usd: 0.05, ... }
});
```

---

### Skills Management

#### Upload Skill

**POST** `/users/:userId/skills`

Upload a skill to R2.

**Body:**
```json
{
  "name": "debugging.md",
  "content": "# Debugging Skill\n\nWhen debugging..."
}
```

**Response:**
```json
{
  "status": "success",
  "userId": "user-123",
  "skillName": "debugging.md",
  "key": "users/user-123/skills/debugging.md",
  "message": "Skill saved to R2. Call /setup/:sessionId to load into sandbox."
}
```

#### List Skills

**GET** `/users/:userId/skills`

List all skills for a user.

**Response:**
```json
{
  "userId": "user-123",
  "skills": ["debugging.md", "testing.md"],
  "count": 2
}
```

#### Get Skill

**GET** `/users/:userId/skills/:skillName`

Get a specific skill.

**Response:**
```json
{
  "userId": "user-123",
  "skillName": "debugging.md",
  "content": "# Debugging Skill\n...",
  "metadata": {
    "userId": "user-123",
    "uploadedAt": "2025-01-15T10:00:00.000Z"
  },
  "uploaded": "2025-01-15T10:00:00.000Z",
  "size": 1234
}
```

#### Delete Skill

**DELETE** `/users/:userId/skills/:skillName`

Delete a skill.

**Response:**
```json
{
  "status": "deleted",
  "userId": "user-123",
  "skillName": "debugging.md",
  "key": "users/user-123/skills/debugging.md"
}
```

---

### Conversations Management

#### Save Conversation

**POST** `/users/:userId/conversations`

Save conversation history to R2.

**Body:**
```json
{
  "conversationId": "conv-123",
  "messages": [
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "Hi there!" }
  ],
  "metadata": {
    "startedAt": "2025-01-15T10:00:00Z",
    "endedAt": "2025-01-15T10:15:00Z"
  }
}
```

**Response:**
```json
{
  "status": "saved",
  "userId": "user-123",
  "conversationId": "conv-123",
  "key": "users/user-123/conversations/conv-123.json"
}
```

#### Get Conversation

**GET** `/users/:userId/conversations/:conversationId`

Retrieve conversation from R2.

**Response:**
```json
{
  "userId": "user-123",
  "conversationId": "conv-123",
  "conversation": {
    "conversationId": "conv-123",
    "messages": [...],
    "metadata": {...}
  },
  "metadata": {
    "userId": "user-123",
    "conversationId": "conv-123",
    "savedAt": "2025-01-15T10:15:00.000Z"
  },
  "uploaded": "2025-01-15T10:15:00.000Z"
}
```

---

### Sandbox Management

#### Destroy Sandbox

**DELETE** `/sandbox/:sessionId`

Destroy a sandbox and free resources.

**Response:**
```json
{
  "status": "destroyed",
  "sessionId": "session-123"
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message describing what went wrong"
}
```

**Status Codes:**
- `400` - Bad Request (missing required fields)
- `401` - Unauthorized (invalid or missing API key)
- `404` - Not Found (resource doesn't exist)
- `426` - Upgrade Required (WebSocket connection expected)
- `500` - Internal Server Error

---

## Complete Usage Example

```bash
#!/bin/bash

API_KEY="your_api_key"
BASE_URL="https://your-worker.workers.dev"
USER_ID="alice"
SESSION_ID="session-$(date +%s)"

# 1. Upload a skill
curl -X POST "${BASE_URL}/users/${USER_ID}/skills" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "debugging.md",
    "content": "# Debugging Skill\n\nWhen debugging, always..."
  }'

# 2. Setup sandbox
curl -X POST "${BASE_URL}/setup/${SESSION_ID}?userId=${USER_ID}" \
  -H "Authorization: Bearer ${API_KEY}"

# 3. Connect via WebSocket (JavaScript)
# const socket = io(`${BASE_URL}/ws?sessionId=${SESSION_ID}`);

# 4. After conversation, save it
curl -X POST "${BASE_URL}/users/${USER_ID}/conversations" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "conv-1",
    "messages": [...]
  }'
```

---

## Rate Limits

Currently no rate limits enforced. In production, consider:
- Rate limiting per user/IP
- Max sandbox sessions per user
- Max skills per user
- Max conversation size

---

## Next Steps

1. Review [README-R2-SETUP.md](./README-R2-SETUP.md) for R2 configuration
2. Set up authentication in your application
3. Build frontend integration
4. Monitor usage in Cloudflare dashboard
