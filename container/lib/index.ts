/**
 * @fileoverview Library exports for Claude Agent SDK Server
 *
 * This module provides a central export point for all library modules.
 *
 * @module lib
 */

// Types
export * from './types';

// Logger
export { log, createLogger, getTimestamp, truncateStrings } from './logger';
export type { LoggerOptions } from './logger';

// MessageStream
export { MessageStream, createMessageStream } from './MessageStream';

// SessionManager
export { SessionManager, sessionManager, DEFAULT_DISCONNECT_TIMEOUT_MS } from './SessionManager';

// HookHandler
export { HookHandler, createHookHandler, DEFAULT_HOOK_TIMEOUT_MS, AUTO_CONTINUE_HOOKS } from './HookHandler';

// QueryOrchestrator
export {
  QueryOrchestrator,
  createQueryOrchestrator,
  DEFAULT_ALLOWED_TOOLS,
  DEFAULT_MODEL,
  DEFAULT_CWD
} from './QueryOrchestrator';
export type { QueryOrchestratorDeps } from './QueryOrchestrator';

// SocketHandlers
export { registerSocketHandlers } from './SocketHandlers';
export type { SocketHandlerDeps } from './SocketHandlers';
