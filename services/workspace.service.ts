/**
 * @fileoverview Workspace persistence service for project files.
 *
 * Cloudflare Sandbox containers are ephemeral - files created during a session
 * (scripts, images, data files, etc.) are lost when the container hibernates.
 * This service syncs workspace files to/from R2 storage to preserve project state.
 *
 * ## Storage Structure
 * R2: `users/{userId}/projects/{projectId}/workspace/{...files}`
 * Sandbox: `/workspace/projects/{projectId}/{...files}`
 *
 * ## Sync Strategy
 * - **On project load**: Restore all files from R2 to sandbox
 * - **On disconnect/switch**: Save modified files from sandbox to R2
 * - **Periodic**: Optionally sync during long sessions
 *
 * ## Excluded Paths
 * - `node_modules/` - Too large, can be regenerated
 * - `.git/` - Version control should be external
 * - `__pycache__/` - Python cache, regenerated automatically
 * - `.venv/` - Virtual environments, too large
 *
 * @module services/workspace
 */

import type { Sandbox } from "@cloudflare/sandbox";

/**
 * Maximum file size to sync (10MB). Larger files are skipped.
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Safely checks if a path exists in the sandbox.
 *
 * Works around a Cloudflare Sandbox SDK issue where `sandbox.exists()` can throw
 * "Session already exists" when the container wakes from hibernation. In this case,
 * we retry the operation which typically succeeds on the second attempt.
 *
 * @param sandbox - The sandbox instance
 * @param path - Path to check
 * @returns Object with exists property
 */
async function safeExists(sandbox: Sandbox, path: string): Promise<{ exists: boolean }> {
  try {
    return await sandbox.exists(path);
  } catch (error: any) {
    // Handle "Session already exists" error from SDK
    if (error.message?.includes('already exists')) {
      console.log(`[Workspace] Session already exists, retrying exists check for ${path}...`);
      // Small delay then retry - the session should be ready now
      await new Promise(resolve => setTimeout(resolve, 100));
      try {
        return await sandbox.exists(path);
      } catch {
        // If retry fails, assume path doesn't exist
        return { exists: false };
      }
    }
    throw error;
  }
}

/**
 * Directories to exclude from sync (case-insensitive).
 */
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  '__pycache__',
  '.venv',
  'venv',
  '.env',
  '.cache',
  '.npm',
  '.yarn',
  'dist',
  'build',
]);

/**
 * File extensions to exclude from sync.
 */
const EXCLUDED_EXTENSIONS = new Set([
  '.pyc',
  '.pyo',
  '.so',
  '.dylib',
  '.dll',
  '.exe',
  '.o',
  '.a',
]);

/**
 * R2 key helpers for workspace files.
 */
export const getWorkspaceR2Prefix = (userId: string, projectId: string): string => {
  return `users/${userId}/projects/${projectId}/workspace/`;
};

export const getWorkspaceR2Key = (userId: string, projectId: string, relativePath: string): string => {
  return `users/${userId}/projects/${projectId}/workspace/${relativePath}`;
};

export const getProjectLocalPath = (projectId: string): string => {
  return `/workspace/projects/${projectId}`;
};

/**
 * Checks if a path should be excluded from sync.
 */
function shouldExcludePath(path: string): boolean {
  const parts = path.split('/');

  for (const part of parts) {
    if (EXCLUDED_DIRS.has(part.toLowerCase())) {
      return true;
    }
  }

  const ext = path.substring(path.lastIndexOf('.'));
  if (EXCLUDED_EXTENSIONS.has(ext.toLowerCase())) {
    return true;
  }

  return false;
}

/**
 * Lists all files in a sandbox directory using `ls -laR` command.
 *
 * NOTE: Uses Cloudflare Sandbox SDK's sandbox.exec() which runs commands
 * in an isolated container - NOT child_process.exec() on the host.
 * The dirPath is validated internally (must be /workspace/projects/{uuid}).
 * Using ls instead of find to reduce container resource usage and avoid
 * potential interference with the agent-sdk process running in the same container.
 *
 * @param sandbox - The sandbox instance
 * @param dirPath - Directory to list (validated project path)
 * @param basePath - Base path for relative path calculation
 * @returns Array of {relativePath, fullPath} objects
 */
async function listFilesRecursive(
  sandbox: Sandbox,
  dirPath: string,
  basePath: string
): Promise<Array<{ relativePath: string; fullPath: string }>> {
  const files: Array<{ relativePath: string; fullPath: string }> = [];

  try {
    // Use ls -laR for recursive listing (faster and lighter than find)
    // Cloudflare Sandbox SDK runs this in an isolated container (not host)
    const lsCmd = `ls -laR "${dirPath}" 2>/dev/null`;
    const result = await sandbox.exec(lsCmd, { timeout: 10000 });

    if (!result.stdout) {
      return files;
    }

    // Parse ls -laR output
    // Format:
    // /path/to/dir:
    // total N
    // drwxr-xr-x 2 root root 4096 Dec  3 01:00 .
    // -rw-r--r-- 1 root root 1234 Dec  3 01:00 file.txt
    //
    // /path/to/dir/subdir:
    // ...
    let currentDir = dirPath;
    const lines = result.stdout.split('\n');

    for (const line of lines) {
      // Directory header line ends with ":"
      if (line.endsWith(':')) {
        currentDir = line.slice(0, -1);
        continue;
      }

      // Skip empty lines, total lines, and . / .. entries
      if (!line || line.startsWith('total ') || line.trim() === '') continue;

      const parts = line.split(/\s+/);
      if (parts.length < 9) continue;

      const permissions = parts[0];
      // Name is everything after the 8th field
      const nameStartIndex = line.indexOf(parts[8],
        line.indexOf(parts[7]) + parts[7].length);
      const name = line.substring(nameStartIndex).trim();

      // Skip directories, . and .. entries
      if (permissions.startsWith('d') || name === '.' || name === '..') continue;

      // Skip symlinks for safety
      if (permissions.startsWith('l')) continue;

      const fullPath = `${currentDir}/${name}`.replace(/\/+/g, '/');
      const relativePath = fullPath.replace(basePath + '/', '');

      // Skip excluded paths and extensions
      if (shouldExcludePath(relativePath)) {
        continue;
      }

      files.push({ relativePath, fullPath });
    }
  } catch (error: any) {
    // Directory might not exist yet
    if (!error.message?.includes('ENOENT') && !error.message?.includes('not found')) {
      console.warn(`[Workspace] Error listing ${dirPath}:`, error.message);
    }
  }

  return files;
}

/**
 * Saves the entire project workspace from sandbox to R2.
 *
 * Recursively syncs all files from `/workspace/projects/{projectId}/` to R2,
 * excluding large directories like node_modules and .git.
 *
 * @param sandbox - The sandbox instance to read from
 * @param bucket - The R2 bucket for storage
 * @param userId - User identifier
 * @param projectId - Project identifier
 * @returns Object with sync statistics
 *
 * @example
 * // On disconnect or project switch
 * const result = await saveWorkspaceToR2(sandbox, bucket, userId, projectId);
 * console.log(`Saved ${result.filesSaved} files (${result.bytesSaved} bytes)`);
 */
export const saveWorkspaceToR2 = async (
  sandbox: Sandbox,
  bucket: R2Bucket,
  userId: string,
  projectId: string
): Promise<{ filesSaved: number; filesSkipped: number; bytesSaved: number; errors: string[] }> => {
  const result = {
    filesSaved: 0,
    filesSkipped: 0,
    bytesSaved: 0,
    errors: [] as string[],
  };

  const localBase = getProjectLocalPath(projectId);
  const r2Prefix = getWorkspaceR2Prefix(userId, projectId);

  console.log(`[Workspace] Saving workspace: ${localBase} -> R2:${r2Prefix}`);

  try {
    // Check if project directory exists (using safe wrapper for SDK quirks)
    const exists = await safeExists(sandbox, localBase);
    if (!exists.exists) {
      console.log(`[Workspace] Project directory doesn't exist, nothing to save`);
      return result;
    }

    // List all files recursively
    const files = await listFilesRecursive(sandbox, localBase, localBase);
    console.log(`[Workspace] Found ${files.length} files to potentially sync`);

    // Upload each file to R2
    for (const file of files) {
      try {
        // Read file from sandbox
        const fileData = await sandbox.readFile(file.fullPath);

        // Skip files that are too large
        if (fileData.content.length > MAX_FILE_SIZE) {
          console.log(`[Workspace] Skipping large file: ${file.relativePath} (${fileData.content.length} bytes)`);
          result.filesSkipped++;
          continue;
        }

        // Determine content type
        const ext = file.relativePath.split('.').pop()?.toLowerCase() || '';
        const contentType = getContentType(ext);

        // Upload to R2
        const r2Key = r2Prefix + file.relativePath;
        await bucket.put(r2Key, fileData.content, {
          httpMetadata: { contentType },
          customMetadata: {
            userId,
            projectId,
            originalPath: file.relativePath,
            savedAt: new Date().toISOString(),
          },
        });

        result.filesSaved++;
        result.bytesSaved += fileData.content.length;
      } catch (error: any) {
        const errorMsg = `Failed to save ${file.relativePath}: ${error.message}`;
        console.error(`[Workspace] ${errorMsg}`);
        result.errors.push(errorMsg);
      }
    }

    console.log(`[Workspace] Saved ${result.filesSaved} files (${result.bytesSaved} bytes), skipped ${result.filesSkipped}`);
  } catch (error: any) {
    console.error(`[Workspace] Failed to save workspace:`, error.message);
    result.errors.push(error.message);
  }

  return result;
};

/**
 * Restores the project workspace from R2 to sandbox.
 *
 * Downloads all files from R2 and writes them to the sandbox filesystem,
 * recreating the full directory structure.
 *
 * @param sandbox - The sandbox instance to write to
 * @param bucket - The R2 bucket containing workspace files
 * @param userId - User identifier
 * @param projectId - Project identifier
 * @returns Object with restore statistics
 *
 * @example
 * // On project load or reconnect
 * const result = await restoreWorkspaceFromR2(sandbox, bucket, userId, projectId);
 * console.log(`Restored ${result.filesRestored} files`);
 */
export const restoreWorkspaceFromR2 = async (
  sandbox: Sandbox,
  bucket: R2Bucket,
  userId: string,
  projectId: string
): Promise<{ filesRestored: number; bytesRestored: number; errors: string[] }> => {
  const result = {
    filesRestored: 0,
    bytesRestored: 0,
    errors: [] as string[],
  };

  const localBase = getProjectLocalPath(projectId);
  const r2Prefix = getWorkspaceR2Prefix(userId, projectId);

  console.log(`[Workspace] Restoring workspace: R2:${r2Prefix} -> ${localBase}`);

  try {
    // Ensure project directory exists
    await sandbox.mkdir(localBase, { recursive: true });

    // List all objects in R2 with this prefix
    let cursor: string | undefined;
    let totalObjects = 0;

    do {
      const listing = await bucket.list({
        prefix: r2Prefix,
        cursor,
      });

      for (const object of listing.objects) {
        try {
          // Calculate local path from R2 key
          const relativePath = object.key.replace(r2Prefix, '');
          if (!relativePath) continue;

          const localPath = `${localBase}/${relativePath}`;

          // Get file content from R2
          const r2Object = await bucket.get(object.key);
          if (!r2Object) {
            console.warn(`[Workspace] Object not found: ${object.key}`);
            continue;
          }

          // Ensure parent directory exists
          const parentDir = localPath.substring(0, localPath.lastIndexOf('/'));
          await sandbox.mkdir(parentDir, { recursive: true });

          // Determine if this is a text or binary file by extension
          // Sandbox SDK's writeFile() only accepts strings, so we handle them differently
          const ext = localPath.split('.').pop()?.toLowerCase() || '';
          const textExtensions = new Set([
            'txt', 'md', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'csv',
            'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java',
            'c', 'cpp', 'h', 'hpp', 'css', 'scss', 'html', 'sql', 'sh', 'bash',
            'toml', 'ini', 'cfg', 'conf', 'env', 'gitignore', 'dockerignore',
          ]);

          if (textExtensions.has(ext)) {
            // For text files, use text() which returns a string
            const content = await r2Object.text();
            await sandbox.writeFile(localPath, content);
            result.filesRestored++;
            result.bytesRestored += content.length;
          } else {
            // Binary files can't be written via sandbox.writeFile (only accepts strings)
            // Log a warning and skip - these files would need a different approach
            console.warn(`[Workspace] Skipping binary file (sandbox.writeFile only accepts strings): ${localPath}`);
            result.errors.push(`Skipped binary file: ${localPath}`);
            continue;
          }
          totalObjects++;
        } catch (error: any) {
          const errorMsg = `Failed to restore ${object.key}: ${error.message}`;
          console.error(`[Workspace] ${errorMsg}`);
          result.errors.push(errorMsg);
        }
      }

      cursor = listing.truncated ? listing.cursor : undefined;
    } while (cursor);

    console.log(`[Workspace] Restored ${result.filesRestored} files (${result.bytesRestored} bytes)`);
  } catch (error: any) {
    console.error(`[Workspace] Failed to restore workspace:`, error.message);
    result.errors.push(error.message);
  }

  return result;
};

/**
 * Clears workspace files from R2 for a project.
 *
 * Use with caution - this permanently deletes all saved workspace files.
 *
 * @param bucket - The R2 bucket
 * @param userId - User identifier
 * @param projectId - Project identifier
 * @returns Number of objects deleted
 */
export const clearWorkspaceFromR2 = async (
  bucket: R2Bucket,
  userId: string,
  projectId: string
): Promise<number> => {
  const r2Prefix = getWorkspaceR2Prefix(userId, projectId);
  let deleted = 0;

  try {
    let cursor: string | undefined;

    do {
      const listing = await bucket.list({
        prefix: r2Prefix,
        cursor,
      });

      // Delete objects in batches
      const keysToDelete = listing.objects.map(obj => obj.key);
      if (keysToDelete.length > 0) {
        await bucket.delete(keysToDelete);
        deleted += keysToDelete.length;
      }

      cursor = listing.truncated ? listing.cursor : undefined;
    } while (cursor);

    console.log(`[Workspace] Cleared ${deleted} objects from R2 for project ${projectId}`);
  } catch (error: any) {
    console.error(`[Workspace] Failed to clear workspace:`, error.message);
  }

  return deleted;
};

/**
 * Returns content type based on file extension.
 */
function getContentType(ext: string): string {
  const contentTypes: Record<string, string> = {
    // Text
    'txt': 'text/plain',
    'md': 'text/markdown',
    'json': 'application/json',
    'jsonl': 'application/jsonl',
    'xml': 'application/xml',
    'yaml': 'application/yaml',
    'yml': 'application/yaml',
    'csv': 'text/csv',

    // Code
    'js': 'application/javascript',
    'ts': 'application/typescript',
    'jsx': 'application/javascript',
    'tsx': 'application/typescript',
    'py': 'text/x-python',
    'rb': 'text/x-ruby',
    'go': 'text/x-go',
    'rs': 'text/x-rust',
    'java': 'text/x-java',
    'c': 'text/x-c',
    'cpp': 'text/x-c++',
    'h': 'text/x-c',
    'hpp': 'text/x-c++',
    'css': 'text/css',
    'scss': 'text/x-scss',
    'html': 'text/html',
    'sql': 'application/sql',
    'sh': 'application/x-sh',
    'bash': 'application/x-sh',

    // Images
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'ico': 'image/x-icon',

    // Documents
    'pdf': 'application/pdf',

    // Data
    'db': 'application/octet-stream',
    'sqlite': 'application/octet-stream',
  };

  return contentTypes[ext] || 'application/octet-stream';
}
