/**
 * @fileoverview Debug endpoints for Claude Agent SDK Server
 *
 * Provides diagnostic endpoints for inspecting server state and skills.
 *
 * @module routes/debug
 */

import { Express, Request, Response } from "express";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Skill detail information.
 */
interface SkillDetail {
  hasSkillMd: boolean;
  skillMdPath: string;
  contentLength?: number;
  preview?: string;
  readError?: string;
}

/**
 * Debug skills response payload.
 */
interface SkillsDebugResponse {
  skillsDir: string;
  exists: boolean;
  isDirectory?: boolean;
  skills: string[];
  details: Record<string, SkillDetail>;
  error?: string;
  claudeDir: {
    exists: boolean;
    contents?: string[];
    error?: string;
  };
}

// ============================================================================
// HANDLERS
// ============================================================================

/**
 * Handles skills debug requests.
 *
 * @description
 * Provides diagnostic information about the skills directory structure,
 * including which skill directories exist and whether they contain valid
 * SKILL.md files.
 *
 * @param req - Express request
 * @param res - Express response
 */
function skillsDebugHandler(req: Request, res: Response<SkillsDebugResponse>): void {
  const skillsDir = "/workspace/.claude/skills";
  const result: SkillsDebugResponse = {
    skillsDir,
    exists: existsSync(skillsDir),
    skills: [],
    details: {},
    claudeDir: {
      exists: false
    }
  };

  if (result.exists) {
    try {
      const stat = statSync(skillsDir);
      result.isDirectory = stat.isDirectory();

      if (result.isDirectory) {
        const entries = readdirSync(skillsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillMdPath = join(skillsDir, entry.name, "SKILL.md");
            const hasSkillMd = existsSync(skillMdPath);
            result.skills.push(entry.name);
            result.details[entry.name] = {
              hasSkillMd,
              skillMdPath,
            };
            if (hasSkillMd) {
              try {
                const content = readFileSync(skillMdPath, "utf-8");
                result.details[entry.name].contentLength = content.length;
                result.details[entry.name].preview = content.substring(0, 200);
              } catch (readErr: unknown) {
                result.details[entry.name].readError = (readErr as Error).message;
              }
            }
          }
        }
      }
    } catch (err: unknown) {
      result.error = (err as Error).message;
    }
  }

  // Also check /workspace/.claude directory
  const claudeDir = "/workspace/.claude";
  result.claudeDir = {
    exists: existsSync(claudeDir),
  };
  if (result.claudeDir.exists) {
    try {
      result.claudeDir.contents = readdirSync(claudeDir);
    } catch (e: unknown) {
      result.claudeDir.error = (e as Error).message;
    }
  }

  console.log("[DEBUG] Skills directory check:", JSON.stringify(result, null, 2));
  res.json(result);
}

/**
 * Registers debug routes on the Express app.
 *
 * @param app - The Express application
 *
 * @example
 * import { registerDebugRoutes } from './routes/debug';
 * registerDebugRoutes(app);
 */
export function registerDebugRoutes(app: Express): void {
  app.get("/debug/skills", skillsDebugHandler);
}

export default registerDebugRoutes;
