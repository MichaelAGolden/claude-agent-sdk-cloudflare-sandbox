/**
 * @fileoverview Structured logging utilities for Claude Agent SDK Server
 *
 * This module provides categorized logging methods that output structured JSON
 * for easy parsing by log aggregation systems (CloudWatch, Datadog, etc.).
 *
 * All log methods include:
 * - Timestamp in ISO 8601 format
 * - Log level (INFO, WARN, ERROR, DEBUG)
 * - Direction indicator for message flow tracing
 * - Optional socket ID for request correlation
 *
 * @module logger
 */

import type { Socket } from 'socket.io';
import type { LogLevel, LogDirection, Logger } from './types.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Maximum string length before truncation in log output.
 * Prevents log bloat from large message payloads.
 */
const MAX_STRING_LENGTH = 200;

/**
 * Global socket reference for emitting logs to connected clients.
 * This allows container logs to be forwarded through Socket.IO to the worker.
 */
let globalSocket: Socket | null = null;

/**
 * Sets the global socket for log forwarding.
 * Call this when a socket connects to enable live log streaming.
 */
export function setLogSocket(socket: Socket | null): void {
  globalSocket = socket;
}

/**
 * Gets the current log socket.
 */
export function getLogSocket(): Socket | null {
  return globalSocket;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generates an ISO 8601 timestamp for log entries.
 *
 * @returns Current timestamp in ISO 8601 format (e.g., "2024-01-15T10:30:00.000Z")
 *
 * @example
 * const timestamp = getTimestamp();
 * console.log(timestamp); // "2024-01-15T10:30:00.123Z"
 */
export const getTimestamp = (): string => {
  return new Date().toISOString();
};

/**
 * JSON replacer function that truncates long strings to prevent log bloat.
 *
 * @description
 * Used as the replacer argument in JSON.stringify() for log output. Strings
 * exceeding MAX_STRING_LENGTH characters are truncated with an indicator
 * showing the original length.
 *
 * @param key - The JSON key being processed
 * @param value - The value to potentially truncate
 * @returns Original value if not a long string, otherwise truncated string
 *
 * @example
 * const longText = "a".repeat(500);
 * const result = truncateStrings("content", longText);
 * // Returns: "aaaa... [truncated, 500 chars total]"
 */
export function truncateStrings(key: string, value: unknown): unknown {
  if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
    return value.substring(0, MAX_STRING_LENGTH) + `... [truncated, ${value.length} chars total]`;
  }
  return value;
}

// ============================================================================
// LOG ENTRY TYPES
// ============================================================================

/**
 * Structure of a log entry for JSON serialization.
 */
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  direction: LogDirection;
  socketId?: string;
  event?: string;
  message?: string;
  data?: unknown;
  error?: unknown;
  details?: unknown;
}

/**
 * Internal helper to write a log entry.
 * Also emits to connected socket for live log forwarding.
 *
 * @param entry - The log entry to write
 */
function writeLog(entry: LogEntry): void {
  const logStr = JSON.stringify(entry, truncateStrings);
  console.log(logStr);

  // Forward important logs via Socket.IO for live streaming to worker/frontend
  // Forward: errors, warnings, hook events, SDK messages, and key connection events
  if (globalSocket?.connected) {
    const event = entry.event || '';
    const message = entry.message || '';

    const shouldForward = entry.level === 'ERROR' ||
                          entry.level === 'WARN' ||
                          event.includes('hook') ||
                          event.startsWith('SDK_MSG') ||
                          message.includes('connected') ||
                          message.includes('Query') ||
                          message.includes('session');

    if (shouldForward) {
      globalSocket.emit('container_log', entry);
    }
  }
}

// ============================================================================
// LOGGER IMPLEMENTATION
// ============================================================================

/**
 * Structured logging utility for consistent JSON-formatted log output.
 *
 * @description
 * Provides categorized logging methods that output structured JSON for easy parsing
 * by log aggregation systems. Long strings (>200 chars) are automatically truncated.
 *
 * @example
 * // Log incoming message from client
 * log.incoming(socket.id, 'message', { prompt: 'Hello' });
 *
 * // Log outgoing event to client
 * log.outgoing(socket.id, 'stream', { type: 'text', length: 150 });
 *
 * // Log internal operation
 * log.info('Session created', socket.id);
 *
 * // Log error with details
 * log.error('Query failed', error, socket.id);
 */
export const log: Logger = {
  /**
   * Logs incoming events from Socket.IO clients.
   *
   * @param socketId - The Socket.IO socket identifier
   * @param event - Name of the incoming event
   * @param data - Optional event payload data
   */
  incoming: (socketId: string, event: string, data?: unknown): void => {
    writeLog({
      timestamp: getTimestamp(),
      level: 'INFO',
      direction: 'IN',
      socketId,
      event,
      data
    });
  },

  /**
   * Logs outgoing events to Socket.IO clients.
   *
   * @param socketId - The Socket.IO socket identifier
   * @param event - Name of the outgoing event
   * @param data - Optional event payload data
   */
  outgoing: (socketId: string, event: string, data?: unknown): void => {
    writeLog({
      timestamp: getTimestamp(),
      level: 'INFO',
      direction: 'OUT',
      socketId,
      event,
      data
    });
  },

  /**
   * Logs informational messages for standard operations.
   *
   * @param message - Descriptive message
   * @param socketId - Optional socket ID for correlation
   */
  info: (message: string, socketId?: string): void => {
    writeLog({
      timestamp: getTimestamp(),
      level: 'INFO',
      direction: 'INTERNAL',
      socketId,
      message
    });
  },

  /**
   * Logs warning conditions that don't prevent operation but may need attention.
   *
   * @param message - Warning description
   * @param socketId - Optional socket ID for correlation
   */
  warn: (message: string, socketId?: string): void => {
    writeLog({
      timestamp: getTimestamp(),
      level: 'WARN',
      direction: 'INTERNAL',
      socketId,
      message
    });
  },

  /**
   * Logs error conditions requiring investigation or intervention.
   *
   * @param message - Error description
   * @param error - Error object or additional error details
   * @param socketId - Optional socket ID for correlation
   */
  error: (message: string, error?: unknown, socketId?: string): void => {
    writeLog({
      timestamp: getTimestamp(),
      level: 'ERROR',
      direction: 'INTERNAL',
      socketId,
      message,
      error
    });
  },

  /**
   * Logs debug information for development and troubleshooting.
   *
   * @param message - Debug message
   * @param data - Additional diagnostic data
   * @param socketId - Optional socket ID for correlation
   */
  debug: (message: string, data?: unknown, socketId?: string): void => {
    writeLog({
      timestamp: getTimestamp(),
      level: 'DEBUG',
      direction: 'INTERNAL',
      socketId,
      message,
      data
    });
  },

  /**
   * Logs SDK message events with specialized formatting for message type tracking.
   *
   * @param socketId - The Socket.IO socket identifier
   * @param messageType - Type of SDK message (assistant, user, system, etc.)
   * @param details - Additional message details
   */
  sdkMessage: (socketId: string, messageType: string, details?: unknown): void => {
    writeLog({
      timestamp: getTimestamp(),
      level: 'DEBUG',
      direction: 'INTERNAL',
      socketId,
      event: `SDK_MSG[${messageType}]`,
      details
    });
  }
};

// ============================================================================
// LOGGER FACTORY (for testing and custom configurations)
// ============================================================================

/**
 * Configuration options for creating a custom logger.
 */
export interface LoggerOptions {
  /** Maximum string length before truncation */
  maxStringLength?: number;
  /** Custom timestamp function */
  getTimestamp?: () => string;
  /** Custom output function (defaults to console.log) */
  output?: (entry: string) => void;
  /** Minimum log level to output */
  minLevel?: LogLevel;
}

/**
 * Log level priority for filtering.
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  'DEBUG': 0,
  'INFO': 1,
  'WARN': 2,
  'ERROR': 3
};

/**
 * Creates a logger instance with custom configuration.
 *
 * @description
 * Factory function for creating loggers with custom settings. Useful for:
 * - Testing with mock output functions
 * - Adjusting truncation length
 * - Filtering by log level
 *
 * @param options - Custom logger configuration
 * @returns A Logger instance with the specified configuration
 *
 * @example
 * // Create a logger that only outputs errors
 * const errorLogger = createLogger({ minLevel: 'ERROR' });
 *
 * // Create a logger for testing
 * const logs: string[] = [];
 * const testLogger = createLogger({
 *   output: (entry) => logs.push(entry)
 * });
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const {
    maxStringLength = MAX_STRING_LENGTH,
    getTimestamp: customGetTimestamp = getTimestamp,
    output = (entry: string) => console.log(entry),
    minLevel = 'DEBUG'
  } = options;

  const minPriority = LOG_LEVEL_PRIORITY[minLevel];

  function customTruncateStrings(key: string, value: unknown): unknown {
    if (typeof value === 'string' && value.length > maxStringLength) {
      return value.substring(0, maxStringLength) + `... [truncated, ${value.length} chars total]`;
    }
    return value;
  }

  function shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= minPriority;
  }

  function write(entry: LogEntry): void {
    if (shouldLog(entry.level)) {
      output(JSON.stringify(entry, customTruncateStrings));
    }
  }

  return {
    incoming: (socketId: string, event: string, data?: unknown): void => {
      write({
        timestamp: customGetTimestamp(),
        level: 'INFO',
        direction: 'IN',
        socketId,
        event,
        data
      });
    },

    outgoing: (socketId: string, event: string, data?: unknown): void => {
      write({
        timestamp: customGetTimestamp(),
        level: 'INFO',
        direction: 'OUT',
        socketId,
        event,
        data
      });
    },

    info: (message: string, socketId?: string): void => {
      write({
        timestamp: customGetTimestamp(),
        level: 'INFO',
        direction: 'INTERNAL',
        socketId,
        message
      });
    },

    warn: (message: string, socketId?: string): void => {
      write({
        timestamp: customGetTimestamp(),
        level: 'WARN',
        direction: 'INTERNAL',
        socketId,
        message
      });
    },

    error: (message: string, error?: unknown, socketId?: string): void => {
      write({
        timestamp: customGetTimestamp(),
        level: 'ERROR',
        direction: 'INTERNAL',
        socketId,
        message,
        error
      });
    },

    debug: (message: string, data?: unknown, socketId?: string): void => {
      write({
        timestamp: customGetTimestamp(),
        level: 'DEBUG',
        direction: 'INTERNAL',
        socketId,
        message,
        data
      });
    },

    sdkMessage: (socketId: string, messageType: string, details?: unknown): void => {
      write({
        timestamp: customGetTimestamp(),
        level: 'DEBUG',
        direction: 'INTERNAL',
        socketId,
        event: `SDK_MSG[${messageType}]`,
        details
      });
    }
  };
}

export default log;
