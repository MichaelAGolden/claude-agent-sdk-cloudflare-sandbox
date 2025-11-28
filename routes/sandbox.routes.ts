/**
 * @fileoverview Sandbox setup and WebSocket proxy endpoints.
 *
 * These endpoints handle sandbox initialization and real-time communication
 * with the Claude Agent SDK running inside sandboxes.
 *
 * @module routes/sandbox
 */

import { Hono } from "hono";
import { getSandbox } from "@cloudflare/sandbox";
import type { Bindings } from "../lib/types";
import { isProduction } from "../lib/utils";
import { DEFAULT_MODEL, R2_BUCKET_NAME } from "../lib/constants";
import { loadSkillsFromR2ToSandbox } from "../services/skills.service";
import { startAgentProcess, isAgentRunning } from "../services/sandbox.service";
import { sandboxAgentState, setAgentState } from "../state/agent-state";
import { requireApiKey } from "./middleware/auth.middleware";

const sandboxRoutes = new Hono<{ Bindings: Bindings }>();

/**
 * Prepares a sandbox with user skills and environment.
 *
 * Initializes a sandbox by setting environment variables and loading
 * skills. In production, skills are mounted from R2; in development,
 * they're copied via writeFile.
 *
 * @route POST /setup/:sessionId
 */
sandboxRoutes.post("/setup/:sessionId", requireApiKey, async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const userId = c.req.query("userId") || sessionId;
    const sandbox = getSandbox(c.env.Sandbox, sessionId);

    // Set environment variables
    await sandbox.setEnvVars({
      ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY || c.env.CLAUDE_CODE_OAUTH_TOKEN || "",
      CLAUDE_MODEL: c.env.MODEL || DEFAULT_MODEL,
      USER_ID: userId,
    });

    let setupMethod: string;
    let skillsLoaded: string[] = [];

    if (isProduction(c.env)) {
      // PRODUCTION: Mount R2 bucket for SKILLS only (read-heavy, not actively written)
      try {
        await sandbox.mountBucket(R2_BUCKET_NAME, "/workspace/.claude", {
          endpoint: `https://${c.env.ACCOUNT_ID}.r2.cloudflarestorage.com`,
          readOnly: true,
        });
        setupMethod = "r2_mount";
      } catch (err: any) {
        console.error("Failed to mount R2:", err);
        // Fallback to loading from R2
        setupMethod = "r2_load_fallback";
        skillsLoaded = await loadSkillsFromR2ToSandbox(sandbox, c.env.USER_DATA, userId);
      }
    } else {
      // DEVELOPMENT: Load from R2 via writeFile
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
 * Direct WebSocket connection to Claude Agent SDK.
 *
 * Establishes a WebSocket connection that is proxied directly to the
 * agent process running on port 3001 inside the sandbox.
 *
 * @route GET /ws
 */
sandboxRoutes.get("/ws", async (c) => {
  const upgradeHeader = c.req.header("Upgrade");
  if (!upgradeHeader || upgradeHeader !== "websocket") {
    return c.text("Expected Upgrade: websocket", 426);
  }

  const sessionId = c.req.query("sessionId") || "default";
  const sandbox = getSandbox(c.env.Sandbox, sessionId);

  // Ensure environment variables are set (idempotent)
  await sandbox.setEnvVars({
    ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY || c.env.CLAUDE_CODE_OAUTH_TOKEN || "",
    CLAUDE_MODEL: c.env.MODEL || DEFAULT_MODEL,
  });

  // Proxy WebSocket to the agent server running on port 3001
  return sandbox.wsConnect(c.req.raw, 3001);
});

/**
 * Socket.IO proxy endpoint for real-time chat communication.
 *
 * Proxies all Socket.IO traffic (both HTTP polling and WebSocket upgrades)
 * to the Claude Agent SDK running inside the sandbox.
 *
 * ## On-Demand Agent Architecture (v2)
 *
 * The agent is NOT auto-started by the container. Instead:
 * 1. Container boots with control plane only (no agent)
 * 2. User connects via Socket.IO
 * 3. This handler loads skills FIRST, then starts the agent
 * 4. Agent discovers skills (they exist before agent starts)
 *
 * This ensures skills are always available to the agent.
 *
 * @route ALL /socket.io/*
 */
sandboxRoutes.all("/socket.io/*", async (c) => {
  const sessionId = c.req.query("sessionId") || "default";
  const userId = sessionId; // sessionId is the userId in our architecture
  const sandbox = getSandbox(c.env.Sandbox, sessionId);

  // Step 1: Set environment variables (must happen before agent starts)
  await sandbox.setEnvVars({
    ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY || c.env.CLAUDE_CODE_OAUTH_TOKEN || "",
    CLAUDE_MODEL: c.env.MODEL || DEFAULT_MODEL,
    USER_ID: userId,
  });

  // Step 2: Check if agent is already running
  const agentState = sandboxAgentState.get(sessionId);
  const agentHealthy = await isAgentRunning(sandbox);

  // Step 3: If agent not running, load skills and start it
  if (!agentHealthy || !agentState?.started) {
    try {
      console.log(`[Socket.IO] Agent not running for session ${sessionId} - initializing...`);

      // 3a. Load skills from R2 to filesystem BEFORE starting agent
      if (c.env.USER_DATA) {
        console.log(`[Socket.IO] Loading skills from R2 for user ${userId}...`);

        // Create the skills directory structure
        await sandbox.mkdir("/workspace/.claude/skills", { recursive: true });

        // Load all skills from R2
        const skillsLoaded = await loadSkillsFromR2ToSandbox(sandbox, c.env.USER_DATA, userId);
        console.log(`[Socket.IO] Loaded ${skillsLoaded.length} skills to filesystem`);

        if (skillsLoaded.length > 0) {
          console.log(`[Socket.IO] Skills ready:`, skillsLoaded);
        } else {
          console.log(`[Socket.IO] No skills found for user ${userId}`);
        }
      }

      // 3b. Now start the agent (skills are already on filesystem)
      console.log(`[Socket.IO] Starting agent for session ${sessionId}...`);
      const started = await startAgentProcess(sandbox, sessionId);

      if (started) {
        console.log(`[Socket.IO] Agent started successfully for session ${sessionId}`);
      } else {
        console.error(`[Socket.IO] Failed to start agent for session ${sessionId}`);
        // Don't return error - let it fall through and try to proxy anyway
        // The proxy will fail with a more descriptive error
      }
    } catch (error) {
      console.error(`[Socket.IO] Error initializing session ${sessionId}:`, error);
      // Continue to proxy - it will fail with connection error if agent isn't up
    }
  }

  // Step 4: Proxy to the agent
  const upgradeHeader = c.req.header("Upgrade");
  if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
    return sandbox.wsConnect(c.req.raw, 3001);
  }

  // For HTTP polling, proxy the request to port 3001
  const url = new URL(c.req.url);
  const targetUrl = `http://localhost:3001${url.pathname}${url.search}`;

  try {
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
 * Destroys a sandbox and cleans up resources (protected endpoint).
 *
 * @route DELETE /sandbox/:sessionId
 */
sandboxRoutes.delete("/sandbox/:sessionId", requireApiKey, async (c) => {
  try {
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

export { sandboxRoutes };
