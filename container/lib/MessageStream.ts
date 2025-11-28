/**
 * @fileoverview Asynchronous message queue for streaming user messages to SDK
 *
 * This module implements a producer-consumer pattern for delivering user messages
 * to the Claude Agent SDK's query function. It implements the AsyncIterable interface,
 * allowing the SDK to consume messages using `for await...of` syntax.
 *
 * @module MessageStream
 */

import type { SDKUserMessage, Logger } from './types';
import { log as defaultLog } from './logger';

// ============================================================================
// MESSAGE STREAM CLASS
// ============================================================================

/**
 * Asynchronous message queue for streaming user messages to the SDK query loop.
 *
 * @class MessageStream
 * @implements {AsyncIterable<T>}
 * @template T - The message type (defaults to SDKUserMessage)
 *
 * @classdesc
 * MessageStream provides a producer-consumer pattern for delivering user messages
 * to the Claude Agent SDK's query function. It implements the AsyncIterable interface,
 * allowing the SDK to consume messages using `for await...of` syntax.
 *
 * ## Design Pattern
 *
 * The class uses a hybrid queue/promise approach:
 * - When the consumer is waiting (`resolvers` array has entries), new messages
 *   are delivered directly by resolving the pending promise
 * - When the consumer is busy processing, messages are queued for later delivery
 * - When `finish()` is called, all pending consumers receive `done: true`
 *
 * ## Usage Flow
 *
 * ```typescript
 * const stream = new MessageStream<SDKUserMessage>();
 *
 * // Consumer (SDK query loop)
 * for await (const message of stream) {
 *   await processMessage(message);
 * }
 *
 * // Producer (Socket.IO message handler)
 * stream.push(userMessage);
 *
 * // Cleanup
 * stream.finish();
 * ```
 *
 * ## Thread Safety
 *
 * This implementation is designed for single-threaded Node.js execution.
 * The queue and resolvers arrays are not protected by locks, which is safe
 * because Node.js processes events sequentially.
 *
 * @example
 * // Create stream for a new session
 * const messageStream = new MessageStream();
 *
 * // Pass to SDK query
 * const q = query({ prompt: messageStream, options: {...} });
 *
 * // Push user message when received from client
 * messageStream.push({
 *   type: 'user',
 *   session_id: 'abc123',
 *   message: { role: 'user', content: 'Hello!' },
 *   parent_tool_use_id: null
 * });
 *
 * // Signal end of conversation
 * messageStream.finish();
 */
export class MessageStream<T = SDKUserMessage> implements AsyncIterable<T> {
  /**
   * Internal queue holding messages when no consumer is waiting.
   */
  private queue: T[] = [];

  /**
   * Array of Promise resolve functions for waiting consumers.
   *
   * @description
   * When the async iterator's `next()` method is called and the queue is empty,
   * a new Promise is created and its resolver is stored here. When a message
   * arrives via `push()`, the first resolver is called to deliver the message.
   */
  private resolvers: ((value: IteratorResult<T>) => void)[] = [];

  /**
   * Flag indicating whether the stream has been terminated.
   *
   * @description
   * Once `finish()` is called, this flag prevents new messages from being
   * queued and signals the iterator to return `done: true`.
   */
  private finished = false;

  /**
   * Logger instance for debug output.
   */
  private log: Logger;

  /**
   * Creates a new MessageStream instance.
   *
   * @param logger - Optional custom logger (defaults to standard logger)
   *
   * @example
   * const stream = new MessageStream();
   *
   * // With custom logger for testing
   * const testStream = new MessageStream(mockLogger);
   */
  constructor(logger: Logger = defaultLog) {
    this.log = logger;
  }

  /**
   * Adds a user message to the stream for delivery to the SDK.
   *
   * @description
   * If a consumer is waiting (iterator's `next()` was called but no message
   * was available), the message is delivered immediately by resolving the
   * pending promise. Otherwise, the message is queued for later delivery.
   *
   * Messages pushed after `finish()` is called are silently ignored with
   * a warning log.
   *
   * @param message - The message to add to the stream
   * @param socketId - Optional socket ID for logging correlation
   *
   * @example
   * // Push a simple user message
   * stream.push({
   *   type: 'user',
   *   session_id: 'session-123',
   *   message: { role: 'user', content: 'What is 2+2?' },
   *   parent_tool_use_id: null
   * });
   */
  push(message: T, socketId?: string): void {
    this.log.debug(
      `MessageStream.push() called`,
      { type: (message as any).type, queueLength: this.queue.length },
      socketId
    );

    if (this.finished) {
      this.log.warn(`MessageStream.push() ignored - stream already finished`, socketId);
      return;
    }

    if (this.resolvers.length > 0) {
      this.log.debug(`MessageStream: resolving waiting consumer`, undefined, socketId);
      const resolve = this.resolvers.shift()!;
      resolve({ value: message, done: false });
    } else {
      this.log.debug(
        `MessageStream: queuing message (queue size: ${this.queue.length + 1})`,
        undefined,
        socketId
      );
      this.queue.push(message);
    }
  }

  /**
   * Terminates the stream, signaling completion to all consumers.
   *
   * @description
   * When called, this method:
   * 1. Sets the `finished` flag to prevent new messages
   * 2. Resolves all pending iterator promises with `done: true`
   * 3. Subsequent `push()` calls will be ignored
   * 4. Subsequent iterator `next()` calls will immediately return `done: true`
   *
   * This should be called when:
   * - The user explicitly ends the conversation
   * - The session is being cleaned up
   * - An error requires terminating the message flow
   *
   * @example
   * // Signal end of conversation
   * stream.finish();
   *
   * // After finish(), push is ignored
   * stream.push(message); // Warning logged, message discarded
   */
  finish(): void {
    this.finished = true;
    while (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve({ value: undefined as unknown as T, done: true });
    }
  }

  /**
   * Returns whether the stream has been finished.
   *
   * @returns True if finish() has been called
   */
  isFinished(): boolean {
    return this.finished;
  }

  /**
   * Returns the current queue length.
   *
   * @returns Number of messages waiting in the queue
   */
  queueLength(): number {
    return this.queue.length;
  }

  /**
   * Clears all pending messages from the queue.
   *
   * @description
   * Removes all queued messages without delivering them. Does not affect
   * the finished state. Useful for resetting state during thread switches.
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * Returns an async iterator for consuming messages from the stream.
   *
   * @description
   * Implements the AsyncIterable protocol, allowing the stream to be consumed
   * using `for await...of` syntax. The iterator:
   *
   * - Returns queued messages immediately if available
   * - Returns `done: true` immediately if stream is finished
   * - Creates a pending Promise if queue is empty and stream is active
   *
   * @returns An async iterator yielding messages
   *
   * @example
   * // Consume all messages until stream finishes
   * for await (const message of stream) {
   *   console.log('Received:', message.message.content);
   * }
   * console.log('Stream ended');
   */
  [Symbol.asyncIterator](): AsyncIterator<T> {
    const self = this;
    return {
      /**
       * Retrieves the next message from the stream.
       *
       * @returns Promise resolving to the next message or done signal
       */
      next: (): Promise<IteratorResult<T>> => {
        self.log.debug(
          `MessageStream.next() called`,
          { queueLength: self.queue.length, finished: self.finished }
        );

        if (self.queue.length > 0) {
          self.log.debug(`MessageStream: yielding from queue (remaining: ${self.queue.length - 1})`);
          return Promise.resolve({ value: self.queue.shift()!, done: false });
        }

        if (self.finished) {
          self.log.debug(`MessageStream: iterator finished`);
          return Promise.resolve({ value: undefined as unknown as T, done: true });
        }

        self.log.debug(`MessageStream: waiting for next message`);
        return new Promise<IteratorResult<T>>((resolve) => {
          self.resolvers.push(resolve);
        });
      }
    };
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Creates a new MessageStream instance with default SDK message type.
 *
 * @param logger - Optional custom logger
 * @returns A new MessageStream<SDKUserMessage> instance
 *
 * @example
 * const stream = createMessageStream();
 * stream.push(userMessage);
 */
export function createMessageStream(logger?: Logger): MessageStream<SDKUserMessage> {
  return new MessageStream<SDKUserMessage>(logger);
}

export default MessageStream;
