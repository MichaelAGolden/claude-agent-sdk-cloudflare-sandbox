/**
 * @fileoverview Route registration for Claude Agent SDK Server
 *
 * This module provides a single entry point for registering all REST routes.
 *
 * @module routes
 */

import { Express } from "express";
import { registerHealthRoutes } from "./health.js";
import { registerAdminRoutes } from "./admin.js";
import { registerDebugRoutes } from "./debug.js";

/**
 * Registers all REST routes on the Express app.
 *
 * @description
 * Convenience function that registers all route modules:
 * - Health routes: `/health`
 * - Admin routes: `/restart`
 * - Debug routes: `/debug/skills`
 *
 * @param app - The Express application
 *
 * @example
 * import express from 'express';
 * import { registerRoutes } from './routes';
 *
 * const app = express();
 * registerRoutes(app);
 */
export function registerRoutes(app: Express): void {
  registerHealthRoutes(app);
  registerAdminRoutes(app);
  registerDebugRoutes(app);
}

// Re-export individual route registration functions for granular control
export { registerHealthRoutes } from "./health.js";
export { registerAdminRoutes } from "./admin.js";
export { registerDebugRoutes } from "./debug.js";

export default registerRoutes;
