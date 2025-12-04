/**
 * @fileoverview Skills API endpoints (authenticated, frontend-facing).
 *
 * API for managing user and project-scoped skills. All endpoints require Clerk JWT authentication.
 * The userId is extracted from the verified token, not from query parameters.
 *
 * Skills are markdown files that extend Claude's capabilities with custom
 * instructions, workflows, or domain knowledge.
 *
 * ## Skill Scoping
 * - User skills: Available across all projects (no projectId)
 * - Project skills: Only available within a specific project (requires projectId)
 *
 * @module routes/skills
 */

import { Hono } from "hono";
import type { Bindings } from "../lib/types";
import { getUserSkillKey, getProjectSkillKey } from "../lib/utils";
import {
  listAllSkillsFromR2,
  listProjectSkillsFromR2,
  type SkillInfo,
} from "../services/skills.service";
import { restartAgentForSkillsReload } from "../services/sandbox.service";
import { requireAuth, getAuthUserId } from "./middleware";

const skillsRoutes = new Hono<{ Bindings: Bindings; Variables: { authenticatedUserId: string } }>();

// Apply auth middleware to all routes
skillsRoutes.use("/*", requireAuth);

/**
 * Lists all skills for the authenticated user.
 *
 * Returns both user-scoped and project-scoped skills if projectId is provided.
 * Each skill includes scope information ('user' or 'project').
 *
 * @route GET /
 * @query projectId - Optional project ID to include project-scoped skills
 */
skillsRoutes.get("/", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const projectId = c.req.query("projectId");

    if (!c.env.USER_DATA) {
      console.error("[API Skills] USER_DATA binding missing. Check wrangler.toml or context loss.");
      return c.json({ error: "Storage configuration error" }, 500);
    }

    const skills = await listAllSkillsFromR2(c.env.USER_DATA, userId, projectId);

    return c.json({
      userId,
      projectId: projectId || null,
      skills,
      count: skills.length,
    });
  } catch (error: any) {
    console.error("[API Skills List Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Uploads a new skill for the authenticated user.
 *
 * If projectId is provided, creates a project-scoped skill.
 * Otherwise, creates a user-scoped skill (available in all projects).
 *
 * @route POST /
 */
skillsRoutes.post("/", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const body = await c.req.json<{
      name: string;
      content: string;
      projectId?: string;
    }>();

    if (!body.name || !body.content) {
      return c.json({ error: "name and content are required" }, 400);
    }

    // Determine scope and R2 key
    const scope = body.projectId ? 'project' : 'user';
    const key = body.projectId
      ? getProjectSkillKey(userId, body.projectId, body.name)
      : getUserSkillKey(userId, body.name);

    // Store in R2
    await c.env.USER_DATA.put(key, body.content, {
      httpMetadata: {
        contentType: "text/markdown",
      },
      customMetadata: {
        userId,
        scope,
        projectId: body.projectId || '',
        uploadedAt: new Date().toISOString(),
      },
    });

    // Restart the agent process to discover the new skill
    const result = await restartAgentForSkillsReload(c.env.Sandbox, c.env.USER_DATA, userId, body.projectId);

    return c.json({
      status: "success",
      message: result.restarted
        ? "Skill uploaded and agent restarted. The skill is now available."
        : "Skill uploaded. Refresh the page to load the new skill.",
      userId,
      skillName: body.name,
      scope,
      projectId: body.projectId || null,
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
 * Retrieves a specific skill's content and metadata for the authenticated user.
 *
 * @route GET /:skillName
 * @query projectId - If provided, looks for project-scoped skill first
 */
skillsRoutes.get("/:skillName", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const skillName = c.req.param("skillName");
    const projectId = c.req.query("projectId");

    // Try project-scoped skill first if projectId provided
    if (projectId) {
      const projectKey = getProjectSkillKey(userId, projectId, skillName);
      const projectObj = await c.env.USER_DATA.get(projectKey);
      if (projectObj) {
        const content = await projectObj.text();
        const metadata = projectObj.customMetadata;
        return c.json({
          userId,
          skillName,
          scope: 'project',
          projectId,
          content,
          metadata,
          uploaded: projectObj.uploaded,
          size: projectObj.size,
        });
      }
    }

    // Fall back to user-scoped skill
    const userKey = getUserSkillKey(userId, skillName);
    const userObj = await c.env.USER_DATA.get(userKey);
    if (!userObj) {
      return c.json({ error: "Skill not found" }, 404);
    }

    const content = await userObj.text();
    const metadata = userObj.customMetadata;

    return c.json({
      userId,
      skillName,
      scope: 'user',
      projectId: null,
      content,
      metadata,
      uploaded: userObj.uploaded,
      size: userObj.size,
    });
  } catch (error: any) {
    console.error("[API Skills Get Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Deletes a skill for the authenticated user.
 *
 * @route DELETE /:skillName
 * @query projectId - If provided, deletes project-scoped skill
 * @query scope - 'user' or 'project' to explicitly specify which to delete
 */
skillsRoutes.delete("/:skillName", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const skillName = c.req.param("skillName");
    const projectId = c.req.query("projectId");
    const scope = c.req.query("scope") as 'user' | 'project' | undefined;

    // Determine which skill to delete
    let key: string;
    let actualScope: 'user' | 'project';

    if (scope === 'project' && projectId) {
      key = getProjectSkillKey(userId, projectId, skillName);
      actualScope = 'project';
    } else if (scope === 'user' || !projectId) {
      key = getUserSkillKey(userId, skillName);
      actualScope = 'user';
    } else {
      // Default: try project first, then user
      const projectKey = getProjectSkillKey(userId, projectId, skillName);
      const projectObj = await c.env.USER_DATA.get(projectKey);
      if (projectObj) {
        key = projectKey;
        actualScope = 'project';
      } else {
        key = getUserSkillKey(userId, skillName);
        actualScope = 'user';
      }
    }

    // Check if skill exists
    const obj = await c.env.USER_DATA.get(key);
    if (!obj) {
      return c.json({ error: "Skill not found" }, 404);
    }

    // Delete from R2
    await c.env.USER_DATA.delete(key);

    // Restart the agent process to remove the deleted skill
    const result = await restartAgentForSkillsReload(c.env.Sandbox, c.env.USER_DATA, userId, projectId);

    return c.json({
      status: "deleted",
      message: result.restarted
        ? "Skill deleted and agent restarted. The skill has been removed."
        : "Skill deleted. Refresh the page to update skills.",
      userId,
      skillName,
      scope: actualScope,
      projectId: actualScope === 'project' ? projectId : null,
      agentRestarted: result.restarted,
      remainingSkills: result.skillsLoaded,
    });
  } catch (error: any) {
    console.error("[API Skills Delete Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

export { skillsRoutes };
