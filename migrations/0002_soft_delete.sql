-- Add soft delete support for threads
-- Migration: 0002_soft_delete
--
-- Threads are soft-deleted to preserve usage tracking data.
-- The deleted_at timestamp indicates when a thread was deleted.
-- R2 transcripts are cleaned up separately on delete.

ALTER TABLE threads ADD COLUMN deleted_at DATETIME DEFAULT NULL;

-- Index to efficiently filter out deleted threads
CREATE INDEX IF NOT EXISTS idx_threads_deleted ON threads(user_id, deleted_at);
