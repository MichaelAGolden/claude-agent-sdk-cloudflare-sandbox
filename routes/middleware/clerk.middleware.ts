/**
 * @fileoverview Clerk JWT verification middleware for user authentication.
 *
 * This middleware validates Clerk JWTs to authenticate users on protected routes.
 * It extracts the userId from the verified token and makes it available to handlers.
 *
 * ## Security Model
 * - Frontend sends Clerk JWT in Authorization header
 * - Backend verifies JWT signature using Clerk's JWKS
 * - userId is extracted from verified token, not trusted from client
 *
 * @module routes/middleware/clerk
 */

import { verifyToken } from "@clerk/backend";
import type { Context, Next } from "hono";
import type { Bindings } from "../../lib/types";
import { normalizeUserId, isProduction } from "../../lib/utils";

/**
 * Extended bindings type with authenticated user context.
 */
export type AuthenticatedBindings = Bindings & {
  authenticatedUserId: string;
};

/**
 * Middleware that verifies Clerk JWT and extracts authenticated userId.
 *
 * This middleware:
 * 1. Extracts Bearer token from Authorization header
 * 2. Verifies the JWT using Clerk's SDK
 * 3. Sets `authenticatedUserId` in context for downstream handlers
 *
 * @param c - The Hono context
 * @param next - The next middleware function
 * @returns Response or passes to next middleware
 *
 * @example
 * // Apply to all routes in a group
 * const protectedRoutes = new Hono<{ Bindings: AuthenticatedBindings }>();
 * protectedRoutes.use("/*", requireAuth);
 *
 * @example
 * // Access authenticated userId in handler
 * app.get("/protected", requireAuth, (c) => {
 *   const userId = c.get("authenticatedUserId");
 *   return c.json({ userId });
 * });
 */
export const requireAuth = async (
  c: Context<{ Bindings: Bindings; Variables: { authenticatedUserId: string } }>,
  next: Next
) => {
  // Allow OPTIONS requests to pass through for CORS preflight
  if (c.req.method === "OPTIONS") {
    return next();
  }

  // Ensure env exists
  if (!c.env) {
    console.error("[Auth] Critical: c.env is undefined at start of middleware");
    return c.json({ error: "Server configuration error" }, 500);
  }

  const secretKey = c.env.CLERK_SECRET_KEY;
  const authHeader = c.req.header("Authorization");
  const isProd = isProduction(c.env);

  // Handle missing credentials
  if (!secretKey || !authHeader || !authHeader.startsWith("Bearer ")) {
    if (isProd) {
      // PRODUCTION: Fail closed - require valid authentication
      console.error("[Auth] Missing authentication in production:", {
        hasSecretKey: !!secretKey,
        hasAuthHeader: !!authHeader,
      });
      return c.json({ error: "Authentication required" }, 401);
    }
    // DEVELOPMENT: Allow fallback to dev-user for local testing
    console.warn("[Auth] Development mode: using 'dev-user' fallback.");
    c.set("authenticatedUserId", "dev-user");
    return next();
  }

  const token = authHeader.substring(7); // Remove "Bearer " prefix

  try {
    // Verify the JWT token using Clerk's standalone verifyToken
    const payload = await verifyToken(token, { secretKey });

    const userId = payload.sub;
    if (!userId) {
      console.warn("[Auth] Token valid but no user ID. Using 'dev-user'.");
      c.set("authenticatedUserId", "dev-user");
      return next();
    }

    // Normalize userId to lowercase for sandbox compatibility
    // (Cloudflare Sandbox IDs are used in hostnames which are case-insensitive)
    c.set("authenticatedUserId", normalizeUserId(userId));

    await next();
  } catch (error: any) {
    console.error("[Auth] Token verification failed:", error.message || error);

    if (isProd) {
      // PRODUCTION: Fail closed - reject invalid tokens
      return c.json({ error: "Invalid or expired authentication token" }, 401);
    }
    // DEVELOPMENT: Allow fallback for easier testing
    console.warn("[Auth] Development mode: proceeding as 'dev-user' despite verification failure.");
    c.set("authenticatedUserId", "dev-user");
    await next();
  }
};

/**
 * Helper function to get authenticated userId from context.
 *
 * @param c - The Hono context
 * @returns The authenticated userId
 * @throws Error if userId is not set (middleware not applied)
 */
export const getAuthUserId = (
  c: Context<{ Bindings: Bindings; Variables: { authenticatedUserId: string } }>
): string => {
  const userId = c.get("authenticatedUserId");
  if (!userId) {
    throw new Error("authenticatedUserId not set - ensure requireAuth middleware is applied");
  }
  return userId;
};

/**
 * Optional auth middleware that sets userId if token is present but doesn't require it.
 *
 * Useful for routes that work with or without authentication.
 *
 * @param c - The Hono context
 * @param next - The next middleware function
 */
export const optionalAuth = async (
  c: Context<{ Bindings: Bindings; Variables: { authenticatedUserId: string } }>,
  next: Next
) => {
  const secretKey = c.env.CLERK_SECRET_KEY;
  const authHeader = c.req.header("Authorization");

  if (secretKey && authHeader?.startsWith("Bearer ")) {
    try {
      const token = authHeader.substring(7);
      const payload = await verifyToken(token, { secretKey });
      const userId = payload.sub;

      if (userId) {
        // Normalize userId to lowercase for sandbox compatibility
        c.set("authenticatedUserId", normalizeUserId(userId));
      }
    } catch {
      // Token invalid - continue without auth
    }
  }

  await next();
};
