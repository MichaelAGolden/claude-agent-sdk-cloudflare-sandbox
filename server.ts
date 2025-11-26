import { Hono } from "hono";
import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
export { Sandbox } from "@cloudflare/sandbox";

type Bindings = {
  Sandbox: DurableObjectNamespace<Sandbox>;
  USER_DATA: R2Bucket;
  DB: D1Database;
  ANTHROPIC_API_KEY?: string;
  CLAUDE_CODE_OAUTH_TOKEN?: string;
  MODEL?: string;
  API_KEY: string;
  CLERK_SECRET_KEY?: string;
  ACCOUNT_ID?: string;
  ENVIRONMENT?: string; // "development" | "production"
  PUBLIC_URL?: string;  // Public URL for WebSocket connections
};

type Skill = {
  name: string;
  content: string;
};

// Thread types for D1
type Thread = {
  id: string;
  user_id: string;
  session_id: string | null;
  title: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
};

type Message = {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  hook_event: string | null;
  created_at: string;
};

// Helper: Generate UUID
const generateUUID = (): string => {
  return crypto.randomUUID();
};

const app = new Hono<{ Bindings: Bindings }>();

// Helper: Check if running in production (R2 mounting available)
const isProduction = (env: Bindings): boolean => {
  return env.ENVIRONMENT === "production";
};

// Helper: Get R2 key for user's skill
const getUserSkillKey = (userId: string, skillName: string): string => {
  return `users/${userId}/skills/${skillName}`;
};

// Helper: Get R2 key prefix for user's skills directory
const getUserSkillsPrefix = (userId: string): string => {
  return `users/${userId}/skills/`;
};

// Helper: List all skills for a user from R2
const listUserSkillsFromR2 = async (
  bucket: R2Bucket,
  userId: string
): Promise<string[]> => {
  const prefix = getUserSkillsPrefix(userId);
  const listed = await bucket.list({ prefix });
  return listed.objects.map((obj) => obj.key.replace(prefix, ""));
};

// Helper: Load skills from R2 to sandbox (dev mode only)
const loadSkillsFromR2ToSandbox = async (
  sandbox: Sandbox,
  bucket: R2Bucket,
  userId: string
): Promise<string[]> => {
  const skillNames = await listUserSkillsFromR2(bucket, userId);
  const loaded: string[] = [];

  for (const skillName of skillNames) {
    const key = getUserSkillKey(userId, skillName);
    const obj = await bucket.get(key);
    if (obj) {
      const content = await obj.text();
      const skillPath = `/workspace/.claude/skills/${skillName}`;
      await sandbox.writeFile(skillPath, content);
      loaded.push(skillPath);
    }
  }

  return loaded;
};

// =============================================================================
// Session Transcript Sync Helpers
// =============================================================================
// The SDK stores transcripts at /root/.claude/projects/-workspace/<session_id>.jsonl
// We sync these to/from R2 at session start/end for persistence

// Helper: Get R2 key for a session transcript
const getTranscriptR2Key = (userId: string, sessionId: string): string => {
  return `users/${userId}/transcripts/${sessionId}.jsonl`;
};

// Helper: Get the local path where SDK stores transcripts
const getTranscriptLocalPath = (sessionId: string): string => {
  return `/root/.claude/projects/-workspace/${sessionId}.jsonl`;
};

// Helper: Restore transcript from R2 to sandbox (call BEFORE SDK query with resume)
const restoreTranscriptFromR2 = async (
  sandbox: Sandbox,
  bucket: R2Bucket,
  userId: string,
  sessionId: string
): Promise<boolean> => {
  try {
    const r2Key = getTranscriptR2Key(userId, sessionId);
    const obj = await bucket.get(r2Key);

    if (!obj) {
      console.log(`[Transcript] No transcript found in R2 for session ${sessionId}`);
      return false;
    }

    const content = await obj.text();
    const localPath = getTranscriptLocalPath(sessionId);

    // Ensure the directory exists
    await sandbox.mkdir("/root/.claude/projects/-workspace", { recursive: true });

    // Write transcript to local path
    await sandbox.writeFile(localPath, content);
    console.log(`[Transcript] Restored transcript from R2: ${r2Key} -> ${localPath}`);
    return true;
  } catch (error: any) {
    console.error(`[Transcript] Failed to restore from R2:`, error.message);
    return false;
  }
};

// Helper: Save transcript from sandbox to R2 (call AFTER session ends)
const saveTranscriptToR2 = async (
  sandbox: Sandbox,
  bucket: R2Bucket,
  userId: string,
  sessionId: string
): Promise<boolean> => {
  try {
    const localPath = getTranscriptLocalPath(sessionId);

    // Check if transcript exists
    const exists = await sandbox.exists(localPath);
    if (!exists.exists) {
      console.log(`[Transcript] No local transcript to save for session ${sessionId}`);
      return false;
    }

    // Read transcript from sandbox
    const file = await sandbox.readFile(localPath);
    const r2Key = getTranscriptR2Key(userId, sessionId);

    // Save to R2
    await bucket.put(r2Key, file.content, {
      httpMetadata: { contentType: "application/jsonl" },
      customMetadata: {
        userId,
        sessionId,
        savedAt: new Date().toISOString(),
      },
    });

    console.log(`[Transcript] Saved transcript to R2: ${localPath} -> ${r2Key}`);
    return true;
  } catch (error: any) {
    console.error(`[Transcript] Failed to save to R2:`, error.message);
    return false;
  }
};

app.get("/health", (c) => {
  return c.json({
    status: "healthy",
    environment: c.env.ENVIRONMENT || "development",
    hasApiKey: !!(c.env?.ANTHROPIC_API_KEY || c.env?.CLAUDE_CODE_OAUTH_TOKEN),
    hasSandbox: !!c.env?.Sandbox,
    hasR2: !!c.env?.USER_DATA,
    hasD1: !!c.env?.DB,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Worker info endpoint - provides public URL for WebSocket connections.
 * Called by frontend worker via service binding to discover backend URL.
 *
 * GET /_info
 */
app.get("/_info", (c) => {
  // Use configured PUBLIC_URL, or try to derive from request URL
  const publicUrl = c.env.PUBLIC_URL || new URL(c.req.url).origin;

  return c.json({
    publicUrl,
    socketPath: "/socket.io/",
    environment: c.env.ENVIRONMENT || "development",
  });
});

// =============================================================================
// Thread API Endpoints (D1)
// =============================================================================

/**
 * List all threads for a user.
 *
 * GET /api/threads?userId=xxx
 */
app.get("/api/threads", async (c) => {
  try {
    const userId = c.req.query("userId");
    if (!userId) {
      return c.json({ error: "userId query parameter is required" }, 400);
    }

    const result = await c.env.DB.prepare(
      `SELECT id, user_id, session_id, title, summary, created_at, updated_at
       FROM threads
       WHERE user_id = ? AND deleted_at IS NULL
       ORDER BY updated_at DESC`
    ).bind(userId).all<Thread>();

    return c.json({
      threads: result.results || [],
      count: result.results?.length || 0,
    });
  } catch (error: any) {
    console.error("[List Threads Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Create a new thread.
 *
 * POST /api/threads
 * Body: { userId: "xxx", title?: "optional title" }
 */
app.post("/api/threads", async (c) => {
  try {
    const body = await c.req.json<{ userId: string; title?: string }>();

    if (!body.userId) {
      return c.json({ error: "userId is required" }, 400);
    }

    const threadId = generateUUID();
    const title = body.title || "New conversation";
    const now = new Date().toISOString();

    // Ensure user exists (upsert)
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO users (id) VALUES (?)`
    ).bind(body.userId).run();

    // Create thread
    await c.env.DB.prepare(
      `INSERT INTO threads (id, user_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(threadId, body.userId, title, now, now).run();

    return c.json({
      id: threadId,
      user_id: body.userId,
      title,
      session_id: null,
      summary: null,
      created_at: now,
      updated_at: now,
    });
  } catch (error: any) {
    console.error("[Create Thread Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Get a thread with all its messages.
 *
 * GET /api/threads/:id
 */
app.get("/api/threads/:id", async (c) => {
  try {
    const threadId = c.req.param("id");

    // Get thread
    const thread = await c.env.DB.prepare(
      `SELECT id, user_id, session_id, title, summary, created_at, updated_at
       FROM threads WHERE id = ?`
    ).bind(threadId).first<Thread>();

    if (!thread) {
      return c.json({ error: "Thread not found" }, 404);
    }

    // Get messages
    const messagesResult = await c.env.DB.prepare(
      `SELECT id, thread_id, role, content, hook_event, created_at
       FROM messages
       WHERE thread_id = ?
       ORDER BY created_at ASC`
    ).bind(threadId).all<Message>();

    return c.json({
      thread,
      messages: messagesResult.results || [],
    });
  } catch (error: any) {
    console.error("[Get Thread Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Update a thread (title, session_id, summary).
 *
 * PATCH /api/threads/:id
 * Body: { title?: "xxx", sessionId?: "xxx", summary?: "xxx" }
 */
app.patch("/api/threads/:id", async (c) => {
  try {
    const threadId = c.req.param("id");
    const body = await c.req.json<{ title?: string; sessionId?: string; summary?: string }>();

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];

    if (body.title !== undefined) {
      updates.push("title = ?");
      values.push(body.title);
    }
    if (body.sessionId !== undefined) {
      updates.push("session_id = ?");
      values.push(body.sessionId);
    }
    if (body.summary !== undefined) {
      updates.push("summary = ?");
      values.push(body.summary);
    }

    if (updates.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    updates.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(threadId);

    await c.env.DB.prepare(
      `UPDATE threads SET ${updates.join(", ")} WHERE id = ?`
    ).bind(...values).run();

    // Return updated thread
    const thread = await c.env.DB.prepare(
      `SELECT id, user_id, session_id, title, summary, created_at, updated_at
       FROM threads WHERE id = ?`
    ).bind(threadId).first<Thread>();

    return c.json(thread);
  } catch (error: any) {
    console.error("[Update Thread Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Delete a thread (soft delete).
 *
 * - Soft deletes the thread in D1 (sets deleted_at timestamp)
 * - Deletes R2 transcript for the session if it exists
 * - D1 data is preserved for usage tracking
 *
 * DELETE /api/threads/:id
 */
app.delete("/api/threads/:id", async (c) => {
  try {
    const threadId = c.req.param("id");

    // Get thread info before soft-deleting (need user_id and session_id for R2 cleanup)
    const thread = await c.env.DB.prepare(
      `SELECT id, user_id, session_id FROM threads WHERE id = ? AND deleted_at IS NULL`
    ).bind(threadId).first<{ id: string; user_id: string; session_id: string | null }>();

    if (!thread) {
      return c.json({ error: "Thread not found" }, 404);
    }

    // Delete R2 transcript if session exists (cleanup conversation context)
    let r2Deleted = false;
    if (thread.session_id && c.env.USER_DATA) {
      try {
        const r2Key = getTranscriptR2Key(thread.user_id, thread.session_id);
        await c.env.USER_DATA.delete(r2Key);
        r2Deleted = true;
        console.log(`[Delete Thread] Deleted R2 transcript: ${r2Key}`);
      } catch (r2Error: any) {
        // Log but don't fail - R2 cleanup is best-effort
        console.error(`[Delete Thread] Failed to delete R2 transcript:`, r2Error.message);
      }
    }

    // Soft delete: set deleted_at timestamp instead of hard delete
    // This preserves D1 data for usage tracking
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE threads SET deleted_at = ? WHERE id = ?`
    ).bind(now, threadId).run();

    return c.json({
      status: "deleted",
      threadId,
      deletedAt: now,
      r2Deleted,
      preservedForTracking: true,
    });
  } catch (error: any) {
    console.error("[Delete Thread Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Add a message to a thread.
 *
 * POST /api/threads/:id/messages
 * Body: { role: "user"|"assistant"|"hook", content: "...", hookEvent?: {...} }
 */
app.post("/api/threads/:id/messages", async (c) => {
  try {
    const threadId = c.req.param("id");
    const body = await c.req.json<{ role: string; content: string; hookEvent?: any }>();

    if (!body.role || body.content === undefined) {
      return c.json({ error: "role and content are required" }, 400);
    }

    const messageId = generateUUID();
    const now = new Date().toISOString();
    const contentStr = typeof body.content === 'string' ? body.content : JSON.stringify(body.content);
    const hookEventStr = body.hookEvent ? JSON.stringify(body.hookEvent) : null;

    // Insert message
    await c.env.DB.prepare(
      `INSERT INTO messages (id, thread_id, role, content, hook_event, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(messageId, threadId, body.role, contentStr, hookEventStr, now).run();

    // Update thread's updated_at
    await c.env.DB.prepare(
      `UPDATE threads SET updated_at = ? WHERE id = ?`
    ).bind(now, threadId).run();

    return c.json({
      id: messageId,
      thread_id: threadId,
      role: body.role,
      content: contentStr,
      hook_event: hookEventStr,
      created_at: now,
    });
  } catch (error: any) {
    console.error("[Add Message Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

// =============================================================================
// Session Transcript Sync API Endpoints
// =============================================================================

/**
 * Restore a session transcript from R2 to sandbox.
 * Call this BEFORE sending a message with `resume` option.
 *
 * POST /api/sessions/:sandboxSessionId/restore
 * Body: { userId: "xxx", sdkSessionId: "xxx" }
 *
 * The sandboxSessionId is the ID used to get the sandbox (typically threadId).
 * The sdkSessionId is the Claude SDK's session_id for transcript lookup.
 */
app.post("/api/sessions/:sandboxSessionId/restore", async (c) => {
  try {
    const sandboxSessionId = c.req.param("sandboxSessionId");
    const body = await c.req.json<{ userId: string; sdkSessionId: string }>();

    if (!body.userId || !body.sdkSessionId) {
      return c.json({ error: "userId and sdkSessionId are required" }, 400);
    }

    // Check if running in production (R2 sync available)
    if (!isProduction(c.env)) {
      return c.json({
        status: "skipped",
        reason: "R2 sync not available in development mode",
        sandboxSessionId,
        sdkSessionId: body.sdkSessionId,
      });
    }

    const sandbox = getSandbox(c.env.Sandbox, sandboxSessionId);
    const restored = await restoreTranscriptFromR2(
      sandbox,
      c.env.USER_DATA,
      body.userId,
      body.sdkSessionId
    );

    return c.json({
      status: restored ? "restored" : "not_found",
      sandboxSessionId,
      sdkSessionId: body.sdkSessionId,
      userId: body.userId,
      localPath: getTranscriptLocalPath(body.sdkSessionId),
    });
  } catch (error: any) {
    console.error("[Restore Transcript Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Sync (save) a session transcript from sandbox to R2.
 * Call this on session end / disconnect to persist the transcript.
 *
 * POST /api/sessions/:sandboxSessionId/sync
 * Body: { userId: "xxx", sdkSessionId: "xxx" }
 */
app.post("/api/sessions/:sandboxSessionId/sync", async (c) => {
  try {
    const sandboxSessionId = c.req.param("sandboxSessionId");
    const body = await c.req.json<{ userId: string; sdkSessionId: string }>();

    if (!body.userId || !body.sdkSessionId) {
      return c.json({ error: "userId and sdkSessionId are required" }, 400);
    }

    // Check if running in production (R2 sync available)
    if (!isProduction(c.env)) {
      return c.json({
        status: "skipped",
        reason: "R2 sync not available in development mode",
        sandboxSessionId,
        sdkSessionId: body.sdkSessionId,
      });
    }

    const sandbox = getSandbox(c.env.Sandbox, sandboxSessionId);
    const saved = await saveTranscriptToR2(
      sandbox,
      c.env.USER_DATA,
      body.userId,
      body.sdkSessionId
    );

    return c.json({
      status: saved ? "synced" : "no_transcript",
      sandboxSessionId,
      sdkSessionId: body.sdkSessionId,
      userId: body.userId,
      r2Key: getTranscriptR2Key(body.userId, body.sdkSessionId),
    });
  } catch (error: any) {
    console.error("[Sync Transcript Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Generate title for a thread using Claude Haiku.
 *
 * POST /api/threads/:id/title
 * Generates a title based on the first message in the thread.
 */
app.post("/api/threads/:id/title", async (c) => {
  try {
    const threadId = c.req.param("id");

    // Get first user message
    const firstMessage = await c.env.DB.prepare(
      `SELECT content FROM messages
       WHERE thread_id = ? AND role = 'user'
       ORDER BY created_at ASC
       LIMIT 1`
    ).bind(threadId).first<{ content: string }>();

    if (!firstMessage) {
      return c.json({ error: "No user message found" }, 400);
    }

    // Call Haiku to generate title
    const apiKey = c.env.ANTHROPIC_API_KEY || c.env.CLAUDE_CODE_OAUTH_TOKEN;
    if (!apiKey) {
      return c.json({ error: "No API key configured" }, 500);
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 50,
        messages: [{
          role: "user",
          content: `Generate a short 3-6 word title for this conversation. Only respond with the title, no quotes or explanation.\n\nFirst message: "${firstMessage.content.substring(0, 500)}"`
        }]
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[Haiku Error]", error);
      return c.json({ error: "Failed to generate title" }, 500);
    }

    const result: any = await response.json();
    const title = result.content?.[0]?.text?.trim() || "New conversation";

    // Update thread title
    await c.env.DB.prepare(
      `UPDATE threads SET title = ?, updated_at = ? WHERE id = ?`
    ).bind(title, new Date().toISOString(), threadId).run();

    return c.json({ threadId, title });
  } catch (error: any) {
    console.error("[Generate Title Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Setup endpoint to prepare a sandbox with user's skills.
 *
 * POST /setup/:sessionId?userId=xxx
 *
 * In production: Mounts user's R2 directory as /workspace/.claude/
 * In development: Loads skills from R2 via writeFile
 */
app.post("/setup/:sessionId", async (c) => {
  try {
    const authHeader = c.req.header("Authorization");
    const expectedToken = c.env.API_KEY;

    if (expectedToken && (!authHeader || authHeader !== `Bearer ${expectedToken}`)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const sessionId = c.req.param("sessionId");
    const userId = c.req.query("userId") || sessionId;
    const sandbox = getSandbox(c.env.Sandbox, sessionId);

    // Set environment variables
    await sandbox.setEnvVars({
      ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY || c.env.CLAUDE_CODE_OAUTH_TOKEN || "",
      CLAUDE_MODEL: c.env.MODEL || "claude-sonnet-4-5-20250929",
      USER_ID: userId,
    });

    let setupMethod: string;
    let skillsLoaded: string[] = [];

    if (isProduction(c.env)) {
      // PRODUCTION: Mount R2 bucket for SKILLS only (read-heavy, not actively written)
      // NOTE: We do NOT mount /root/.claude/ for SDK transcripts because:
      //   - The SDK actively reads/writes transcript files during conversations
      //   - Mounted storage has network latency on every file operation
      //   - Better to sync transcripts to/from R2 at session start/end
      try {
        // Mount for skills at /workspace/.claude/ (read-only recommended for stability)
        await sandbox.mountBucket("claude-agent-user-data", "/workspace/.claude", {
          endpoint: `https://${c.env.ACCOUNT_ID}.r2.cloudflarestorage.com`,
          readOnly: true, // Skills are read-only during operation
        });

        setupMethod = "r2_mount";
        // Skills are automatically available at /workspace/.claude/users/{userId}/skills/
      } catch (err: any) {
        console.error("Failed to mount R2:", err);
        // Fallback to loading from R2
        setupMethod = "r2_load_fallback";
        skillsLoaded = await loadSkillsFromR2ToSandbox(sandbox, c.env.USER_DATA, userId);
      }
    } else {
      // DEVELOPMENT: Load from R2 via writeFile (R2 mounting not available in wrangler dev)
      // NOTE: SDK session persistence does NOT work in dev mode because:
      //   1. R2 mounting requires FUSE support not available in wrangler dev
      //   2. The SDK stores transcripts in /root/.claude/projects/ which is ephemeral
      // Session resume will only work in production with R2 mounted.
      setupMethod = "r2_load_dev";
      skillsLoaded = await loadSkillsFromR2ToSandbox(sandbox, c.env.USER_DATA, userId);
    }

    return c.json({
      status: "ready",
      sessionId,
      userId,
      setupMethod,
      skillsLoaded: skillsLoaded.length > 0 ? skillsLoaded : undefined,
      message: "Sandbox prepared. Connect via WebSocket to /ws?sessionId=" + sessionId
    });

  } catch (error: any) {
    console.error("[Setup Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * WebSocket endpoint for connecting to the Claude Agent SDK.
 *
 * GET /ws?sessionId=xxx&userId=xxx
 *
 * Call POST /setup/:sessionId first to load skills.
 */
app.get("/ws", async (c) => {
  const upgradeHeader = c.req.header("Upgrade");
  if (!upgradeHeader || upgradeHeader !== "websocket") {
    return c.text("Expected Upgrade: websocket", 426);
  }

  const sessionId = c.req.query("sessionId") || "default";
  const sandbox = getSandbox(c.env.Sandbox, sessionId);

  // Ensure environment variables are set (idempotent)
  await sandbox.setEnvVars({
    ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY || c.env.CLAUDE_CODE_OAUTH_TOKEN || "",
    CLAUDE_MODEL: c.env.MODEL || "claude-sonnet-4-5-20250929",
  });

  // Proxy WebSocket to the agent server running on port 3001
  return sandbox.wsConnect(c.req.raw, 3001);
});

/**
 * Socket.IO proxy endpoint - handles both HTTP polling and WebSocket
 *
 * GET/POST /socket.io/*
 */
app.all("/socket.io/*", async (c) => {
  const sessionId = c.req.query("sessionId") || "default";
  const sandbox = getSandbox(c.env.Sandbox, sessionId);

  // Ensure environment variables are set (idempotent)
  await sandbox.setEnvVars({
    ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY || c.env.CLAUDE_CODE_OAUTH_TOKEN || "",
    CLAUDE_MODEL: c.env.MODEL || "claude-sonnet-4-5-20250929",
  });

  // NOTE: We do NOT mount R2 at /root/.claude/ because:
  // 1. The SDK actively reads/writes transcript files during conversations
  // 2. Mounted storage has network latency on every file operation
  // 3. Cloudflare docs recommend: "Copy frequently accessed files locally"
  // Instead, we sync transcripts to/from R2 at session start/end (see syncTranscriptFromR2/syncTranscriptToR2)

  // Check if this is a WebSocket upgrade request
  const upgradeHeader = c.req.header("Upgrade");
  if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
    // Proxy WebSocket to the agent server running on port 3001
    return sandbox.wsConnect(c.req.raw, 3001);
  }

  // For HTTP polling, proxy the request to port 3001
  const url = new URL(c.req.url);
  const targetUrl = `http://localhost:3001${url.pathname}${url.search}`;

  try {
    // Build request with proper options
    const fetchRequest = new Request(targetUrl, {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: c.req.method !== "GET" && c.req.method !== "HEAD" ? await c.req.arrayBuffer() : undefined,
    });
    const response = await sandbox.fetch(fetchRequest);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error: any) {
    return c.json({ error: "Failed to proxy to sandbox", details: error.message }, 500);
  }
});

/**
 * Upload a skill to R2 for a user.
 *
 * POST /users/:userId/skills
 * Body: { name: "skill-name.md", content: "..." }
 */
app.post("/users/:userId/skills", async (c) => {
  try {
    const authHeader = c.req.header("Authorization");
    const expectedToken = c.env.API_KEY;

    if (expectedToken && (!authHeader || authHeader !== `Bearer ${expectedToken}`)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const userId = c.req.param("userId");
    const body = await c.req.json<Skill>().catch(() => ({ name: "", content: "" }));

    if (!body.name || !body.content) {
      return c.json({ error: "Skill name and content are required" }, 400);
    }

    // Store in R2
    const key = getUserSkillKey(userId, body.name);
    await c.env.USER_DATA.put(key, body.content, {
      httpMetadata: {
        contentType: "text/markdown",
      },
      customMetadata: {
        userId,
        uploadedAt: new Date().toISOString(),
      },
    });

    return c.json({
      status: "success",
      userId,
      skillName: body.name,
      key,
      message: "Skill saved to R2. Call /setup/:sessionId to load into sandbox.",
    });

  } catch (error: any) {
    console.error("[Upload Skill Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * List all skills for a user.
 *
 * GET /users/:userId/skills
 */
app.get("/users/:userId/skills", async (c) => {
  try {
    const authHeader = c.req.header("Authorization");
    const expectedToken = c.env.API_KEY;

    if (expectedToken && (!authHeader || authHeader !== `Bearer ${expectedToken}`)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const userId = c.req.param("userId");
    const skillNames = await listUserSkillsFromR2(c.env.USER_DATA, userId);

    return c.json({
      userId,
      skills: skillNames,
      count: skillNames.length,
    });

  } catch (error: any) {
    console.error("[List Skills Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Get a specific skill for a user.
 *
 * GET /users/:userId/skills/:skillName
 */
app.get("/users/:userId/skills/:skillName", async (c) => {
  try {
    const authHeader = c.req.header("Authorization");
    const expectedToken = c.env.API_KEY;

    if (expectedToken && (!authHeader || authHeader !== `Bearer ${expectedToken}`)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const userId = c.req.param("userId");
    const skillName = c.req.param("skillName");
    const key = getUserSkillKey(userId, skillName);

    const obj = await c.env.USER_DATA.get(key);
    if (!obj) {
      return c.json({ error: "Skill not found" }, 404);
    }

    const content = await obj.text();
    const metadata = obj.customMetadata;

    return c.json({
      userId,
      skillName,
      content,
      metadata,
      uploaded: obj.uploaded,
      size: obj.size,
    });

  } catch (error: any) {
    console.error("[Get Skill Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Delete a skill for a user.
 *
 * DELETE /users/:userId/skills/:skillName
 */
app.delete("/users/:userId/skills/:skillName", async (c) => {
  try {
    const authHeader = c.req.header("Authorization");
    const expectedToken = c.env.API_KEY;

    if (expectedToken && (!authHeader || authHeader !== `Bearer ${expectedToken}`)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const userId = c.req.param("userId");
    const skillName = c.req.param("skillName");
    const key = getUserSkillKey(userId, skillName);

    await c.env.USER_DATA.delete(key);

    return c.json({
      status: "deleted",
      userId,
      skillName,
      key,
    });

  } catch (error: any) {
    console.error("[Delete Skill Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Save conversation to R2.
 *
 * POST /users/:userId/conversations
 * Body: { conversationId: "xxx", messages: [...], metadata: {...} }
 */
app.post("/users/:userId/conversations", async (c) => {
  try {
    const authHeader = c.req.header("Authorization");
    const expectedToken = c.env.API_KEY;

    if (expectedToken && (!authHeader || authHeader !== `Bearer ${expectedToken}`)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const userId = c.req.param("userId");
    const body = await c.req.json<any>();

    if (!body.conversationId) {
      return c.json({ error: "conversationId is required" }, 400);
    }

    const key = `users/${userId}/conversations/${body.conversationId}.json`;
    await c.env.USER_DATA.put(key, JSON.stringify(body), {
      httpMetadata: {
        contentType: "application/json",
      },
      customMetadata: {
        userId,
        conversationId: body.conversationId,
        savedAt: new Date().toISOString(),
      },
    });

    return c.json({
      status: "saved",
      userId,
      conversationId: body.conversationId,
      key,
    });

  } catch (error: any) {
    console.error("[Save Conversation Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Get conversation from R2.
 *
 * GET /users/:userId/conversations/:conversationId
 */
app.get("/users/:userId/conversations/:conversationId", async (c) => {
  try {
    const authHeader = c.req.header("Authorization");
    const expectedToken = c.env.API_KEY;

    if (expectedToken && (!authHeader || authHeader !== `Bearer ${expectedToken}`)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const userId = c.req.param("userId");
    const conversationId = c.req.param("conversationId");
    const key = `users/${userId}/conversations/${conversationId}.json`;

    const obj = await c.env.USER_DATA.get(key);
    if (!obj) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    const conversation = await obj.json();

    return c.json({
      userId,
      conversationId,
      conversation,
      metadata: obj.customMetadata,
      uploaded: obj.uploaded,
    });

  } catch (error: any) {
    console.error("[Get Conversation Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Destroy a sandbox and clean up resources.
 *
 * DELETE /sandbox/:sessionId
 */
app.delete("/sandbox/:sessionId", async (c) => {
  try {
    const authHeader = c.req.header("Authorization");
    const expectedToken = c.env.API_KEY;

    if (expectedToken && (!authHeader || authHeader !== `Bearer ${expectedToken}`)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const sessionId = c.req.param("sessionId");
    const sandbox = getSandbox(c.env.Sandbox, sessionId);

    await sandbox.destroy();

    return c.json({
      status: "destroyed",
      sessionId,
    });

  } catch (error: any) {
    console.error("[Destroy Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

export default app;
