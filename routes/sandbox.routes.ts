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
import { isProduction, normalizeUserId } from "../lib/utils";
import { DEFAULT_MODEL, R2_BUCKET_NAME } from "../lib/constants";
import { loadSkillsFromR2ToSandbox } from "../services/skills.service";
import { startAgentProcess, isAgentRunning } from "../services/sandbox.service";
import { restoreWorkspaceFromR2, getProjectLocalPath } from "../services/workspace.service";
import { startLogForwarding, stopLogForwarding } from "../services/log-forwarder.service";
import { sandboxAgentState, setAgentState } from "../state/agent-state";
import { requireApiKey } from "./middleware/auth.middleware";
import { requireAuth, getAuthUserId } from "./middleware/clerk.middleware";

const sandboxRoutes = new Hono<{ Bindings: Bindings; Variables: { authenticatedUserId: string } }>();

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
    const sessionId = normalizeUserId(c.req.param("sessionId"));
    const userId = normalizeUserId(c.req.query("userId") || sessionId);
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

  const sessionId = normalizeUserId(c.req.query("sessionId") || "default");
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
  const sessionId = normalizeUserId(c.req.query("sessionId") || "default");
  const userId = sessionId; // sessionId is the userId in our architecture
  const sandbox = getSandbox(c.env.Sandbox, sessionId);

  // Step 1: Check in-memory state FIRST (instant, no network call)
  // This avoids waking up a hibernated sandbox just to check health
  const agentState = sandboxAgentState.get(sessionId);
  const likelyRunning = agentState?.started && agentState.startedAt &&
    (Date.now() - agentState.startedAt) < 5 * 60 * 1000; // Within 5 minutes

  // Check if agent is currently starting (prevents duplicate startup attempts)
  const isStarting = agentState?.starting && agentState.startedAt &&
    (Date.now() - agentState.startedAt) < 30 * 1000; // Starting should complete within 30s

  if (likelyRunning) {
    // Fast path: state says agent should be running, try proxy immediately
    // If agent crashed, the proxy will fail and user will reconnect
    console.log(`[Socket.IO] Agent likely running for session ${sessionId} - proxying immediately (state age: ${Date.now() - agentState!.startedAt!}ms)`);
  } else if (isStarting) {
    // Agent is in the process of starting - wait briefly then proxy
    // This prevents EADDRINUSE errors from multiple startup attempts
    console.log(`[Socket.IO] Agent is starting for session ${sessionId} - waiting... (started ${Date.now() - agentState!.startedAt!}ms ago)`);
    // Give the startup a moment to complete, then let proxy attempt connect
    await new Promise(resolve => setTimeout(resolve, 2000));
  } else {
    // Need to check health or initialize
    const agentHealthy = await isAgentRunning(sandbox);

    if (agentHealthy) {
      // Agent is running - update state and proxy
      console.log(`[Socket.IO] Agent healthy for session ${sessionId} - proxying`);
      setAgentState(sessionId, { started: true, startedAt: Date.now(), processId: "agent-sdk" });

      // Start log forwarding to see container logs in wrangler output
      startLogForwarding(sandbox, sessionId);
    } else {
      // Agent not running - need to initialize
      // Mark as "starting" to prevent concurrent startup attempts
      setAgentState(sessionId, { started: false, starting: true, startedAt: Date.now() });
      console.log(`[Socket.IO] Agent not running for session ${sessionId} - initializing...`);

      try {
        // Set environment variables (must happen before agent starts)
        await sandbox.setEnvVars({
          ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY || c.env.CLAUDE_CODE_OAUTH_TOKEN || "",
          CLAUDE_MODEL: c.env.MODEL || DEFAULT_MODEL,
          USER_ID: userId,
        });

        // Load skills from R2 to filesystem BEFORE starting agent
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

        // Now start the agent (skills are already on filesystem)
        console.log(`[Socket.IO] Starting agent for session ${sessionId}...`);
        const started = await startAgentProcess(sandbox, sessionId);

        if (started) {
          console.log(`[Socket.IO] Agent started successfully for session ${sessionId}`);
          // startAgentProcess already sets the state with started: true

          // Start log forwarding to see container logs in wrangler output
          startLogForwarding(sandbox, sessionId);
        } else {
          console.error(`[Socket.IO] Failed to start agent for session ${sessionId}`);
          // Clear the starting state so next attempt can try again
          setAgentState(sessionId, { started: false, starting: false, startedAt: Date.now() });
          // Don't return error - let it fall through and try to proxy anyway
          // The proxy will fail with a more descriptive error
        }
      } catch (error) {
        console.error(`[Socket.IO] Error initializing session ${sessionId}:`, error);
        // Clear the starting state on error
        setAgentState(sessionId, { started: false, starting: false, startedAt: Date.now() });
        // Continue to proxy - it will fail with connection error if agent isn't up
      }
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
 * Serves a file from the sandbox filesystem.
 *
 * Used to display images and other artifacts created by the agent.
 * The file path is provided as a query parameter.
 * Requires authentication - only the sandbox owner can access files.
 *
 * @route GET /sandbox/:sessionId/file
 * @query path - The absolute path to the file in the sandbox
 */
sandboxRoutes.get("/sandbox/:sessionId/file", requireAuth, async (c) => {
  try {
    const userId = getAuthUserId(c);
    const sessionId = normalizeUserId(c.req.param("sessionId"));

    // Verify session ownership
    if (sessionId !== userId) {
      return c.json({ error: "Unauthorized: cannot access other user's sandbox" }, 403);
    }

    const filePath = c.req.query("path");

    if (!filePath) {
      return c.json({ error: "Missing 'path' query parameter" }, 400);
    }

    // Security: Only allow files from /workspace, /home, or /tmp
    // /home is included because Claude sometimes creates files there
    if (!filePath.startsWith("/workspace") && !filePath.startsWith("/home") && !filePath.startsWith("/tmp")) {
      return c.json({ error: "Access denied: Only /workspace, /home, and /tmp paths allowed" }, 403);
    }

    const sandbox = getSandbox(c.env.Sandbox, sessionId);

    // Determine content type based on file extension
    const ext = filePath.split(".").pop()?.toLowerCase() || "";
    const contentTypeMap: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
      pdf: "application/pdf",
      json: "application/json",
      txt: "text/plain",
      html: "text/html",
      css: "text/css",
      js: "application/javascript",
    };

    const contentType = contentTypeMap[ext] || "application/octet-stream";
    const isBinary = contentType.startsWith("image/") ||
                     contentType === "application/pdf" ||
                     contentType === "application/octet-stream";

    // Read file from sandbox
    // For binary files, use base64 encoding to get the data safely
    const file = await sandbox.readFile(filePath, isBinary ? { encoding: "base64" } : undefined);

    if (isBinary) {
      try {
        // The sandbox returns base64-encoded data for binary files
        // Clean any whitespace that might have been added
        const cleanBase64 = file.content.replace(/\s/g, '');

        // Convert base64 to binary using Uint8Array
        // This is more robust than atob() for large files
        const binaryString = atob(cleanBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        return new Response(bytes, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=3600",
          },
        });
      } catch (decodeError: any) {
        console.error("[File Serve] Base64 decode error:", decodeError.message);
        console.error("[File Serve] Content length:", file.content.length);
        console.error("[File Serve] First 100 chars:", file.content.substring(0, 100));

        // If base64 decoding fails, the data might already be raw binary
        // This shouldn't happen but let's handle it gracefully
        return c.json({
          error: "Failed to decode file",
          details: decodeError.message
        }, 500);
      }
    }

    // Return text content directly
    return new Response(file.content, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error: any) {
    console.error("[File Serve Error]", error);
    if (error.message?.includes("ENOENT") || error.message?.includes("not found")) {
      return c.json({ error: "File not found" }, 404);
    }
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Lists the contents of a directory in the sandbox filesystem.
 *
 * Returns immediate children of the specified directory with type and size info.
 * Used by the file explorer UI for lazy-loading directory trees.
 * Requires authentication - only the sandbox owner can list directories.
 *
 * NOTE: This uses sandbox.exec() from the Cloudflare Sandbox SDK which runs
 * commands inside an isolated container - NOT Node.js child_process. This is
 * safe because commands run in a sandboxed environment with no host access.
 *
 * @route GET /sandbox/:sessionId/dir
 * @query path - The absolute path to list (default: /workspace)
 */
sandboxRoutes.get("/sandbox/:sessionId/dir", requireAuth, async (c) => {
  try {
    const userId = getAuthUserId(c);
    const sessionId = normalizeUserId(c.req.param("sessionId"));

    // Verify session ownership
    if (sessionId !== userId) {
      return c.json({ error: "Unauthorized: cannot access other user's sandbox" }, 403);
    }

    const dirPath = c.req.query("path") || "/workspace";

    // Security: Only allow /workspace, /home, and /tmp prefixes
    // Also block directory traversal attempts
    // /home is included because Claude sometimes creates files there
    if ((!dirPath.startsWith("/workspace") && !dirPath.startsWith("/home") && !dirPath.startsWith("/tmp")) ||
        dirPath.includes("..")) {
      return c.json({ error: "Access denied: Only /workspace, /home, and /tmp paths allowed" }, 403);
    }

    const sandbox = getSandbox(c.env.Sandbox, sessionId);

    // List directory using ls -la (simpler and faster than find)
    // NOTE: This uses Cloudflare Sandbox SDK's sandbox.exec() which runs in an
    // isolated container - NOT child_process.exec() on the host. The dirPath is
    // validated above (lines 371-373) to only allow /workspace or /tmp prefixes.
    // Using ls instead of find to reduce container resource usage and avoid
    // potential interference with the agent-sdk process running in the same container.
    const lsCmd = `ls -la "${dirPath}" 2>/dev/null | tail -n +2`;
    const result = await sandbox.exec(lsCmd, { timeout: 2000 });

    // Parse ls -la output into structured entries
    interface DirEntry {
      name: string;
      type: "file" | "directory" | "symlink";
      size: number;
      path: string;
    }

    const entries: DirEntry[] = (result.stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line: string) => {
        // ls -la format: permissions links owner group size month day time name
        // Example: drwxr-xr-x 2 root root 4096 Dec  3 01:00 dirname
        // Example: -rw-r--r-- 1 root root 1234 Dec  3 01:00 file.txt
        // Example: lrwxrwxrwx 1 root root   10 Dec  3 01:00 link -> target
        const parts = line.split(/\s+/);
        if (parts.length < 9) return null;

        const permissions = parts[0];
        const size = parseInt(parts[4], 10);
        // Name is everything after the 8th field (handles names with spaces)
        const nameStartIndex = line.indexOf(parts[8],
          line.indexOf(parts[7]) + parts[7].length);
        let name = line.substring(nameStartIndex).trim();

        // Skip . and .. entries
        if (name === "." || name === "..") return null;

        // Handle symlinks: "name -> target" - extract just the name
        if (permissions.startsWith("l") && name.includes(" -> ")) {
          name = name.split(" -> ")[0];
        }

        if (!name) return null;

        // Determine type from first character of permissions
        let type: "file" | "directory" | "symlink" = "file";
        if (permissions.startsWith("d")) type = "directory";
        else if (permissions.startsWith("l")) type = "symlink";

        return {
          name,
          type,
          size: isNaN(size) ? 0 : size,
          path: `${dirPath}/${name}`.replace(/\/+/g, "/"),
        };
      })
      .filter((entry): entry is DirEntry => entry !== null)
      // Sort: directories first, then alphabetically
      .sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === "directory" ? -1 : b.type === "directory" ? 1 : 0;
        }
        return a.name.localeCompare(b.name);
      });

    return c.json({
      path: dirPath,
      entries,
      count: entries.length,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    console.error("[Dir List Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Serves an image from R2 storage.
 *
 * This route serves persisted images that were uploaded to R2 when
 * the agent created them. Images are stored under:
 * users/{userId}/artifacts/{threadId}/{timestamp}-{filename}
 *
 * @route GET /images/:userId/:threadId/:filename
 */
sandboxRoutes.get("/images/:userId/:threadId/:filename", async (c) => {
  try {
    const userId = c.req.param("userId");
    const threadId = c.req.param("threadId");
    const filename = c.req.param("filename");

    // Construct R2 key
    const r2Key = `users/${userId}/artifacts/${threadId}/${filename}`;
    console.log(`[Image Serve] Fetching from R2: ${r2Key}`);

    // Fetch from R2
    const object = await c.env.USER_DATA.get(r2Key);

    if (!object) {
      console.log(`[Image Serve] Not found in R2: ${r2Key}`);
      return c.json({ error: "Image not found" }, 404);
    }

    // Determine content type from filename
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const contentTypeMap: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
    };

    const contentType = contentTypeMap[ext] || "application/octet-stream";

    // Return the image
    return new Response(object.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000", // 1 year cache for immutable artifacts
        "ETag": object.etag,
      },
    });
  } catch (error: any) {
    console.error("[Image Serve Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Fetches logs from the agent process running in the sandbox.
 *
 * This endpoint retrieves stdout/stderr logs from the Claude Agent SDK
 * process, allowing visibility into what's happening inside the container.
 * Requires authentication - only the sandbox owner can view logs.
 *
 * @route GET /sandbox/:sessionId/logs
 */
sandboxRoutes.get("/sandbox/:sessionId/logs", requireAuth, async (c) => {
  try {
    const userId = getAuthUserId(c);
    const sessionId = normalizeUserId(c.req.param("sessionId"));

    // Verify session ownership
    if (sessionId !== userId) {
      return c.json({ error: "Unauthorized: cannot access other user's sandbox" }, 403);
    }

    const sandbox = getSandbox(c.env.Sandbox, sessionId);

    // Get process logs from the agent
    const logs = await sandbox.getProcessLogs("agent-sdk");

    return c.json({
      status: "ok",
      sessionId,
      logs: typeof logs === 'string' ? logs : JSON.stringify(logs, null, 2),
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[Container Logs Error]", error);
    return c.json({
      status: "error",
      error: error.message,
      logs: null,
    }, 500);
  }
});

/**
 * Executes a command in the sandbox and returns the output.
 *
 * This is useful for debugging - you can run commands like `ps aux`
 * or `cat /tmp/some-file` to inspect sandbox state.
 *
 * NOTE: sandbox.exec() is the Cloudflare Sandbox SDK API that runs commands
 * inside an isolated container - NOT Node.js child_process.exec(). This is
 * safe because commands run in a sandboxed environment with no access to
 * the host system.
 *
 * @route POST /sandbox/:sessionId/exec
 */
sandboxRoutes.post("/sandbox/:sessionId/exec", requireApiKey, async (c) => {
  try {
    const sessionId = normalizeUserId(c.req.param("sessionId"));
    const body = await c.req.json<{ command: string; timeout?: number }>();

    if (!body.command) {
      return c.json({ error: "command is required" }, 400);
    }

    const sandbox = getSandbox(c.env.Sandbox, sessionId);
    // sandbox.exec is Cloudflare Sandbox SDK API (runs in isolated container, not host)
    const result = await sandbox.exec(body.command, {
      timeout: body.timeout || 5000,
    });

    return c.json({
      status: "ok",
      sessionId,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    });
  } catch (error: any) {
    console.error("[Sandbox Exec Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Destroys a sandbox and cleans up resources (protected endpoint).
 *
 * @route DELETE /sandbox/:sessionId
 */
sandboxRoutes.delete("/sandbox/:sessionId", requireApiKey, async (c) => {
  try {
    const sessionId = normalizeUserId(c.req.param("sessionId"));
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
