/**
 * @fileoverview SDK Hook handling for Claude Agent SDK Server
 *
 * This module implements hook handlers for SDK lifecycle events. It uses
 * the Strategy pattern to handle different hook types (PreToolUse, PostToolUse,
 * etc.) with appropriate behaviors.
 *
 * @module HookHandler
 */

import { Socket } from "socket.io";
import type { HookContext, HookResponse, Logger } from './types';
import { log as defaultLog } from './logger';

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Default timeout for hook responses from client (5 minutes).
 */
export const DEFAULT_HOOK_TIMEOUT_MS = 300000;

/**
 * Hook events that auto-continue without waiting for client response.
 */
export const AUTO_CONTINUE_HOOKS = new Set(['PostToolUse']);

// ============================================================================
// HOOK HANDLER CLASS
// ============================================================================

/**
 * Creates and manages SDK hook handlers for a session.
 *
 * @class HookHandler
 *
 * @description
 * HookHandler implements the Strategy pattern for handling different SDK
 * lifecycle events. Each hook type has specific behavior:
 *
 * - **PreToolUse**: Requires client approval before tool execution
 * - **PostToolUse**: Notifies client but auto-continues (no approval needed)
 * - **Other hooks**: Request-response pattern with configurable timeout
 *
 * ## Hook Flow
 *
 * ```
 * SDK calls hook -> HookHandler captures SDK session ID ->
 * If PostToolUse: emit notification, return continue ->
 * Otherwise: emit hook_request, wait for callback ->
 * Return response to SDK
 * ```
 *
 * ## Session ID Capture
 *
 * A critical responsibility is capturing the SDK's session_id from hook events
 * and forwarding it to the frontend. This ID is required for session resumption.
 *
 * @example
 * const handler = new HookHandler({
 *   sessionId: 'sandbox-123',
 *   getSocket: () => sessionManager.getSocket('sandbox-123'),
 *   abortSignal: abortController.signal,
 *   onSdkSessionId: (id) => {
 *     socket.emit("message", { role: "system", subtype: "init", session_id: id });
 *   }
 * });
 *
 * // Create hooks for SDK options
 * const hooks = {
 *   PreToolUse: [{ hooks: [handler.createHook('PreToolUse')] }],
 *   PostToolUse: [{ hooks: [handler.createHook('PostToolUse')] }],
 *   // ...
 * };
 */
export class HookHandler {
  private context: HookContext;
  private log: Logger;
  private sdkSessionIdSent = false;

  /**
   * Creates a new HookHandler instance.
   *
   * @param context - The hook context containing session info and callbacks
   * @param logger - Optional custom logger
   */
  constructor(context: HookContext, logger: Logger = defaultLog) {
    this.context = context;
    this.log = logger;
  }

  /**
   * Resets the SDK session ID sent flag.
   *
   * @description
   * Call this when starting a new query to ensure the session ID
   * is captured and forwarded again.
   */
  resetSessionIdCapture(): void {
    this.sdkSessionIdSent = false;
  }

  /**
   * Creates a hook handler function for the specified event type.
   *
   * @description
   * Returns an async function that can be passed to the SDK's hooks configuration.
   * The handler:
   *
   * 1. Captures SDK session ID from hook data and forwards to frontend
   * 2. Returns early if session is aborted
   * 3. For PostToolUse: notifies client and auto-continues
   * 4. For other hooks: uses request-response pattern with timeout
   *
   * @param eventName - The SDK hook event name
   * @param timeoutMs - Timeout for client response (default: 5 minutes)
   * @returns Async hook handler function
   *
   * @example
   * const preToolUseHook = handler.createHook('PreToolUse');
   * const result = await preToolUseHook({ tool_name: 'Bash', tool_input: {...} });
   */
  createHook(eventName: string, timeoutMs: number = DEFAULT_HOOK_TIMEOUT_MS): (input: unknown) => Promise<HookResponse> {
    return async (input: unknown): Promise<HookResponse> => {
      const socket = this.context.getSocket();
      const inputObj = input as Record<string, unknown> | null;

      // Capture SDK session ID from hook event data
      this.captureSessionId(inputObj, eventName, socket);

      // Check if session is aborted
      if (this.context.abortSignal.aborted) {
        return {};
      }

      // Handle disconnected socket
      if (!socket || !socket.connected) {
        this.log.warn(`Skipping hook ${eventName} (socket disconnected)`, this.context.sessionId);
        return {};
      }

      // Use strategy based on hook type
      if (AUTO_CONTINUE_HOOKS.has(eventName)) {
        return this.handleAutoContinueHook(eventName, input, socket);
      }

      return this.handleRequestResponseHook(eventName, input, socket, timeoutMs);
    };
  }

  /**
   * Creates all standard SDK hooks.
   *
   * @description
   * Convenience method that creates handlers for all SDK hook events.
   *
   * @returns Object containing all hook configurations for SDK options
   */
  createAllHooks(): Record<string, Array<{ hooks: Array<(input: unknown) => Promise<HookResponse>> }>> {
    const hookNames = [
      'PreToolUse',
      'PostToolUse',
      'Notification',
      'UserPromptSubmit',
      'SessionStart',
      'SessionEnd',
      'Stop',
      'SubagentStop',
      'PreCompact'
    ];

    const hooks: Record<string, Array<{ hooks: Array<(input: unknown) => Promise<HookResponse>> }>> = {};

    for (const name of hookNames) {
      hooks[name] = [{ hooks: [this.createHook(name)] }];
    }

    return hooks;
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  /**
   * Captures the SDK session ID from hook input and forwards to frontend.
   */
  private captureSessionId(
    input: Record<string, unknown> | null,
    eventName: string,
    socket: Socket | undefined
  ): void {
    if (!input?.session_id || this.sdkSessionIdSent || !socket?.connected) {
      return;
    }

    const sdkSessionId = input.session_id as string;
    console.log(`[SDK SESSION] Captured SDK session_id from ${eventName} hook: ${sdkSessionId}`);

    this.log.outgoing(socket.id, 'message[system/init]', { sdk_session_id: sdkSessionId });

    // Emit the session ID to frontend
    socket.emit("message", {
      role: "system",
      subtype: "init",
      session_id: sdkSessionId
    });

    this.sdkSessionIdSent = true;

    // Notify callback
    this.context.onSdkSessionId(sdkSessionId);
  }

  /**
   * Handles hooks that auto-continue without waiting for client response.
   */
  private handleAutoContinueHook(
    eventName: string,
    input: unknown,
    socket: Socket
  ): HookResponse {
    this.log.outgoing(
      socket.id,
      'hook_notification',
      { event: eventName, dataKeys: Object.keys((input as object) || {}) }
    );

    socket.emit("hook_notification", { event: eventName, data: input });

    return { action: 'continue' };
  }

  /**
   * Handles hooks using request-response pattern with timeout.
   */
  private async handleRequestResponseHook(
    eventName: string,
    input: unknown,
    socket: Socket,
    timeoutMs: number
  ): Promise<HookResponse> {
    this.log.debug(
      `Hook triggered: ${eventName}`,
      { inputKeys: Object.keys((input as object) || {}) },
      socket.id
    );

    try {
      const response = await new Promise<HookResponse>((resolve) => {
        // Timeout handler
        const timeout = setTimeout(() => {
          this.log.warn(`Hook ${eventName} timed out after ${timeoutMs}ms`, this.context.sessionId);
          cleanup();
          resolve({});
        }, timeoutMs);

        // Disconnect handler
        const onDisconnect = () => {
          this.log.warn(`Client disconnected while waiting for hook ${eventName}`, this.context.sessionId);
          cleanup();
          resolve({});
        };
        socket.once('disconnect', onDisconnect);

        // Cleanup function
        const cleanup = () => {
          clearTimeout(timeout);
          socket.off('disconnect', onDisconnect);
        };

        // Emit hook request with callback
        this.log.outgoing(
          socket.id,
          'hook_request',
          { event: eventName, dataKeys: Object.keys((input as object) || {}) }
        );

        socket.emit(
          "hook_request",
          { event: eventName, data: input },
          (clientResponse: HookResponse) => {
            cleanup();
            this.log.incoming(socket.id, `hook_response[${eventName}]`, clientResponse);
            resolve(clientResponse || {});
          }
        );
      });

      return response;
    } catch (error) {
      this.log.error(`Error in hook ${eventName}`, error, this.context.sessionId);
      return {};
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Creates a HookHandler with the given context.
 *
 * @param context - The hook context
 * @param logger - Optional custom logger
 * @returns A new HookHandler instance
 */
export function createHookHandler(context: HookContext, logger?: Logger): HookHandler {
  return new HookHandler(context, logger);
}

export default HookHandler;
