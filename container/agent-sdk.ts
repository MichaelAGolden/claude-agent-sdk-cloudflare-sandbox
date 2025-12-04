/**
 * @fileoverview Claude Agent SDK Socket.IO Server Entry Point
 *
 * This is the main entry point for the Claude Agent SDK server. It bootstraps
 * the application by:
 * - Setting up environment and API keys
 * - Creating Express and Socket.IO servers
 * - Registering REST routes
 * - Initializing session management and query orchestration
 * - Starting the HTTP server
 *
 * The actual business logic has been extracted into focused modules:
 * - `lib/types.ts` - Type definitions
 * - `lib/logger.ts` - Structured logging
 * - `lib/MessageStream.ts` - Async message queue
 * - `lib/SessionManager.ts` - Session state management
 * - `lib/HookHandler.ts` - SDK hook handling
 * - `lib/QueryOrchestrator.ts` - SDK query lifecycle
 * - `lib/SocketHandlers.ts` - Socket.IO event handlers
 * - `routes/` - REST endpoints
 *
 * @module agent-sdk
 * @author Claude Agent SDK Team
 * @license MIT
 */

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

// Import library modules
import { log, SessionManager, QueryOrchestrator, registerSocketHandlers } from "./lib/index.js";
import { registerRoutes } from "./routes/index.js";

// ============================================================================
// ENVIRONMENT SETUP
// ============================================================================

/**
 * Initialize API key from environment variables.
 *
 * @description
 * Supports both standard ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN for
 * flexible authentication in different deployment environments.
 */
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN;

/**
 * Global handler for unhandled Promise rejections.
 *
 * @description
 * Prevents server crashes from SDK-related AbortError rejections that occur
 * during normal shutdown operations.
 */
process.on('unhandledRejection', (reason: unknown) => {
  const err = reason as Error | undefined;
  if (err?.message === 'Operation aborted' || err?.name === 'AbortError') {
    console.log('Caught unhandled AbortError (likely from SDK shutdown)');
    return;
  }
  console.error('Unhandled Rejection:', reason);
});

/**
 * Validate required API key presence.
 */
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Error: ANTHROPIC_API_KEY not found in environment variables");
  process.exit(1);
}

// ============================================================================
// SERVER SETUP
// ============================================================================

/**
 * Express application instance for HTTP endpoints.
 */
const app = express();

/**
 * HTTP server instance wrapping the Express app.
 */
const server = createServer(app);

/**
 * Socket.IO server instance for real-time bidirectional communication.
 *
 * @description
 * Configured with permissive CORS settings. In production, consider
 * restricting the `origin` to specific allowed domains.
 */
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ============================================================================
// DEPENDENCY INITIALIZATION
// ============================================================================

/**
 * Session manager instance.
 */
const sessionManager = new SessionManager(log);

/**
 * Query orchestrator instance.
 */
const queryOrchestrator = new QueryOrchestrator({
  sessionManager,
  logger: log
});

// ============================================================================
// ROUTE REGISTRATION
// ============================================================================

/**
 * Register all REST routes.
 */
registerRoutes(app);

// ============================================================================
// SOCKET.IO SETUP
// ============================================================================

/**
 * Socket.IO connection handler.
 *
 * @description
 * Delegates all socket event handling to the registerSocketHandlers function.
 */
io.on("connection", (socket) => {
  registerSocketHandlers(socket, {
    sessionManager,
    queryOrchestrator,
    logger: log
  });
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

/**
 * Server port from environment or default.
 */
const PORT = process.env.PORT || 3001;

/**
 * Start the HTTP/Socket.IO server and perform startup diagnostics.
 */
server.listen(PORT, () => {
  log.info(`Server started on port ${PORT}`);
  console.log(`\n Claude Agent SDK Web Interface`);
  console.log(` Server running at http://localhost:${PORT}`);
  console.log(` Detailed logging enabled with timestamps`);
  console.log(`\nLog format: [timestamp] [LEVEL] direction [socketId] event: data`);
  console.log(`  IN = incoming from client`);
  console.log(`  OUT = outgoing to client`);
  console.log(`  INTERNAL = internal operations`);

  // Log skill discovery info at startup
  console.log(`\n Skills Configuration:`);
  console.log(`  Working directory (cwd): /workspace`);
  console.log(`  settingSources: ['user', 'project']`);
  console.log(`  Skill tool enabled: Yes`);

  // Check what skills exist in the project skills directory
  const skillsDir = "/workspace/.claude/skills";
  console.log(`\n Checking skills directory: ${skillsDir}`);
  if (existsSync(skillsDir)) {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    const skillDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    console.log(`  Found ${skillDirs.length} skill directories: ${skillDirs.join(', ') || '(none)'}`);
    for (const skillName of skillDirs) {
      const skillMdPath = join(skillsDir, skillName, "SKILL.md");
      if (existsSync(skillMdPath)) {
        const content = readFileSync(skillMdPath, "utf-8");
        console.log(`  OK ${skillName}/SKILL.md (${content.length} bytes)`);
      } else {
        console.log(`  MISSING ${skillName}/SKILL.md not found`);
      }
    }
  } else {
    console.log(`  Skills directory does not exist`);
  }

  // Also check user skills location
  const userSkillsDir = `${process.env.HOME || '/root'}/.claude/skills`;
  console.log(`\n Checking user skills directory: ${userSkillsDir}`);
  if (existsSync(userSkillsDir)) {
    const entries = readdirSync(userSkillsDir, { withFileTypes: true });
    const skillDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    console.log(`  Found ${skillDirs.length} user skill directories`);
  } else {
    console.log(`  User skills directory does not exist`);
  }

  console.log(`\nPress Ctrl+C to stop the server\n`);
});
