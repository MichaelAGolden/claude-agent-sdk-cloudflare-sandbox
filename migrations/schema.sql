-- ezagentsdk Database Schema
-- Run this once to set up the D1 database:
--   npx wrangler d1 execute <your-db-name> --remote --file=migrations/schema.sql

-- Users table (synced from Clerk)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,              -- Clerk user ID
  email TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Threads table
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,              -- UUID
  user_id TEXT NOT NULL,
  session_id TEXT,                  -- Claude SDK session ID for resume
  title TEXT DEFAULT 'New conversation',
  summary TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME DEFAULT NULL, -- Soft delete (preserves data for usage tracking)
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL,               -- 'user', 'assistant', 'hook'
  content TEXT NOT NULL,            -- JSON for complex content
  hook_event TEXT,                  -- JSON for hook data (nullable)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_threads_user ON threads(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_deleted ON threads(user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);
