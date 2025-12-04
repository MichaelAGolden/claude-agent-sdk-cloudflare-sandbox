/**
 * @fileoverview Thread API endpoints for conversation management.
 *
 * Threads are the primary container for conversations. Each thread represents
 * a distinct conversation with its own message history. Threads are stored in
 * D1 (SQLite) for structured querying and fast retrieval.
 *
 * All routes require Clerk JWT authentication. The userId is extracted from
 * the verified token, not from query parameters or request bodies.
 *
 * @module routes/threads
 */

import { Hono } from "hono";
import type { Bindings, Thread, Message } from "../lib/types";
import { generateUUID, getTranscriptR2Key } from "../lib/utils";
import { generateThreadTitle } from "../services/title-generator.service";
import { requireAuth, getAuthUserId } from "./middleware";

const threadsRoutes = new Hono<{ Bindings: Bindings; Variables: { authenticatedUserId: string } }>();

// Apply auth middleware to all routes
threadsRoutes.use("/*", requireAuth);

/**
 * Lists all conversation threads for the authenticated user.
 *
 * Returns threads in reverse chronological order (most recently updated first).
 * Soft-deleted threads are excluded from results.
 *
 * @route GET /
 */
threadsRoutes.get("/", async (c) => {
  try {
    // Get userId from verified JWT token (not from query params)
    const userId = getAuthUserId(c);

    if (!c.env.DB) {
        console.error("[API Threads] DB binding missing. Check wrangler.toml or context loss.");
        return c.json({ error: "Database configuration error" }, 500);
    }

    const result = await c.env.DB.prepare(
      `SELECT id, user_id, project_id, session_id, title, summary, model, created_at, updated_at
       FROM threads
       WHERE user_id = ? AND deleted_at IS NULL
       ORDER BY updated_at DESC`
    ).bind(userId).all<Thread>();

    return c.json({
      threads: result.results || [],
      count: result.results?.length || 0,
    });
  } catch (error: any) {
    console.error("[List Threads Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Creates a new conversation thread for the authenticated user.
 *
 * Creates a thread with the specified title (or default "New conversation").
 * If projectId is provided, the thread is associated with that project.
 * Automatically creates the user record if it doesn't exist (upsert).
 *
 * @route POST /
 */
threadsRoutes.post("/", async (c) => {
  try {
    // Get userId from verified JWT token
    const userId = getAuthUserId(c);
    const body = await c.req.json<{ title?: string; projectId?: string }>().catch(() => ({ title: undefined, projectId: undefined }));

    const threadId = generateUUID();
    const title = body.title || "New conversation";
    const now = new Date().toISOString();

    // Ensure user exists (upsert)
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO users (id) VALUES (?)`
    ).bind(userId).run();

    // Verify project exists if provided
    if (body.projectId) {
      const project = await c.env.DB.prepare(
        `SELECT id FROM projects WHERE id = ? AND user_id = ? AND deleted_at IS NULL`
      ).bind(body.projectId, userId).first();

      if (!project) {
        return c.json({ error: "Project not found" }, 404);
      }
    }

    // Create thread with optional project_id
    await c.env.DB.prepare(
      `INSERT INTO threads (id, user_id, project_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(threadId, userId, body.projectId || null, title, now, now).run();

    return c.json({
      id: threadId,
      user_id: userId,
      project_id: body.projectId || null,
      title,
      session_id: null,
      summary: null,
      created_at: now,
      updated_at: now,
    });
  } catch (error: any) {
    console.error("[Create Thread Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Retrieves a thread with all its messages.
 *
 * Returns the thread metadata along with its complete message history
 * in chronological order (oldest first). Only returns threads owned by
 * the authenticated user.
 *
 * @route GET /:id
 */
threadsRoutes.get("/:id", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const threadId = c.req.param("id");

    // Get thread - MUST belong to authenticated user
    const thread = await c.env.DB.prepare(
      `SELECT id, user_id, project_id, session_id, title, summary, model, created_at, updated_at
       FROM threads WHERE id = ? AND user_id = ?`
    ).bind(threadId, userId).first<Thread>();

    if (!thread) {
      return c.json({ error: "Thread not found" }, 404);
    }

    // Get messages
    const messagesResult = await c.env.DB.prepare(
      `SELECT id, thread_id, role, content, hook_event, created_at
       FROM messages
       WHERE thread_id = ?
       ORDER BY created_at ASC`
    ).bind(threadId).all<Message>();

    return c.json({
      thread,
      messages: messagesResult.results || [],
    });
  } catch (error: any) {
    console.error("[Get Thread Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Updates thread metadata.
 *
 * Allows partial updates to thread properties. Only provided fields
 * are updated; omitted fields remain unchanged. Only the thread owner
 * can update the thread.
 *
 * @route PATCH /:id
 */
threadsRoutes.patch("/:id", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const threadId = c.req.param("id");
    const body = await c.req.json<{ title?: string; sessionId?: string; summary?: string; model?: string }>();

    // Verify ownership first
    const existing = await c.env.DB.prepare(
      `SELECT id FROM threads WHERE id = ? AND user_id = ?`
    ).bind(threadId, userId).first();

    if (!existing) {
      return c.json({ error: "Thread not found" }, 404);
    }

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];

    if (body.title !== undefined) {
      updates.push("title = ?");
      values.push(body.title);
    }
    if (body.sessionId !== undefined) {
      updates.push("session_id = ?");
      values.push(body.sessionId);
    }
    if (body.summary !== undefined) {
      updates.push("summary = ?");
      values.push(body.summary);
    }
    if (body.model !== undefined) {
      updates.push("model = ?");
      values.push(body.model);
    }

    if (updates.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    updates.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(threadId);
    values.push(userId); // Add userId to WHERE clause

    await c.env.DB.prepare(
      `UPDATE threads SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`
    ).bind(...values).run();

    // Return updated thread
    const thread = await c.env.DB.prepare(
      `SELECT id, user_id, project_id, session_id, title, summary, model, created_at, updated_at
       FROM threads WHERE id = ? AND user_id = ?`
    ).bind(threadId, userId).first<Thread>();

    return c.json(thread);
  } catch (error: any) {
    console.error("[Update Thread Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Soft-deletes a thread.
 *
 * Performs a soft delete by setting the `deleted_at` timestamp. The thread
 * data is preserved in D1 for usage tracking and audit purposes.
 * Only the thread owner can delete the thread.
 *
 * @route DELETE /:id
 */
threadsRoutes.delete("/:id", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const threadId = c.req.param("id");

    // Get thread info - MUST belong to authenticated user
    const thread = await c.env.DB.prepare(
      `SELECT id, user_id, session_id FROM threads WHERE id = ? AND user_id = ? AND deleted_at IS NULL`
    ).bind(threadId, userId).first<{ id: string; user_id: string; session_id: string | null }>();

    if (!thread) {
      return c.json({ error: "Thread not found" }, 404);
    }

    // Delete R2 transcript if session exists (cleanup conversation context)
    let r2Deleted = false;
    if (thread.session_id && c.env.USER_DATA) {
      try {
        const r2Key = getTranscriptR2Key(thread.user_id, thread.session_id);
        await c.env.USER_DATA.delete(r2Key);
        r2Deleted = true;
        console.log(`[Delete Thread] Deleted R2 transcript: ${r2Key}`);
      } catch (r2Error: any) {
        // Log but don't fail - R2 cleanup is best-effort
        console.error(`[Delete Thread] Failed to delete R2 transcript:`, r2Error.message);
      }
    }

    // Soft delete: set deleted_at timestamp instead of hard delete
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE threads SET deleted_at = ? WHERE id = ? AND user_id = ?`
    ).bind(now, threadId, userId).run();

    return c.json({
      status: "deleted",
      threadId,
      deletedAt: now,
      r2Deleted,
      preservedForTracking: true,
    });
  } catch (error: any) {
    console.error("[Delete Thread Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Adds a message to a thread.
 *
 * Appends a new message to the thread's conversation history.
 * Only the thread owner can add messages.
 *
 * @route POST /:id/messages
 */
threadsRoutes.post("/:id/messages", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const threadId = c.req.param("id");
    const body = await c.req.json<{ role: string; content: string; hookEvent?: any }>();

    // Verify thread ownership
    const thread = await c.env.DB.prepare(
      `SELECT id FROM threads WHERE id = ? AND user_id = ?`
    ).bind(threadId, userId).first();

    if (!thread) {
      return c.json({ error: "Thread not found" }, 404);
    }

    if (!body.role || body.content === undefined) {
      return c.json({ error: "role and content are required" }, 400);
    }

    const messageId = generateUUID();
    const now = new Date().toISOString();
    const contentStr = typeof body.content === 'string' ? body.content : JSON.stringify(body.content);
    const hookEventStr = body.hookEvent ? JSON.stringify(body.hookEvent) : null;

    // Insert message
    await c.env.DB.prepare(
      `INSERT INTO messages (id, thread_id, role, content, hook_event, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(messageId, threadId, body.role, contentStr, hookEventStr, now).run();

    // Update thread's updated_at (with ownership check)
    await c.env.DB.prepare(
      `UPDATE threads SET updated_at = ? WHERE id = ? AND user_id = ?`
    ).bind(now, threadId, userId).run();

    return c.json({
      id: messageId,
      thread_id: threadId,
      role: body.role,
      content: contentStr,
      hook_event: hookEventStr,
      created_at: now,
    });
  } catch (error: any) {
    console.error("[Add Message Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Generates a title for a thread using Claude Haiku.
 *
 * Analyzes the first user message in the thread and generates a concise
 * 3-6 word title. Only the thread owner can generate titles.
 *
 * @route POST /:id/title
 */
threadsRoutes.post("/:id/title", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const threadId = c.req.param("id");

    // Verify thread ownership
    const thread = await c.env.DB.prepare(
      `SELECT id FROM threads WHERE id = ? AND user_id = ?`
    ).bind(threadId, userId).first();

    if (!thread) {
      return c.json({ error: "Thread not found" }, 404);
    }

    // Get first user message
    const firstMessage = await c.env.DB.prepare(
      `SELECT content FROM messages
       WHERE thread_id = ? AND role = 'user'
       ORDER BY created_at ASC
       LIMIT 1`
    ).bind(threadId).first<{ content: string }>();

    if (!firstMessage) {
      return c.json({ error: "No user message found" }, 400);
    }

    // Call Haiku to generate title
    const apiKey = c.env.ANTHROPIC_API_KEY || c.env.CLAUDE_CODE_OAUTH_TOKEN;
    if (!apiKey) {
      return c.json({ error: "No API key configured" }, 500);
    }

    const title = await generateThreadTitle(apiKey, firstMessage.content);

    // Update thread title (with ownership check)
    await c.env.DB.prepare(
      `UPDATE threads SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?`
    ).bind(title, new Date().toISOString(), threadId, userId).run();

    return c.json({ threadId, title });
  } catch (error: any) {
    console.error("[Generate Title Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

export { threadsRoutes };
