# Dockerfile Skills Architecture (Static)

## Overview

Bake Claude skills into the Docker image at build time for fastest container startup.

## Implementation

### 1. Create skills directory structure

```
project-root/
├── skills/
│   ├── debugging.md
│   ├── testing.md
│   └── optimization.md
├── Dockerfile
└── ...
```

### 2. Update Dockerfile

```dockerfile
FROM docker.io/cloudflare/sandbox:0.5.1

# Build the agent application
WORKDIR /app
COPY container/package.json container/tsconfig.json ./
COPY container/agent-sdk.ts ./
RUN npm install && npm run build

# Copy skills into the container at build time
WORKDIR /workspace
RUN mkdir -p .claude/skills
COPY skills/ .claude/skills/

# Expose the agent port
EXPOSE 3001

# Run both processes
CMD node /app/dist/agent-sdk.js & exec bun /container-server/dist/index.js
```

### 3. Simplified server.ts

Since skills are already in the container, you don't need the setup endpoint:

```typescript
app.get("/ws", async (c) => {
  const sessionId = c.req.query("sessionId") || "default";
  const sandbox = getSandbox(c.env.Sandbox, sessionId);

  await sandbox.setEnvVars({
    ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY || c.env.CLAUDE_CODE_OAUTH_TOKEN || "",
    CLAUDE_MODEL: c.env.MODEL || "claude-sonnet-4-5-20250929",
  });

  // Skills are already at /workspace/.claude/skills/ from Dockerfile
  return sandbox.wsConnect(c.req.raw, 3001);
});
```

## Benefits

- ✅ Fastest container startup (skills already present)
- ✅ Works in both dev and production
- ✅ No runtime API calls needed
- ✅ Simple architecture

## Limitations

- ❌ Skills are static (same for all users)
- ❌ Requires Docker rebuild to update skills
- ❌ Larger Docker image size
- ❌ Not suitable for user-specific or dynamic skills

## Best For

- Default/common skills that all users need
- Skills that rarely change
- When you want minimal runtime configuration
