/**
 * @fileoverview Agent lifecycle API endpoints.
 *
 * Authenticated API for controlling the Claude Agent SDK lifecycle.
 * These endpoints allow the frontend to start, stop, and restart
 * the agent without refreshing the page or restarting the container.
 *
 * All endpoints require Clerk JWT authentication. The userId is extracted
 * from the verified token to ensure users can only control their own agents.
 *
 * @module routes/agent
 */

import { Hono } from "hono";
import { getSandbox } from "@cloudflare/sandbox";
import type { Bindings } from "../lib/types";
import {
  startAgentProcess,
  stopAgentProcess,
  restartAgentWithSkills,
  isAgentRunning,
} from "../services/sandbox.service";
import { sandboxAgentState, clearAgentState } from "../state/agent-state";
import { requireAuth, getAuthUserId } from "./middleware";

const agentRoutes = new Hono<{ Bindings: Bindings; Variables: { authenticatedUserId: string } }>();

// Apply auth middleware to all routes
agentRoutes.use("/*", requireAuth);

/**
 * Gets the current agent status for the authenticated user.
 *
 * @route GET /status
 */
agentRoutes.get("/status", async (c) => {
  try {
    const userId = getAuthUserId(c);

    const sandbox = getSandbox(c.env.Sandbox, userId);
    const running = await isAgentRunning(sandbox);
    const state = sandboxAgentState.get(userId);

    return c.json({
      userId,
      running,
      startedAt: state?.startedAt || null,
      processId: state?.processId || null,
    });
  } catch (error: any) {
    console.error("[Agent Status Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Starts the agent for the authenticated user.
 *
 * This endpoint starts the Claude Agent SDK if it's not already running.
 * Skills should be loaded before calling this endpoint.
 *
 * @route POST /start
 */
agentRoutes.post("/start", async (c) => {
  try {
    const userId = getAuthUserId(c);

    const sandbox = getSandbox(c.env.Sandbox, userId);

    // Set environment variables first
    await sandbox.setEnvVars({
      ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY || c.env.CLAUDE_CODE_OAUTH_TOKEN || "",
      CLAUDE_MODEL: c.env.MODEL || "claude-sonnet-4-5-20250929",
      USER_ID: userId,
    });

    const started = await startAgentProcess(sandbox, userId);

    if (started) {
      return c.json({
        status: "started",
        message: "Agent started successfully",
        userId,
      });
    } else {
      return c.json({
        status: "error",
        message: "Failed to start agent",
        userId,
      }, 500);
    }
  } catch (error: any) {
    console.error("[Agent Start Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Stops the agent for the authenticated user.
 *
 * @route POST /stop
 */
agentRoutes.post("/stop", async (c) => {
  try {
    const userId = getAuthUserId(c);

    const sandbox = getSandbox(c.env.Sandbox, userId);
    const stopped = await stopAgentProcess(sandbox, userId);

    if (stopped) {
      return c.json({
        status: "stopped",
        message: "Agent stopped successfully",
        userId,
      });
    } else {
      return c.json({
        status: "error",
        message: "Failed to stop agent",
        userId,
      }, 500);
    }
  } catch (error: any) {
    console.error("[Agent Stop Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Restarts the agent with fresh skills from R2 for the authenticated user.
 *
 * This is the primary endpoint for reloading skills. It:
 * 1. Stops the currently running agent (if any)
 * 2. Loads all skills from R2 to the sandbox filesystem
 * 3. Starts a fresh agent process
 *
 * The frontend can call this after adding/removing skills to ensure
 * the agent picks up the changes without a page refresh.
 *
 * @route POST /restart
 */
agentRoutes.post("/restart", async (c) => {
  try {
    const userId = getAuthUserId(c);

    console.log(`[Agent] Restart requested for user ${userId}`);

    const sandbox = getSandbox(c.env.Sandbox, userId);

    // Set environment variables
    await sandbox.setEnvVars({
      ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY || c.env.CLAUDE_CODE_OAUTH_TOKEN || "",
      CLAUDE_MODEL: c.env.MODEL || "claude-sonnet-4-5-20250929",
      USER_ID: userId,
    });

    // Perform the restart with skills reload
    const result = await restartAgentWithSkills(sandbox, c.env.USER_DATA, userId);

    if (result.success) {
      return c.json({
        status: "restarted",
        message: "Agent restarted successfully with fresh skills",
        userId,
        skillsLoaded: result.skillsLoaded,
        skillCount: result.skillsLoaded.length,
      });
    } else {
      // Clear state so next connection will try fresh
      clearAgentState(userId);
      return c.json({
        status: "error",
        message: "Failed to restart agent",
        userId,
        skillsLoaded: result.skillsLoaded,
      }, 500);
    }
  } catch (error: any) {
    console.error("[Agent Restart Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

export { agentRoutes };
