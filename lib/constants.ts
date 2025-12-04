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
 * Claude model API IDs.
 * These are the exact strings required for Anthropic API calls.
 * @see https://platform.claude.com/docs/en/about-claude/models/overview
 */
export const CLAUDE_MODELS = {
  // Current frontier models (4.5 series)
  SONNET_4_5: "claude-sonnet-4-5-20250929",
  HAIKU_4_5: "claude-haiku-4-5-20251001",
  OPUS_4_5: "claude-opus-4-5-20251101",

  // Legacy models (for compatibility)
  OPUS_4_1: "claude-opus-4-1-20250805",
  SONNET_4: "claude-sonnet-4-20250514",
  OPUS_4: "claude-opus-4-20250514",
  SONNET_3_7: "claude-3-7-sonnet-20250219",
  HAIKU_3_5: "claude-3-5-haiku-20241022",
  HAIKU_3: "claude-3-haiku-20240307",
} as const;

/**
 * Model display names for UI.
 */
export const MODEL_DISPLAY_NAMES: Record<string, string> = {
  [CLAUDE_MODELS.SONNET_4_5]: "Claude Sonnet 4.5",
  [CLAUDE_MODELS.HAIKU_4_5]: "Claude Haiku 4.5",
  [CLAUDE_MODELS.OPUS_4_5]: "Claude Opus 4.5",
  [CLAUDE_MODELS.OPUS_4_1]: "Claude Opus 4.1",
  [CLAUDE_MODELS.SONNET_4]: "Claude Sonnet 4",
  [CLAUDE_MODELS.OPUS_4]: "Claude Opus 4",
  [CLAUDE_MODELS.SONNET_3_7]: "Claude Sonnet 3.7",
  [CLAUDE_MODELS.HAIKU_3_5]: "Claude Haiku 3.5",
  [CLAUDE_MODELS.HAIKU_3]: "Claude Haiku 3",
};

/**
 * Model aliases used by Claude Agent SDK.
 * Maps SDK aliases to full API IDs.
 */
export const MODEL_ALIASES: Record<string, string> = {
  sonnet: CLAUDE_MODELS.SONNET_4_5,
  haiku: CLAUDE_MODELS.HAIKU_4_5,
  opus: CLAUDE_MODELS.OPUS_4_5,
  inherit: "", // Special value: inherit from parent query
};

/**
 * Default Claude model to use when MODEL env var is not set.
 */
export const DEFAULT_MODEL = CLAUDE_MODELS.SONNET_4_5;

/**
 * Haiku model used for lightweight tasks like title generation.
 */
export const HAIKU_MODEL = CLAUDE_MODELS.HAIKU_4_5;

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
