/**
 * @fileoverview Session transcript synchronization service.
 *
 * The Claude Agent SDK stores conversation transcripts locally at:
 * `/root/.claude/projects/-workspace/<session_id>.jsonl`
 *
 * These transcripts are essential for conversation resumption (the SDK's
 * `resume` option). Since sandbox filesystems are ephemeral, we sync
 * transcripts to/from R2 storage:
 *
 * - **On session start**: Restore transcript from R2 (if exists)
 * - **On session end**: Save transcript to R2 for persistence
 *
 * ## Why Not Mount R2?
 * We intentionally do NOT mount R2 at `/root/.claude/` because:
 * 1. The SDK actively reads/writes transcript files during conversations
 * 2. Mounted storage has network latency on every file operation
 * 3. Cloudflare docs recommend copying frequently accessed files locally
 *
 * @module services/transcripts
 */

import type { Sandbox } from "@cloudflare/sandbox";
import { getTranscriptR2Key, getTranscriptLocalPath } from "../lib/utils";

/**
 * Restores a session transcript from R2 to the sandbox filesystem.
 *
 * Call this function BEFORE sending a message with the SDK's `resume` option.
 * The SDK reads the transcript file to restore conversation context, so it
 * must be present in the sandbox before the query is made.
 *
 * ## Process Flow
 * 1. Fetch transcript from R2 using userId/sessionId
 * 2. Create the required directory structure if missing
 * 3. Write transcript content to local path
 * 4. Return success/failure status
 *
 * @param sandbox - The sandbox instance to write the transcript to
 * @param bucket - The R2 bucket containing user data
 * @param userId - The unique identifier for the user
 * @param sessionId - The Claude SDK session identifier
 * @returns True if transcript was restored, false if not found or error
 *
 * @example
 * // Before resuming a conversation
 * const restored = await restoreTranscriptFromR2(sandbox, bucket, userId, sessionId);
 * if (restored) {
 *   // SDK can now resume from previous conversation
 *   await sdk.query({ prompt, resume: true, sessionId });
 * }
 */
export const restoreTranscriptFromR2 = async (
  sandbox: Sandbox,
  bucket: R2Bucket,
  userId: string,
  sessionId: string
): Promise<boolean> => {
  try {
    const r2Key = getTranscriptR2Key(userId, sessionId);
    const obj = await bucket.get(r2Key);

    if (!obj) {
      console.log(`[Transcript] No transcript found in R2 for session ${sessionId}`);
      return false;
    }

    const content = await obj.text();
    const localPath = getTranscriptLocalPath(sessionId);

    // Ensure the directory exists
    await sandbox.mkdir("/root/.claude/projects/-workspace", { recursive: true });

    // Write transcript to local path
    await sandbox.writeFile(localPath, content);
    console.log(`[Transcript] Restored transcript from R2: ${r2Key} -> ${localPath}`);
    return true;
  } catch (error: any) {
    console.error(`[Transcript] Failed to restore from R2:`, error.message);
    return false;
  }
};

/**
 * Saves a session transcript from sandbox filesystem to R2 storage.
 *
 * Call this function AFTER a session ends (e.g., on WebSocket disconnect)
 * to persist the conversation transcript for future resumption.
 *
 * ## Process Flow
 * 1. Check if local transcript exists in sandbox
 * 2. Read transcript content from sandbox filesystem
 * 3. Upload to R2 with metadata (userId, sessionId, timestamp)
 * 4. Return success/failure status
 *
 * ## R2 Object Metadata
 * - `contentType`: "application/jsonl"
 * - `userId`: User who owns the transcript
 * - `sessionId`: SDK session identifier
 * - `savedAt`: ISO 8601 timestamp of save operation
 *
 * @param sandbox - The sandbox instance to read the transcript from
 * @param bucket - The R2 bucket for user data storage
 * @param userId - The unique identifier for the user
 * @param sessionId - The Claude SDK session identifier
 * @returns True if transcript was saved, false if not found or error
 *
 * @example
 * // On WebSocket disconnect
 * socket.on("disconnect", async () => {
 *   await saveTranscriptToR2(sandbox, bucket, userId, sessionId);
 * });
 */
export const saveTranscriptToR2 = async (
  sandbox: Sandbox,
  bucket: R2Bucket,
  userId: string,
  sessionId: string
): Promise<boolean> => {
  try {
    const localPath = getTranscriptLocalPath(sessionId);

    // Check if transcript exists
    const exists = await sandbox.exists(localPath);
    if (!exists.exists) {
      console.log(`[Transcript] No local transcript to save for session ${sessionId}`);
      return false;
    }

    // Read transcript from sandbox
    const file = await sandbox.readFile(localPath);
    const r2Key = getTranscriptR2Key(userId, sessionId);

    // Save to R2
    await bucket.put(r2Key, file.content, {
      httpMetadata: { contentType: "application/jsonl" },
      customMetadata: {
        userId,
        sessionId,
        savedAt: new Date().toISOString(),
      },
    });

    console.log(`[Transcript] Saved transcript to R2: ${localPath} -> ${r2Key}`);
    return true;
  } catch (error: any) {
    console.error(`[Transcript] Failed to save to R2:`, error.message);
    return false;
  }
};
