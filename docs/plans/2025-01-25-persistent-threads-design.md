# Persistent Chat Threads Design

## Overview

Add persistent chat threads with the ability to switch between conversations, each resumable via Claude SDK's session management.

## Architecture

```
User → Frontend (React + Clerk + assistant-ui)
     → Clerk Auth (JWT token)
     → Workers Backend (validates JWT, manages D1/R2)
     → Durable Object Sandbox (per-session isolation)
     → Container (agent-sdk.ts)
```

## Technology Choices

| Component | Technology | Purpose |
|-----------|------------|---------|
| Auth | Clerk | User authentication (local & production) |
| Structured data | D1 (SQL) | Users, threads, messages - strongly consistent |
| Blob storage | R2 | User uploads, agent artifacts |
| SDK runtime | Durable Object | Claude Agent SDK container |
| Frontend | React + assistant-ui | ThreadListSidebar + Thread components |
| Title generation | Claude Haiku | Auto-generate thread titles (cost-effective) |

## D1 Database Schema

```sql
-- Users table (synced from Clerk)
CREATE TABLE users (
  id TEXT PRIMARY KEY,              -- Clerk user ID
  email TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Threads table
CREATE TABLE threads (
  id TEXT PRIMARY KEY,              -- UUID
  user_id TEXT NOT NULL,
  session_id TEXT,                  -- Claude SDK session ID for resume
  title TEXT DEFAULT 'New conversation',
  summary TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Messages table
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL,               -- 'user', 'assistant', 'hook'
  content TEXT NOT NULL,            -- JSON for complex content
  hook_event TEXT,                  -- JSON for hook data (nullable)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX idx_threads_user ON threads(user_id, updated_at DESC);
CREATE INDEX idx_messages_thread ON messages(thread_id, created_at);
```

## R2 Storage Structure

```
uploads/{userId}/{threadId}/{filename}    -- User file uploads
artifacts/{userId}/{threadId}/{filename}  -- Agent-generated files
```

## API Endpoints

```
GET    /api/threads              -- List user's threads
POST   /api/threads              -- Create new thread
GET    /api/threads/:id          -- Get thread + messages
PATCH  /api/threads/:id          -- Update title
DELETE /api/threads/:id          -- Delete thread + messages
POST   /api/threads/:id/title    -- Generate title with Haiku
```

## Frontend Structure

```tsx
<ClerkProvider>
  <SignedIn>
    <ThreadProvider>
      <SidebarProvider>
        <ThreadListSidebar />
        <SidebarInset>
          <AgentProvider threadId={currentThreadId}>
            <Thread />
          </AgentProvider>
        </SidebarInset>
      </SidebarProvider>
    </ThreadProvider>
  </SignedIn>
  <SignedOut>
    <SignInPage />
  </SignedOut>
</ClerkProvider>
```

## Key Flows

### New Thread
1. User clicks "New Thread" in sidebar
2. `POST /api/threads` creates D1 record, returns `threadId`
3. Frontend switches to new thread (empty state)
4. On first message, SDK generates `session_id`
5. Backend updates thread with `session_id`
6. After first response, call Haiku to generate title

### Thread Switching
1. User clicks thread in sidebar
2. `GET /api/threads/:id` fetches thread + messages
3. Frontend updates state with messages
4. Socket reconnects with thread's `sessionId`
5. SDK resumes session with full context

### Session Resume
When connecting to a thread with existing `session_id`:
```typescript
const q = query({
  prompt: userMessage,
  options: {
    resume: thread.sessionId,  // Resume existing session
    // ... other options
  }
});
```

## Clerk Integration

### Frontend
```tsx
import { ClerkProvider, SignedIn, SignedOut, useAuth } from '@clerk/clerk-react';

// Get token for API calls
const { getToken } = useAuth();
const token = await getToken();

// Attach to Socket.IO
const socket = io(URL, {
  auth: { token }
});
```

### Backend (Workers)
```typescript
import { verifyToken } from '@clerk/backend';

// Middleware
const { userId } = await verifyToken(token, {
  secretKey: env.CLERK_SECRET_KEY
});
```

## Haiku Title Generation

```typescript
import Anthropic from '@anthropic-ai/sdk';

async function generateTitle(firstMessage: string): Promise<string> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 50,
    messages: [{
      role: 'user',
      content: `Generate a short 3-6 word title for this conversation. Only respond with the title, no quotes or explanation.\n\nFirst message: "${firstMessage}"`
    }]
  });
  return response.content[0].text.trim();
}
```

## Implementation Order

1. **Clerk Setup** - Add to frontend, protect routes
2. **D1 Database** - Create database, run schema migration
3. **API Endpoints** - Thread CRUD in Workers
4. **ThreadContext** - Frontend state management for threads
5. **ThreadListSidebar** - Install and integrate assistant-ui component
6. **Thread Switching** - Wire up session resume with SDK
7. **Title Generation** - Add Haiku integration
8. **Polish** - Error handling, loading states, optimistic updates

## Wrangler Bindings

```toml
# wrangler.toml additions
[[d1_databases]]
binding = "DB"
database_name = "claude-agent-threads"
database_id = "..." # From: wrangler d1 create claude-agent-threads

[vars]
CLERK_PUBLISHABLE_KEY = "pk_..."

# In .dev.vars (secrets)
CLERK_SECRET_KEY = "sk_..."
```

## Notes

- **No KV**: D1 provides strong consistency needed for real-time chat state
- **Session ID**: Captured from SDK's first `system` message with `subtype: 'init'`
- **Thread deletion**: Cascades to messages via foreign key
- **Auth mode**: Clerk for both local dev and production (unified experience)
