/**
 * @fileoverview Skills management service for R2 storage operations.
 *
 * This service handles all R2 operations related to user skills, including
 * listing, loading, and copying skills to sandbox filesystems.
 *
 * @module services/skills
 */

import type { Sandbox } from "@cloudflare/sandbox";
import { getUserSkillKey, getUserSkillsPrefix } from "../lib/utils";

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
 * Loads user skills from R2 storage into a sandbox filesystem.
 *
 * This function is used in development mode (or as a fallback in production)
 * to copy skill files from R2 into the sandbox's local filesystem. The Claude
 * Agent SDK discovers skills at startup by scanning the `.claude/skills/` directory.
 *
 * ## Process Flow
 * 1. List all skill names for the user from R2
 * 2. For each skill, fetch the SKILL.md content from R2
 * 3. Write the content to `/workspace/.claude/skills/{skillName}/SKILL.md`
 * 4. Return list of loaded skill paths
 *
 * ## Important Notes
 * - Skills must be loaded BEFORE the agent process starts
 * - Directories must be created explicitly with sandbox.mkdir() before writeFile
 * - In production, R2 mounting is preferred over this copy approach
 *
 * @param sandbox - The Cloudflare Sandbox instance to write files to
 * @param bucket - The R2 bucket containing user skill files
 * @param userId - The unique identifier for the user
 * @returns Array of sandbox filesystem paths where skills were written
 *
 * @example
 * const loadedPaths = await loadSkillsFromR2ToSandbox(sandbox, env.USER_DATA, "user_123");
 * // Returns: [
 * //   "/workspace/.claude/skills/code-review/SKILL.md",
 * //   "/workspace/.claude/skills/testing/SKILL.md"
 * // ]
 */
export const loadSkillsFromR2ToSandbox = async (
  sandbox: Sandbox,
  bucket: R2Bucket,
  userId: string
): Promise<string[]> => {
  console.log(`[Skills] loadSkillsFromR2ToSandbox called for user: ${userId}`);

  const skillNames = await listUserSkillsFromR2(bucket, userId);
  console.log(`[Skills] listUserSkillsFromR2 returned ${skillNames.length} skill names`);

  const loaded: string[] = [];

  for (const skillName of skillNames) {
    const key = getUserSkillKey(userId, skillName);
    console.log(`[Skills] Fetching skill from R2 key: ${key}`);

    const obj = await bucket.get(key);
    if (obj) {
      const content = await obj.text();
      console.log(`[Skills] Got skill content: ${content.length} bytes`);

      // Create directory structure: .claude/skills/{skillName}/SKILL.md
      const skillDir = `/workspace/.claude/skills/${skillName}`;
      const skillPath = `${skillDir}/SKILL.md`;

      console.log(`[Skills] Writing skill to sandbox path: ${skillPath}`);
      // Ensure directory exists before writing (sandbox.writeFile does NOT create parent dirs)
      await sandbox.mkdir(skillDir, { recursive: true });
      await sandbox.writeFile(skillPath, content);
      console.log(`[Skills] Successfully wrote skill: ${skillPath}`);
      loaded.push(skillPath);
    } else {
      console.log(`[Skills] WARNING: R2 object not found for key: ${key}`);
    }
  }

  console.log(`[Skills] Loaded ${loaded.length} skills to sandbox: ${loaded.join(', ')}`);
  return loaded;
};
