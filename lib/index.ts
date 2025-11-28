/**
 * @fileoverview Barrel exports for the lib module.
 *
 * This module re-exports all types, constants, and utilities from the lib folder
 * for convenient importing throughout the application.
 *
 * @module lib
 *
 * @example
 * import { Bindings, Thread, generateUUID, AGENT_PROCESS_ID } from "./lib";
 */

// Type definitions
export type {
  Bindings,
  Skill,
  Thread,
  Message,
  AgentState,
} from "./types";

// Constants
export {
  AGENT_PROCESS_ID,
  DEFAULT_MODEL,
  HAIKU_MODEL,
  AGENT_STARTUP_TIMEOUT_MS,
  AGENT_HEALTH_POLL_INTERVAL_MS,
  AGENT_STOP_WAIT_MS,
  AGENT_KILL_WAIT_MS,
  AGENT_PORT,
  R2_BUCKET_NAME,
  SKILLS_BASE_PATH,
  TRANSCRIPT_BASE_PATH,
} from "./constants";

// Utility functions
export {
  generateUUID,
  isProduction,
  getUserSkillKey,
  getUserSkillsPrefix,
  getTranscriptR2Key,
  getTranscriptLocalPath,
} from "./utils";
