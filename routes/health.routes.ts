/**
 * @fileoverview Health check and server info endpoints.
 *
 * Public endpoints for monitoring, load balancer probes, and
 * frontend service discovery.
 *
 * @module routes/health
 */

import { Hono } from "hono";
import type { Bindings } from "../lib/types";

const healthRoutes = new Hono<{ Bindings: Bindings }>();

/**
 * Health check endpoint for monitoring and load balancer probes.
 *
 * Returns the server's health status and configuration state. This endpoint
 * is public (no authentication required) and suitable for automated monitoring.
 *
 * @route GET /health
 */
healthRoutes.get("/health", (c) => {
  return c.json({
    status: "healthy",
    environment: c.env.ENVIRONMENT || "development",
    hasApiKey: !!(c.env?.ANTHROPIC_API_KEY || c.env?.CLAUDE_CODE_OAUTH_TOKEN),
    hasSandbox: !!c.env?.Sandbox,
    hasR2: !!c.env?.USER_DATA,
    hasD1: !!c.env?.DB,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Worker information endpoint for frontend service discovery.
 *
 * Provides the public URL for WebSocket connections. Called by the frontend
 * worker via service binding to determine where to connect clients.
 *
 * @route GET /_info
 */
healthRoutes.get("/_info", (c) => {
  // Use configured PUBLIC_URL, or try to derive from request URL
  const publicUrl = c.env.PUBLIC_URL || new URL(c.req.url).origin;

  return c.json({
    publicUrl,
    socketPath: "/socket.io/",
    environment: c.env.ENVIRONMENT || "development",
  });
});

export { healthRoutes };
