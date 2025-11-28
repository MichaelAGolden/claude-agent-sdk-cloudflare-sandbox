/**
 * @fileoverview Authentication middleware for protected endpoints.
 *
 * This middleware validates API keys for protected routes. It extracts
 * the Bearer token from the Authorization header and compares it against
 * the configured API_KEY environment variable.
 *
 * @module routes/middleware/auth
 */

import type { Context, Next } from "hono";
import type { Bindings } from "../../lib/types";

/**
 * Middleware that requires a valid API key in the Authorization header.
 *
 * Validates the Bearer token against env.API_KEY. Returns 401 Unauthorized
 * if the token is missing or invalid.
 *
 * @param c - The Hono context
 * @param next - The next middleware function
 * @returns Response or passes to next middleware
 *
 * @example
 * // Apply to all routes in a group
 * const protectedRoutes = new Hono<{ Bindings: Bindings }>();
 * protectedRoutes.use("/*", requireApiKey);
 *
 * @example
 * // Apply to a single route
 * app.post("/protected", requireApiKey, (c) => {
 *   return c.json({ message: "You are authenticated" });
 * });
 */
export const requireApiKey = async (
  c: Context<{ Bindings: Bindings }>,
  next: Next
) => {
  const authHeader = c.req.header("Authorization");
  const expectedToken = c.env.API_KEY;

  // If API_KEY is not configured, skip auth check (development mode)
  if (!expectedToken) {
    await next();
    return;
  }

  if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
};
