/**
 * @fileoverview Runtime state management for Claude Agent SDK processes.
 *
 * This module manages the in-memory state of agent processes running within
 * sandboxes. It tracks lifecycle information to prevent duplicate startups
 * and enable proper cleanup.
 *
 * @module state/agent-state
 */

import type { AgentState } from "../lib/types";

/**
 * In-memory cache tracking agent process state per sandbox session.
 *
 * This Map maintains the lifecycle state of Claude Agent SDK processes
 * running within sandboxes. It's used to:
 * - Prevent duplicate agent startups
 * - Track when agents were started
 * - Store process IDs for management
 * - Reset state when skills change (triggering restart)
 *
 * @example
 * // Check if agent needs initialization
 * const state = sandboxAgentState.get(sessionId);
 * if (!state?.started) {
 *   await startAgentProcess(sandbox, sessionId);
 * }
 */
export const sandboxAgentState = new Map<string, AgentState>();

/**
 * Gets the agent state for a session.
 *
 * @param sessionId - The session identifier
 * @returns The agent state or undefined if not found
 */
export const getAgentState = (sessionId: string): AgentState | undefined => {
  return sandboxAgentState.get(sessionId);
};

/**
 * Sets the agent state for a session.
 *
 * @param sessionId - The session identifier
 * @param state - The new agent state
 */
export const setAgentState = (sessionId: string, state: AgentState): void => {
  sandboxAgentState.set(sessionId, state);
};

/**
 * Clears the agent state for a session.
 *
 * Call this when an agent process exits or needs to be reset.
 *
 * @param sessionId - The session identifier
 */
export const clearAgentState = (sessionId: string): void => {
  sandboxAgentState.delete(sessionId);
};

/**
 * Checks if an agent has been started for a session.
 *
 * @param sessionId - The session identifier
 * @returns True if the agent has been started
 */
export const isAgentStarted = (sessionId: string): boolean => {
  const state = sandboxAgentState.get(sessionId);
  return state?.started ?? false;
};
