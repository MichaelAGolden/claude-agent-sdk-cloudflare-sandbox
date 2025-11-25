import { Hono } from "hono";
import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
export { Sandbox } from "@cloudflare/sandbox";

type Bindings = {
  Sandbox: DurableObjectNamespace<Sandbox>;
  USER_DATA: R2Bucket;
  ANTHROPIC_API_KEY?: string;
  CLAUDE_CODE_OAUTH_TOKEN?: string;
  MODEL?: string;
  API_KEY: string;
  ENVIRONMENT?: string; // "development" | "production"
};

type Skill = {
  name: string;
  content: string;
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

app.get("/health", (c) => {
  return c.json({
    status: "healthy",
    environment: c.env.ENVIRONMENT || "development",
    hasApiKey: !!(c.env?.ANTHROPIC_API_KEY || c.env?.CLAUDE_CODE_OAUTH_TOKEN),
    hasSandbox: !!c.env?.Sandbox,
    hasR2: !!c.env?.USER_DATA,
    timestamp: new Date().toISOString(),
  });
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
      // PRODUCTION: Mount R2 bucket as filesystem
      // This makes all user data available as real files
      try {
        await sandbox.mountBucket("claude-agent-user-data", "/workspace/.claude", {
          endpoint: `https://${c.env.ACCOUNT_ID}.r2.cloudflarestorage.com`,
          // Credentials automatically detected from environment or can be provided
          // credentials: {
          //   accessKeyId: c.env.R2_ACCESS_KEY_ID,
          //   secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
          // },
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
    const response = await sandbox.fetch(targetUrl, {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: c.req.method !== "GET" && c.req.method !== "HEAD" ? await c.req.arrayBuffer() : undefined,
    });

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
