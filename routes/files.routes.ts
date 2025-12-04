/**
 * @fileoverview File synchronization API endpoints.
 *
 * These endpoints manage file persistence for Claude sessions, ensuring
 * artifacts created by the agent are captured and can be restored later.
 *
 * ## Sync Strategy
 * 1. **Immediate capture** - POST /sync/file syncs a single file immediately
 * 2. **Hook capture** - POST /sync/hook extracts and syncs files from hook data
 * 3. **Full sync** - POST /sync/full syncs all directories on session end
 * 4. **Restore** - POST /restore loads all files back to sandbox
 *
 * @module routes/files
 */

import { Hono } from "hono";
import { getSandbox } from "@cloudflare/sandbox";
import type { Bindings } from "../lib/types";
import { isProduction, normalizeUserId } from "../lib/utils";
import {
  syncSingleFile,
  syncFilesFromHook,
  fullSync,
  restoreFromR2,
  getFileR2Key,
  getFilesR2Prefix,
} from "../services/file-sync.service";
import { requireAuth, getAuthUserId } from "./middleware";

const filesRoutes = new Hono<{ Bindings: Bindings; Variables: { authenticatedUserId: string } }>();

// Apply auth middleware to all routes
filesRoutes.use("/*", requireAuth);

/**
 * Syncs a single file from sandbox to R2.
 *
 * Called immediately when a file is detected in a hook event.
 *
 * @route POST /:sandboxSessionId/sync/file
 * @body { filePath: string } - Absolute path to the file in sandbox
 */
filesRoutes.post("/:sandboxSessionId/sync/file", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const sandboxSessionId = normalizeUserId(c.req.param("sandboxSessionId"));
    const body = await c.req.json<{ filePath: string }>();

    if (!body.filePath) {
      return c.json({ error: "filePath is required" }, 400);
    }

    // Check production mode
    if (!isProduction(c.env)) {
      return c.json({
        status: "skipped",
        reason: "R2 sync not available in development mode",
        filePath: body.filePath,
      });
    }

    // Verify session ownership
    if (sandboxSessionId !== userId) {
      return c.json({ error: "Unauthorized: cannot access other user's sandbox" }, 403);
    }

    const sandbox = getSandbox(c.env.Sandbox, sandboxSessionId);
    const result = await syncSingleFile(sandbox, c.env.USER_DATA, userId, body.filePath);

    return c.json({
      status: result.success ? "synced" : "failed",
      ...result,
      r2Key: result.success && !result.skipped ? getFileR2Key(userId, body.filePath) : undefined,
    });
  } catch (error: any) {
    console.error("[File Sync Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Extracts file paths from hook data and syncs them.
 *
 * Called when a PostToolUse hook event is received.
 * Parses the hook data to find file paths and syncs each one.
 *
 * @route POST /:sandboxSessionId/sync/hook
 * @body { hookData: object } - The raw PostToolUse hook event data
 */
filesRoutes.post("/:sandboxSessionId/sync/hook", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const sandboxSessionId = normalizeUserId(c.req.param("sandboxSessionId"));
    const body = await c.req.json<{ hookData: unknown }>();

    if (!body.hookData) {
      return c.json({ error: "hookData is required" }, 400);
    }

    // Check production mode
    if (!isProduction(c.env)) {
      return c.json({
        status: "skipped",
        reason: "R2 sync not available in development mode",
      });
    }

    // Verify session ownership
    if (sandboxSessionId !== userId) {
      return c.json({ error: "Unauthorized: cannot access other user's sandbox" }, 403);
    }

    const sandbox = getSandbox(c.env.Sandbox, sandboxSessionId);
    const results = await syncFilesFromHook(sandbox, c.env.USER_DATA, userId, body.hookData);

    const successCount = results.filter(r => r.success && !r.skipped).length;
    const skippedCount = results.filter(r => r.skipped).length;
    const failedCount = results.filter(r => !r.success).length;

    return c.json({
      status: "processed",
      filesFound: results.length,
      filesSynced: successCount,
      filesSkipped: skippedCount,
      filesFailed: failedCount,
      results,
    });
  } catch (error: any) {
    console.error("[Hook Sync Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Performs a full sync of all directories to R2.
 *
 * Called on session end or disconnect to ensure all files are captured.
 * Syncs /workspace, /home/user, and /root/.claude directories.
 *
 * @route POST /:sandboxSessionId/sync/full
 */
filesRoutes.post("/:sandboxSessionId/sync/full", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const sandboxSessionId = normalizeUserId(c.req.param("sandboxSessionId"));

    // Check production mode
    if (!isProduction(c.env)) {
      return c.json({
        status: "skipped",
        reason: "R2 sync not available in development mode",
      });
    }

    // Verify session ownership
    if (sandboxSessionId !== userId) {
      return c.json({ error: "Unauthorized: cannot access other user's sandbox" }, 403);
    }

    const sandbox = getSandbox(c.env.Sandbox, sandboxSessionId);
    const result = await fullSync(sandbox, c.env.USER_DATA, userId);

    return c.json({
      status: "synced",
      ...result,
      r2Prefix: getFilesR2Prefix(userId),
    });
  } catch (error: any) {
    console.error("[Full Sync Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Restores all synced files from R2 to sandbox.
 *
 * Called on session resume to restore the user's workspace state.
 *
 * @route POST /:sandboxSessionId/restore
 */
filesRoutes.post("/:sandboxSessionId/restore", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const sandboxSessionId = normalizeUserId(c.req.param("sandboxSessionId"));

    // Check production mode
    if (!isProduction(c.env)) {
      return c.json({
        status: "skipped",
        reason: "R2 restore not available in development mode",
      });
    }

    // Verify session ownership
    if (sandboxSessionId !== userId) {
      return c.json({ error: "Unauthorized: cannot access other user's sandbox" }, 403);
    }

    const sandbox = getSandbox(c.env.Sandbox, sandboxSessionId);
    const result = await restoreFromR2(sandbox, c.env.USER_DATA, userId);

    return c.json({
      status: "restored",
      ...result,
    });
  } catch (error: any) {
    console.error("[Restore Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Lists all synced files for a user from R2.
 *
 * Useful for debugging and UI display of what's been captured.
 *
 * @route GET /:sandboxSessionId/files
 * @query prefix - Optional prefix to filter files (e.g., "home/user")
 */
filesRoutes.get("/:sandboxSessionId/files", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const sandboxSessionId = normalizeUserId(c.req.param("sandboxSessionId"));
    const prefix = c.req.query("prefix");

    // Check production mode
    if (!isProduction(c.env)) {
      return c.json({
        status: "skipped",
        reason: "R2 not available in development mode",
        files: [],
      });
    }

    // Verify session ownership
    if (sandboxSessionId !== userId) {
      return c.json({ error: "Unauthorized: cannot access other user's files" }, 403);
    }

    const r2Prefix = prefix
      ? `users/${userId}/files/${prefix}`
      : getFilesR2Prefix(userId);

    const files: Array<{
      path: string;
      size: number;
      syncedAt?: string;
    }> = [];

    let cursor: string | undefined;

    do {
      const listing = await c.env.USER_DATA.list({ prefix: r2Prefix, cursor });

      for (const object of listing.objects) {
        // Extract sandbox path from R2 key
        const sandboxPath = '/' + object.key.replace(getFilesR2Prefix(userId), '');

        files.push({
          path: sandboxPath,
          size: object.size,
          // Custom metadata is available in object headers
        });
      }

      cursor = listing.truncated ? listing.cursor : undefined;
    } while (cursor);

    return c.json({
      status: "ok",
      count: files.length,
      files,
      r2Prefix,
    });
  } catch (error: any) {
    console.error("[List Files Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Serves a synced file from R2.
 *
 * This allows accessing files that were captured even after the sandbox
 * has been destroyed or hibernated.
 *
 * @route GET /:sandboxSessionId/file
 * @query path - The sandbox path of the file (e.g., "/home/user/output.png")
 */
filesRoutes.get("/:sandboxSessionId/file", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const sandboxSessionId = normalizeUserId(c.req.param("sandboxSessionId"));
    const filePath = c.req.query("path");

    if (!filePath) {
      return c.json({ error: "path query parameter is required" }, 400);
    }

    // Check production mode
    if (!isProduction(c.env)) {
      return c.json({
        status: "skipped",
        reason: "R2 not available in development mode",
      });
    }

    // Verify session ownership
    if (sandboxSessionId !== userId) {
      return c.json({ error: "Unauthorized: cannot access other user's files" }, 403);
    }

    const r2Key = getFileR2Key(userId, filePath);
    const object = await c.env.USER_DATA.get(r2Key);

    if (!object) {
      return c.json({ error: "File not found in R2" }, 404);
    }

    // Get content type from object metadata or derive from extension
    let contentType = object.httpMetadata?.contentType;
    if (!contentType) {
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      const contentTypes: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        pdf: 'application/pdf',
        json: 'application/json',
        txt: 'text/plain',
        md: 'text/markdown',
        html: 'text/html',
        css: 'text/css',
        js: 'application/javascript',
        py: 'text/x-python',
      };
      contentType = contentTypes[ext] || 'application/octet-stream';
    }

    return new Response(object.body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
        'ETag': object.etag,
      },
    });
  } catch (error: any) {
    console.error("[Serve File Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

export { filesRoutes };
