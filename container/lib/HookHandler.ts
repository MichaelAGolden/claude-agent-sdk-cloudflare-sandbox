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
import type { HookContext, HookResponse, Logger } from './types.js';
import { log as defaultLog } from './logger.js';

// ============================================================================
// IMAGE DETECTION UTILITIES
// ============================================================================

/**
 * Supported image file extensions.
 */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

/**
 * Paths where the agent typically creates output files.
 */
const ARTIFACT_PATHS = ['/workspace', '/tmp'];

/**
 * Checks if a file path is an image based on extension.
 */
function isImageFile(filePath: string): boolean {
  const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Checks if a path is within allowed artifact directories.
 */
function isInArtifactPath(filePath: string): boolean {
  return ARTIFACT_PATHS.some(prefix => filePath.startsWith(prefix));
}

/**
 * Extracts image file paths from PostToolUse hook data.
 *
 * Only extracts paths for images that were actually CREATED, not just mentioned.
 * For Bash commands, we look for specific patterns that indicate file creation
 * rather than just any path that appears in output.
 */
function extractImagePaths(hookData: unknown): string[] {
  const data = hookData as Record<string, unknown>;
  const imagePaths: string[] = [];

  if (!data) return imagePaths;

  const toolName = data.tool_name as string;
  const toolInput = data.tool_input as Record<string, unknown>;
  const toolResult = data.tool_result as string;

  // Check Write tool - this is a definite file creation
  if (toolName === 'Write' && toolInput?.file_path) {
    const filePath = toolInput.file_path as string;
    if (isImageFile(filePath) && isInArtifactPath(filePath)) {
      imagePaths.push(filePath);
    }
  }

  // Check Bash tool - only look for specific creation patterns
  // We need to be careful here to avoid false positives from paths that
  // are just mentioned in output (e.g., error messages, ls output)
  if (toolName === 'Bash' && toolResult) {
    const command = (toolInput?.command as string) || '';

    // Only check for image creation if the command looks like it creates files
    // Common patterns: python scripts that save images, imagemagick convert, etc.
    const likelyCreatesImages =
      command.includes('savefig') ||
      command.includes('imsave') ||
      command.includes('save(') ||
      command.includes('convert ') ||
      command.includes('matplotlib') ||
      command.includes('pillow') ||
      command.includes('PIL') ||
      command.includes('.png') ||
      command.includes('.jpg') ||
      command.includes('> /') ||  // Redirect to file
      command.includes('tee ');

    if (likelyCreatesImages) {
      // Look for paths in output that indicate successful file creation
      // Patterns like "Saved to /workspace/image.png" or just the path on its own line
      const pathMatches = toolResult.match(/\/(?:workspace|tmp)\/[^\s'"<>|]+\.(?:png|jpg|jpeg|gif|webp|svg)/gi);
      if (pathMatches) {
        for (const match of pathMatches) {
          // Additional validation: make sure it's not in an error context
          const lowerResult = toolResult.toLowerCase();
          const isError = lowerResult.includes('error') ||
                          lowerResult.includes('not found') ||
                          lowerResult.includes('no such file') ||
                          lowerResult.includes('failed');

          // Only add if the result doesn't look like an error
          if (!isError && isInArtifactPath(match)) {
            imagePaths.push(match);
          }
        }
      }
    }
  }

  return [...new Set(imagePaths)]; // Deduplicate
}

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
      const toolName = inputObj?.tool_name || 'unknown';

      console.log(`[HOOK ENTRY] ${eventName} for ${toolName}, socket=${socket?.id || 'null'}, connected=${socket?.connected}`);

      // Capture SDK session ID from hook event data
      this.captureSessionId(inputObj, eventName, socket);

      // Check if session is aborted
      if (this.context.abortSignal.aborted) {
        console.log(`[HOOK ABORT] ${eventName} - session aborted`);
        return {};
      }

      // Handle disconnected socket
      if (!socket || !socket.connected) {
        console.warn(`[HOOK SKIP] ${eventName} - socket disconnected or null`);
        this.log.warn(`Skipping hook ${eventName} (socket disconnected)`, this.context.sessionId);
        return {};
      }

      // Use strategy based on hook type
      if (AUTO_CONTINUE_HOOKS.has(eventName)) {
        console.log(`[HOOK AUTO] ${eventName} - using auto-continue strategy`);
        return this.handleAutoContinueHook(eventName, input, socket);
      }

      console.log(`[HOOK REQUEST] ${eventName} - using request-response strategy`);
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
   * For PostToolUse, also checks for image artifacts.
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

    // Check for image artifacts in PostToolUse events
    if (eventName === 'PostToolUse') {
      this.detectAndEmitImagePaths(input, socket);
    }

    return { action: 'continue' };
  }

  /**
   * Detects image artifacts from tool execution and emits paths.
   *
   * The container only detects the paths - the Cloudflare Worker handles
   * reading from sandbox, uploading to R2, and serving the images.
   */
  private detectAndEmitImagePaths(input: unknown, socket: Socket): void {
    try {
      const imagePaths = extractImagePaths(input);

      if (imagePaths.length === 0) {
        return;
      }

      console.log(`[HookHandler] Detected ${imagePaths.length} image(s):`, imagePaths);

      // Emit each image path - the worker will handle upload to R2
      for (const filePath of imagePaths) {
        socket.emit("image_created", {
          sandboxPath: filePath,
          sessionId: this.context.sessionId,
        });
      }
    } catch (error) {
      console.error('[HookHandler] Error detecting image paths:', error);
    }
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
    const inputObj = input as Record<string, unknown> | null;
    const toolName = inputObj?.tool_name || 'unknown';
    const hookId = `${eventName}-${Date.now()}`;

    console.log(`[HOOK ${hookId}] START: ${eventName} for tool=${toolName}`);
    console.log(`[HOOK ${hookId}] Socket state: connected=${socket.connected}, id=${socket.id}`);

    this.log.debug(
      `Hook triggered: ${eventName}`,
      { inputKeys: Object.keys((input as object) || {}) },
      socket.id
    );

    const startTime = Date.now();

    try {
      const response = await new Promise<HookResponse>((resolve) => {
        // Progress logging - log every 5 seconds while waiting
        let progressCount = 0;
        const progressInterval = setInterval(() => {
          progressCount++;
          const elapsed = Date.now() - startTime;
          const socketNow = this.context.getSocket();
          console.warn(`[HOOK ${hookId}] WAITING ${progressCount * 5}s (${elapsed}ms elapsed), socket=${socketNow?.id || 'null'}, connected=${socketNow?.connected}`);
        }, 5000);

        // Timeout handler
        const timeout = setTimeout(() => {
          const elapsed = Date.now() - startTime;
          console.error(`[HOOK ${hookId}] TIMEOUT after ${elapsed}ms (limit=${timeoutMs}ms)`);
          this.log.warn(`Hook ${eventName} timed out after ${timeoutMs}ms`, this.context.sessionId);
          cleanup();
          resolve({});
        }, timeoutMs);

        // Disconnect handler
        const onDisconnect = () => {
          const elapsed = Date.now() - startTime;
          console.error(`[HOOK ${hookId}] DISCONNECT after ${elapsed}ms`);
          this.log.warn(`Client disconnected while waiting for hook ${eventName}`, this.context.sessionId);
          cleanup();
          resolve({});
        };
        socket.once('disconnect', onDisconnect);

        // Cleanup function
        const cleanup = () => {
          clearInterval(progressInterval);
          clearTimeout(timeout);
          socket.off('disconnect', onDisconnect);
        };

        // Emit hook request with callback
        console.log(`[HOOK ${hookId}] EMITTING hook_request to client...`);
        this.log.outgoing(
          socket.id,
          'hook_request',
          { event: eventName, dataKeys: Object.keys((input as object) || {}) }
        );

        socket.emit(
          "hook_request",
          { event: eventName, data: input },
          (clientResponse: HookResponse) => {
            const elapsed = Date.now() - startTime;
            console.log(`[HOOK ${hookId}] CALLBACK received after ${elapsed}ms:`, JSON.stringify(clientResponse));
            cleanup();
            this.log.incoming(socket.id, `hook_response[${eventName}]`, clientResponse);
            resolve(clientResponse || {});
          }
        );

        console.log(`[HOOK ${hookId}] hook_request emitted, waiting for callback...`);
      });

      const totalTime = Date.now() - startTime;
      console.log(`[HOOK ${hookId}] COMPLETE in ${totalTime}ms, response:`, JSON.stringify(response));
      return response;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.error(`[HOOK ${hookId}] ERROR after ${elapsed}ms:`, error);
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
