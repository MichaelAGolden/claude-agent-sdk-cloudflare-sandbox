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
