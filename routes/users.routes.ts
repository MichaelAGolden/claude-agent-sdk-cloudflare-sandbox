/**
 * @fileoverview Protected user resource API endpoints.
 *
 * These endpoints provide API-key-protected access to user resources.
 * They're designed for server-to-server communication and administrative
 * operations. All endpoints require the API_KEY in the Authorization header.
 *
 * @module routes/users
 */

import { Hono } from "hono";
import type { Bindings, Skill } from "../lib/types";
import { getUserSkillKey } from "../lib/utils";
import { listUserSkillsFromR2 } from "../services/skills.service";
import { requireApiKey } from "./middleware/auth.middleware";

const usersRoutes = new Hono<{ Bindings: Bindings }>();

// Apply auth middleware to all routes
usersRoutes.use("/*", requireApiKey);

/**
 * Uploads a skill for a user (protected endpoint).
 *
 * Stores a skill in R2 storage. Unlike the public /api/skills endpoint,
 * this does NOT trigger an agent restart - it's meant for batch operations.
 *
 * @route POST /:userId/skills
 */
usersRoutes.post("/:userId/skills", async (c) => {
  try {
    const userId = c.req.param("userId");
    const body = await c.req.json<Skill>().catch(() => ({ name: "", content: "" }));

    if (!body.name || !body.content) {
      return c.json({ error: "Skill name and content are required" }, 400);
    }

    // Store in R2
    const key = getUserSkillKey(userId, body.name);
    await c.env.USER_DATA.put(key, body.content, {
      httpMetadata: {
        contentType: "text/markdown",
      },
      customMetadata: {
        userId,
        uploadedAt: new Date().toISOString(),
      },
    });

    return c.json({
      status: "success",
      userId,
      skillName: body.name,
      key,
      message: "Skill saved to R2. Call /setup/:sessionId to load into sandbox.",
    });
  } catch (error: any) {
    console.error("[Upload Skill Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Lists all skills for a user (protected endpoint).
 *
 * @route GET /:userId/skills
 */
usersRoutes.get("/:userId/skills", async (c) => {
  try {
    const userId = c.req.param("userId");
    const skillNames = await listUserSkillsFromR2(c.env.USER_DATA, userId);

    return c.json({
      userId,
      skills: skillNames,
      count: skillNames.length,
    });
  } catch (error: any) {
    console.error("[List Skills Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Retrieves a specific skill for a user (protected endpoint).
 *
 * @route GET /:userId/skills/:skillName
 */
usersRoutes.get("/:userId/skills/:skillName", async (c) => {
  try {
    const userId = c.req.param("userId");
    const skillName = c.req.param("skillName");
    const key = getUserSkillKey(userId, skillName);

    const obj = await c.env.USER_DATA.get(key);
    if (!obj) {
      return c.json({ error: "Skill not found" }, 404);
    }

    const content = await obj.text();
    const metadata = obj.customMetadata;

    return c.json({
      userId,
      skillName,
      content,
      metadata,
      uploaded: obj.uploaded,
      size: obj.size,
    });
  } catch (error: any) {
    console.error("[Get Skill Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Deletes a skill for a user (protected endpoint).
 *
 * @route DELETE /:userId/skills/:skillName
 */
usersRoutes.delete("/:userId/skills/:skillName", async (c) => {
  try {
    const userId = c.req.param("userId");
    const skillName = c.req.param("skillName");
    const key = getUserSkillKey(userId, skillName);

    await c.env.USER_DATA.delete(key);

    return c.json({
      status: "deleted",
      userId,
      skillName,
      key,
    });
  } catch (error: any) {
    console.error("[Delete Skill Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Saves a conversation snapshot to R2 (protected endpoint).
 *
 * Stores a complete conversation export including all messages and metadata.
 *
 * @route POST /:userId/conversations
 */
usersRoutes.post("/:userId/conversations", async (c) => {
  try {
    const userId = c.req.param("userId");
    const body = await c.req.json<any>();

    if (!body.conversationId) {
      return c.json({ error: "conversationId is required" }, 400);
    }

    const key = `users/${userId}/conversations/${body.conversationId}.json`;
    await c.env.USER_DATA.put(key, JSON.stringify(body), {
      httpMetadata: {
        contentType: "application/json",
      },
      customMetadata: {
        userId,
        conversationId: body.conversationId,
        savedAt: new Date().toISOString(),
      },
    });

    return c.json({
      status: "saved",
      userId,
      conversationId: body.conversationId,
      key,
    });
  } catch (error: any) {
    console.error("[Save Conversation Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Retrieves a saved conversation from R2 (protected endpoint).
 *
 * @route GET /:userId/conversations/:conversationId
 */
usersRoutes.get("/:userId/conversations/:conversationId", async (c) => {
  try {
    const userId = c.req.param("userId");
    const conversationId = c.req.param("conversationId");
    const key = `users/${userId}/conversations/${conversationId}.json`;

    const obj = await c.env.USER_DATA.get(key);
    if (!obj) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    const conversation = await obj.json();

    return c.json({
      userId,
      conversationId,
      conversation,
      metadata: obj.customMetadata,
      uploaded: obj.uploaded,
    });
  } catch (error: any) {
    console.error("[Get Conversation Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

export { usersRoutes };
