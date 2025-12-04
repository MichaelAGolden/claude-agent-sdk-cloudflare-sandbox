/**
 * @fileoverview Utility functions used throughout the Claude Agent SDK server.
 *
 * This module contains pure utility functions that don't depend on
 * external services or state.
 *
 * @module lib/utils
 */

import type { Bindings } from "./types";

/**
 * Normalizes a user ID to lowercase for sandbox compatibility.
 *
 * Cloudflare Sandbox IDs are used in hostnames which are case-insensitive.
 * User IDs from authentication providers like Clerk often contain uppercase
 * letters (e.g., "user_35yar6ZIrFf6GWUTXCZoZPUWMLt"). This function normalizes
 * them once at the source to prevent issues downstream.
 *
 * @param userId - The user ID from authentication provider
 * @returns Lowercase normalized user ID
 *
 * @example
 * const userId = normalizeUserId(clerkUserId);
 * // "user_35yar6ZIrFf6GWUTXCZoZPUWMLt" -> "user_35yar6zirff6gwutxczozpuwmlt"
 */
export const normalizeUserId = (userId: string): string => {
  return userId.toLowerCase();
};

/**
 * Generates a cryptographically secure UUID v4.
 *
 * Uses the Web Crypto API available in Cloudflare Workers for
 * generating unique identifiers for threads, messages, and other entities.
 *
 * @returns A UUID v4 string in the format xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 *
 * @example
 * const threadId = generateUUID();
 * // Returns: "550e8400-e29b-41d4-a716-446655440000"
 */
export const generateUUID = (): string => {
  return crypto.randomUUID();
};

/**
 * Determines if the server is running in production mode.
 *
 * Production mode enables additional features:
 * - R2 bucket mounting for direct filesystem access
 * - Full transcript persistence
 * - Optimized skill loading
 *
 * @param env - The Cloudflare Workers environment bindings
 * @returns True if ENVIRONMENT is set to "production"
 *
 * @example
 * if (isProduction(c.env)) {
 *   await sandbox.mountBucket("bucket-name", "/mount/path");
 * }
 */
export const isProduction = (env: Bindings): boolean => {
  return env.ENVIRONMENT === "production";
};

/**
 * Constructs the R2 object key for a user's skill file.
 *
 * Skills are stored in R2 with a hierarchical structure:
 * `users/{userId}/skills/{skillName}/SKILL.md`
 *
 * @param userId - The unique identifier for the user
 * @param skillName - The name of the skill (directory name)
 * @returns The full R2 object key path
 *
 * @example
 * const key = getUserSkillKey("user_123", "code-review");
 * // Returns: "users/user_123/skills/code-review/SKILL.md"
 */
export const getUserSkillKey = (userId: string, skillName: string): string => {
  return `users/${userId}/skills/${skillName}/SKILL.md`;
};

/**
 * Constructs the R2 prefix for listing a user's skills directory.
 *
 * Used with R2's list() operation to enumerate all skills
 * belonging to a user.
 *
 * @param userId - The unique identifier for the user
 * @returns The R2 prefix path for the user's skills directory
 *
 * @example
 * const prefix = getUserSkillsPrefix("user_123");
 * // Returns: "users/user_123/skills/"
 */
export const getUserSkillsPrefix = (userId: string): string => {
  return `users/${userId}/skills/`;
};

/**
 * Constructs the R2 object key for a project-scoped skill file.
 *
 * Project skills are stored in R2 with a hierarchical structure:
 * `users/{userId}/projects/{projectId}/skills/{skillName}/SKILL.md`
 *
 * @param userId - The unique identifier for the user
 * @param projectId - The project this skill belongs to
 * @param skillName - The name of the skill (directory name)
 * @returns The full R2 object key path
 *
 * @example
 * const key = getProjectSkillKey("user_123", "proj_456", "figma-helper");
 * // Returns: "users/user_123/projects/proj_456/skills/figma-helper/SKILL.md"
 */
export const getProjectSkillKey = (userId: string, projectId: string, skillName: string): string => {
  return `users/${userId}/projects/${projectId}/skills/${skillName}/SKILL.md`;
};

/**
 * Constructs the R2 prefix for listing a project's skills directory.
 *
 * Used with R2's list() operation to enumerate all skills
 * belonging to a specific project.
 *
 * @param userId - The unique identifier for the user
 * @param projectId - The project ID
 * @returns The R2 prefix path for the project's skills directory
 *
 * @example
 * const prefix = getProjectSkillsPrefix("user_123", "proj_456");
 * // Returns: "users/user_123/projects/proj_456/skills/"
 */
export const getProjectSkillsPrefix = (userId: string, projectId: string): string => {
  return `users/${userId}/projects/${projectId}/skills/`;
};

/**
 * Constructs the R2 object key for a session transcript.
 *
 * @param userId - The unique identifier for the user
 * @param sessionId - The Claude SDK session identifier
 * @returns The R2 object key path for the transcript
 *
 * @example
 * const key = getTranscriptR2Key("user_123", "session_abc");
 * // Returns: "users/user_123/transcripts/session_abc.jsonl"
 */
export const getTranscriptR2Key = (userId: string, sessionId: string): string => {
  return `users/${userId}/transcripts/${sessionId}.jsonl`;
};

/**
 * Returns the sandbox-local path where the SDK stores transcripts.
 *
 * The Claude SDK uses a deterministic path based on the working directory
 * (normalized to "-workspace") and session ID.
 *
 * @param sessionId - The Claude SDK session identifier
 * @returns The absolute path in the sandbox filesystem
 *
 * @example
 * const path = getTranscriptLocalPath("session_abc");
 * // Returns: "/root/.claude/projects/-workspace/session_abc.jsonl"
 */
export const getTranscriptLocalPath = (sessionId: string): string => {
  return `/root/.claude/projects/-workspace/${sessionId}.jsonl`;
};

// ============================================================================
// AGENT STORAGE UTILITIES
// ============================================================================

/**
 * Constructs the R2 object key for a user-scoped agent file.
 *
 * Agents are stored in R2 with a hierarchical structure:
 * `users/{userId}/agents/{agentName}/AGENT.md`
 *
 * @param userId - The unique identifier for the user
 * @param agentName - The name of the agent (directory name)
 * @returns The full R2 object key path
 *
 * @example
 * const key = getUserAgentKey("user_123", "code-reviewer");
 * // Returns: "users/user_123/agents/code-reviewer/AGENT.md"
 */
export const getUserAgentKey = (userId: string, agentName: string): string => {
  return `users/${userId}/agents/${agentName}/AGENT.md`;
};

/**
 * Constructs the R2 prefix for listing a user's agents directory.
 *
 * Used with R2's list() operation to enumerate all agents
 * belonging to a user.
 *
 * @param userId - The unique identifier for the user
 * @returns The R2 prefix path for the user's agents directory
 *
 * @example
 * const prefix = getUserAgentsPrefix("user_123");
 * // Returns: "users/user_123/agents/"
 */
export const getUserAgentsPrefix = (userId: string): string => {
  return `users/${userId}/agents/`;
};

/**
 * Constructs the R2 object key for a project-scoped agent file.
 *
 * Project agents are stored in R2 with a hierarchical structure:
 * `users/{userId}/projects/{projectId}/agents/{agentName}/AGENT.md`
 *
 * @param userId - The unique identifier for the user
 * @param projectId - The project this agent belongs to
 * @param agentName - The name of the agent (directory name)
 * @returns The full R2 object key path
 *
 * @example
 * const key = getProjectAgentKey("user_123", "proj_456", "security-scanner");
 * // Returns: "users/user_123/projects/proj_456/agents/security-scanner/AGENT.md"
 */
export const getProjectAgentKey = (userId: string, projectId: string, agentName: string): string => {
  return `users/${userId}/projects/${projectId}/agents/${agentName}/AGENT.md`;
};

/**
 * Constructs the R2 prefix for listing a project's agents directory.
 *
 * Used with R2's list() operation to enumerate all agents
 * belonging to a specific project.
 *
 * @param userId - The unique identifier for the user
 * @param projectId - The project ID
 * @returns The R2 prefix path for the project's agents directory
 *
 * @example
 * const prefix = getProjectAgentsPrefix("user_123", "proj_456");
 * // Returns: "users/user_123/projects/proj_456/agents/"
 */
export const getProjectAgentsPrefix = (userId: string, projectId: string): string => {
  return `users/${userId}/projects/${projectId}/agents/`;
};
