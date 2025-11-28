/**
 * @fileoverview Constants used throughout the Claude Agent SDK server.
 *
 * This module centralizes magic strings, timing values, and configuration
 * defaults to improve maintainability and prevent duplication.
 *
 * @module lib/constants
 */

/**
 * Process identifier for the Claude Agent SDK within a sandbox.
 *
 * Used with sandbox.startProcess() and sandbox.killProcess() for
 * consistent process management.
 */
export const AGENT_PROCESS_ID = "agent-sdk";

/**
 * Default Claude model to use when MODEL env var is not set.
 */
export const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

/**
 * Haiku model used for lightweight tasks like title generation.
 */
export const HAIKU_MODEL = "claude-3-haiku-20240307";

/**
 * Maximum time to wait for agent health check during startup (ms).
 */
export const AGENT_STARTUP_TIMEOUT_MS = 15000;

/**
 * Interval between health check polls during agent startup (ms).
 */
export const AGENT_HEALTH_POLL_INTERVAL_MS = 300;

/**
 * Time to wait after SIGTERM before checking if agent stopped (ms).
 */
export const AGENT_STOP_WAIT_MS = 500;

/**
 * Time to wait after SIGKILL for forced termination (ms).
 */
export const AGENT_KILL_WAIT_MS = 300;

/**
 * Port where the agent SDK server listens inside the sandbox.
 */
export const AGENT_PORT = 3001;

/**
 * R2 bucket name for user data (skills, transcripts, conversations).
 */
export const R2_BUCKET_NAME = "claude-agent-user-data";

/**
 * Base path for skills in the sandbox filesystem.
 */
export const SKILLS_BASE_PATH = "/workspace/.claude/skills";

/**
 * Base path for Claude SDK transcript storage.
 */
export const TRANSCRIPT_BASE_PATH = "/root/.claude/projects/-workspace";
