/**
 * @fileoverview Session state management for Claude Agent SDK Server
 *
 * This module implements the Repository pattern for managing client sessions.
 * It encapsulates all session state operations, including creation, resumption,
 * cleanup, and thread switching.
 *
 * @module SessionManager
 */

import { Socket } from "socket.io";
import type {
  SessionState,
  StoredMessage,
  Logger,
  ISessionManager
} from './types.js';
import { MessageStream } from './MessageStream.js';
import { log as defaultLog } from './logger.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Default grace period (in ms) before cleaning up disconnected sessions.
 *
 * Set to 15 minutes to support long-running agent tasks (5-10 minutes).
 * If the user's browser loses connection temporarily (network hiccup,
 * laptop sleep, etc.), the agent can continue working and the user
 * can reconnect to see results.
 */
export const DEFAULT_DISCONNECT_TIMEOUT_MS = 900000; // 15 minutes

// ============================================================================
// SESSION MANAGER CLASS
// ============================================================================

/**
 * Manages client session state with proper encapsulation and lifecycle handling.
 *
 * @class SessionManager
 * @implements {ISessionManager}
 *
 * @description
 * SessionManager provides a centralized store for all client sessions, implementing
 * the Repository pattern. It handles:
 *
 * - Session creation and initialization
 * - Session resumption on reconnection
 * - Graceful disconnect with timeout-based cleanup
 * - Thread switching (clearing history when SDK session changes)
 * - Conversation history management
 *
 * ## Session Lifecycle
 *
 * 1. **Create**: New session initialized when client connects
 * 2. **Update**: Session state updated during query processing
 * 3. **Disconnect**: Timer started for cleanup grace period
 * 4. **Resume**: Timer cancelled when client reconnects
 * 5. **Cleanup**: Session deleted after timeout expires
 *
 * @example
 * const sessionManager = new SessionManager();
 *
 * // Create new session
 * const session = sessionManager.create('sandbox-123', socket);
 *
 * // Resume existing session
 * const resumed = sessionManager.resume('sandbox-123', newSocket);
 *
 * // Schedule cleanup on disconnect
 * sessionManager.scheduleCleanup('sandbox-123', 60000);
 *
 * // Switch threads
 * sessionManager.switchThread('sandbox-123', 'new-sdk-session-id');
 */
export class SessionManager implements ISessionManager {
  /**
   * Internal storage for session state.
   */
  private sessions = new Map<string, SessionState>();

  /**
   * Logger instance for debug output.
   */
  private log: Logger;

  /**
   * Creates a new SessionManager instance.
   *
   * @param logger - Optional custom logger (defaults to standard logger)
   */
  constructor(logger: Logger = defaultLog) {
    this.log = logger;
  }

  // ==========================================================================
  // CORE CRUD OPERATIONS
  // ==========================================================================

  /**
   * Retrieves a session by its ID.
   *
   * @param sessionId - The session identifier to look up
   * @returns The session state, or undefined if not found
   */
  get(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Creates a new session for a client connection.
   *
   * @param sessionId - The session identifier (typically container/sandbox ID)
   * @param socket - The Socket.IO socket for this connection
   * @returns The newly created session state
   *
   * @example
   * const session = sessionManager.create('sandbox-123', socket);
   */
  create(sessionId: string, socket: Socket): SessionState {
    this.log.info(`Creating new session for ${sessionId}`, socket.id);

    const session: SessionState = {
      sessionId,
      currentSocket: socket,
      queryIterator: null,
      messageStream: null,
      abortController: new AbortController(),
      isQueryRunning: false,
      conversationHistory: [],
      currentSdkSessionId: null
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Updates specific properties of an existing session.
   *
   * @param sessionId - The session identifier
   * @param updates - Partial session state to merge
   *
   * @example
   * sessionManager.update('sandbox-123', { isQueryRunning: true });
   */
  update(sessionId: string, updates: Partial<SessionState>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      Object.assign(session, updates);
    } else {
      this.log.warn(`Cannot update non-existent session: ${sessionId}`);
    }
  }

  /**
   * Deletes a session and cleans up resources.
   *
   * @param sessionId - The session identifier to delete
   */
  delete(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Clean up resources
      if (session.disconnectTimeout) {
        clearTimeout(session.disconnectTimeout);
      }
      if (session.messageStream) {
        session.messageStream.finish();
      }
      session.abortController.abort();

      this.sessions.delete(sessionId);
      this.log.info(`Session ${sessionId} deleted`);
    }
  }

  /**
   * Checks if a session exists.
   *
   * @param sessionId - The session identifier
   * @returns True if the session exists
   */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Returns the total number of active sessions.
   *
   * @returns Count of sessions
   */
  size(): number {
    return this.sessions.size;
  }

  // ==========================================================================
  // SOCKET ACCESS
  // ==========================================================================

  /**
   * Retrieves the current Socket.IO socket for a session.
   *
   * @description
   * The socket may change during the session lifetime due to client reconnections.
   * This method ensures we always use the most current socket reference.
   *
   * @param sessionId - The session identifier
   * @returns The current socket, or undefined if session not found
   */
  getSocket(sessionId: string): Socket | undefined {
    return this.sessions.get(sessionId)?.currentSocket;
  }

  /**
   * Updates the socket for a session (used during reconnection).
   *
   * @param sessionId - The session identifier
   * @param socket - The new Socket.IO socket
   */
  updateSocket(sessionId: string, socket: Socket): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.currentSocket = socket;
    }
  }

  // ==========================================================================
  // SESSION LIFECYCLE
  // ==========================================================================

  /**
   * Resumes an existing session with a new socket connection.
   *
   * @description
   * Handles client reconnection by:
   * 1. Updating the socket reference
   * 2. Cancelling any pending cleanup timeout
   * 3. Returning the session for further processing
   *
   * @param sessionId - The session identifier
   * @param socket - The new Socket.IO socket
   * @returns The resumed session, or undefined if not found
   *
   * @example
   * const session = sessionManager.resume('sandbox-123', newSocket);
   * if (session) {
   *   socket.emit("status", { type: "info", message: "Session resumed" });
   * }
   */
  resume(sessionId: string, socket: Socket): SessionState | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    this.log.info(`Resuming existing session for ${sessionId}`, socket.id);

    // Update socket reference
    session.currentSocket = socket;

    // Cancel pending cleanup
    if (session.disconnectTimeout) {
      clearTimeout(session.disconnectTimeout);
      session.disconnectTimeout = undefined;
      this.log.info(`Cancelled disconnect timeout for ${sessionId}`);
    }

    return session;
  }

  /**
   * Schedules session cleanup after a disconnect.
   *
   * @description
   * When a client disconnects, we don't immediately clean up. Instead,
   * we start a timer to allow for reconnection (e.g., browser refresh,
   * network interruption).
   *
   * @param sessionId - The session identifier
   * @param delayMs - Delay before cleanup (defaults to 60 seconds)
   *
   * @example
   * socket.on("disconnect", () => {
   *   sessionManager.scheduleCleanup(sessionId, 60000);
   * });
   */
  scheduleCleanup(sessionId: string, delayMs: number = DEFAULT_DISCONNECT_TIMEOUT_MS): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    this.log.info(`Scheduling session cleanup for ${sessionId} in ${delayMs}ms`);

    session.disconnectTimeout = setTimeout(() => {
      this.log.info(`Session ${sessionId} timed out, cleaning up`);

      // Abort any running operations
      session.abortController.abort();

      // Finish the message stream
      if (session.messageStream) {
        session.messageStream.finish();
      }

      // Delete the session
      this.sessions.delete(sessionId);
    }, delayMs);
  }

  /**
   * Cancels a scheduled cleanup for a session.
   *
   * @param sessionId - The session identifier
   */
  cancelCleanup(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session?.disconnectTimeout) {
      clearTimeout(session.disconnectTimeout);
      session.disconnectTimeout = undefined;
      this.log.info(`Cancelled cleanup for ${sessionId}`);
    }
  }

  // ==========================================================================
  // THREAD MANAGEMENT
  // ==========================================================================

  /**
   * Switches to a different SDK session (conversation thread).
   *
   * @description
   * When the frontend requests a different thread (via `options.resume`),
   * this method:
   * 1. Clears the conversation history (belongs to old thread)
   * 2. Updates the tracked SDK session ID
   *
   * Note: This does NOT interrupt running queries. Call `interruptQuery()`
   * first if needed.
   *
   * @param sessionId - The container session identifier
   * @param newSdkSessionId - The new SDK session ID (null for new conversation)
   *
   * @example
   * // Switch to a different thread
   * sessionManager.switchThread('sandbox-123', 'sdk-session-xyz');
   *
   * // Start a new conversation (no resume)
   * sessionManager.switchThread('sandbox-123', null);
   */
  switchThread(sessionId: string, newSdkSessionId: string | null): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.log.warn(`Cannot switch thread for non-existent session: ${sessionId}`);
      return;
    }

    this.log.info(
      `Switching thread for ${sessionId}: ${session.currentSdkSessionId} -> ${newSdkSessionId}`
    );

    // Clear conversation history (belongs to old thread)
    session.conversationHistory = [];

    // Update tracked SDK session
    session.currentSdkSessionId = newSdkSessionId;
  }

  /**
   * Checks if a thread switch is needed.
   *
   * @param sessionId - The container session identifier
   * @param requestedSdkSessionId - The requested SDK session ID
   * @returns True if the requested session differs from current
   */
  needsThreadSwitch(sessionId: string, requestedSdkSessionId: string | null): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    return requestedSdkSessionId !== session.currentSdkSessionId;
  }

  // ==========================================================================
  // QUERY STATE MANAGEMENT
  // ==========================================================================

  /**
   * Prepares a session for a new query.
   *
   * @description
   * Initializes the query-related state:
   * - Creates a new MessageStream
   * - Creates a new AbortController
   * - Sets isQueryRunning to true
   *
   * @param sessionId - The session identifier
   * @returns The prepared session, or undefined if not found
   */
  prepareForQuery(sessionId: string): SessionState | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    session.messageStream = new MessageStream(this.log);
    session.abortController = new AbortController();
    session.isQueryRunning = true;

    return session;
  }

  /**
   * Cleans up query state after completion or interruption.
   *
   * @param sessionId - The session identifier
   */
  cleanupQuery(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.isQueryRunning = false;
    session.queryIterator = null;
    session.messageStream = null;
  }

  /**
   * Interrupts a running query for a session.
   *
   * @param sessionId - The session identifier
   * @returns Promise that resolves when interruption is complete
   */
  async interruptQuery(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (session.queryIterator) {
      try {
        await session.queryIterator.interrupt();
      } catch (err) {
        this.log.error("Error interrupting query", err, sessionId);
      }
    }

    // Clean up query state
    session.isQueryRunning = false;
    session.queryIterator = null;
    if (session.messageStream) {
      session.messageStream.finish();
    }
    session.messageStream = null;
  }

  // ==========================================================================
  // CONVERSATION HISTORY
  // ==========================================================================

  /**
   * Adds a message to the session's conversation history.
   *
   * @param sessionId - The session identifier
   * @param message - The message to add
   */
  addToHistory(sessionId: string, message: StoredMessage): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.conversationHistory.push(message);
    }
  }

  /**
   * Gets the conversation history for a session.
   *
   * @param sessionId - The session identifier
   * @returns The conversation history array, or empty array if not found
   */
  getHistory(sessionId: string): StoredMessage[] {
    return this.sessions.get(sessionId)?.conversationHistory || [];
  }

  /**
   * Clears the conversation history for a session.
   *
   * @param sessionId - The session identifier
   */
  clearHistory(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.conversationHistory = [];
    }
  }

  // ==========================================================================
  // DEBUGGING
  // ==========================================================================

  /**
   * Gets debug information about all sessions.
   *
   * @returns Array of session debug info
   */
  getDebugInfo(): Array<{
    sessionId: string;
    isConnected: boolean;
    isQueryRunning: boolean;
    historyLength: number;
    sdkSessionId: string | null;
  }> {
    const info: Array<{
      sessionId: string;
      isConnected: boolean;
      isQueryRunning: boolean;
      historyLength: number;
      sdkSessionId: string | null;
    }> = [];

    for (const [sessionId, session] of this.sessions) {
      info.push({
        sessionId,
        isConnected: session.currentSocket?.connected ?? false,
        isQueryRunning: session.isQueryRunning,
        historyLength: session.conversationHistory.length,
        sdkSessionId: session.currentSdkSessionId
      });
    }

    return info;
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

/**
 * Default singleton instance of SessionManager.
 *
 * @description
 * For applications that don't need dependency injection, this provides
 * a convenient shared instance.
 */
export const sessionManager = new SessionManager();

export default SessionManager;
