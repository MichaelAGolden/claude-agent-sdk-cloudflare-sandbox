/**
 * @fileoverview Agents management service for R2 storage operations.
 *
 * This service handles all R2 operations related to user agents (subagents),
 * including listing, loading, and copying agents to sandbox filesystems.
 *
 * Agents can be scoped to:
 * - User level: Available across all projects (stored in users/{userId}/agents/)
 * - Project level: Only available within a specific project (stored in users/{userId}/projects/{projectId}/agents/)
 *
 * @module services/agents
 */

import type { Sandbox } from "@cloudflare/sandbox";
import {
  getUserAgentKey,
  getUserAgentsPrefix,
  getProjectAgentKey,
  getProjectAgentsPrefix,
} from "../lib/utils";

export type AgentScope = 'user' | 'project';

/**
 * Model aliases supported by Claude Agent SDK for subagents.
 */
export type ModelAlias = 'sonnet' | 'opus' | 'haiku' | 'inherit';

/**
 * Subagent definition for Claude Agent SDK.
 * This is the format expected by the SDK's agents parameter.
 */
export interface AgentDefinition {
  /** Natural language description of when to use this agent */
  description: string;
  /** The agent's system prompt defining its role and behavior */
  prompt: string;
  /** Array of allowed tool names. If omitted, inherits all tools */
  tools?: string[];
  /** Model override for this agent. Defaults to main model if omitted */
  model?: ModelAlias;
}

/**
 * Stored agent with metadata for persistence.
 */
export interface StoredAgent {
  /** Unique name/identifier for the agent */
  name: string;
  /** Scope: user-level or project-level */
  scope: AgentScope;
  /** Project ID if project-scoped */
  projectId?: string;
  /** The agent definition */
  definition: AgentDefinition;
  /** Upload timestamp */
  uploadedAt?: string;
  /** File size in bytes */
  size?: number;
}

/**
 * Agent info for listing (without full content).
 */
export interface AgentInfo {
  name: string;
  scope: AgentScope;
  projectId?: string;
}

/**
 * Lists all user-scoped agent names from R2 storage.
 *
 * @param bucket - The R2 bucket containing user data
 * @param userId - The unique identifier for the user
 * @returns Array of unique agent names (directory names)
 */
export const listUserAgentsFromR2 = async (
  bucket: R2Bucket,
  userId: string
): Promise<string[]> => {
  const prefix = getUserAgentsPrefix(userId);
  console.log(`[Agents] Listing R2 objects with prefix: ${prefix}`);

  const listed = await bucket.list({ prefix });
  console.log(`[Agents] R2 list returned ${listed.objects.length} objects`);

  const agentNames = new Set<string>();
  for (const obj of listed.objects) {
    const relativePath = obj.key.replace(prefix, "");
    const agentName = relativePath.split("/")[0];
    if (agentName && relativePath.endsWith("/AGENT.md")) {
      agentNames.add(agentName);
    }
  }

  const result = Array.from(agentNames);
  console.log(`[Agents] Found ${result.length} user agents: ${result.join(', ')}`);
  return result;
};

/**
 * Lists all project-scoped agent names from R2 storage.
 *
 * @param bucket - The R2 bucket containing user data
 * @param userId - The unique identifier for the user
 * @param projectId - The project ID to list agents for
 * @returns Array of unique agent names (directory names)
 */
export const listProjectAgentsFromR2 = async (
  bucket: R2Bucket,
  userId: string,
  projectId: string
): Promise<string[]> => {
  const prefix = getProjectAgentsPrefix(userId, projectId);
  console.log(`[Agents] Listing project agents with prefix: ${prefix}`);

  const listed = await bucket.list({ prefix });
  console.log(`[Agents] R2 list returned ${listed.objects.length} objects for project ${projectId}`);

  const agentNames = new Set<string>();
  for (const obj of listed.objects) {
    const relativePath = obj.key.replace(prefix, "");
    const agentName = relativePath.split("/")[0];
    if (agentName && relativePath.endsWith("/AGENT.md")) {
      agentNames.add(agentName);
    }
  }

  const result = Array.from(agentNames);
  console.log(`[Agents] Found ${result.length} project agents: ${result.join(', ')}`);
  return result;
};

/**
 * Lists all agents (both user-scoped and project-scoped) for a user.
 *
 * @param bucket - The R2 bucket containing user data
 * @param userId - The unique identifier for the user
 * @param projectId - Optional project ID to include project-scoped agents
 * @returns Array of AgentInfo objects with scope information
 */
export const listAllAgentsFromR2 = async (
  bucket: R2Bucket,
  userId: string,
  projectId?: string
): Promise<AgentInfo[]> => {
  const agents: AgentInfo[] = [];

  // Get user-scoped agents
  const userAgentNames = await listUserAgentsFromR2(bucket, userId);
  for (const name of userAgentNames) {
    agents.push({ name, scope: 'user' });
  }

  // Get project-scoped agents if projectId provided
  if (projectId) {
    const projectAgentNames = await listProjectAgentsFromR2(bucket, userId, projectId);
    for (const name of projectAgentNames) {
      agents.push({ name, scope: 'project', projectId });
    }
  }

  return agents;
};

/**
 * Gets a single agent's full definition from R2.
 *
 * @param bucket - The R2 bucket containing user data
 * @param userId - The unique identifier for the user
 * @param agentName - The agent name
 * @param scope - The scope ('user' or 'project')
 * @param projectId - The project ID (required for project scope)
 * @returns The stored agent or null if not found
 */
export const getAgentFromR2 = async (
  bucket: R2Bucket,
  userId: string,
  agentName: string,
  scope: AgentScope,
  projectId?: string
): Promise<StoredAgent | null> => {
  const key = scope === 'project' && projectId
    ? getProjectAgentKey(userId, projectId, agentName)
    : getUserAgentKey(userId, agentName);

  const obj = await bucket.get(key);
  if (!obj) return null;

  const content = await obj.text();

  // Parse the AGENT.md file (markdown with YAML frontmatter)
  const definition = parseAgentFile(content);
  if (!definition) return null;

  return {
    name: agentName,
    scope,
    projectId: scope === 'project' ? projectId : undefined,
    definition,
    uploadedAt: obj.uploaded?.toISOString(),
    size: obj.size,
  };
};

/**
 * Parses an AGENT.md file content into an AgentDefinition.
 *
 * Expected format:
 * ---
 * description: When to use this agent
 * tools: Read, Grep, Glob
 * model: sonnet
 * ---
 *
 * System prompt content goes here...
 *
 * @param content - The raw file content
 * @returns Parsed AgentDefinition or null if invalid
 */
export const parseAgentFile = (content: string): AgentDefinition | null => {
  try {
    // Check for YAML frontmatter
    if (!content.startsWith('---')) {
      // No frontmatter - treat entire content as prompt with minimal definition
      return {
        description: 'Custom agent',
        prompt: content.trim(),
      };
    }

    // Extract frontmatter and body
    const endFrontmatter = content.indexOf('---', 3);
    if (endFrontmatter === -1) {
      return {
        description: 'Custom agent',
        prompt: content.trim(),
      };
    }

    const frontmatter = content.slice(3, endFrontmatter).trim();
    const prompt = content.slice(endFrontmatter + 3).trim();

    // Parse YAML frontmatter (simple key: value parsing)
    const definition: AgentDefinition = {
      description: '',
      prompt,
    };

    for (const line of frontmatter.split('\n')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const key = line.slice(0, colonIndex).trim().toLowerCase();
      const value = line.slice(colonIndex + 1).trim();

      if (key === 'description') {
        definition.description = value;
      } else if (key === 'tools') {
        // Parse comma-separated tools
        definition.tools = value.split(',').map(t => t.trim()).filter(Boolean);
      } else if (key === 'model') {
        const modelValue = value.toLowerCase();
        if (['sonnet', 'opus', 'haiku', 'inherit'].includes(modelValue)) {
          definition.model = modelValue as ModelAlias;
        }
      }
    }

    return definition;
  } catch (error) {
    console.error('[Agents] Failed to parse agent file:', error);
    return null;
  }
};

/**
 * Serializes an AgentDefinition to AGENT.md format.
 *
 * @param definition - The agent definition to serialize
 * @returns Markdown content with YAML frontmatter
 */
export const serializeAgentFile = (definition: AgentDefinition): string => {
  let content = '---\n';
  content += `description: ${definition.description}\n`;
  if (definition.tools && definition.tools.length > 0) {
    content += `tools: ${definition.tools.join(', ')}\n`;
  }
  if (definition.model) {
    content += `model: ${definition.model}\n`;
  }
  content += '---\n\n';
  content += definition.prompt;
  return content;
};

/**
 * Loads user-scoped and project-scoped agents from R2 storage into a sandbox filesystem.
 *
 * This function copies agent files from R2 into the sandbox's local filesystem. The Claude
 * Agent SDK discovers agents at startup by scanning the `.claude/agents/` directory.
 *
 * @param sandbox - The Cloudflare Sandbox instance to write files to
 * @param bucket - The R2 bucket containing user agent files
 * @param userId - The unique identifier for the user
 * @param projectId - Optional project ID to also load project-scoped agents
 * @returns Array of sandbox filesystem paths where agents were written
 */
export const loadAgentsFromR2ToSandbox = async (
  sandbox: Sandbox,
  bucket: R2Bucket,
  userId: string,
  projectId?: string
): Promise<string[]> => {
  console.log(`[Agents] loadAgentsFromR2ToSandbox called for user: ${userId}, project: ${projectId || 'none'}`);

  const loaded: string[] = [];

  // Paths where SDK discovers agents
  const workspaceAgentsBase = "/workspace/.claude/agents";
  const userAgentsBase = "/root/.claude/agents";

  // Ensure base directories exist
  console.log(`[Agents] Creating base directories: ${workspaceAgentsBase}, ${userAgentsBase}`);
  await sandbox.mkdir(workspaceAgentsBase, { recursive: true });
  await sandbox.mkdir(userAgentsBase, { recursive: true });

  // Load user-scoped agents (available in all projects)
  const userAgentNames = await listUserAgentsFromR2(bucket, userId);
  console.log(`[Agents] Found ${userAgentNames.length} user-scoped agents`);

  for (const agentName of userAgentNames) {
    const key = getUserAgentKey(userId, agentName);
    const obj = await bucket.get(key);
    if (obj) {
      const content = await obj.text();

      // Write to workspace agents location
      const workspaceAgentDir = `${workspaceAgentsBase}/${agentName}`;
      const workspaceAgentPath = `${workspaceAgentDir}/AGENT.md`;
      await sandbox.mkdir(workspaceAgentDir, { recursive: true });
      await sandbox.writeFile(workspaceAgentPath, content);
      loaded.push(workspaceAgentPath);

      // Also write to user agents location (~/.claude/agents)
      const userAgentDir = `${userAgentsBase}/${agentName}`;
      const userAgentPath = `${userAgentDir}/AGENT.md`;
      await sandbox.mkdir(userAgentDir, { recursive: true });
      await sandbox.writeFile(userAgentPath, content);
      loaded.push(userAgentPath);

      console.log(`[Agents] Loaded user agent: ${agentName}`);
    }
  }

  // Load project-scoped agents (only for current project)
  if (projectId) {
    const projectAgentNames = await listProjectAgentsFromR2(bucket, userId, projectId);
    console.log(`[Agents] Found ${projectAgentNames.length} project-scoped agents for project ${projectId}`);

    for (const agentName of projectAgentNames) {
      const key = getProjectAgentKey(userId, projectId, agentName);
      const obj = await bucket.get(key);
      if (obj) {
        const content = await obj.text();

        // Only write to workspace location (project-specific)
        const workspaceAgentDir = `${workspaceAgentsBase}/${agentName}`;
        const workspaceAgentPath = `${workspaceAgentDir}/AGENT.md`;
        await sandbox.mkdir(workspaceAgentDir, { recursive: true });
        await sandbox.writeFile(workspaceAgentPath, content);
        loaded.push(workspaceAgentPath);

        console.log(`[Agents] Loaded project agent: ${agentName}`);
      }
    }
  }

  console.log(`[Agents] Loaded ${loaded.length} total agent paths to sandbox`);
  return loaded;
};

/**
 * Converts stored agents to the format expected by the SDK's agents parameter.
 *
 * @param bucket - The R2 bucket containing user data
 * @param userId - The unique identifier for the user
 * @param projectId - Optional project ID to include project-scoped agents
 * @returns Record of agent name to AgentDefinition
 */
export const getAgentsForSDK = async (
  bucket: R2Bucket,
  userId: string,
  projectId?: string
): Promise<Record<string, AgentDefinition>> => {
  const agents: Record<string, AgentDefinition> = {};

  // Get user-scoped agents
  const userAgentNames = await listUserAgentsFromR2(bucket, userId);
  for (const agentName of userAgentNames) {
    const stored = await getAgentFromR2(bucket, userId, agentName, 'user');
    if (stored) {
      agents[agentName] = stored.definition;
    }
  }

  // Get project-scoped agents (these can override user-scoped with same name)
  if (projectId) {
    const projectAgentNames = await listProjectAgentsFromR2(bucket, userId, projectId);
    for (const agentName of projectAgentNames) {
      const stored = await getAgentFromR2(bucket, userId, agentName, 'project', projectId);
      if (stored) {
        agents[agentName] = stored.definition;
      }
    }
  }

  return agents;
};
