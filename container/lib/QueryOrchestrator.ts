/**
 * @fileoverview SDK Query lifecycle orchestration for Claude Agent SDK Server
 *
 * This module manages the complete lifecycle of SDK queries, including
 * initialization, message processing, streaming, and cleanup.
 *
 * @module QueryOrchestrator
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  ExtendedOptions,
  Logger,
  EmitToClientFn,
  AssistantContentBlock
} from './types';
import { SessionManager } from './SessionManager';
import { HookHandler } from './HookHandler';
import { log as defaultLog } from './logger';

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Default allowed tools for SDK queries.
 */
export const DEFAULT_ALLOWED_TOOLS = [
  "Read", "Write", "Bash", "Grep", "WebSearch", "WebFetch", "Task",
  "BashOutput", "Edit", "Glob", "KillBash", "NotebookEdit", "TodoWrite",
  "ExitPlanMode", "ListMcpResources", "ReadMcpResource", "Skill"
];

/**
 * Default model for SDK queries.
 */
export const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

/**
 * Default working directory for SDK queries.
 */
export const DEFAULT_CWD = "/workspace";

// ============================================================================
// QUERY ORCHESTRATOR CLASS
// ============================================================================

/**
 * Dependencies required by QueryOrchestrator.
 */
export interface QueryOrchestratorDeps {
  sessionManager: SessionManager;
  logger?: Logger;
}

/**
 * Orchestrates SDK query lifecycle including initialization, message processing, and cleanup.
 *
 * @class QueryOrchestrator
 *
 * @description
 * QueryOrchestrator is the core business logic for bridging Socket.IO communication
 * with the Claude Agent SDK. It handles:
 *
 * - Query initialization with proper configuration
 * - Hook setup for SDK event interception
 * - Message stream processing and routing
 * - Error handling and cleanup
 *
 * ## Query Lifecycle
 *
 * 1. **Initialization**: Create MessageStream, AbortController, configure hooks
 * 2. **Start Query**: Call SDK `query()` with all options
 * 3. **Process Messages**: Iterate over SDK messages and route to client
 * 4. **Cleanup**: Reset session state on completion or error
 *
 * @example
 * const orchestrator = new QueryOrchestrator({
 *   sessionManager: new SessionManager(),
 *   logger: customLogger
 * });
 *
 * await orchestrator.start('sandbox-123', socket, {
 *   model: 'claude-sonnet-4-5-20250929',
 *   maxTurns: 10
 * });
 */
export class QueryOrchestrator {
  private sessionManager: SessionManager;
  private log: Logger;

  /**
   * Creates a new QueryOrchestrator instance.
   *
   * @param deps - Dependencies including session manager and optional logger
   */
  constructor(deps: QueryOrchestratorDeps) {
    this.sessionManager = deps.sessionManager;
    this.log = deps.logger || defaultLog;
  }

  /**
   * Starts and manages the SDK query loop for a session.
   *
   * @description
   * Main entry point for query execution. This method:
   *
   * 1. Validates session state
   * 2. Prepares session for query (MessageStream, AbortController)
   * 3. Sets up hook handlers
   * 4. Initializes SDK query with configuration
   * 5. Processes message stream
   * 6. Handles errors and cleanup
   *
   * @param sessionId - The container/sandbox session identifier
   * @param options - SDK query configuration options
   * @returns Promise that resolves when query completes
   */
  async start(sessionId: string, options: ExtendedOptions = {}): Promise<void> {
    const session = this.sessionManager.get(sessionId);
    if (!session) {
      this.log.warn(`startAgentQuery called but no session found for ${sessionId}`);
      return;
    }

    if (session.isQueryRunning) {
      this.log.info(`Query already running, ignoring startAgentQuery`, session.currentSocket.id);
      return;
    }

    this.log.info(`Starting agent query for session ${sessionId}`, session.currentSocket.id);

    // Prepare session for query
    this.sessionManager.prepareForQuery(sessionId);

    // Create emit function bound to current session
    const emitToClient: EmitToClientFn = (event: string, data?: unknown) => {
      const currentSocket = this.sessionManager.getSocket(sessionId);
      if (currentSocket && currentSocket.connected) {
        currentSocket.emit(event, data);
      } else {
        this.log.warn(`Cannot emit ${event}: Socket disconnected for session ${sessionId}`);
      }
    };

    // Create hook handler
    const hookHandler = new HookHandler(
      {
        sessionId,
        getSocket: () => this.sessionManager.getSocket(sessionId),
        abortSignal: session.abortController.signal,
        onSdkSessionId: (sdkSessionId: string) => {
          // Update session's currentSdkSessionId when SDK creates/resumes a session
          const currentSession = this.sessionManager.get(sessionId);
          if (currentSession) {
            console.log(`[SDK SESSION] Updating currentSdkSessionId from ${currentSession.currentSdkSessionId} to ${sdkSessionId}`);
            currentSession.currentSdkSessionId = sdkSessionId;
          }
        }
      },
      this.log
    );

    try {
      // Debug logging for session resumption
      if (options.resume) {
        console.log(`[SDK QUERY] Starting query with RESUME session_id: ${options.resume}`);
      } else {
        console.log(`[SDK QUERY] Starting NEW query (no resume)`);
      }

      // Build query options
      const queryOptions = this.buildQueryOptions(session, options, hookHandler, emitToClient);

      // Initialize the SDK query
      // Use type assertion to work with SDK's internal types
      const q = query({
        prompt: session.messageStream!,
        options: queryOptions as Parameters<typeof query>[0]['options']
      });

      session.queryIterator = q;
      this.log.info("Starting query stream processing...", sessionId);

      // Process message stream
      await this.processMessageStream(q, sessionId, emitToClient);

    } catch (error: unknown) {
      const err = error as Error;
      this.log.error(`Error for session ${sessionId}`, err);
      emitToClient("error", { message: err.message || "An error occurred", details: err });
    } finally {
      // Cleanup
      this.sessionManager.cleanupQuery(sessionId);
    }
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  /**
   * Builds the SDK query options object.
   *
   * @description
   * Returns a plain object with all SDK options. The return type uses `unknown`
   * for the hooks property because the SDK's hook types are complex and
   * we handle them via type assertion at the call site.
   */
  private buildQueryOptions(
    session: { abortController: AbortController },
    options: ExtendedOptions,
    hookHandler: HookHandler,
    emitToClient: EmitToClientFn
  ): Record<string, unknown> {
    return {
      maxTurns: options.maxTurns || Infinity,
      allowedTools: options.allowedTools || DEFAULT_ALLOWED_TOOLS,
      model: options.model || process.env.CLAUDE_MODEL || DEFAULT_MODEL,
      abortController: session.abortController,
      systemPrompt: options.systemPrompt,
      permissionMode: options.permissionMode,
      resume: options.resume,
      maxThinkingTokens: options.maxThinkingTokens,
      includePartialMessages: options.includePartialMessages !== false,
      settingSources: options.settingSources !== undefined ? options.settingSources : ['user', 'project'],
      fallbackModel: options.fallbackModel,
      agents: options.agents,
      mcpServers: options.mcpServers || {},
      strictMcpConfig: options.strictMcpConfig,
      stderr: (data: string) => emitToClient("stderr", data),
      executable: options.executable,
      executableArgs: options.executableArgs,
      env: options.env || process.env,
      cwd: options.cwd || DEFAULT_CWD,
      additionalDirectories: options.additionalDirectories,
      forkSession: options.forkSession,
      continue: options.continue,
      disallowedTools: options.disallowedTools,
      extraArgs: options.extraArgs,
      pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
      permissionPromptToolName: options.permissionPromptToolName,
      hooks: hookHandler.createAllHooks(),
      ...options
    };
  }

  /**
   * Processes the SDK message stream and routes messages to client.
   */
  private async processMessageStream(
    q: AsyncIterable<unknown>,
    sessionId: string,
    emitToClient: EmitToClientFn
  ): Promise<void> {
    let messageCount = 0;

    for await (const message of q) {
      messageCount++;
      const msg = message as Record<string, unknown>;
      const currentSocketId = this.sessionManager.getSocket(sessionId)?.id || sessionId;

      // Log every message from the SDK
      console.log(`[SDK MESSAGE ${messageCount}] type=${msg.type}`);
      this.log.sdkMessage(currentSocketId, msg.type as string, { messageNumber: messageCount });

      // Route message based on type
      this.routeMessage(msg, sessionId, emitToClient, currentSocketId);
    }

    this.log.info(`Query stream completed. Total messages: ${messageCount}`, sessionId);
  }

  /**
   * Routes an SDK message to the appropriate handler.
   */
  private routeMessage(
    message: Record<string, unknown>,
    sessionId: string,
    emitToClient: EmitToClientFn,
    currentSocketId: string
  ): void {
    switch (message.type) {
      case "stream_event":
        this.handleStreamEvent(message, emitToClient, currentSocketId);
        break;

      case "assistant":
        this.handleAssistantMessage(message, sessionId, emitToClient, currentSocketId);
        break;

      case "user":
        this.handleUserMessage(message, emitToClient, currentSocketId);
        break;

      case "system":
        this.handleSystemMessage(message, emitToClient, currentSocketId);
        break;

      case "result":
        this.handleResultMessage(message, emitToClient, currentSocketId);
        break;

      default:
        // Forward any unhandled message types
        this.log.outgoing(currentSocketId, 'sdk_event', { type: message.type });
        emitToClient("sdk_event", message);
        break;
    }
  }

  /**
   * Handles stream_event messages (real-time text deltas).
   */
  private handleStreamEvent(
    message: Record<string, unknown>,
    emitToClient: EmitToClientFn,
    currentSocketId: string
  ): void {
    const event = message.event as Record<string, unknown>;
    console.log(`[STREAM_EVENT] event.type=${event.type}, delta.type=${(event.delta as Record<string, unknown>)?.type}, index=${event.index}`);
    this.log.debug(`Stream event: ${event.type}`, undefined, currentSocketId);

    if (event.type === "content_block_delta") {
      const delta = event.delta as Record<string, unknown>;

      if (delta?.type === "text_delta" && delta?.text) {
        // Text delta: stream to client for real-time display
        const text = delta.text as string;
        console.log(`[STREAMING TEXT] Emitting ${text.length} chars: "${text.substring(0, 30)}..."`);
        this.log.outgoing(currentSocketId, 'stream', { type: 'text', contentLength: text.length });
        emitToClient("stream", { type: "text", content: text });
      } else if (delta?.type === "input_json_delta" && delta?.partial_json) {
        // Tool input streaming
        console.log(`[STREAMING JSON] Tool input delta`);
        emitToClient("stream", { type: "json", content: delta.partial_json });
      } else {
        console.log(`[STREAM_EVENT] Unhandled delta type: ${delta?.type}`);
      }
    } else if (event.type === "content_block_start") {
      console.log(`[STREAM_EVENT] Content block start, index=${event.index}, type=${(event.content_block as Record<string, unknown>)?.type}`);
    } else if (event.type === "content_block_stop") {
      console.log(`[STREAM_EVENT] Content block stop, index=${event.index}`);
    }

    // Forward raw stream event for clients that want full control
    this.log.outgoing(currentSocketId, 'stream_event', { eventType: event.type });
    emitToClient("stream_event", message);
  }

  /**
   * Handles assistant messages (complete responses).
   */
  private handleAssistantMessage(
    message: Record<string, unknown>,
    sessionId: string,
    emitToClient: EmitToClientFn,
    currentSocketId: string
  ): void {
    const assistantMessage = message.message as { content: AssistantContentBlock[] };

    this.log.outgoing(currentSocketId, 'message[assistant]', {
      uuid: message.uuid,
      contentBlocks: Array.isArray(assistantMessage.content) ? assistantMessage.content.length : 1
    });

    // Store assistant message in history
    this.sessionManager.addToHistory(sessionId, {
      role: 'assistant',
      content: assistantMessage.content,
      uuid: message.uuid as string,
      timestamp: Date.now()
    });

    emitToClient("message", {
      role: "assistant",
      content: assistantMessage.content,
      uuid: message.uuid
    });
  }

  /**
   * Handles user message echoes from SDK.
   */
  private handleUserMessage(
    message: Record<string, unknown>,
    emitToClient: EmitToClientFn,
    currentSocketId: string
  ): void {
    const userMessage = message.message as { content: string };

    this.log.outgoing(currentSocketId, 'message[user]', { uuid: message.uuid });
    emitToClient("message", {
      role: "user",
      content: userMessage.content,
      uuid: message.uuid
    });
  }

  /**
   * Handles system messages from SDK.
   */
  private handleSystemMessage(
    message: Record<string, unknown>,
    emitToClient: EmitToClientFn,
    currentSocketId: string
  ): void {
    // Debug logging
    console.log(`[SDK SYSTEM MESSAGE] Full structure:`, JSON.stringify(message, null, 2));

    if (message.subtype === 'compact_boundary') {
      // Compact boundary indicates conversation history was truncated
      this.log.outgoing(currentSocketId, 'compact_boundary', { subtype: message.subtype });
      emitToClient("compact_boundary", message);
    } else if (message.subtype === 'init') {
      // Forward SDK's real session_id via 'message' event
      const sdkSessionId = message.session_id ||
                           (message.data as Record<string, unknown>)?.session_id ||
                           (message as Record<string, unknown>).sessionId;

      console.log(`[SDK INIT] session_id found: ${sdkSessionId}`);

      if (sdkSessionId) {
        this.log.outgoing(currentSocketId, 'message[system/init]', { sdk_session_id: sdkSessionId });
        emitToClient("message", {
          role: "system",
          subtype: "init",
          session_id: sdkSessionId
        });
      } else {
        console.error(`[SDK INIT] WARNING: No session_id found in init message!`);
        emitToClient("system", message);
      }
    } else {
      this.log.outgoing(currentSocketId, 'system', { subtype: message.subtype });
      emitToClient("system", message);
    }
  }

  /**
   * Handles result messages (query completion with metrics).
   */
  private handleResultMessage(
    message: Record<string, unknown>,
    emitToClient: EmitToClientFn,
    currentSocketId: string
  ): void {
    this.log.outgoing(currentSocketId, 'result', {
      costUSD: message.cost_usd,
      durationMs: message.duration_ms
    });
    emitToClient("result", message);
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Creates a QueryOrchestrator with the given dependencies.
 *
 * @param deps - Dependencies including session manager
 * @returns A new QueryOrchestrator instance
 */
export function createQueryOrchestrator(deps: QueryOrchestratorDeps): QueryOrchestrator {
  return new QueryOrchestrator(deps);
}

export default QueryOrchestrator;
