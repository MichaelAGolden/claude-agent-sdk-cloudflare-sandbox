/**
 * @fileoverview File synchronization service for capturing Claude's work artifacts.
 *
 * This service captures files created/modified during Claude sessions and persists
 * them to R2 storage. It operates at two levels:
 *
 * 1. **Immediate capture** - On PostToolUse hooks, extract file paths and sync
 *    immediately to ensure we don't lose artifacts if the session crashes.
 *
 * 2. **Full sync** - On SessionEnd/Disconnect, sync entire directories to catch
 *    any files created by bash scripts or other indirect means.
 *
 * ## Directories Synced
 * - `/workspace/` - Project files and code artifacts
 * - `/home/user/` - Claude's working directory for generated outputs
 * - `/root/.claude/` - SDK transcripts for session resumption
 *
 * ## Hook Data Structure
 * Tool inputs contain file paths in predictable locations:
 * - Write: `tool_input.file_path`
 * - Read: `tool_input.file_path`
 * - Bash: `tool_input.command` (parsed for file operations) + `cwd`
 *
 * @module services/file-sync
 */

import type { Sandbox } from "@cloudflare/sandbox";

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Maximum file size to sync (10MB).
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Directories to scan for full sync operations.
 */
const SYNC_DIRECTORIES = [
  '/workspace',
  '/home/user',
  '/home',
  '/root/.claude',
];

/**
 * Directories containing Claude's working files (where artifacts are created).
 */
const ARTIFACT_DIRECTORIES = [
  '/workspace',
  '/home/user',
  '/home',
  '/tmp',
];

/**
 * Directories to exclude from sync (too large or regeneratable).
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

// ============================================================================
// FILE PATH EXTRACTION
// ============================================================================

/**
 * Extracts file paths from hook event data.
 *
 * Parses tool_input for different tool types to find file paths that
 * were created, modified, or read during the tool execution.
 *
 * @param hookData - The raw hook event data from PostToolUse
 * @returns Array of file paths found in the hook data
 */
export function extractFilePathsFromHook(hookData: unknown): string[] {
  const data = hookData as Record<string, unknown>;
  if (!data) return [];

  const filePaths: string[] = [];
  const toolName = data.tool_name as string;
  const toolInput = data.tool_input as Record<string, unknown>;
  const toolResult = data.tool_result as string;
  const cwd = data.cwd as string;

  // Write tool - direct file creation
  if (toolName === 'Write' && toolInput?.file_path) {
    const filePath = toolInput.file_path as string;
    if (isInArtifactDirectory(filePath)) {
      filePaths.push(filePath);
    }
  }

  // Read tool - file was accessed (might want to preserve it)
  if (toolName === 'Read' && toolInput?.file_path) {
    const filePath = toolInput.file_path as string;
    if (isInArtifactDirectory(filePath)) {
      filePaths.push(filePath);
    }
  }

  // Edit tool - file was modified
  if (toolName === 'Edit' && toolInput?.file_path) {
    const filePath = toolInput.file_path as string;
    if (isInArtifactDirectory(filePath)) {
      filePaths.push(filePath);
    }
  }

  // Bash tool - parse command and output for file operations
  if (toolName === 'Bash' && toolInput?.command) {
    const command = toolInput.command as string;
    const bashPaths = extractFilePathsFromBashCommand(command, toolResult, cwd);
    filePaths.push(...bashPaths);
  }

  // NotebookEdit tool - jupyter notebook modification
  if (toolName === 'NotebookEdit' && toolInput?.notebook_path) {
    const filePath = toolInput.notebook_path as string;
    if (isInArtifactDirectory(filePath)) {
      filePaths.push(filePath);
    }
  }

  return [...new Set(filePaths)]; // Deduplicate
}

/**
 * Checks if a file path is within directories we want to capture.
 */
function isInArtifactDirectory(filePath: string): boolean {
  return ARTIFACT_DIRECTORIES.some(prefix => filePath.startsWith(prefix));
}

/**
 * Extracts file paths from Bash command execution.
 *
 * Looks for common patterns that indicate file creation:
 * - Output redirection (> or >>)
 * - Python scripts that save files
 * - File copy/move operations
 * - wget/curl downloads
 */
function extractFilePathsFromBashCommand(
  command: string,
  result: string | undefined,
  cwd: string | undefined
): string[] {
  const paths: string[] = [];

  // Output redirection patterns: > /path/to/file or >> /path/to/file
  const redirectMatches = command.match(/>\s*([^\s;&|]+)/g);
  if (redirectMatches) {
    for (const match of redirectMatches) {
      const path = match.replace(/^>+\s*/, '').trim();
      if (path.startsWith('/') && isInArtifactDirectory(path)) {
        paths.push(path);
      } else if (cwd && !path.startsWith('/')) {
        // Relative path - combine with cwd
        const fullPath = `${cwd}/${path}`.replace(/\/+/g, '/');
        if (isInArtifactDirectory(fullPath)) {
          paths.push(fullPath);
        }
      }
    }
  }

  // Python file operations - look for common save patterns in output
  if (result && (command.includes('python') || command.includes('.py'))) {
    // Match paths in output that look like saved files
    const outputPathMatches = result.match(
      /(?:saved?|created?|wrote?|output|writing)[^\n]*?(\/(?:workspace|home|tmp)\/[^\s'"<>|]+)/gi
    );
    if (outputPathMatches) {
      for (const match of outputPathMatches) {
        const pathMatch = match.match(/(\/(?:workspace|home|tmp)\/[^\s'"<>|]+)/i);
        if (pathMatch && isInArtifactDirectory(pathMatch[1])) {
          paths.push(pathMatch[1]);
        }
      }
    }

    // Also look for common Python save method outputs
    const savePatterns = result.match(
      /\/(?:workspace|home|tmp)\/[^\s'"<>|]+\.(?:png|jpg|jpeg|gif|webp|svg|pdf|csv|json|txt|md|py|html|xml)/gi
    );
    if (savePatterns) {
      for (const path of savePatterns) {
        if (isInArtifactDirectory(path)) {
          paths.push(path);
        }
      }
    }
  }

  // cp/mv commands - extract destination
  const cpMvMatch = command.match(/(?:cp|mv)\s+[^\s]+\s+([^\s;&|]+)/);
  if (cpMvMatch) {
    const dest = cpMvMatch[1];
    if (dest.startsWith('/') && isInArtifactDirectory(dest)) {
      paths.push(dest);
    } else if (cwd && !dest.startsWith('/')) {
      const fullPath = `${cwd}/${dest}`.replace(/\/+/g, '/');
      if (isInArtifactDirectory(fullPath)) {
        paths.push(fullPath);
      }
    }
  }

  // wget/curl downloads with -o or -O output option
  const downloadMatch = command.match(/(?:wget|curl)[^|;]*?(?:-o|-O)\s+([^\s;&|]+)/);
  if (downloadMatch) {
    const dest = downloadMatch[1];
    if (dest.startsWith('/') && isInArtifactDirectory(dest)) {
      paths.push(dest);
    } else if (cwd && !dest.startsWith('/')) {
      const fullPath = `${cwd}/${dest}`.replace(/\/+/g, '/');
      if (isInArtifactDirectory(fullPath)) {
        paths.push(fullPath);
      }
    }
  }

  return paths;
}

// ============================================================================
// R2 KEY HELPERS
// ============================================================================

/**
 * Generates R2 key for a synced file.
 *
 * Structure: `users/{userId}/files/{sandboxPath}`
 *
 * @example
 * getFileR2Key("user_123", "/home/user/output.png")
 * // Returns: "users/user_123/files/home/user/output.png"
 */
export function getFileR2Key(userId: string, sandboxPath: string): string {
  // Remove leading slash for R2 key
  const normalizedPath = sandboxPath.replace(/^\/+/, '');
  return `users/${userId}/files/${normalizedPath}`;
}

/**
 * Generates R2 prefix for listing all files for a user.
 */
export function getFilesR2Prefix(userId: string): string {
  return `users/${userId}/files/`;
}

/**
 * Generates R2 prefix for a specific directory.
 */
export function getDirectoryR2Prefix(userId: string, directory: string): string {
  const normalizedDir = directory.replace(/^\/+/, '').replace(/\/+$/, '');
  return `users/${userId}/files/${normalizedDir}/`;
}

// ============================================================================
// SINGLE FILE SYNC
// ============================================================================

/**
 * Result of a single file sync operation.
 */
export interface FileSyncResult {
  path: string;
  success: boolean;
  bytes?: number;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

/**
 * Syncs a single file from sandbox to R2.
 *
 * Called immediately on PostToolUse when a file path is detected.
 * This ensures we capture files even if the session crashes before
 * the full sync on SessionEnd.
 *
 * @param sandbox - The sandbox instance to read from
 * @param bucket - The R2 bucket for storage
 * @param userId - User identifier for R2 key
 * @param filePath - Absolute path to the file in sandbox
 * @returns Result of the sync operation
 */
export async function syncSingleFile(
  sandbox: Sandbox,
  bucket: R2Bucket,
  userId: string,
  filePath: string
): Promise<FileSyncResult> {
  try {
    // Check if file should be excluded
    if (shouldExcludePath(filePath)) {
      return {
        path: filePath,
        success: true,
        skipped: true,
        skipReason: 'excluded_path',
      };
    }

    // Check if file exists
    const exists = await sandbox.exists(filePath);
    if (!exists.exists) {
      return {
        path: filePath,
        success: false,
        error: 'File does not exist',
      };
    }

    // Read file content
    const fileData = await sandbox.readFile(filePath);

    // Skip files that are too large
    if (fileData.content.length > MAX_FILE_SIZE) {
      return {
        path: filePath,
        success: true,
        skipped: true,
        skipReason: `too_large_${fileData.content.length}_bytes`,
      };
    }

    // Determine content type
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const contentType = getContentType(ext);

    // Upload to R2
    const r2Key = getFileR2Key(userId, filePath);
    await bucket.put(r2Key, fileData.content, {
      httpMetadata: { contentType },
      customMetadata: {
        userId,
        sandboxPath: filePath,
        syncedAt: new Date().toISOString(),
        syncType: 'immediate',
      },
    });

    console.log(`[FileSync] Synced file: ${filePath} -> ${r2Key} (${fileData.content.length} bytes)`);

    return {
      path: filePath,
      success: true,
      bytes: fileData.content.length,
    };
  } catch (error: any) {
    console.error(`[FileSync] Failed to sync ${filePath}:`, error.message);
    return {
      path: filePath,
      success: false,
      error: error.message,
    };
  }
}

/**
 * Syncs multiple files from hook event.
 *
 * Extracts file paths from the hook data and syncs each one.
 *
 * @param sandbox - The sandbox instance
 * @param bucket - The R2 bucket
 * @param userId - User identifier
 * @param hookData - PostToolUse hook event data
 * @returns Array of sync results
 */
export async function syncFilesFromHook(
  sandbox: Sandbox,
  bucket: R2Bucket,
  userId: string,
  hookData: unknown
): Promise<FileSyncResult[]> {
  const filePaths = extractFilePathsFromHook(hookData);

  if (filePaths.length === 0) {
    return [];
  }

  console.log(`[FileSync] Found ${filePaths.length} file(s) in hook data:`, filePaths);

  const results: FileSyncResult[] = [];
  for (const filePath of filePaths) {
    const result = await syncSingleFile(sandbox, bucket, userId, filePath);
    results.push(result);
  }

  return results;
}

// ============================================================================
// FULL DIRECTORY SYNC
// ============================================================================

/**
 * Result of a full directory sync operation.
 */
export interface DirectorySyncResult {
  directory: string;
  filesSynced: number;
  filesSkipped: number;
  bytesSynced: number;
  errors: string[];
}

/**
 * Result of a full sync (all directories).
 */
export interface FullSyncResult {
  directories: DirectorySyncResult[];
  totalFilesSynced: number;
  totalFilesSkipped: number;
  totalBytesSynced: number;
  totalErrors: string[];
}

/**
 * Syncs an entire directory from sandbox to R2.
 *
 * Recursively lists all files and uploads them to R2.
 *
 * @param sandbox - The sandbox instance
 * @param bucket - The R2 bucket
 * @param userId - User identifier
 * @param directory - Directory path to sync
 * @returns Sync statistics
 */
export async function syncDirectory(
  sandbox: Sandbox,
  bucket: R2Bucket,
  userId: string,
  directory: string
): Promise<DirectorySyncResult> {
  const result: DirectorySyncResult = {
    directory,
    filesSynced: 0,
    filesSkipped: 0,
    bytesSynced: 0,
    errors: [],
  };

  try {
    // Check if directory exists
    const exists = await sandbox.exists(directory);
    if (!exists.exists) {
      console.log(`[FileSync] Directory doesn't exist: ${directory}`);
      return result;
    }

    // List all files recursively using ls -laR
    const files = await listFilesRecursive(sandbox, directory);
    console.log(`[FileSync] Found ${files.length} files in ${directory}`);

    // Sync each file
    for (const filePath of files) {
      const syncResult = await syncSingleFile(sandbox, bucket, userId, filePath);

      if (syncResult.success) {
        if (syncResult.skipped) {
          result.filesSkipped++;
        } else {
          result.filesSynced++;
          result.bytesSynced += syncResult.bytes || 0;
        }
      } else {
        result.errors.push(`${filePath}: ${syncResult.error}`);
      }
    }
  } catch (error: any) {
    console.error(`[FileSync] Error syncing directory ${directory}:`, error.message);
    result.errors.push(`Directory error: ${error.message}`);
  }

  return result;
}

/**
 * Performs a full sync of all relevant directories.
 *
 * Called on SessionEnd/Disconnect to ensure all files are captured.
 *
 * @param sandbox - The sandbox instance
 * @param bucket - The R2 bucket
 * @param userId - User identifier
 * @returns Aggregated sync statistics
 */
export async function fullSync(
  sandbox: Sandbox,
  bucket: R2Bucket,
  userId: string
): Promise<FullSyncResult> {
  console.log(`[FileSync] Starting full sync for user ${userId}`);

  const result: FullSyncResult = {
    directories: [],
    totalFilesSynced: 0,
    totalFilesSkipped: 0,
    totalBytesSynced: 0,
    totalErrors: [],
  };

  for (const directory of SYNC_DIRECTORIES) {
    const dirResult = await syncDirectory(sandbox, bucket, userId, directory);
    result.directories.push(dirResult);
    result.totalFilesSynced += dirResult.filesSynced;
    result.totalFilesSkipped += dirResult.filesSkipped;
    result.totalBytesSynced += dirResult.bytesSynced;
    result.totalErrors.push(...dirResult.errors);
  }

  console.log(
    `[FileSync] Full sync complete: ${result.totalFilesSynced} files synced, ` +
    `${result.totalFilesSkipped} skipped, ${result.totalBytesSynced} bytes, ` +
    `${result.totalErrors.length} errors`
  );

  return result;
}

// ============================================================================
// RESTORE FROM R2
// ============================================================================

/**
 * Result of a restore operation.
 */
export interface RestoreResult {
  filesRestored: number;
  bytesRestored: number;
  errors: string[];
}

/**
 * Restores all synced files from R2 to sandbox.
 *
 * Called on session resume to restore the user's workspace state.
 *
 * @param sandbox - The sandbox instance
 * @param bucket - The R2 bucket
 * @param userId - User identifier
 * @returns Restore statistics
 */
export async function restoreFromR2(
  sandbox: Sandbox,
  bucket: R2Bucket,
  userId: string
): Promise<RestoreResult> {
  const result: RestoreResult = {
    filesRestored: 0,
    bytesRestored: 0,
    errors: [],
  };

  const prefix = getFilesR2Prefix(userId);
  console.log(`[FileSync] Restoring files from R2 prefix: ${prefix}`);

  try {
    let cursor: string | undefined;

    do {
      const listing = await bucket.list({ prefix, cursor });

      for (const object of listing.objects) {
        try {
          // Calculate sandbox path from R2 key
          // R2 key: users/{userId}/files/{sandboxPath}
          const sandboxPath = '/' + object.key.replace(prefix, '');

          // Get file content
          const r2Object = await bucket.get(object.key);
          if (!r2Object) {
            console.warn(`[FileSync] Object not found: ${object.key}`);
            continue;
          }

          // Ensure parent directory exists
          const parentDir = sandboxPath.substring(0, sandboxPath.lastIndexOf('/'));
          if (parentDir) {
            await sandbox.mkdir(parentDir, { recursive: true });
          }

          // Determine if this is a text or binary file
          const ext = sandboxPath.split('.').pop()?.toLowerCase() || '';
          const textExtensions = new Set([
            'txt', 'md', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'csv',
            'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java',
            'c', 'cpp', 'h', 'hpp', 'css', 'scss', 'html', 'sql', 'sh', 'bash',
            'toml', 'ini', 'cfg', 'conf', 'env', 'gitignore', 'dockerignore',
          ]);

          // Write file to sandbox
          // sandbox.writeFile accepts strings for text content
          if (textExtensions.has(ext)) {
            const content = await r2Object.text();
            await sandbox.writeFile(sandboxPath, content);
            result.bytesRestored += content.length;
          } else {
            // For binary files, use base64 encoding as a workaround
            // Note: This may not work for all file types, but handles most cases
            const arrayBuffer = await r2Object.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            // Convert to base64 string for transport, then decode in sandbox
            // Actually, let's try writing as text if it's small enough
            // For now, skip binary files and log a warning
            console.warn(`[FileSync] Skipping binary file (sandbox.writeFile only supports text): ${sandboxPath}`);
            result.errors.push(`Skipped binary file: ${sandboxPath}`);
            continue;
          }

          result.filesRestored++;
        } catch (error: any) {
          const errorMsg = `Failed to restore ${object.key}: ${error.message}`;
          console.error(`[FileSync] ${errorMsg}`);
          result.errors.push(errorMsg);
        }
      }

      cursor = listing.truncated ? listing.cursor : undefined;
    } while (cursor);

    console.log(
      `[FileSync] Restore complete: ${result.filesRestored} files, ` +
      `${result.bytesRestored} bytes`
    );
  } catch (error: any) {
    console.error(`[FileSync] Restore failed:`, error.message);
    result.errors.push(error.message);
  }

  return result;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

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
 * Lists all files in a directory recursively.
 *
 * Uses `ls -laR` to get a recursive listing, then parses the output.
 */
async function listFilesRecursive(
  sandbox: Sandbox,
  dirPath: string
): Promise<string[]> {
  const files: string[] = [];

  try {
    const result = await sandbox.exec(`ls -laR "${dirPath}" 2>/dev/null`, { timeout: 30000 });

    if (!result.stdout) {
      return files;
    }

    let currentDir = dirPath;
    const lines = result.stdout.split('\n');

    for (const line of lines) {
      // Directory header ends with ":"
      if (line.endsWith(':')) {
        currentDir = line.slice(0, -1);
        continue;
      }

      // Skip empty lines, total lines
      if (!line || line.startsWith('total ') || line.trim() === '') continue;

      const parts = line.split(/\s+/);
      if (parts.length < 9) continue;

      const permissions = parts[0];
      // Name is everything after the 8th field
      const nameStartIndex = line.indexOf(parts[8], line.indexOf(parts[7]) + parts[7].length);
      const name = line.substring(nameStartIndex).trim();

      // Skip directories, . and .. entries, symlinks
      if (permissions.startsWith('d') || permissions.startsWith('l')) continue;
      if (name === '.' || name === '..') continue;

      const fullPath = `${currentDir}/${name}`.replace(/\/+/g, '/');

      // Skip excluded paths
      if (shouldExcludePath(fullPath)) continue;

      files.push(fullPath);
    }
  } catch (error: any) {
    if (!error.message?.includes('ENOENT') && !error.message?.includes('not found')) {
      console.warn(`[FileSync] Error listing ${dirPath}:`, error.message);
    }
  }

  return files;
}

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
    'ipynb': 'application/x-ipynb+json',
  };

  return contentTypes[ext] || 'application/octet-stream';
}
