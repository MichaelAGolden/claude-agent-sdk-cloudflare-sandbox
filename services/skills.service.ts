/**
 * @fileoverview Skills management service for R2 storage operations.
 *
 * This service handles all R2 operations related to user skills, including
 * listing, loading, and copying skills to sandbox filesystems.
 *
 * Skills can be scoped to:
 * - User level: Available across all projects (stored in users/{userId}/skills/)
 * - Project level: Only available within a specific project (stored in users/{userId}/projects/{projectId}/skills/)
 *
 * @module services/skills
 */

import type { Sandbox } from "@cloudflare/sandbox";
import {
  getUserSkillKey,
  getUserSkillsPrefix,
  getProjectSkillKey,
  getProjectSkillsPrefix,
} from "../lib/utils";

export type SkillScope = 'user' | 'project';

export interface SkillInfo {
  name: string;
  scope: SkillScope;
  projectId?: string;
}

/**
 * Lists all skill names for a user from R2 storage.
 *
 * Scans the user's skills directory in R2 and extracts unique skill names
 * from SKILL.md file paths. This function is used to discover available
 * skills before loading them into a sandbox.
 *
 * ## R2 Structure
 * ```
 * users/{userId}/skills/
 *   ├── code-review/
 *   │   └── SKILL.md
 *   ├── testing-patterns/
 *   │   └── SKILL.md
 *   └── documentation/
 *       └── SKILL.md
 * ```
 *
 * @param bucket - The R2 bucket containing user data
 * @param userId - The unique identifier for the user
 * @returns Array of unique skill names (directory names)
 *
 * @example
 * const skillNames = await listUserSkillsFromR2(env.USER_DATA, "user_123");
 * // Returns: ["code-review", "testing-patterns", "documentation"]
 */
export const listUserSkillsFromR2 = async (
  bucket: R2Bucket,
  userId: string
): Promise<string[]> => {
  const prefix = getUserSkillsPrefix(userId);
  console.log(`[Skills] Listing R2 objects with prefix: ${prefix}`);

  const listed = await bucket.list({ prefix });
  console.log(`[Skills] R2 list returned ${listed.objects.length} objects`);

  // Extract unique skill directory names from paths like:
  // users/{userId}/skills/{skillName}/SKILL.md -> skillName
  const skillNames = new Set<string>();
  for (const obj of listed.objects) {
    console.log(`[Skills] Found R2 object: ${obj.key}`);
    const relativePath = obj.key.replace(prefix, "");
    // Extract directory name (first path segment)
    const skillName = relativePath.split("/")[0];
    if (skillName && relativePath.endsWith("/SKILL.md")) {
      console.log(`[Skills] Extracted skill name: ${skillName}`);
      skillNames.add(skillName);
    } else {
      console.log(`[Skills] Skipped object (relativePath: ${relativePath}, skillName: ${skillName})`);
    }
  }

  const result = Array.from(skillNames);
  console.log(`[Skills] Found ${result.length} skills for user ${userId}: ${result.join(', ')}`);
  return result;
};

/**
 * Lists all skill names for a specific project from R2 storage.
 *
 * @param bucket - The R2 bucket containing user data
 * @param userId - The unique identifier for the user
 * @param projectId - The project ID to list skills for
 * @returns Array of unique skill names (directory names)
 */
export const listProjectSkillsFromR2 = async (
  bucket: R2Bucket,
  userId: string,
  projectId: string
): Promise<string[]> => {
  const prefix = getProjectSkillsPrefix(userId, projectId);
  console.log(`[Skills] Listing project skills with prefix: ${prefix}`);

  const listed = await bucket.list({ prefix });
  console.log(`[Skills] R2 list returned ${listed.objects.length} objects for project ${projectId}`);

  const skillNames = new Set<string>();
  for (const obj of listed.objects) {
    const relativePath = obj.key.replace(prefix, "");
    const skillName = relativePath.split("/")[0];
    if (skillName && relativePath.endsWith("/SKILL.md")) {
      skillNames.add(skillName);
    }
  }

  const result = Array.from(skillNames);
  console.log(`[Skills] Found ${result.length} project skills: ${result.join(', ')}`);
  return result;
};

/**
 * Lists all skills (both user-scoped and project-scoped) for a user.
 *
 * @param bucket - The R2 bucket containing user data
 * @param userId - The unique identifier for the user
 * @param projectId - Optional project ID to include project-scoped skills
 * @returns Array of SkillInfo objects with scope information
 */
export const listAllSkillsFromR2 = async (
  bucket: R2Bucket,
  userId: string,
  projectId?: string
): Promise<SkillInfo[]> => {
  const skills: SkillInfo[] = [];

  // Get user-scoped skills
  const userSkillNames = await listUserSkillsFromR2(bucket, userId);
  for (const name of userSkillNames) {
    skills.push({ name, scope: 'user' });
  }

  // Get project-scoped skills if projectId provided
  if (projectId) {
    const projectSkillNames = await listProjectSkillsFromR2(bucket, userId, projectId);
    for (const name of projectSkillNames) {
      skills.push({ name, scope: 'project', projectId });
    }
  }

  return skills;
};

/**
 * Loads user-scoped and project-scoped skills from R2 storage into a sandbox filesystem.
 *
 * This function copies skill files from R2 into the sandbox's local filesystem. The Claude
 * Agent SDK discovers skills at startup by scanning the `.claude/skills/` directory.
 *
 * ## Skill Scoping
 * - User skills: Always loaded to both locations (available in all projects)
 * - Project skills: Only loaded to workspace location (only for current project)
 *
 * ## Process Flow
 * 1. List all user-scoped skills from R2
 * 2. If projectId provided, also list project-scoped skills
 * 3. For each skill, fetch the SKILL.md content from R2
 * 4. Write user skills to both ~/.claude/skills/ and /workspace/.claude/skills/
 * 5. Write project skills to /workspace/.claude/skills/ only
 * 6. Return list of loaded skill paths
 *
 * @param sandbox - The Cloudflare Sandbox instance to write files to
 * @param bucket - The R2 bucket containing user skill files
 * @param userId - The unique identifier for the user
 * @param projectId - Optional project ID to also load project-scoped skills
 * @returns Array of sandbox filesystem paths where skills were written
 */
export const loadSkillsFromR2ToSandbox = async (
  sandbox: Sandbox,
  bucket: R2Bucket,
  userId: string,
  projectId?: string
): Promise<string[]> => {
  console.log(`[Skills] loadSkillsFromR2ToSandbox called for user: ${userId}, project: ${projectId || 'none'}`);

  const loaded: string[] = [];

  // Paths where SDK discovers skills
  const workspaceSkillsBase = "/workspace/.claude/skills";
  const userSkillsBase = "/root/.claude/skills";

  // Ensure base directories exist
  console.log(`[Skills] Creating base directories: ${workspaceSkillsBase}, ${userSkillsBase}`);
  await sandbox.mkdir(workspaceSkillsBase, { recursive: true });
  await sandbox.mkdir(userSkillsBase, { recursive: true });

  // Load user-scoped skills (available in all projects)
  const userSkillNames = await listUserSkillsFromR2(bucket, userId);
  console.log(`[Skills] Found ${userSkillNames.length} user-scoped skills`);

  for (const skillName of userSkillNames) {
    const key = getUserSkillKey(userId, skillName);
    const obj = await bucket.get(key);
    if (obj) {
      const content = await obj.text();

      // Write to workspace skills location
      const workspaceSkillDir = `${workspaceSkillsBase}/${skillName}`;
      const workspaceSkillPath = `${workspaceSkillDir}/SKILL.md`;
      await sandbox.mkdir(workspaceSkillDir, { recursive: true });
      await sandbox.writeFile(workspaceSkillPath, content);
      loaded.push(workspaceSkillPath);

      // Also write to user skills location (~/.claude/skills)
      const userSkillDir = `${userSkillsBase}/${skillName}`;
      const userSkillPath = `${userSkillDir}/SKILL.md`;
      await sandbox.mkdir(userSkillDir, { recursive: true });
      await sandbox.writeFile(userSkillPath, content);
      loaded.push(userSkillPath);

      console.log(`[Skills] Loaded user skill: ${skillName}`);
    }
  }

  // Load project-scoped skills (only for current project)
  if (projectId) {
    const projectSkillNames = await listProjectSkillsFromR2(bucket, userId, projectId);
    console.log(`[Skills] Found ${projectSkillNames.length} project-scoped skills for project ${projectId}`);

    for (const skillName of projectSkillNames) {
      const key = getProjectSkillKey(userId, projectId, skillName);
      const obj = await bucket.get(key);
      if (obj) {
        const content = await obj.text();

        // Only write to workspace location (project-specific)
        const workspaceSkillDir = `${workspaceSkillsBase}/${skillName}`;
        const workspaceSkillPath = `${workspaceSkillDir}/SKILL.md`;
        await sandbox.mkdir(workspaceSkillDir, { recursive: true });
        await sandbox.writeFile(workspaceSkillPath, content);
        loaded.push(workspaceSkillPath);

        console.log(`[Skills] Loaded project skill: ${skillName}`);
      }
    }
  }

  console.log(`[Skills] Loaded ${loaded.length} total skill paths to sandbox`);
  return loaded;
};
