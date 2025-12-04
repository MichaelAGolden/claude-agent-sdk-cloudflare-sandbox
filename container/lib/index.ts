/**
 * @fileoverview Library exports for Claude Agent SDK Server
 *
 * This module provides a central export point for all library modules.
 *
 * @module lib
 */

// Types
export * from './types.js';

// Logger
export { log, createLogger, getTimestamp, truncateStrings, setLogSocket, getLogSocket } from './logger.js';
export type { LoggerOptions } from './logger.js';

// MessageStream
export { MessageStream, createMessageStream } from './MessageStream.js';

// SessionManager
export { SessionManager, sessionManager, DEFAULT_DISCONNECT_TIMEOUT_MS } from './SessionManager.js';

// HookHandler
export { HookHandler, createHookHandler, DEFAULT_HOOK_TIMEOUT_MS, AUTO_CONTINUE_HOOKS } from './HookHandler.js';

// QueryOrchestrator
export {
  QueryOrchestrator,
  createQueryOrchestrator,
  DEFAULT_ALLOWED_TOOLS,
  DEFAULT_MODEL,
  DEFAULT_CWD
} from './QueryOrchestrator.js';
export type { QueryOrchestratorDeps } from './QueryOrchestrator.js';

// SocketHandlers
export { registerSocketHandlers } from './SocketHandlers.js';
export type { SocketHandlerDeps } from './SocketHandlers.js';
