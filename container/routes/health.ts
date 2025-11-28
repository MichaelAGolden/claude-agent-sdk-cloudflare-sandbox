/**
 * @fileoverview Health check endpoint for Claude Agent SDK Server
 *
 * Provides a simple health check endpoint for container orchestration
 * and load balancers.
 *
 * @module routes/health
 */

import { Express, Request, Response } from "express";

/**
 * Health check response payload.
 */
interface HealthResponse {
  status: "healthy";
  timestamp: string;
}

/**
 * Handles health check requests.
 *
 * @param req - Express request
 * @param res - Express response
 */
function healthHandler(req: Request, res: Response<HealthResponse>): void {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString()
  });
}

/**
 * Registers health check routes on the Express app.
 *
 * @param app - The Express application
 *
 * @example
 * import { registerHealthRoutes } from './routes/health';
 * registerHealthRoutes(app);
 */
export function registerHealthRoutes(app: Express): void {
  app.get("/health", healthHandler);
}

export default registerHealthRoutes;
