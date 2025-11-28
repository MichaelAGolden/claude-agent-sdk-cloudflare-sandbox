/**
 * @fileoverview Thread API endpoints for conversation management.
 *
 * Threads are the primary container for conversations. Each thread represents
 * a distinct conversation with its own message history. Threads are stored in
 * D1 (SQLite) for structured querying and fast retrieval.
 *
 * @module routes/threads
 */

import { Hono } from "hono";
import type { Bindings, Thread, Message } from "../lib/types";
import { generateUUID, getTranscriptR2Key } from "../lib/utils";
import { generateThreadTitle } from "../services/title-generator.service";

const threadsRoutes = new Hono<{ Bindings: Bindings }>();

/**
 * Lists all conversation threads for a user.
 *
 * Returns threads in reverse chronological order (most recently updated first).
 * Soft-deleted threads are excluded from results.
 *
 * @route GET /
 */
threadsRoutes.get("/", async (c) => {
  try {
    const userId = c.req.query("userId");
    if (!userId) {
      return c.json({ error: "userId query parameter is required" }, 400);
    }

    const result = await c.env.DB.prepare(
      `SELECT id, user_id, session_id, title, summary, created_at, updated_at
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
 * Creates a new conversation thread.
 *
 * Creates a thread with the specified title (or default "New conversation").
 * Automatically creates the user record if it doesn't exist (upsert).
 *
 * @route POST /
 */
threadsRoutes.post("/", async (c) => {
  try {
    const body = await c.req.json<{ userId: string; title?: string }>();

    if (!body.userId) {
      return c.json({ error: "userId is required" }, 400);
    }

    const threadId = generateUUID();
    const title = body.title || "New conversation";
    const now = new Date().toISOString();

    // Ensure user exists (upsert)
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO users (id) VALUES (?)`
    ).bind(body.userId).run();

    // Create thread
    await c.env.DB.prepare(
      `INSERT INTO threads (id, user_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(threadId, body.userId, title, now, now).run();

    return c.json({
      id: threadId,
      user_id: body.userId,
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
 * in chronological order (oldest first).
 *
 * @route GET /:id
 */
threadsRoutes.get("/:id", async (c) => {
  try {
    const threadId = c.req.param("id");

    // Get thread
    const thread = await c.env.DB.prepare(
      `SELECT id, user_id, session_id, title, summary, created_at, updated_at
       FROM threads WHERE id = ?`
    ).bind(threadId).first<Thread>();

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
 * are updated; omitted fields remain unchanged.
 *
 * @route PATCH /:id
 */
threadsRoutes.patch("/:id", async (c) => {
  try {
    const threadId = c.req.param("id");
    const body = await c.req.json<{ title?: string; sessionId?: string; summary?: string }>();

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

    if (updates.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    updates.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(threadId);

    await c.env.DB.prepare(
      `UPDATE threads SET ${updates.join(", ")} WHERE id = ?`
    ).bind(...values).run();

    // Return updated thread
    const thread = await c.env.DB.prepare(
      `SELECT id, user_id, session_id, title, summary, created_at, updated_at
       FROM threads WHERE id = ?`
    ).bind(threadId).first<Thread>();

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
 *
 * @route DELETE /:id
 */
threadsRoutes.delete("/:id", async (c) => {
  try {
    const threadId = c.req.param("id");

    // Get thread info before soft-deleting (need user_id and session_id for R2 cleanup)
    const thread = await c.env.DB.prepare(
      `SELECT id, user_id, session_id FROM threads WHERE id = ? AND deleted_at IS NULL`
    ).bind(threadId).first<{ id: string; user_id: string; session_id: string | null }>();

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
      `UPDATE threads SET deleted_at = ? WHERE id = ?`
    ).bind(now, threadId).run();

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
 *
 * @route POST /:id/messages
 */
threadsRoutes.post("/:id/messages", async (c) => {
  try {
    const threadId = c.req.param("id");
    const body = await c.req.json<{ role: string; content: string; hookEvent?: any }>();

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

    // Update thread's updated_at
    await c.env.DB.prepare(
      `UPDATE threads SET updated_at = ? WHERE id = ?`
    ).bind(now, threadId).run();

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
 * 3-6 word title.
 *
 * @route POST /:id/title
 */
threadsRoutes.post("/:id/title", async (c) => {
  try {
    const threadId = c.req.param("id");

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

    // Update thread title
    await c.env.DB.prepare(
      `UPDATE threads SET title = ?, updated_at = ? WHERE id = ?`
    ).bind(title, new Date().toISOString(), threadId).run();

    return c.json({ threadId, title });
  } catch (error: any) {
    console.error("[Generate Title Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

export { threadsRoutes };
