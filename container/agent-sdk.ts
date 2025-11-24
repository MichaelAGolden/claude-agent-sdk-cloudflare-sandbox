import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import {
  query,
  SDKUserMessage,
  Query,
  tool,
  createSdkMcpServer,
  type Options,
  type HookEvent
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Load environment variables
dotenv.config();

// ============================================================================ 
// LOGGING UTILITIES
// ============================================================================ 

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
type LogDirection = 'IN' | 'OUT' | 'INTERNAL';

const getTimestamp = (): string => {
  return new Date().toISOString();
};

const log = {
  incoming: (socketId: string, event: string, data?: any) => {
    console.log(JSON.stringify({
      timestamp: getTimestamp(),
      level: 'INFO',
      direction: 'IN',
      socketId,
      event,
      data
    }, truncateStrings));
  },
  outgoing: (socketId: string, event: string, data?: any) => {
    console.log(JSON.stringify({
      timestamp: getTimestamp(),
      level: 'INFO',
      direction: 'OUT',
      socketId,
      event,
      data
    }, truncateStrings));
  },
  info: (message: string, socketId?: string) => {
    console.log(JSON.stringify({
      timestamp: getTimestamp(),
      level: 'INFO',
      direction: 'INTERNAL',
      socketId,
      message
    }, truncateStrings));
  },
  warn: (message: string, socketId?: string) => {
    console.log(JSON.stringify({
      timestamp: getTimestamp(),
      level: 'WARN',
      direction: 'INTERNAL',
      socketId,
      message
    }, truncateStrings));
  },
  error: (message: string, error?: any, socketId?: string) => {
    console.log(JSON.stringify({
      timestamp: getTimestamp(),
      level: 'ERROR',
      direction: 'INTERNAL',
      socketId,
      message,
      error
    }, truncateStrings));
  },
  debug: (message: string, data?: any, socketId?: string) => {
    console.log(JSON.stringify({
      timestamp: getTimestamp(),
      level: 'DEBUG',
      direction: 'INTERNAL',
      socketId,
      message,
      data
    }, truncateStrings));
  },
  sdkMessage: (socketId: string, messageType: string, details?: any) => {
    console.log(JSON.stringify({
      timestamp: getTimestamp(),
      level: 'DEBUG',
      direction: 'INTERNAL',
      socketId,
      event: `SDK_MSG[${messageType}]`,
      details
    }, truncateStrings));
  }
};

function truncateStrings(key: string, value: any): any {
  if (typeof value === 'string' && value.length > 200) {
    return value.substring(0, 200) + `... [truncated, ${value.length} chars total]`;
  }
  return value;
}

// Prevent crash from unhandled SDK rejections
process.on('unhandledRejection', (reason: any) => {
  if (reason?.message === 'Operation aborted' || reason?.name === 'AbortError') {
    console.log('Caught unhandled AbortError (likely from SDK shutdown)');
    return;
  }
  console.error('Unhandled Rejection:', reason);
});

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("❌ Error: ANTHROPIC_API_KEY not found in environment variables");
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

class MessageStream implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private resolvers: ((value: IteratorResult<SDKUserMessage>) => void)[] = [];
  private finished = false;

  constructor() { }

  push(message: SDKUserMessage, socketId?: string) {
    log.debug(`MessageStream.push() called`, { type: message.type, queueLength: this.queue.length }, socketId);
    if (this.finished) {
      log.warn(`MessageStream.push() ignored - stream already finished`, socketId);
      return;
    }
    if (this.resolvers.length > 0) {
      log.debug(`MessageStream: resolving waiting consumer`, undefined, socketId);
      const resolve = this.resolvers.shift()!;
      resolve({ value: message, done: false });
    } else {
      log.debug(`MessageStream: queuing message (queue size: ${this.queue.length + 1})`, undefined, socketId);
      this.queue.push(message);
    }
  }

  finish() {
    this.finished = true;
    while (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve({ value: undefined as any, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    const self = this;
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        log.debug(`MessageStream.next() called`, { queueLength: self.queue.length, finished: self.finished });
        if (self.queue.length > 0) {
          log.debug(`MessageStream: yielding from queue (remaining: ${self.queue.length - 1})`);
          return Promise.resolve({ value: self.queue.shift()!, done: false });
        }
        if (self.finished) {
          log.debug(`MessageStream: iterator finished`);
          return Promise.resolve({ value: undefined as any, done: true });
        }
        log.debug(`MessageStream: waiting for next message`);
        return new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          self.resolvers.push(resolve);
        });
      }
    };
  }
}

interface SessionState {
  sessionId: string;
  currentSocket: Socket;
  queryIterator: Query | null;
  messageStream: MessageStream | null;
  abortController: AbortController;
  isQueryRunning: boolean;
  disconnectTimeout?: NodeJS.Timeout;
}

const sessions = new Map<string, SessionState>();

interface ExtendedOptions extends Partial<Options> {
  // Removed clientTools and hasCustomPermissionHandler
}

// Helper to get current socket for a session
const getSessionSocket = (sessionId: string): Socket | undefined => {
  return sessions.get(sessionId)?.currentSocket;
};

// Helper to start the agent query loop - Moved to top level
const startAgentQuery = async (sessionId: string, initialOptions: ExtendedOptions = {}) => {
  const session = sessions.get(sessionId);
  if (!session) {
    log.warn(`startAgentQuery called but no session found for ${sessionId}`);
    return;
  }

  if (session.isQueryRunning) {
    log.info(`Query already running, ignoring startAgentQuery`, session.currentSocket.id);
    return;
  }

  log.info(`Starting agent query for session ${sessionId}`, session.currentSocket.id);

  session.isQueryRunning = true;
  session.messageStream = new MessageStream();
  session.abortController = new AbortController();

  // Helper to emit to the *current* socket
  const emitToClient = (event: string, data?: any) => {
    const currentSocket = getSessionSocket(sessionId);
    if (currentSocket && currentSocket.connected) {
      currentSocket.emit(event, data);
    } else {
      log.warn(`Cannot emit ${event}: Socket disconnected for session ${sessionId}`);
    }
  };

  try {
    // Define hooks
    const createHook = (eventName: string) => async (input: any) => {
      const currentSocket = getSessionSocket(sessionId);

      // If session aborted, stop
      if (session.abortController.signal.aborted) {
        return {};
      }

      // If socket disconnected, we wait for reconnection or timeout? 
      // For now, let's fail fast if no socket, OR we could wait a bit? 
      // Given the requirement "don't quit easily", waiting for reconnection inside the hook would be ideal.
      // But that's complicated. Let's stick to: if no socket, log warning and return continue/empty.
      if (!currentSocket || !currentSocket.connected) {
        log.warn(`Skipping hook ${eventName} (socket disconnected)`, sessionId);
        return {};
      }

      // Special handling for PostToolUse: Auto-continue and notify client
      if (eventName === 'PostToolUse') {
        log.outgoing(currentSocket.id, 'hook_notification', { event: eventName, dataKeys: Object.keys(input || {}) });
        currentSocket.emit("hook_notification", { event: eventName, data: input });
        return { action: 'continue' };
      }

      log.debug(`Hook triggered: ${eventName}`, { inputKeys: Object.keys(input || {}) }, currentSocket.id);

      try {
        const response = await new Promise<any>((resolve, reject) => {
          const timeout = setTimeout(() => {
            log.warn(`Hook ${eventName} timed out after 5 minutes`, sessionId);
            cleanup();
            resolve({});
          }, 300000);

          // If client disconnects, we might want to wait for reconnection instead of rejecting immediately? 
          // But for simplicity and to match previous fix, we reject/resolve empty on disconnect.
          // Ideally, if the user refreshes, the socket disconnects.
          // If we resolve empty, the agent continues.
          const onDisconnect = () => {
            log.warn(`Client disconnected while waiting for hook ${eventName}`, sessionId);
            cleanup();
            resolve({});
          };
          currentSocket.once('disconnect', onDisconnect);

          const cleanup = () => {
            clearTimeout(timeout);
            currentSocket.off('disconnect', onDisconnect);
          };

          log.outgoing(currentSocket.id, 'hook_request', { event: eventName, dataKeys: Object.keys(input || {}) });
          currentSocket.emit("hook_request", { event: eventName, data: input }, (clientResponse: any) => {
            cleanup();
            log.incoming(currentSocket.id, `hook_response[${eventName}]`, clientResponse);
            resolve(clientResponse || {});
          });
        });
        return response;
      } catch (error) {
        log.error(`Error in hook ${eventName}`, error, sessionId);
        return {};
      }
    };

    // Process client-defined tools - REMOVED
    const mcpServers = initialOptions.mcpServers || {};

    const q = query({
      prompt: session.messageStream,
      options: {
        maxTurns: initialOptions.maxTurns || Infinity,
        allowedTools: initialOptions.allowedTools || [
          "Read", "Write", "Bash", "Grep", "WebSearch", "WebFetch", "Task",
          "BashOutput", "Edit", "Glob", "KillBash", "NotebookEdit", "TodoWrite",
          "ExitPlanMode", "ListMcpResources", "ReadMcpResource"
        ],
        model: initialOptions.model || process.env.CLAUDE_MODEL || "claude-sonnet-4-5-20250929",
        abortController: session.abortController,
        systemPrompt: initialOptions.systemPrompt,
        permissionMode: initialOptions.permissionMode,
        resume: initialOptions.resume,
        maxThinkingTokens: initialOptions.maxThinkingTokens,
        includePartialMessages: initialOptions.includePartialMessages,
        settingSources: initialOptions.settingSources !== undefined ? initialOptions.settingSources : [],
        fallbackModel: initialOptions.fallbackModel,
        agents: initialOptions.agents,
        mcpServers: mcpServers,
        plugins: initialOptions.plugins,
        outputFormat: initialOptions.outputFormat,
        strictMcpConfig: initialOptions.strictMcpConfig,
        stderr: (data: string) => emitToClient("stderr", data),
        executable: initialOptions.executable,
        executableArgs: initialOptions.executableArgs,
        env: initialOptions.env || process.env,
        cwd: initialOptions.cwd || process.cwd(),
        additionalDirectories: initialOptions.additionalDirectories,
        forkSession: initialOptions.forkSession,
        continue: initialOptions.continue,
        disallowedTools: initialOptions.disallowedTools,
        extraArgs: initialOptions.extraArgs,
        pathToClaudeCodeExecutable: initialOptions.pathToClaudeCodeExecutable,
        permissionPromptToolName: initialOptions.permissionPromptToolName,

        hooks: {
          PreToolUse: [{ hooks: [createHook('PreToolUse')] }],
          PostToolUse: [{ hooks: [createHook('PostToolUse')] }],
          Notification: [{ hooks: [createHook('Notification')] }],
          UserPromptSubmit: [{ hooks: [createHook('UserPromptSubmit')] }],
          SessionStart: [{ hooks: [createHook('SessionStart')] }],
          SessionEnd: [{ hooks: [createHook('SessionEnd')] }],
          Stop: [{ hooks: [createHook('Stop')] }],
          SubagentStop: [{ hooks: [createHook('SubagentStop')] }],
          PreCompact: [{ hooks: [createHook('PreCompact')] }]
        },

        // Removed canUseTool (custom permission handler)

        ...initialOptions
      }
    });

    session.queryIterator = q;
    log.info("Starting query stream processing...", sessionId);
    let messageCount = 0;

    for await (const message of q) {
      messageCount++;
      const currentSocketId = getSessionSocket(sessionId)?.id || sessionId;
      log.sdkMessage(currentSocketId, message.type, { messageNumber: messageCount });

      // Use emitToClient to ensure it goes to the current socket
      switch (message.type) {
        case "stream_event":
          const event = message.event;
          log.debug(`Stream event: ${event.type}`, undefined, currentSocketId);
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
            log.outgoing(currentSocketId, 'stream', { type: 'text', contentLength: event.delta.text?.length });
            emitToClient("stream", { type: "text", content: event.delta.text });
          }
          log.outgoing(currentSocketId, 'stream_event', { eventType: event.type });
          emitToClient("stream_event", message);
          break;
        case "assistant":
          log.outgoing(currentSocketId, 'message[assistant]', {
            uuid: message.uuid,
            contentBlocks: Array.isArray(message.message.content) ? message.message.content.length : 1
          });
          emitToClient("message", { role: "assistant", content: message.message.content, uuid: message.uuid });
          break;
        case "user":
          log.outgoing(currentSocketId, 'message[user]', { uuid: message.uuid });
          emitToClient("message", { role: "user", content: message.message.content, uuid: message.uuid });
          break;
        case "system":
          if (message.subtype === 'compact_boundary') {
            log.outgoing(currentSocketId, 'compact_boundary', { subtype: message.subtype });
            emitToClient("compact_boundary", message);
          } else {
            log.outgoing(currentSocketId, 'system', { subtype: (message as any).subtype });
            emitToClient("system", message);
          }
          break;
        case "result":
          log.outgoing(currentSocketId, 'result', {
            costUSD: (message as any).cost_usd,
            durationMs: (message as any).duration_ms
          });
          emitToClient("result", message);
          break;
        default:
          log.outgoing(currentSocketId, 'sdk_event', { type: message.type });
          emitToClient("sdk_event", message);
          break;
      }
    }
    log.info(`Query stream completed. Total messages: ${messageCount}`, sessionId);

  } catch (error: any) {
    log.error(`Error for session ${sessionId}`, error);
    emitToClient("error", { message: error.message || "An error occurred", details: error });
  } finally {
    if (session) {
      session.isQueryRunning = false;
      session.queryIterator = null;
      // Do not nullify messageStream immediately if we want to allow resumption later? 
      // But query() consumes it. If query finishes, stream is done.
      session.messageStream = null;
    }
  }
};

io.on("connection", (socket: Socket) => {
  const sessionId = socket.handshake.query.sessionId as string;
  log.info(`New client connected`, socket.id);

  if (!sessionId) {
    log.warn(`Client connected without sessionId`, socket.id);
    // Allow but it won't persist well
  } else {
    log.info(`Client claimed sessionId: ${sessionId}`, socket.id);
  }

  const effectiveSessionId = sessionId || socket.id;

  let session = sessions.get(effectiveSessionId);

  if (session) {
    // RESUME SESSION
    log.info(`Resuming existing session for ${effectiveSessionId}`, socket.id);

    // Update current socket
    session.currentSocket = socket;

    // Clear any pending disconnect cleanup
    if (session.disconnectTimeout) {
      clearTimeout(session.disconnectTimeout);
      session.disconnectTimeout = undefined;
      log.info(`Cancelled disconnect timeout for ${effectiveSessionId}`);
    }

    // Send history? (Not strictly stored here other than what SDK sends, but frontend should have it)
    // But if frontend refreshed, it lost memory state. 
    // We are not storing full history in `session` object here, so we can't replay it easily 
    // without modifying the MessageStream/Query architecture to buffer history.
    // For now, let's just re-attach control. The user might see a blank chat but the *agent process* is still running.
    // To fix blank chat, we'd need to store history.

    socket.emit("status", { type: "info", message: "Session resumed" });

  } else {
    // NEW SESSION
    log.info(`Creating new session for ${effectiveSessionId}`, socket.id);
    sessions.set(effectiveSessionId, {
      sessionId: effectiveSessionId,
      currentSocket: socket,
      queryIterator: null,
      messageStream: null,
      abortController: new AbortController(),
      isQueryRunning: false
    });
  }

  // Handle 'start'
  socket.on("start", (config: any) => {
    log.incoming(socket.id, 'start', { configKeys: Object.keys(config || {}) });
    startAgentQuery(effectiveSessionId, config);
    const statusPayload = { type: "info", message: "Session initialized" };
    log.outgoing(socket.id, 'status', statusPayload);
    socket.emit("status", statusPayload);
  });

  // Handle 'message'
  socket.on("message", async (data: { prompt: string, options?: ExtendedOptions }) => {
    const session = sessions.get(effectiveSessionId);
    if (!session) {
      log.warn(`Message received but no session found`, socket.id);
      return;
    }

    const userPrompt = typeof data === 'string' ? data : data.prompt;
    const options = typeof data === 'string' ? {} : data.options || {};

    log.incoming(socket.id, 'message', {
      promptLength: userPrompt?.length,
      promptPreview: userPrompt?.substring(0, 100),
      hasOptions: Object.keys(options).length > 0,
      optionKeys: Object.keys(options)
    });

    if (!session.isQueryRunning) {
      log.info(`No query running, starting new query loop`, socket.id);
      startAgentQuery(effectiveSessionId, options);
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    const sdkMessage: SDKUserMessage = {
      type: 'user',
      session_id: effectiveSessionId,
      message: { role: 'user', content: userPrompt },
      parent_tool_use_id: null
    };

    log.debug(`Pushing user message to stream`, { promptLength: userPrompt?.length }, socket.id);

    if (session.messageStream) {
      session.messageStream.push(sdkMessage, socket.id);
    } else {
      log.error(`Message stream not available despite starting query`, undefined, socket.id);
      const errorPayload = { message: "Agent not ready" };
      log.outgoing(socket.id, 'error', errorPayload);
      socket.emit("error", errorPayload);
    }
  });

  // Handle 'interrupt'
  socket.on("interrupt", async () => {
    log.incoming(socket.id, 'interrupt');
    const session = sessions.get(effectiveSessionId);
    if (session && session.queryIterator) {
      try {
        log.info(`Interrupting query`, socket.id);
        await session.queryIterator.interrupt();
        const statusPayload = { type: "info", message: "Interrupted" };
        log.outgoing(socket.id, 'status', statusPayload);
        socket.emit("status", statusPayload);
      } catch (err) {
        log.error("Error interrupting query", err, socket.id);
        const errorPayload = { message: "Failed to interrupt" };
        log.outgoing(socket.id, 'error', errorPayload);
        socket.emit("error", errorPayload);
      }
    } else {
      log.warn(`No active query to interrupt`, socket.id);
    }
  });

  // Handle 'clear'
  socket.on("clear", async () => {
    log.incoming(socket.id, 'clear');
    const session = sessions.get(effectiveSessionId);
    if (session) {
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
      session.messageStream = null; // Will be recreated on next start

      // We might want to delete the session entirely and let it be recreated?
      // Or just reset its internal state.
      // For now, let's keep the session object but reset its components.

      log.info(`Session cleared`, socket.id);
      const statusPayload = { type: "info", message: "Session cleared" };
      log.outgoing(socket.id, 'cleared', statusPayload);
      socket.emit("cleared", statusPayload);
    }
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    log.info(`Client disconnected`, socket.id);

    const session = sessions.get(effectiveSessionId);
    if (session) {
      // Don't abort immediately. Wait 60s for reconnection.
      log.info(`Scheduling session abort for ${effectiveSessionId} in 60s`);
      session.disconnectTimeout = setTimeout(() => {
        log.info(`Session ${effectiveSessionId} timed out, aborting.`);
        session.abortController.abort();
        if (session.messageStream) session.messageStream.finish();
        sessions.delete(effectiveSessionId);
      }, 60000); // 60 seconds grace period
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  log.info(`Server started on port ${PORT}`);
  console.log(`\n🚀 Claude Agent SDK Web Interface`);
  console.log(`📡 Server running at http://localhost:${PORT}`);
  console.log(`📋 Detailed logging enabled with timestamps`);
  console.log(`\nLog format: [timestamp] [LEVEL] direction [socketId] event: data`);
  console.log(`  → = incoming from client`);
  console.log(`  ← = outgoing to client`);
  console.log(`  • = internal operations`);
  console.log(`\nPress Ctrl+C to stop the server\n`);
});
