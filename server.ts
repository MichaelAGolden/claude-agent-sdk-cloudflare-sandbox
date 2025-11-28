/**
 * @fileoverview Claude Agent SDK Cloudflare Workers Backend Server
 *
 * This module implements a comprehensive backend server for hosting Claude AI agent
 * conversations using Cloudflare's edge computing infrastructure. It provides a
 * multi-tenant architecture where each user gets isolated sandbox environments
 * for running Claude Agent SDK instances.
 *
 * ## Architecture Overview
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                           Frontend (React)                              │
 * └─────────────────────────────────────────────────────────────────────────┘
 *                                    │
 *                     ┌──────────────┴──────────────┐
 *                     ▼                             ▼
 *              REST API (Hono)              Socket.IO/WebSocket
 *              /api/threads                 /socket.io/*
 *              /api/skills                  /ws
 *                     │                             │
 *                     └──────────────┬──────────────┘
 *                                    ▼
 *                    ┌───────────────────────────────┐
 *                    │     Cloudflare Workers        │
 *                    │        (This Server)          │
 *                    └───────────────────────────────┘
 *                           │         │         │
 *              ┌────────────┼─────────┼─────────┼────────────┐
 *              ▼            ▼         ▼         ▼            ▼
 *         ┌────────┐  ┌─────────┐  ┌────┐  ┌────────┐  ┌──────────┐
 *         │Sandbox │  │Sandbox  │  │ D1 │  │   R2   │  │ Anthropic│
 *         │(User A)│  │(User B) │  │ DB │  │ Bucket │  │   API    │
 *         └────────┘  └─────────┘  └────┘  └────────┘  └──────────┘
 *             │            │
 *             └────────────┴─── Claude Agent SDK (Node.js)
 * ```
 *
 * ## Project Structure
 *
 * - `lib/` - Shared types, constants, and utilities
 * - `state/` - Runtime state management (agent process tracking)
 * - `services/` - Business logic (skills, transcripts, sandbox lifecycle)
 * - `routes/` - Hono route handlers organized by domain
 *
 * ## Key Components
 *
 * - **Hono Framework**: Lightweight, fast HTTP framework for Cloudflare Workers
 * - **Cloudflare Sandbox**: Durable Object-based isolated execution environments
 * - **D1 Database**: SQLite-compatible database for thread/message persistence
 * - **R2 Storage**: Object storage for skills, transcripts, and conversations
 * - **Socket.IO**: Real-time bidirectional communication for chat streaming
 *
 * @module server
 * @requires hono
 * @requires @cloudflare/sandbox
 * @author Claude Agent SDK Team
 * @license MIT
 * @version 1.0.0
 * @see {@link https://developers.cloudflare.com/workers/} Cloudflare Workers Documentation
 * @see {@link https://docs.anthropic.com/} Anthropic API Documentation
 */

import { Hono } from "hono";
export { Sandbox } from "@cloudflare/sandbox";

import type { Bindings } from "./lib/types";
import { registerRoutes } from "./routes";

/**
 * Hono application instance configured with Cloudflare Workers bindings.
 */
const app = new Hono<{ Bindings: Bindings }>();

// Register all route groups
registerRoutes(app);

/**
 * Exports the Hono application as the default module export.
 *
 * This is the entry point for the Cloudflare Worker. Cloudflare's runtime
 * invokes the exported `fetch` handler (provided by Hono) for each incoming
 * request.
 */
export default app;
