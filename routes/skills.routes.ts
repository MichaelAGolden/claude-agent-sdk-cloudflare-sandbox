/**
 * @fileoverview Skills API endpoints (public, frontend-facing).
 *
 * Public-facing API for managing user skills. These endpoints are designed
 * for frontend consumption and accept userId as a query parameter or in
 * the request body.
 *
 * Skills are markdown files that extend Claude's capabilities with custom
 * instructions, workflows, or domain knowledge.
 *
 * @module routes/skills
 */

import { Hono } from "hono";
import type { Bindings } from "../lib/types";
import { getUserSkillKey } from "../lib/utils";
import { listUserSkillsFromR2 } from "../services/skills.service";
import { restartAgentForSkillsReload } from "../services/sandbox.service";

const skillsRoutes = new Hono<{ Bindings: Bindings }>();

/**
 * Lists all skills for a user.
 *
 * Returns the names of all skills stored in R2 for the specified user.
 *
 * @route GET /
 */
skillsRoutes.get("/", async (c) => {
  try {
    const userId = c.req.query("userId");
    if (!userId) {
      return c.json({ error: "userId query parameter is required" }, 400);
    }

    const skillNames = await listUserSkillsFromR2(c.env.USER_DATA, userId);

    return c.json({
      userId,
      skills: skillNames,
      count: skillNames.length,
    });
  } catch (error: any) {
    console.error("[API Skills List Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Uploads a new skill for a user.
 *
 * Stores the skill content in R2 and triggers an agent restart to load
 * the new skill.
 *
 * @route POST /
 */
skillsRoutes.post("/", async (c) => {
  try {
    const body = await c.req.json<{ userId: string; name: string; content: string }>();

    if (!body.userId) {
      return c.json({ error: "userId is required" }, 400);
    }
    if (!body.name || !body.content) {
      return c.json({ error: "name and content are required" }, 400);
    }

    // Store in R2
    const key = getUserSkillKey(body.userId, body.name);
    await c.env.USER_DATA.put(key, body.content, {
      httpMetadata: {
        contentType: "text/markdown",
      },
      customMetadata: {
        userId: body.userId,
        uploadedAt: new Date().toISOString(),
      },
    });

    // Restart the agent process to discover the new skill
    const result = await restartAgentForSkillsReload(c.env.Sandbox, c.env.USER_DATA, body.userId);

    return c.json({
      status: "success",
      message: result.restarted
        ? "Skill uploaded and agent restarted. The skill is now available."
        : "Skill uploaded. Refresh the page to load the new skill.",
      userId: body.userId,
      skillName: body.name,
      r2Key: key,
      agentRestarted: result.restarted,
      skillsLoaded: result.skillsLoaded,
    });
  } catch (error: any) {
    console.error("[API Skills Upload Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Retrieves a specific skill's content and metadata.
 *
 * @route GET /:skillName
 */
skillsRoutes.get("/:skillName", async (c) => {
  try {
    const userId = c.req.query("userId");
    if (!userId) {
      return c.json({ error: "userId query parameter is required" }, 400);
    }

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
    console.error("[API Skills Get Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Deletes a skill for a user.
 *
 * Removes the skill from R2 storage and triggers an agent restart
 * to remove the skill from the agent's knowledge.
 *
 * @route DELETE /:skillName
 */
skillsRoutes.delete("/:skillName", async (c) => {
  try {
    const userId = c.req.query("userId");
    if (!userId) {
      return c.json({ error: "userId query parameter is required" }, 400);
    }

    const skillName = c.req.param("skillName");
    const key = getUserSkillKey(userId, skillName);

    // Check if skill exists
    const obj = await c.env.USER_DATA.get(key);
    if (!obj) {
      return c.json({ error: "Skill not found" }, 404);
    }

    // Delete from R2
    await c.env.USER_DATA.delete(key);

    // Restart the agent process to remove the deleted skill
    const result = await restartAgentForSkillsReload(c.env.Sandbox, c.env.USER_DATA, userId);

    return c.json({
      status: "deleted",
      message: result.restarted
        ? "Skill deleted and agent restarted. The skill has been removed."
        : "Skill deleted. Refresh the page to update skills.",
      userId,
      skillName,
      agentRestarted: result.restarted,
      remainingSkills: result.skillsLoaded,
    });
  } catch (error: any) {
    console.error("[API Skills Delete Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

export { skillsRoutes };
