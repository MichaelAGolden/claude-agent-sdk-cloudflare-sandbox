/**
 * @fileoverview Sandbox and agent process lifecycle management service.
 *
 * This service handles the lifecycle of Claude Agent SDK processes running
 * within Cloudflare Sandbox environments, including starting, stopping,
 * health checking, and restarting with skill updates.
 *
 * @module services/sandbox
 */

import type { Sandbox } from "@cloudflare/sandbox";
import { getSandbox } from "@cloudflare/sandbox";
import {
  AGENT_PROCESS_ID,
  AGENT_STARTUP_TIMEOUT_MS,
  AGENT_HEALTH_POLL_INTERVAL_MS,
  AGENT_STOP_WAIT_MS,
  AGENT_KILL_WAIT_MS,
} from "../lib/constants";
import { sandboxAgentState, clearAgentState, setAgentState } from "../state/agent-state";
import { loadSkillsFromR2ToSandbox } from "./skills.service";

/**
 * Checks if the Claude Agent SDK process is running and healthy.
 *
 * Performs a health check by sending a GET request to the agent's
 * internal health endpoint. The agent exposes this endpoint on
 * port 3001 within the sandbox.
 *
 * @param sandbox - The sandbox instance to check
 * @returns True if the agent responds with 200 OK
 *
 * @example
 * if (await isAgentRunning(sandbox)) {
 *   console.log("Agent is healthy");
 * } else {
 *   await startAgentProcess(sandbox, sessionId);
 * }
 */
export const isAgentRunning = async (sandbox: Sandbox): Promise<boolean> => {
  try {
    const healthRequest = new Request("http://localhost:3001/health", { method: "GET" });
    const response = await sandbox.fetch(healthRequest);
    return response.ok;
  } catch {
    return false;
  }
};

/**
 * Starts the Claude Agent SDK process within a sandbox.
 *
 * This function launches the Node.js agent process and waits for it to
 * become healthy. The agent discovers skills from the filesystem at startup,
 * so skills must be loaded BEFORE calling this function.
 *
 * ## Startup Sequence
 * 1. Check if agent is already running (idempotent)
 * 2. Start the Node.js process with startProcess()
 * 3. Poll the health endpoint until ready (up to 15 seconds)
 * 4. Update the sandboxAgentState cache
 *
 * ## Process Configuration
 * - Command: `node /app/dist/agent-sdk.js`
 * - Port: 3001 (internal to sandbox)
 * - Process ID: "agent-sdk" (for management)
 * - Auto-cleanup: disabled (for monitoring)
 *
 * @param sandbox - The sandbox instance to start the agent in
 * @param sessionId - Session identifier for state tracking
 * @returns True if agent started and became healthy
 *
 * @example
 * // Load skills first, then start agent
 * await loadSkillsFromR2ToSandbox(sandbox, bucket, userId);
 * const started = await startAgentProcess(sandbox, sessionId);
 * if (!started) {
 *   throw new Error("Failed to start agent");
 * }
 */
export const startAgentProcess = async (
  sandbox: Sandbox,
  sessionId: string
): Promise<boolean> => {
  try {
    console.log(`[Agent] Starting agent process for session ${sessionId}...`);

    // Check if agent is already running
    if (await isAgentRunning(sandbox)) {
      console.log(`[Agent] Agent already running for session ${sessionId}`);
      return true;
    }

    // Use startProcess() for background processes (not exec which is synchronous)
    // startProcess() keeps the process running after the call returns
    // IMPORTANT: cwd must be /workspace for the Claude Agent SDK to discover skills
    // at /workspace/.claude/skills/ (relative to cwd)
    const process = await sandbox.startProcess("node /app/dist/agent-sdk.js", {
      processId: AGENT_PROCESS_ID,
      cwd: "/workspace", // Critical: Agent looks for .claude/skills relative to cwd
      autoCleanup: false, // Keep process record for monitoring
      onExit: (code) => {
        console.log(`[Agent] Agent process exited with code ${code} for session ${sessionId}`);
        clearAgentState(sessionId);
      },
    });

    console.log(`[Agent] Started agent process:`, process.id);

    // Wait for agent to be ready (poll health endpoint)
    const startTime = Date.now();

    while (Date.now() - startTime < AGENT_STARTUP_TIMEOUT_MS) {
      if (await isAgentRunning(sandbox)) {
        console.log(`[Agent] Agent is ready for session ${sessionId} (took ${Date.now() - startTime}ms)`);
        setAgentState(sessionId, { started: true, startedAt: Date.now(), processId: process.id });
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, AGENT_HEALTH_POLL_INTERVAL_MS));
    }

    console.error(`[Agent] Agent failed to start within ${AGENT_STARTUP_TIMEOUT_MS}ms for session ${sessionId}`);
    // Try to get logs to understand why it failed
    try {
      const logs = await sandbox.getProcessLogs(AGENT_PROCESS_ID);
      console.error(`[Agent] Process logs:`, logs);
    } catch (e) {
      console.error(`[Agent] Could not get process logs:`, e);
    }
    return false;
  } catch (error) {
    console.error(`[Agent] Error starting agent for session ${sessionId}:`, error);
    return false;
  }
};

/**
 * Stops the Claude Agent SDK process within a sandbox.
 *
 * Gracefully terminates the agent process using SIGTERM, with SIGKILL
 * as a fallback if the process doesn't respond. This is typically called
 * before restarting the agent to reload skills.
 *
 * ## Shutdown Sequence
 * 1. Send SIGTERM to allow graceful shutdown
 * 2. Wait 500ms for process to exit
 * 3. If still running, send SIGKILL
 * 4. Wait 300ms for forced termination
 * 5. Clear sandboxAgentState cache
 *
 * @param sandbox - The sandbox instance containing the agent
 * @param sessionId - Session identifier for state tracking
 * @returns True if agent was stopped (or wasn't running)
 *
 * @example
 * // Stop agent before skill update
 * await stopAgentProcess(sandbox, sessionId);
 * await loadSkillsFromR2ToSandbox(sandbox, bucket, userId);
 * await startAgentProcess(sandbox, sessionId);
 */
export const stopAgentProcess = async (sandbox: Sandbox, sessionId: string): Promise<boolean> => {
  try {
    console.log(`[Agent] Stopping agent process for session ${sessionId}...`);

    // Use killProcess() to stop the background process properly
    try {
      await sandbox.killProcess(AGENT_PROCESS_ID, "SIGTERM");
      console.log(`[Agent] Sent SIGTERM to agent process`);
    } catch (e) {
      // Process might not exist or already stopped
      console.log(`[Agent] killProcess result:`, e);
    }

    // Wait a moment for process to die
    await new Promise(resolve => setTimeout(resolve, AGENT_STOP_WAIT_MS));

    // Verify it's stopped
    if (await isAgentRunning(sandbox)) {
      console.warn(`[Agent] Agent still running after kill for session ${sessionId}, trying SIGKILL...`);
      try {
        await sandbox.killProcess(AGENT_PROCESS_ID, "SIGKILL");
      } catch (e) {
        // Ignore
      }
      await new Promise(resolve => setTimeout(resolve, AGENT_KILL_WAIT_MS));
    }

    console.log(`[Agent] Agent stopped for session ${sessionId}`);
    clearAgentState(sessionId);
    return true;
  } catch (error) {
    console.error(`[Agent] Error stopping agent for session ${sessionId}:`, error);
    return false;
  }
};

/**
 * Orchestrates a complete agent restart with fresh skills.
 *
 * This is the primary function for updating an agent's skills. It performs
 * a coordinated stop → load → start sequence to ensure the agent discovers
 * new or updated skills.
 *
 * ## Restart Sequence
 * 1. Stop the currently running agent (if any)
 * 2. Ensure the `.claude` directory exists
 * 3. Load all skills from R2 to the sandbox filesystem
 * 4. Start a fresh agent process
 * 5. Return success status and loaded skill paths
 *
 * ## Why Restart is Required
 * The Claude Agent SDK discovers skills at startup by scanning the
 * `.claude/skills/` directory. It does not hot-reload skills, so any
 * changes require a full process restart.
 *
 * @param sandbox - The sandbox instance to restart
 * @param bucket - R2 bucket containing user skills
 * @param sessionId - Session identifier (typically userId)
 * @returns Object containing success status and array of loaded skill paths
 *
 * @example
 * // After uploading a new skill
 * const result = await restartAgentWithSkills(sandbox, bucket, userId);
 * if (result.success) {
 *   console.log(`Loaded skills: ${result.skillsLoaded.join(", ")}`);
 * }
 */
export const restartAgentWithSkills = async (
  sandbox: Sandbox,
  bucket: R2Bucket,
  sessionId: string
): Promise<{ success: boolean; skillsLoaded: string[] }> => {
  try {
    // 1. Stop the agent
    await stopAgentProcess(sandbox, sessionId);

    // 2. Load skills from R2
    console.log(`[Agent] Loading skills before restart for session ${sessionId}...`);
    await sandbox.writeFile("/workspace/.claude/.gitkeep", "");
    const skillsLoaded = await loadSkillsFromR2ToSandbox(sandbox, bucket, sessionId);
    console.log(`[Agent] Loaded ${skillsLoaded.length} skills`);

    // 3. Start the agent
    const started = await startAgentProcess(sandbox, sessionId);

    return { success: started, skillsLoaded };
  } catch (error) {
    console.error(`[Agent] Error restarting agent for session ${sessionId}:`, error);
    return { success: false, skillsLoaded: [] };
  }
};

/**
 * Triggers an agent restart to reload skills for a user.
 *
 * This helper gets the user's sandbox and performs a full restart cycle
 * to ensure the agent discovers any new or modified skills. Called after
 * skill upload or deletion.
 *
 * ## Architecture Note
 * The Claude Agent SDK discovers skills at startup by scanning the
 * `.claude/skills/` directory. It does NOT hot-reload skills, so any
 * changes require a full process restart.
 *
 * @param sandboxNamespace - The Sandbox DO namespace
 * @param bucket - R2 bucket containing user skills
 * @param userId - User identifier (also used as session ID)
 * @returns Object containing restart status and loaded skill paths
 *
 * @example
 * // After uploading a new skill
 * const result = await restartAgentForSkillsReload(env.Sandbox, env.USER_DATA, userId);
 * if (result.restarted) {
 *   console.log(`Reloaded skills: ${result.skillsLoaded.join(", ")}`);
 * }
 */
export const restartAgentForSkillsReload = async (
  sandboxNamespace: DurableObjectNamespace<Sandbox>,
  bucket: R2Bucket,
  userId: string
): Promise<{ restarted: boolean; skillsLoaded: string[] }> => {
  try {
    const sandbox = getSandbox(sandboxNamespace, userId);

    console.log(`[Skills] Restarting agent for user ${userId} to reload skills...`);

    // Use the restart helper that properly stops/starts the agent
    const result = await restartAgentWithSkills(sandbox, bucket, userId);

    if (result.success) {
      console.log(`[Skills] Agent restarted successfully for ${userId}`);
      return { restarted: true, skillsLoaded: result.skillsLoaded };
    } else {
      console.error(`[Skills] Agent restart failed for ${userId}`);
      // Clear state so next connection will try to start agent fresh
      clearAgentState(userId);
      return { restarted: false, skillsLoaded: result.skillsLoaded };
    }
  } catch (error) {
    console.error(`[Skills] Failed to restart agent for ${userId}:`, error);
    clearAgentState(userId);
    return { restarted: false, skillsLoaded: [] };
  }
};
