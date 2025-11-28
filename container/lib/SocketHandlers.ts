/**
 * @fileoverview Socket.IO event handlers for Claude Agent SDK Server
 *
 * This module defines all Socket.IO event handlers, separating the event
 * handling logic from server setup and session management.
 *
 * @module SocketHandlers
 */

import { Socket } from "socket.io";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ExtendedOptions, Logger } from './types';
import { SessionManager } from './SessionManager';
import { QueryOrchestrator } from './QueryOrchestrator';
import { log as defaultLog } from './logger';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Dependencies required by socket handlers.
 */
export interface SocketHandlerDeps {
  sessionManager: SessionManager;
  queryOrchestrator: QueryOrchestrator;
  logger?: Logger;
}

/**
 * Message data received from client.
 */
interface MessageData {
  prompt: string;
  options?: ExtendedOptions;
}

/**
 * Interrupt data received from client.
 */
interface InterruptData {
  threadId?: string;
  reason?: string;
}

// ============================================================================
// HANDLER FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a handler for the 'start' event.
 *
 * @description
 * Initializes the SDK query loop with the provided configuration.
 *
 * @param sessionId - The container session ID
 * @param deps - Handler dependencies
 * @param socket - The Socket.IO socket
 * @returns Event handler function
 */
function createStartHandler(
  sessionId: string,
  deps: SocketHandlerDeps,
  socket: Socket
): (config: ExtendedOptions) => void {
  const log = deps.logger || defaultLog;

  return (config: ExtendedOptions) => {
    log.incoming(socket.id, 'start', { configKeys: Object.keys(config || {}) });
    deps.queryOrchestrator.start(sessionId, config);

    const statusPayload = { type: "info" as const, message: "Session initialized" };
    log.outgoing(socket.id, 'status', statusPayload);
    socket.emit("status", statusPayload);
  };
}

/**
 * Creates a handler for the 'message' event.
 *
 * @description
 * Handles incoming user messages and manages thread isolation. When the
 * requested SDK session differs from the current session, performs a thread
 * switch.
 *
 * @param sessionId - The container session ID
 * @param deps - Handler dependencies
 * @param socket - The Socket.IO socket
 * @returns Event handler function
 */
function createMessageHandler(
  sessionId: string,
  deps: SocketHandlerDeps,
  socket: Socket
): (data: MessageData | string) => Promise<void> {
  const log = deps.logger || defaultLog;
  const { sessionManager, queryOrchestrator } = deps;

  return async (data: MessageData | string) => {
    const session = sessionManager.get(sessionId);
    if (!session) {
      log.warn(`Message received but no session found`, socket.id);
      return;
    }

    // Support both string-only and object message formats
    const userPrompt = typeof data === 'string' ? data : data.prompt;
    const options = typeof data === 'string' ? {} : data.options || {};

    log.incoming(socket.id, 'message', {
      promptLength: userPrompt?.length,
      promptPreview: userPrompt?.substring(0, 100),
      hasOptions: Object.keys(options).length > 0,
      optionKeys: Object.keys(options),
      resumeSessionId: options.resume
    });

    // Thread isolation check
    const requestedSdkSessionId = options.resume || null;

    if (sessionManager.needsThreadSwitch(sessionId, requestedSdkSessionId)) {
      log.info(
        `SDK session changing from ${session.currentSdkSessionId} to ${requestedSdkSessionId}`,
        socket.id
      );
      console.log(`[THREAD DEBUG] *** CLEARING conversation history for session switch ***`);

      // Stop any running query
      await sessionManager.interruptQuery(sessionId);

      // Switch threads (clears history and updates SDK session ID)
      sessionManager.switchThread(sessionId, requestedSdkSessionId);

      console.log(`[THREAD DEBUG] Session switch complete. New session: ${requestedSdkSessionId || 'NEW (no resume)'}`);
    }

    // Store user message in history
    const userUuid = crypto.randomUUID();
    sessionManager.addToHistory(sessionId, {
      role: 'user',
      content: userPrompt,
      uuid: userUuid,
      timestamp: Date.now()
    });

    // Start query loop if not already running
    const currentSession = sessionManager.get(sessionId);
    if (currentSession && !currentSession.isQueryRunning) {
      log.info(`Starting new query loop with SDK session: ${requestedSdkSessionId}`, socket.id);
      queryOrchestrator.start(sessionId, options);
      // Small delay to ensure MessageStream is initialized
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Push message to stream
    const updatedSession = sessionManager.get(sessionId);
    if (updatedSession?.messageStream) {
      const sdkMessage: SDKUserMessage = {
        type: 'user',
        session_id: sessionId,
        message: { role: 'user', content: userPrompt },
        parent_tool_use_id: null
      };

      log.debug(`Pushing user message to stream`, { promptLength: userPrompt?.length }, socket.id);
      updatedSession.messageStream.push(sdkMessage, socket.id);
    } else {
      log.error(`Message stream not available despite starting query`, undefined, socket.id);
      const errorPayload = { message: "Agent not ready" };
      log.outgoing(socket.id, 'error', errorPayload);
      socket.emit("error", errorPayload);
    }
  };
}

/**
 * Creates a handler for the 'interrupt' event.
 *
 * @description
 * Stops current query execution. Supports two modes:
 * - Simple interrupt: Emits status update
 * - Thread switch: Emits interrupt_complete with threadId
 *
 * @param sessionId - The container session ID
 * @param deps - Handler dependencies
 * @param socket - The Socket.IO socket
 * @returns Event handler function
 */
function createInterruptHandler(
  sessionId: string,
  deps: SocketHandlerDeps,
  socket: Socket
): (data?: InterruptData) => Promise<void> {
  const log = deps.logger || defaultLog;
  const { sessionManager } = deps;

  return async (data?: InterruptData) => {
    const threadId = data?.threadId;
    const reason = data?.reason || 'user_interrupt';

    log.incoming(socket.id, 'interrupt', { threadId, reason });

    const session = sessionManager.get(sessionId);
    if (!session) {
      // No session - just acknowledge completion for thread switch mode
      if (threadId) {
        socket.emit("interrupt_complete", { threadId, success: true, sessionId: null });
      }
      return;
    }

    // Interrupt the running query
    if (session.queryIterator) {
      try {
        log.info(`Interrupting query (reason: ${reason})`, socket.id);
        await session.queryIterator.interrupt();
      } catch (err) {
        log.error("Error interrupting query", err, socket.id);
      }
    }

    // Mark session as not running
    session.isQueryRunning = false;

    // Emit appropriate response
    if (threadId) {
      // Thread switch mode
      log.outgoing(socket.id, 'interrupt_complete', { threadId, success: true });
      socket.emit("interrupt_complete", {
        threadId,
        success: true,
        sessionId
      });
    } else {
      // Simple interrupt
      const statusPayload = { type: "info" as const, message: "Interrupted" };
      log.outgoing(socket.id, 'status', statusPayload);
      socket.emit("status", statusPayload);
    }
  };
}

/**
 * Creates a handler for the 'get_history' event.
 *
 * @param sessionId - The container session ID
 * @param deps - Handler dependencies
 * @param socket - The Socket.IO socket
 * @returns Event handler function
 */
function createGetHistoryHandler(
  sessionId: string,
  deps: SocketHandlerDeps,
  socket: Socket
): () => void {
  const log = deps.logger || defaultLog;
  const { sessionManager } = deps;

  return () => {
    log.incoming(socket.id, 'get_history');

    const history = sessionManager.getHistory(sessionId);
    log.outgoing(socket.id, 'history', { messageCount: history.length });
    socket.emit("history", { messages: history });
  };
}

/**
 * Creates a handler for the 'clear' event.
 *
 * @description
 * Resets session state for a fresh conversation. Interrupts any running
 * query and clears conversation history.
 *
 * @param sessionId - The container session ID
 * @param deps - Handler dependencies
 * @param socket - The Socket.IO socket
 * @returns Event handler function
 */
function createClearHandler(
  sessionId: string,
  deps: SocketHandlerDeps,
  socket: Socket
): () => Promise<void> {
  const log = deps.logger || defaultLog;
  const { sessionManager } = deps;

  return async () => {
    log.incoming(socket.id, 'clear');

    const session = sessionManager.get(sessionId);
    if (session) {
      // Interrupt running query
      if (session.queryIterator) {
        try {
          log.info(`Interrupting query for clear`, socket.id);
          await session.queryIterator.interrupt();
        } catch (err) {
          log.error("Error interrupting query during clear", err, socket.id);
        }
      }

      // Reset session state
      session.isQueryRunning = false;
      session.queryIterator = null;
      session.messageStream = null;
      sessionManager.clearHistory(sessionId);

      log.info(`Session cleared`, socket.id);
      const statusPayload = { type: "info" as const, message: "Session cleared" };
      log.outgoing(socket.id, 'cleared', statusPayload);
      socket.emit("cleared", statusPayload);
    }
  };
}

/**
 * Creates a handler for the 'disconnect' event.
 *
 * @description
 * Starts graceful session cleanup with a 60-second timer for reconnection.
 *
 * @param sessionId - The container session ID
 * @param deps - Handler dependencies
 * @param socket - The Socket.IO socket
 * @returns Event handler function
 */
function createDisconnectHandler(
  sessionId: string,
  deps: SocketHandlerDeps,
  socket: Socket
): () => void {
  const log = deps.logger || defaultLog;
  const { sessionManager } = deps;

  return () => {
    log.info(`Client disconnected`, socket.id);
    sessionManager.scheduleCleanup(sessionId);
  };
}

// ============================================================================
// MAIN REGISTRATION FUNCTION
// ============================================================================

/**
 * Registers all Socket.IO event handlers for a connected socket.
 *
 * @description
 * Main entry point for setting up socket event handlers. This function:
 *
 * 1. Creates or resumes a session for the socket
 * 2. Registers handlers for all socket events
 * 3. Sends initial status and history on resume
 *
 * @param socket - The Socket.IO socket
 * @param deps - Handler dependencies
 *
 * @example
 * io.on("connection", (socket) => {
 *   registerSocketHandlers(socket, {
 *     sessionManager: new SessionManager(),
 *     queryOrchestrator: new QueryOrchestrator({ sessionManager }),
 *     logger: customLogger
 *   });
 * });
 */
export function registerSocketHandlers(socket: Socket, deps: SocketHandlerDeps): void {
  const log = deps.logger || defaultLog;
  const { sessionManager } = deps;

  // Extract session ID from connection
  const sessionId = socket.handshake.query.sessionId as string;
  log.info(`New client connected`, socket.id);

  if (!sessionId) {
    log.warn(`Client connected without sessionId`, socket.id);
  } else {
    log.info(`Client claimed sessionId: ${sessionId}`, socket.id);
  }

  // Use provided sessionId or fall back to socket.id
  const effectiveSessionId = sessionId || socket.id;

  // Resume or create session
  let session = sessionManager.get(effectiveSessionId);

  if (session) {
    // Resume existing session
    session = sessionManager.resume(effectiveSessionId, socket);
    socket.emit("status", { type: "info", message: "Session resumed" });

    // Send conversation history on reconnect
    const history = sessionManager.getHistory(effectiveSessionId);
    if (history.length > 0) {
      log.outgoing(socket.id, 'history', { messageCount: history.length });
      socket.emit("history", { messages: history });
    }
  } else {
    // Create new session
    sessionManager.create(effectiveSessionId, socket);
  }

  // Register event handlers
  socket.on("start", createStartHandler(effectiveSessionId, deps, socket));
  socket.on("message", createMessageHandler(effectiveSessionId, deps, socket));
  socket.on("interrupt", createInterruptHandler(effectiveSessionId, deps, socket));
  socket.on("get_history", createGetHistoryHandler(effectiveSessionId, deps, socket));
  socket.on("clear", createClearHandler(effectiveSessionId, deps, socket));
  socket.on("disconnect", createDisconnectHandler(effectiveSessionId, deps, socket));
}

export default registerSocketHandlers;
