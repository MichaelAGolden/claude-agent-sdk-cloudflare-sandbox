/**
 * @fileoverview Type definitions for Claude Agent SDK Socket.IO Server
 *
 * This module centralizes all TypeScript type definitions used across the
 * agent-sdk server implementation. It includes:
 * - Session state types
 * - Message types with discriminated unions
 * - Socket.IO event type maps
 * - Branded types for type safety
 *
 * @module types
 */

import { Socket } from "socket.io";
import {
  Query,
  SDKUserMessage,
  type Options
} from "@anthropic-ai/claude-agent-sdk";
import type { MessageStream } from "./MessageStream.js";

// ============================================================================
// BRANDED TYPES
// ============================================================================

/**
 * Branded type for container/sandbox session identifiers.
 *
 * @description
 * ContainerSessionId represents the persistent identifier for a client's
 * connection to a specific container/sandbox. This ID remains stable across
 * socket reconnections.
 *
 * Using a branded type prevents accidentally mixing ContainerSessionId with
 * SdkSessionId, which serve different purposes.
 *
 * @example
 * const containerId = createContainerSessionId('sandbox-abc123');
 * // TypeScript will error if you pass this where SdkSessionId is expected
 */
export type ContainerSessionId = string & { readonly __brand: 'ContainerSessionId' };

/**
 * Branded type for SDK conversation session identifiers.
 *
 * @description
 * SdkSessionId represents the Claude Agent SDK's internal session identifier
 * for a conversation thread. This ID is used for session resumption and
 * changes when switching between conversation threads.
 *
 * @example
 * const sdkId = createSdkSessionId('sdk-session-xyz789');
 * // Use this when calling SDK's resume option
 */
export type SdkSessionId = string & { readonly __brand: 'SdkSessionId' };

/**
 * Creates a branded ContainerSessionId from a plain string.
 *
 * @param id - The raw session ID string
 * @returns A branded ContainerSessionId
 */
export function createContainerSessionId(id: string): ContainerSessionId {
  return id as ContainerSessionId;
}

/**
 * Creates a branded SdkSessionId from a plain string.
 *
 * @param id - The raw SDK session ID string
 * @returns A branded SdkSessionId
 */
export function createSdkSessionId(id: string): SdkSessionId {
  return id as SdkSessionId;
}

// ============================================================================
// LOGGING TYPES
// ============================================================================

/**
 * Log severity level for categorizing log entries.
 *
 * @description
 * - `INFO`: Standard operational messages (connections, query starts)
 * - `WARN`: Non-fatal issues that may require attention
 * - `ERROR`: Failures requiring investigation
 * - `DEBUG`: Verbose diagnostic information for troubleshooting
 */
export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

/**
 * Log direction indicating message flow context.
 *
 * @description
 * - `IN`: Messages received from client via Socket.IO
 * - `OUT`: Messages sent to client via Socket.IO
 * - `INTERNAL`: Server-internal operations and SDK interactions
 */
export type LogDirection = 'IN' | 'OUT' | 'INTERNAL';

/**
 * Logger interface for structured logging.
 */
export interface Logger {
  incoming: (socketId: string, event: string, data?: unknown) => void;
  outgoing: (socketId: string, event: string, data?: unknown) => void;
  info: (message: string, socketId?: string) => void;
  warn: (message: string, socketId?: string) => void;
  error: (message: string, error?: unknown, socketId?: string) => void;
  debug: (message: string, data?: unknown, socketId?: string) => void;
  sdkMessage: (socketId: string, messageType: string, details?: unknown) => void;
}

// ============================================================================
// MESSAGE TYPES
// ============================================================================

/**
 * Base interface for stored messages with common properties.
 */
interface BaseStoredMessage {
  /** Optional unique message identifier for deduplication and reference */
  uuid?: string;
  /** Unix timestamp in milliseconds when the message was stored */
  timestamp: number;
}

/**
 * User message stored in conversation history.
 */
export interface UserStoredMessage extends BaseStoredMessage {
  role: 'user';
  content: string;
}

/**
 * Image content block for displaying images in messages.
 *
 * @description
 * Used when the agent creates an image file. The image is uploaded to R2
 * and a URL is generated for display. This enables Claude to "see" the
 * image via the base64 data, while users see it via the URL.
 */
export interface ImageContentBlock {
  type: 'image';
  /** Source information for the image */
  source: {
    /** Always 'base64' for direct image data */
    type: 'base64';
    /** MIME type of the image (e.g., 'image/png', 'image/jpeg') */
    media_type: string;
    /** Base64-encoded image data */
    data: string;
  };
  /** URL to access the image from R2 storage */
  url?: string;
  /** Original file path in the sandbox */
  sandboxPath?: string;
  /** Alt text for accessibility */
  alt?: string;
}

/**
 * Content block types that can appear in assistant messages.
 */
export type AssistantContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: unknown }
  | { type: 'thinking'; thinking: string }
  | ImageContentBlock
  | { type: string; [key: string]: unknown }; // Catch-all for SDK extensions

/**
 * Assistant message stored in conversation history.
 */
export interface AssistantStoredMessage extends BaseStoredMessage {
  role: 'assistant';
  content: AssistantContentBlock[];
}

/**
 * System message stored in conversation history.
 */
export interface SystemStoredMessage extends BaseStoredMessage {
  role: 'system';
  content: unknown;
}

/**
 * Union type for all stored message types.
 *
 * @description
 * StoredMessage captures messages exchanged during a conversation,
 * enabling history replay on reconnection and conversation context management.
 * Using a discriminated union on 'role' enables TypeScript narrowing.
 *
 * @example
 * function processMessage(msg: StoredMessage) {
 *   if (msg.role === 'user') {
 *     // TypeScript knows msg.content is string
 *     console.log(msg.content.toUpperCase());
 *   } else if (msg.role === 'assistant') {
 *     // TypeScript knows msg.content is AssistantContentBlock[]
 *     msg.content.forEach(block => console.log(block.type));
 *   }
 * }
 */
export type StoredMessage = UserStoredMessage | AssistantStoredMessage | SystemStoredMessage;

// ============================================================================
// SESSION TYPES
// ============================================================================

/**
 * Represents the complete state of a client session.
 *
 * @description
 * SessionState encapsulates all stateful information for a connected client,
 * including connection references, SDK query state, and conversation history.
 *
 * ## Session vs SDK Session
 *
 * This interface tracks two distinct identifiers:
 * - `sessionId`: The container/sandbox identifier, stable across reconnects
 * - `currentSdkSessionId`: The SDK's conversation thread ID, changes when switching threads
 *
 * This distinction enables:
 * - A single container to host multiple conversation threads
 * - Thread switching without losing the container session
 * - Proper conversation history isolation between threads
 *
 * @example
 * const session: SessionState = {
 *   sessionId: 'sandbox-abc123',
 *   currentSocket: socket,
 *   queryIterator: null,
 *   messageStream: null,
 *   abortController: new AbortController(),
 *   isQueryRunning: false,
 *   conversationHistory: [],
 *   currentSdkSessionId: null
 * };
 */
export interface SessionState {
  /** Container/sandbox identifier - stable across socket reconnections */
  sessionId: string;

  /** The currently connected Socket.IO socket for this session */
  currentSocket: Socket;

  /**
   * The active SDK query iterator, if a query is running.
   * Null when no query is active.
   */
  queryIterator: Query | null;

  /**
   * The message stream feeding the query's prompt input.
   * Null when no query is active.
   */
  messageStream: MessageStream | null;

  /** AbortController for cancelling the current query */
  abortController: AbortController;

  /** Flag indicating whether the query loop is currently processing */
  isQueryRunning: boolean;

  /**
   * Timeout handle for delayed session cleanup after disconnect.
   * Cleared if client reconnects within the grace period.
   */
  disconnectTimeout?: NodeJS.Timeout;

  /** Array of messages in the current conversation thread */
  conversationHistory: StoredMessage[];

  /**
   * The SDK's session ID for the current conversation thread.
   *
   * @description
   * This is distinct from `sessionId` (container ID). When the frontend
   * requests a different thread via `options.resume`, this value changes
   * and triggers conversation history reset.
   *
   * Null indicates no SDK session has been established yet.
   */
  currentSdkSessionId: string | null;
}

/**
 * Extended options interface for SDK query configuration.
 *
 * @description
 * ExtendedOptions wraps the SDK's Options type, making all properties optional.
 * This interface can be extended with custom server-specific options.
 */
export type ExtendedOptions = Partial<Options>;

// ============================================================================
// SOCKET.IO EVENT TYPES
// ============================================================================

/**
 * Status payload sent to clients for informational messages.
 */
export interface StatusPayload {
  type: 'info' | 'warning' | 'error';
  message: string;
}

/**
 * Message payload for assistant/user/system messages.
 */
export interface MessagePayload {
  role: 'assistant' | 'user' | 'system';
  content: unknown;
  uuid?: string;
  subtype?: string;
  session_id?: string;
}

/**
 * Stream payload for real-time text/JSON streaming.
 */
export interface StreamPayload {
  type: 'text' | 'json';
  content: string;
}

/**
 * Hook request payload sent to client for approval.
 */
export interface HookRequestPayload {
  event: string;
  data: unknown;
}

/**
 * Hook response from client.
 */
export interface HookResponse {
  action?: 'approve' | 'deny' | 'continue';
  reason?: string;
  [key: string]: unknown;
}

/**
 * Error payload sent to clients.
 */
export interface ErrorPayload {
  message: string;
  details?: unknown;
}

/**
 * History payload containing conversation messages.
 */
export interface HistoryPayload {
  messages: StoredMessage[];
}

/**
 * Interrupt complete payload for thread switching.
 */
export interface InterruptCompletePayload {
  threadId: string;
  success: boolean;
  sessionId: string | null;
}

/**
 * Events sent from client to server.
 */
export interface ClientToServerEvents {
  start: (config: ExtendedOptions) => void;
  message: (data: { prompt: string; options?: ExtendedOptions } | string) => void;
  interrupt: (data?: { threadId?: string; reason?: string }) => void;
  get_history: () => void;
  clear: () => void;
  hook_response: (response: HookResponse) => void;
}

/**
 * Image artifact payload for displaying agent-generated images.
 */
export interface ImageArtifactPayload {
  type: 'image';
  /** URL to fetch the image from R2/server */
  url: string;
  /** Original sandbox path where the image was created */
  sandboxPath?: string;
  /** MIME type of the image */
  mimeType: string;
}

/**
 * Represents a file system operation detected from tool execution.
 */
export interface FileOperation {
  /** Type of file operation */
  type: 'create' | 'modify' | 'delete' | 'rename' | 'mkdir';
  /** Path affected by the operation */
  path: string;
  /** New path for rename/move operations */
  newPath?: string;
}

/**
 * Payload for file_changed events sent to the file explorer UI.
 */
export interface FileChangedPayload {
  /** List of file operations detected */
  operations: FileOperation[];
  /** Session ID for context */
  sessionId: string;
}

/**
 * Events sent from server to client.
 */
export interface ServerToClientEvents {
  status: (payload: StatusPayload) => void;
  message: (payload: MessagePayload) => void;
  stream: (payload: StreamPayload) => void;
  stream_event: (payload: unknown) => void;
  hook_request: (payload: HookRequestPayload, callback: (response: HookResponse) => void) => void;
  hook_notification: (payload: HookRequestPayload) => void;
  error: (payload: ErrorPayload) => void;
  history: (payload: HistoryPayload) => void;
  cleared: (payload: StatusPayload) => void;
  result: (payload: unknown) => void;
  sdk_event: (payload: unknown) => void;
  system: (payload: unknown) => void;
  compact_boundary: (payload: unknown) => void;
  interrupt_complete: (payload: InterruptCompletePayload) => void;
  stderr: (data: string) => void;
  /** Emitted when the agent creates an image artifact */
  image_artifact: (payload: ImageArtifactPayload) => void;
  /** Emitted when the agent creates, modifies, or deletes files */
  file_changed: (payload: FileChangedPayload) => void;
}

/**
 * Inter-server events (for Socket.IO clustering, if needed).
 */
export interface InterServerEvents {
  ping: () => void;
}

/**
 * Socket data attached to each connection.
 */
export interface SocketData {
  sessionId: string;
}

// ============================================================================
// HOOK TYPES
// ============================================================================

/**
 * Configuration for a hook handler.
 */
export interface HookConfig {
  /** The SDK hook event name */
  eventName: string;
  /** Timeout in milliseconds for client response */
  timeoutMs: number;
  /** Whether to auto-approve without client interaction (e.g., PostToolUse) */
  autoApprove: boolean;
}

/**
 * Context provided to hook handlers.
 */
export interface HookContext {
  /** The container session ID */
  sessionId: string;
  /** Function to get the current socket (may change on reconnect) */
  getSocket: () => Socket | undefined;
  /** Abort signal for cancellation */
  abortSignal: AbortSignal;
  /** Callback when SDK session ID is captured from hook events */
  onSdkSessionId: (id: string) => void;
}

/**
 * Function signature for hook handlers.
 */
export type HookHandler = (input: unknown) => Promise<HookResponse>;

// ============================================================================
// SDK MESSAGE TYPES (for exhaustive switch handling)
// ============================================================================

/**
 * Stream event message from SDK.
 */
export interface StreamEventMessage {
  type: 'stream_event';
  event: {
    type: string;
    delta?: {
      type: string;
      text?: string;
      partial_json?: string;
    };
    index?: number;
    content_block?: {
      type: string;
    };
  };
}

/**
 * Assistant message from SDK.
 */
export interface AssistantMessage {
  type: 'assistant';
  message: {
    content: AssistantContentBlock[];
  };
  uuid: string;
}

/**
 * User message from SDK.
 */
export interface UserMessage {
  type: 'user';
  message: {
    content: string;
  };
  uuid: string;
}

/**
 * System message from SDK.
 */
export interface SystemMessage {
  type: 'system';
  subtype?: string;
  session_id?: string;
  data?: {
    session_id?: string;
  };
}

/**
 * Result message from SDK.
 */
export interface ResultMessage {
  type: 'result';
  cost_usd?: number;
  duration_ms?: number;
}

/**
 * Union of all SDK message types.
 *
 * @description
 * Using a discriminated union on 'type' enables TypeScript's exhaustive
 * checking in switch statements.
 *
 * @example
 * function processSDKMessage(msg: SDKMessage) {
 *   switch (msg.type) {
 *     case 'stream_event': // handle streaming
 *     case 'assistant': // handle assistant
 *     case 'user': // handle user
 *     case 'system': // handle system
 *     case 'result': // handle result
 *     default: assertNever(msg); // TypeScript error if case missing
 *   }
 * }
 */
export type SDKMessage =
  | StreamEventMessage
  | AssistantMessage
  | UserMessage
  | SystemMessage
  | ResultMessage
  | { type: string; [key: string]: unknown }; // Catch-all for future SDK additions

/**
 * Helper for exhaustive switch checking.
 *
 * @param x - Should be of type `never` if all cases handled
 * @throws Error if called (indicates unhandled case)
 *
 * @example
 * switch (message.type) {
 *   case 'a': return handleA();
 *   case 'b': return handleB();
 *   default: return assertNever(message); // Error if message.type could be 'c'
 * }
 */
export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(x)}`);
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Function type for emitting events to client.
 */
export type EmitToClientFn = (event: string, data?: unknown) => void;

/**
 * Session manager interface for dependency injection.
 */
export interface ISessionManager {
  get(sessionId: string): SessionState | undefined;
  create(sessionId: string, socket: Socket): SessionState;
  update(sessionId: string, updates: Partial<SessionState>): void;
  delete(sessionId: string): void;
  getSocket(sessionId: string): Socket | undefined;
}

// Re-export SDK types that are used externally
export type { SDKUserMessage, Query, Options };
