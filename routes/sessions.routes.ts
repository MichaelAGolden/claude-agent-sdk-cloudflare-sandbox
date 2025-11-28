/**
 * @fileoverview Session transcript sync API endpoints.
 *
 * These endpoints manage conversation transcript persistence for session
 * resumption. The Claude SDK stores transcripts locally; these endpoints
 * sync them to/from R2 for durability across sandbox restarts.
 *
 * @module routes/sessions
 */

import { Hono } from "hono";
import { getSandbox } from "@cloudflare/sandbox";
import type { Bindings } from "../lib/types";
import { isProduction, getTranscriptLocalPath, getTranscriptR2Key } from "../lib/utils";
import { restoreTranscriptFromR2, saveTranscriptToR2 } from "../services/transcripts.service";

const sessionsRoutes = new Hono<{ Bindings: Bindings }>();

/**
 * Restores a session transcript from R2 to the sandbox.
 *
 * Call this BEFORE sending a message with the SDK's `resume` option.
 * The transcript must be present in the sandbox filesystem for the
 * SDK to restore conversation context.
 *
 * @route POST /:sandboxSessionId/restore
 */
sessionsRoutes.post("/:sandboxSessionId/restore", async (c) => {
  try {
    const sandboxSessionId = c.req.param("sandboxSessionId");
    const body = await c.req.json<{ userId: string; sdkSessionId: string }>();

    if (!body.userId || !body.sdkSessionId) {
      return c.json({ error: "userId and sdkSessionId are required" }, 400);
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

    const sandbox = getSandbox(c.env.Sandbox, sandboxSessionId);
    const restored = await restoreTranscriptFromR2(
      sandbox,
      c.env.USER_DATA,
      body.userId,
      body.sdkSessionId
    );

    return c.json({
      status: restored ? "restored" : "not_found",
      sandboxSessionId,
      sdkSessionId: body.sdkSessionId,
      userId: body.userId,
      localPath: getTranscriptLocalPath(body.sdkSessionId),
    });
  } catch (error: any) {
    console.error("[Restore Transcript Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Saves a session transcript from sandbox to R2.
 *
 * Call this on session end or WebSocket disconnect to persist the
 * conversation transcript for future resumption.
 *
 * @route POST /:sandboxSessionId/sync
 */
sessionsRoutes.post("/:sandboxSessionId/sync", async (c) => {
  try {
    const sandboxSessionId = c.req.param("sandboxSessionId");
    const body = await c.req.json<{ userId: string; sdkSessionId: string }>();

    if (!body.userId || !body.sdkSessionId) {
      return c.json({ error: "userId and sdkSessionId are required" }, 400);
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

    const sandbox = getSandbox(c.env.Sandbox, sandboxSessionId);
    const saved = await saveTranscriptToR2(
      sandbox,
      c.env.USER_DATA,
      body.userId,
      body.sdkSessionId
    );

    return c.json({
      status: saved ? "synced" : "no_transcript",
      sandboxSessionId,
      sdkSessionId: body.sdkSessionId,
      userId: body.userId,
      r2Key: getTranscriptR2Key(body.userId, body.sdkSessionId),
    });
  } catch (error: any) {
    console.error("[Sync Transcript Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

export { sessionsRoutes };
