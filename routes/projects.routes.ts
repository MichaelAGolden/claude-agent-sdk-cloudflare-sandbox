/**
 * @fileoverview Project API endpoints for workspace isolation.
 *
 * Projects group threads and provide isolated workspaces within a user's
 * sandbox. Each project has its own directory at `/workspace/projects/{projectId}/`
 * with independent files, skills, and configuration.
 *
 * All routes require Clerk JWT authentication. The userId is extracted from
 * the verified token.
 *
 * @module routes/projects
 */

import { Hono } from "hono";
import { getSandbox } from "@cloudflare/sandbox";
import type { Bindings, Project, Thread } from "../lib/types";
import { generateUUID } from "../lib/utils";
import { requireAuth, getAuthUserId } from "./middleware";
import {
  saveWorkspaceToR2,
  restoreWorkspaceFromR2,
  clearWorkspaceFromR2,
  getProjectLocalPath,
} from "../services/workspace.service";

const projectsRoutes = new Hono<{ Bindings: Bindings; Variables: { authenticatedUserId: string } }>();

// Apply auth middleware to all routes
projectsRoutes.use("/*", requireAuth);

/**
 * Ensures a user has a default project, creating one if necessary.
 * Also migrates orphan threads (threads without project_id) to the default project.
 *
 * @returns The default project
 */
async function ensureDefaultProject(
  db: D1Database,
  userId: string
): Promise<Project> {
  // Check for existing default project
  let defaultProject = await db.prepare(
    `SELECT id, user_id, name, description, is_default, created_at, updated_at
     FROM projects
     WHERE user_id = ? AND is_default = 1 AND deleted_at IS NULL`
  ).bind(userId).first<Project>();

  if (!defaultProject) {
    // Create default project
    const projectId = generateUUID();
    const now = new Date().toISOString();

    await db.prepare(
      `INSERT INTO projects (id, user_id, name, description, is_default, created_at, updated_at)
       VALUES (?, ?, 'Default Project', 'Your default workspace', 1, ?, ?)`
    ).bind(projectId, userId, now, now).run();

    defaultProject = {
      id: projectId,
      user_id: userId,
      name: 'Default Project',
      description: 'Your default workspace',
      is_default: 1,
      created_at: now,
      updated_at: now,
    };

    console.log(`[Projects] Created default project ${projectId} for user ${userId}`);
  }

  // Migrate orphan threads to default project
  const migrated = await db.prepare(
    `UPDATE threads SET project_id = ? WHERE user_id = ? AND project_id IS NULL`
  ).bind(defaultProject.id, userId).run();

  if (migrated.meta.changes > 0) {
    console.log(`[Projects] Migrated ${migrated.meta.changes} orphan threads to default project`);
  }

  return defaultProject;
}

/**
 * Lists all projects for the authenticated user.
 *
 * @route GET /
 */
projectsRoutes.get("/", async (c) => {
  try {
    const userId = getAuthUserId(c);

    // Ensure default project exists (creates if needed, migrates orphan threads)
    await ensureDefaultProject(c.env.DB, userId);

    const result = await c.env.DB.prepare(
      `SELECT id, user_id, name, description, is_default, created_at, updated_at
       FROM projects
       WHERE user_id = ? AND deleted_at IS NULL
       ORDER BY is_default DESC, updated_at DESC`
    ).bind(userId).all<Project>();

    return c.json({
      projects: result.results || [],
      count: result.results?.length || 0,
    });
  } catch (error: any) {
    console.error("[List Projects Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Creates a new project for the authenticated user.
 *
 * @route POST /
 */
projectsRoutes.post("/", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const body = await c.req.json<{ name: string; description?: string }>();

    if (!body.name || body.name.trim().length === 0) {
      return c.json({ error: "Project name is required" }, 400);
    }

    const projectId = generateUUID();
    const now = new Date().toISOString();

    // Ensure user exists (upsert)
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO users (id) VALUES (?)`
    ).bind(userId).run();

    // Create project
    await c.env.DB.prepare(
      `INSERT INTO projects (id, user_id, name, description, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`
    ).bind(projectId, userId, body.name.trim(), body.description || null, now, now).run();

    // Create project directory in sandbox
    const sandbox = getSandbox(c.env.Sandbox, userId);
    const projectPath = getProjectLocalPath(projectId);
    await sandbox.mkdir(projectPath, { recursive: true });
    await sandbox.mkdir(`${projectPath}/.claude/skills`, { recursive: true });

    const project: Project = {
      id: projectId,
      user_id: userId,
      name: body.name.trim(),
      description: body.description || null,
      is_default: 0,
      created_at: now,
      updated_at: now,
    };

    return c.json(project);
  } catch (error: any) {
    console.error("[Create Project Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Gets a project with its threads.
 *
 * @route GET /:id
 */
projectsRoutes.get("/:id", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const projectId = c.req.param("id");

    // Get project
    const project = await c.env.DB.prepare(
      `SELECT id, user_id, name, description, is_default, created_at, updated_at
       FROM projects
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL`
    ).bind(projectId, userId).first<Project>();

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    // Get threads for this project
    const threadsResult = await c.env.DB.prepare(
      `SELECT id, user_id, project_id, session_id, title, summary, created_at, updated_at
       FROM threads
       WHERE project_id = ? AND user_id = ? AND deleted_at IS NULL
       ORDER BY updated_at DESC`
    ).bind(projectId, userId).all<Thread>();

    return c.json({
      project,
      threads: threadsResult.results || [],
    });
  } catch (error: any) {
    console.error("[Get Project Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Updates project metadata.
 *
 * @route PATCH /:id
 */
projectsRoutes.patch("/:id", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const projectId = c.req.param("id");
    const body = await c.req.json<{ name?: string; description?: string }>();

    // Verify ownership
    const existing = await c.env.DB.prepare(
      `SELECT id, is_default FROM projects WHERE id = ? AND user_id = ? AND deleted_at IS NULL`
    ).bind(projectId, userId).first<{ id: string; is_default: number }>();

    if (!existing) {
      return c.json({ error: "Project not found" }, 404);
    }

    // Build dynamic update
    const updates: string[] = [];
    const values: any[] = [];

    if (body.name !== undefined) {
      if (body.name.trim().length === 0) {
        return c.json({ error: "Project name cannot be empty" }, 400);
      }
      updates.push("name = ?");
      values.push(body.name.trim());
    }

    if (body.description !== undefined) {
      updates.push("description = ?");
      values.push(body.description);
    }

    if (updates.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    updates.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(projectId);
    values.push(userId);

    await c.env.DB.prepare(
      `UPDATE projects SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`
    ).bind(...values).run();

    // Return updated project
    const project = await c.env.DB.prepare(
      `SELECT id, user_id, name, description, is_default, created_at, updated_at
       FROM projects
       WHERE id = ? AND user_id = ?`
    ).bind(projectId, userId).first<Project>();

    return c.json(project);
  } catch (error: any) {
    console.error("[Update Project Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Soft-deletes a project.
 *
 * Cannot delete the default project. Threads are orphaned (project_id set to null)
 * and will be migrated to default project on next list.
 *
 * @route DELETE /:id
 */
projectsRoutes.delete("/:id", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const projectId = c.req.param("id");

    // Get project
    const project = await c.env.DB.prepare(
      `SELECT id, is_default FROM projects WHERE id = ? AND user_id = ? AND deleted_at IS NULL`
    ).bind(projectId, userId).first<{ id: string; is_default: number }>();

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    if (project.is_default === 1) {
      return c.json({ error: "Cannot delete the default project" }, 400);
    }

    // Orphan threads (they'll be migrated to default on next list)
    await c.env.DB.prepare(
      `UPDATE threads SET project_id = NULL WHERE project_id = ? AND user_id = ?`
    ).bind(projectId, userId).run();

    // Soft delete project
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE projects SET deleted_at = ? WHERE id = ? AND user_id = ?`
    ).bind(now, projectId, userId).run();

    // Optionally clean up R2 workspace (in background)
    try {
      await clearWorkspaceFromR2(c.env.USER_DATA, userId, projectId);
    } catch (r2Error) {
      console.error("[Delete Project] Failed to clean R2:", r2Error);
    }

    return c.json({
      status: "deleted",
      projectId,
      deletedAt: now,
    });
  } catch (error: any) {
    console.error("[Delete Project Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Switches to a project - restores workspace from R2.
 *
 * Call this when user switches projects. It:
 * 1. Saves current project's workspace to R2 (if provided)
 * 2. Restores the target project's workspace from R2
 * 3. Returns the project with its threads
 *
 * @route POST /:id/switch
 */
projectsRoutes.post("/:id/switch", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const projectId = c.req.param("id");
    const body = await c.req.json<{ fromProjectId?: string }>().catch(() => ({} as { fromProjectId?: string }));

    // Verify target project exists
    const project = await c.env.DB.prepare(
      `SELECT id, user_id, name, description, is_default, created_at, updated_at
       FROM projects
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL`
    ).bind(projectId, userId).first<Project>();

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    const sandbox = getSandbox(c.env.Sandbox, userId);

    // Save current project workspace (if switching from another project)
    let saveResult = null;
    if (body.fromProjectId && body.fromProjectId !== projectId) {
      console.log(`[Projects] Saving workspace for project ${body.fromProjectId}`);
      saveResult = await saveWorkspaceToR2(sandbox, c.env.USER_DATA, userId, body.fromProjectId);
    }

    // Restore target project workspace
    console.log(`[Projects] Restoring workspace for project ${projectId}`);
    const restoreResult = await restoreWorkspaceFromR2(sandbox, c.env.USER_DATA, userId, projectId);

    // Get threads for this project
    const threadsResult = await c.env.DB.prepare(
      `SELECT id, user_id, project_id, session_id, title, summary, created_at, updated_at
       FROM threads
       WHERE project_id = ? AND user_id = ? AND deleted_at IS NULL
       ORDER BY updated_at DESC`
    ).bind(projectId, userId).all<Thread>();

    return c.json({
      project,
      threads: threadsResult.results || [],
      workspace: {
        saved: saveResult,
        restored: restoreResult,
      },
    });
  } catch (error: any) {
    console.error("[Switch Project Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Manually saves project workspace to R2.
 *
 * Call this periodically during long sessions or before disconnect.
 *
 * @route POST /:id/save-workspace
 */
projectsRoutes.post("/:id/save-workspace", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const projectId = c.req.param("id");

    // Verify project exists
    const project = await c.env.DB.prepare(
      `SELECT id FROM projects WHERE id = ? AND user_id = ? AND deleted_at IS NULL`
    ).bind(projectId, userId).first();

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    const sandbox = getSandbox(c.env.Sandbox, userId);
    const result = await saveWorkspaceToR2(sandbox, c.env.USER_DATA, userId, projectId);

    return c.json({
      status: "saved",
      projectId,
      ...result,
    });
  } catch (error: any) {
    console.error("[Save Workspace Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

export { projectsRoutes };
