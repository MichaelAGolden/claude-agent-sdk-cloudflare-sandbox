/**
 * @fileoverview Route registration and barrel exports.
 *
 * This module provides the `registerRoutes` function that composes all
 * route groups onto the main Hono application, as well as individual
 * route exports for granular usage.
 *
 * @module routes
 */

import type { Hono } from "hono";
import type { Bindings } from "../lib/types";
import { healthRoutes } from "./health.routes";
import { threadsRoutes } from "./threads.routes";
import { sessionsRoutes } from "./sessions.routes";
import { skillsRoutes } from "./skills.routes";
import { usersRoutes } from "./users.routes";
import { sandboxRoutes } from "./sandbox.routes";
import { agentRoutes } from "./agent.routes";

/**
 * Registers all route groups on the main Hono application.
 *
 * This function composes the modular route handlers onto the app:
 * - Health routes: /health, /_info
 * - Thread routes: /api/threads/*
 * - Session routes: /api/sessions/*
 * - Skills routes: /api/skills/*
 * - Agent routes: /api/agent/* (start, stop, restart, status)
 * - User routes: /users/:userId/*
 * - Sandbox routes: /setup/*, /ws, /socket.io/*, /sandbox/*
 *
 * @param app - The Hono application instance to register routes on
 *
 * @example
 * const app = new Hono<{ Bindings: Bindings }>();
 * registerRoutes(app);
 * export default app;
 */
export const registerRoutes = (app: Hono<{ Bindings: Bindings }>): void => {
  // Public health endpoints (root level)
  app.route("/", healthRoutes);

  // Public API endpoints
  app.route("/api/threads", threadsRoutes);
  app.route("/api/sessions", sessionsRoutes);
  app.route("/api/skills", skillsRoutes);
  app.route("/api/agent", agentRoutes);

  // Protected user resources
  app.route("/users", usersRoutes);

  // Sandbox management (includes /setup, /ws, /socket.io, /sandbox)
  app.route("/", sandboxRoutes);
};

// Re-export individual routes for granular usage
export { healthRoutes } from "./health.routes";
export { threadsRoutes } from "./threads.routes";
export { sessionsRoutes } from "./sessions.routes";
export { skillsRoutes } from "./skills.routes";
export { agentRoutes } from "./agent.routes";
export { usersRoutes } from "./users.routes";
export { sandboxRoutes } from "./sandbox.routes";

// Re-export middleware
export { requireApiKey } from "./middleware";
