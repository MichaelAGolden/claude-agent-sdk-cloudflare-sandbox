/**
 * @fileoverview Agents API endpoints (authenticated, frontend-facing).
 *
 * API for managing user and project-scoped agents (subagents). All endpoints require Clerk JWT authentication.
 * The userId is extracted from the verified token, not from query parameters.
 *
 * Agents are markdown files that define specialized AI assistants (subagents)
 * that can be invoked by the main Claude agent for specific tasks.
 *
 * ## Agent Scoping
 * - User agents: Available across all projects (no projectId)
 * - Project agents: Only available within a specific project (requires projectId)
 *
 * @module routes/agents
 */

import { Hono } from "hono";
import type { Bindings } from "../lib/types";
import { getUserAgentKey, getProjectAgentKey } from "../lib/utils";
import {
  listAllAgentsFromR2,
  getAgentFromR2,
  serializeAgentFile,
  type AgentInfo,
  type AgentDefinition,
} from "../services/agents.service";
import { restartAgentForSkillsReload } from "../services/sandbox.service";
import { requireAuth, getAuthUserId } from "./middleware";

const agentsRoutes = new Hono<{ Bindings: Bindings; Variables: { authenticatedUserId: string } }>();

// Apply auth middleware to all routes
agentsRoutes.use("/*", requireAuth);

/**
 * Lists all agents for the authenticated user.
 *
 * Returns both user-scoped and project-scoped agents if projectId is provided.
 * Each agent includes scope information ('user' or 'project').
 *
 * @route GET /
 * @query projectId - Optional project ID to include project-scoped agents
 */
agentsRoutes.get("/", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const projectId = c.req.query("projectId");

    if (!c.env.USER_DATA) {
      console.error("[API Agents] USER_DATA binding missing. Check wrangler.toml or context loss.");
      return c.json({ error: "Storage configuration error" }, 500);
    }

    const agents = await listAllAgentsFromR2(c.env.USER_DATA, userId, projectId);

    return c.json({
      userId,
      projectId: projectId || null,
      agents,
      count: agents.length,
    });
  } catch (error: any) {
    console.error("[API Agents List Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Creates or updates an agent for the authenticated user.
 *
 * If projectId is provided, creates a project-scoped agent.
 * Otherwise, creates a user-scoped agent (available in all projects).
 *
 * @route POST /
 */
agentsRoutes.post("/", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const body = await c.req.json<{
      name: string;
      definition: AgentDefinition;
      projectId?: string;
    }>();

    if (!body.name || !body.definition) {
      return c.json({ error: "name and definition are required" }, 400);
    }

    if (!body.definition.description || !body.definition.prompt) {
      return c.json({ error: "definition.description and definition.prompt are required" }, 400);
    }

    // Validate agent name (must be lowercase with hyphens)
    const namePattern = /^[a-z][a-z0-9-]*$/;
    if (!namePattern.test(body.name)) {
      return c.json({
        error: "Agent name must start with a letter and contain only lowercase letters, numbers, and hyphens"
      }, 400);
    }

    // Determine scope and R2 key
    const scope = body.projectId ? 'project' : 'user';
    const key = body.projectId
      ? getProjectAgentKey(userId, body.projectId, body.name)
      : getUserAgentKey(userId, body.name);

    // Serialize the agent definition to AGENT.md format
    const content = serializeAgentFile(body.definition);

    // Store in R2
    await c.env.USER_DATA.put(key, content, {
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

    // Restart the agent process to discover the new agent
    const result = await restartAgentForSkillsReload(c.env.Sandbox, c.env.USER_DATA, userId, body.projectId);

    return c.json({
      status: "success",
      message: result.restarted
        ? "Agent created and sandbox restarted. The agent is now available."
        : "Agent created. Refresh the page to load the new agent.",
      userId,
      agentName: body.name,
      scope,
      projectId: body.projectId || null,
      r2Key: key,
      sandboxRestarted: result.restarted,
    });
  } catch (error: any) {
    console.error("[API Agents Create Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Retrieves a specific agent's content and metadata for the authenticated user.
 *
 * @route GET /:agentName
 * @query projectId - If provided, looks for project-scoped agent first
 */
agentsRoutes.get("/:agentName", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const agentName = c.req.param("agentName");
    const projectId = c.req.query("projectId");

    // Try project-scoped agent first if projectId provided
    if (projectId) {
      const projectAgent = await getAgentFromR2(
        c.env.USER_DATA,
        userId,
        agentName,
        'project',
        projectId
      );
      if (projectAgent) {
        return c.json({
          userId,
          agentName,
          scope: 'project',
          projectId,
          definition: projectAgent.definition,
          uploadedAt: projectAgent.uploadedAt,
          size: projectAgent.size,
        });
      }
    }

    // Fall back to user-scoped agent
    const userAgent = await getAgentFromR2(
      c.env.USER_DATA,
      userId,
      agentName,
      'user'
    );
    if (!userAgent) {
      return c.json({ error: "Agent not found" }, 404);
    }

    return c.json({
      userId,
      agentName,
      scope: 'user',
      projectId: null,
      definition: userAgent.definition,
      uploadedAt: userAgent.uploadedAt,
      size: userAgent.size,
    });
  } catch (error: any) {
    console.error("[API Agents Get Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Deletes an agent for the authenticated user.
 *
 * @route DELETE /:agentName
 * @query projectId - If provided, deletes project-scoped agent
 * @query scope - 'user' or 'project' to explicitly specify which to delete
 */
agentsRoutes.delete("/:agentName", async (c) => {
  try {
    const userId = getAuthUserId(c);
    const agentName = c.req.param("agentName");
    const projectId = c.req.query("projectId");
    const scope = c.req.query("scope") as 'user' | 'project' | undefined;

    // Determine which agent to delete
    let key: string;
    let actualScope: 'user' | 'project';

    if (scope === 'project' && projectId) {
      key = getProjectAgentKey(userId, projectId, agentName);
      actualScope = 'project';
    } else if (scope === 'user' || !projectId) {
      key = getUserAgentKey(userId, agentName);
      actualScope = 'user';
    } else {
      // Default: try project first, then user
      const projectKey = getProjectAgentKey(userId, projectId, agentName);
      const projectObj = await c.env.USER_DATA.get(projectKey);
      if (projectObj) {
        key = projectKey;
        actualScope = 'project';
      } else {
        key = getUserAgentKey(userId, agentName);
        actualScope = 'user';
      }
    }

    // Check if agent exists
    const obj = await c.env.USER_DATA.get(key);
    if (!obj) {
      return c.json({ error: "Agent not found" }, 404);
    }

    // Delete from R2
    await c.env.USER_DATA.delete(key);

    // Restart the sandbox to remove the deleted agent
    const result = await restartAgentForSkillsReload(c.env.Sandbox, c.env.USER_DATA, userId, projectId);

    return c.json({
      status: "deleted",
      message: result.restarted
        ? "Agent deleted and sandbox restarted. The agent has been removed."
        : "Agent deleted. Refresh the page to update agents.",
      userId,
      agentName,
      scope: actualScope,
      projectId: actualScope === 'project' ? projectId : null,
      sandboxRestarted: result.restarted,
    });
  } catch (error: any) {
    console.error("[API Agents Delete Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

export { agentsRoutes };
