/**
 * @fileoverview Session transcript sync API endpoints.
 *
 * These endpoints manage conversation transcript persistence for session
 * resumption. The Claude SDK stores transcripts locally; these endpoints
 * sync them to/from R2 for durability across sandbox restarts.
 *
 * All endpoints require Clerk JWT authentication. The userId is extracted
 * from the verified token.
 *
 * @module routes/sessions
 */

import { Hono } from "hono";
import { getSandbox } from "@cloudflare/sandbox";
import type { Bindings } from "../lib/types";
import { isProduction, getTranscriptLocalPath, getTranscriptR2Key, normalizeUserId } from "../lib/utils";
import { restoreTranscriptFromR2, saveTranscriptToR2 } from "../services/transcripts.service";
import { requireAuth, getAuthUserId } from "./middleware";

const sessionsRoutes = new Hono<{ Bindings: Bindings; Variables: { authenticatedUserId: string } }>();

// Apply auth middleware to all routes
sessionsRoutes.use("/*", requireAuth);

/**
 * Restores a session transcript from R2 to the sandbox for the authenticated user.
 *
 * Call this BEFORE sending a message with the SDK's `resume` option.
 * The transcript must be present in the sandbox filesystem for the
 * SDK to restore conversation context.
 *
 * @route POST /:sandboxSessionId/restore
 */
sessionsRoutes.post("/:sandboxSessionId/restore", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const sandboxSessionId = normalizeUserId(c.req.param("sandboxSessionId"));
    const body = await c.req.json<{ sdkSessionId: string }>();

    if (!body.sdkSessionId) {
      return c.json({ error: "sdkSessionId is required" }, 400);
    }

    // Check if running in production (R2 sync available)
    if (!isProduction(c.env)) {
      return c.json({
        status: "skipped",
        reason: "R2 sync not available in development mode",
        sandboxSessionId,
        sdkSessionId: body.sdkSessionId,
      });
    }

    // Ensure the sandboxSessionId matches the authenticated user
    // (sandbox sessions are keyed by userId in our architecture)
    if (sandboxSessionId !== userId) {
      return c.json({ error: "Unauthorized: cannot access other user's sandbox" }, 403);
    }

    const sandbox = getSandbox(c.env.Sandbox, sandboxSessionId);
    const restored = await restoreTranscriptFromR2(
      sandbox,
      c.env.USER_DATA,
      userId,
      body.sdkSessionId
    );

    return c.json({
      status: restored ? "restored" : "not_found",
      sandboxSessionId,
      sdkSessionId: body.sdkSessionId,
      userId,
      localPath: getTranscriptLocalPath(body.sdkSessionId),
    });
  } catch (error: any) {
    console.error("[Restore Transcript Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Saves a session transcript from sandbox to R2 for the authenticated user.
 *
 * Call this on session end or WebSocket disconnect to persist the
 * conversation transcript for future resumption.
 *
 * @route POST /:sandboxSessionId/sync
 */
sessionsRoutes.post("/:sandboxSessionId/sync", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const sandboxSessionId = normalizeUserId(c.req.param("sandboxSessionId"));
    const body = await c.req.json<{ sdkSessionId: string }>();

    if (!body.sdkSessionId) {
      return c.json({ error: "sdkSessionId is required" }, 400);
    }

    // Check if running in production (R2 sync available)
    if (!isProduction(c.env)) {
      return c.json({
        status: "skipped",
        reason: "R2 sync not available in development mode",
        sandboxSessionId,
        sdkSessionId: body.sdkSessionId,
      });
    }

    // Ensure the sandboxSessionId matches the authenticated user
    if (sandboxSessionId !== userId) {
      return c.json({ error: "Unauthorized: cannot access other user's sandbox" }, 403);
    }

    const sandbox = getSandbox(c.env.Sandbox, sandboxSessionId);
    const saved = await saveTranscriptToR2(
      sandbox,
      c.env.USER_DATA,
      userId,
      body.sdkSessionId
    );

    return c.json({
      status: saved ? "synced" : "no_transcript",
      sandboxSessionId,
      sdkSessionId: body.sdkSessionId,
      userId,
      r2Key: getTranscriptR2Key(userId, body.sdkSessionId),
    });
  } catch (error: any) {
    console.error("[Sync Transcript Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

export { sessionsRoutes };
