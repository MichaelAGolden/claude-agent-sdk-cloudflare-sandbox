/**
 * @fileoverview Barrel exports for middleware.
 *
 * @module routes/middleware
 */

export { requireApiKey } from "./auth.middleware";
export { requireAuth, optionalAuth, getAuthUserId } from "./clerk.middleware";
export type { AuthenticatedBindings } from "./clerk.middleware";
