# R2 Skills Architecture (Production)

## Overview

Store Claude skills in a Cloudflare R2 bucket and mount them as a local filesystem in the sandbox.

## Setup

### 1. Create R2 Bucket

```bash
wrangler r2 bucket create claude-skills
```

### 2. Upload Skills to R2

```bash
wrangler r2 object put claude-skills/my-skill.md --file ./local-skills/my-skill.md
```

Or via API:
```typescript
// Upload skills to R2 from your application
await env.SKILLS_BUCKET.put('my-skill.md', skillContent);
```

### 3. Update wrangler.toml

```toml
[[r2_buckets]]
binding = "SKILLS_BUCKET"
bucket_name = "claude-skills"
```

### 4. Update server.ts

```typescript
type Bindings = {
  Sandbox: DurableObjectNamespace<Sandbox>;
  SKILLS_BUCKET: R2Bucket;  // Add this
  // ... other bindings
};

app.get("/ws", async (c) => {
  const sessionId = c.req.query("sessionId") || "default";
  const sandbox = getSandbox(c.env.Sandbox, sessionId);

  // Mount R2 bucket as /workspace/.claude/skills
  await sandbox.mountBucket('claude-skills', '/workspace/.claude/skills', {
    endpoint: `https://${c.env.ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: c.env.R2_ACCESS_KEY_ID,
      secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
    },
    readOnly: true  // Skills are read-only
  });

  // Set env vars
  await sandbox.setEnvVars({
    ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY || c.env.CLAUDE_CODE_OAUTH_TOKEN || "",
    CLAUDE_MODEL: c.env.MODEL || "claude-sonnet-4-5-20250929",
  });

  // Now skills in R2 are available at /workspace/.claude/skills/*
  return sandbox.wsConnect(c.req.raw, 3001);
});
```

## Benefits

- ✅ Centralized skill storage
- ✅ Skills shared across all sandboxes
- ✅ Large skill libraries supported
- ✅ Version control via R2 object versioning
- ✅ Skills appear as real filesystem objects

## Limitations

- ❌ Does NOT work with `wrangler dev` (only production)
- ❌ Requires R2 setup and credentials
- ❌ Skills are read-only (must update via R2 API)

## Hybrid Approach

For development flexibility:

```typescript
if (c.env.ENVIRONMENT === 'production') {
  // Mount R2 in production
  await sandbox.mountBucket('claude-skills', '/workspace/.claude/skills', {...});
} else {
  // Use writeFile in development
  for (const skill of skills) {
    await sandbox.writeFile(`/workspace/.claude/skills/${skill.name}`, skill.content);
  }
}
```
