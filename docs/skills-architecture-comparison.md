# Skills Architecture Comparison

## Summary

All three approaches create **actual filesystem objects** - there's no difference in how the Claude Agent SDK sees the skills. The difference is **when** and **how** the files get onto the filesystem.

## Comparison Table

| Feature | Runtime (writeFile) | R2 Mount | Dockerfile COPY |
|---------|-------------------|----------|-----------------|
| **Works in `wrangler dev`** | ✅ Yes | ❌ No | ✅ Yes |
| **Works in production** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Per-user skills** | ✅ Yes | ❌ No | ❌ No |
| **Dynamic updates** | ✅ Yes | ✅ Yes (via R2) | ❌ No |
| **Startup speed** | 🟡 Medium | 🟡 Medium | ✅ Fast |
| **Skill size limit** | 🟡 Worker limit | ✅ Unlimited | 🟡 Image size |
| **Shared across sandboxes** | ❌ No | ✅ Yes | ✅ Yes (same image) |
| **Requires rebuild** | ❌ No | ❌ No | ✅ Yes |
| **Additional cost** | Free | R2 storage | Free |

## Recommendation by Use Case

### Use Runtime (`sandbox.writeFile()`) - **Current Implementation** ✅

**When:**
- Skills differ per user/session
- Developing locally with `wrangler dev`
- Skills are passed from frontend/API
- Skills are small-to-medium size (<1MB each)

**Example use cases:**
- User-provided custom skills
- A/B testing different skill versions
- Skills generated dynamically based on user context

---

### Use R2 Bucket Mount

**When:**
- Skills are shared across all users
- Large skill library (100+ skills)
- Skills updated frequently via admin interface
- Production-only deployment

**Example use cases:**
- Company-wide skill library
- Skills managed via CMS
- Version-controlled skills with rollback capability

---

### Use Dockerfile COPY

**When:**
- Skills are static and universal
- Minimal runtime configuration preferred
- Skills rarely change
- Fastest possible startup required

**Example use cases:**
- Built-in default skills
- Company standard operating procedures
- Skills that are part of your "product"

---

## Hybrid Approach (Recommended for Production)

Combine multiple approaches:

```typescript
// server.ts
app.get("/ws", async (c) => {
  const sandbox = getSandbox(c.env.Sandbox, sessionId);

  // 1. Static skills are already in Dockerfile at /workspace/.claude/skills/

  // 2. In production, mount shared skill library from R2
  if (c.env.ENVIRONMENT === 'production' && c.env.SKILLS_BUCKET) {
    await sandbox.mountBucket('shared-skills', '/workspace/.claude/skills/shared', {
      endpoint: `https://${c.env.ACCOUNT_ID}.r2.cloudflarestorage.com`,
      readOnly: true
    });
  }

  // 3. Add user-specific skills via runtime API
  const userSkills = await getUserSkills(sessionId);
  for (const skill of userSkills) {
    await sandbox.writeFile(
      `/workspace/.claude/skills/user/${skill.name}`,
      skill.content
    );
  }

  return sandbox.wsConnect(c.req.raw, 3001);
});
```

**Result:** Three tiers of skills:
- `/workspace/.claude/skills/*.md` - Built-in (Dockerfile)
- `/workspace/.claude/skills/shared/*.md` - Shared library (R2)
- `/workspace/.claude/skills/user/*.md` - User-specific (runtime)

---

## Current Implementation Status

✅ **Runtime (`writeFile`) is already implemented** in your `server.ts`

The API you have works perfectly and creates real filesystem objects:

```bash
# 1. Setup sandbox with skills
curl -X POST https://your-worker.workers.dev/setup/my-session \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "skills": [
      {
        "name": "debugging.md",
        "content": "# Debugging Skill\n..."
      }
    ]
  }'

# 2. Connect via WebSocket
# Skills are now available at /workspace/.claude/skills/debugging.md
```

The agent will discover and use these skills automatically.
