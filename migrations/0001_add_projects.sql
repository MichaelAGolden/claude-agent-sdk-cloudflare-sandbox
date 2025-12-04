-- Migration: Add projects support
-- Run this migration with:
--   npx wrangler@latest d1 execute claude-agent-threads --remote --file=migrations/0001_add_projects.sql

-- Step 1: Create projects table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_default INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME DEFAULT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, updated_at DESC);

-- Step 2: Add project_id column to threads (nullable for backward compatibility)
ALTER TABLE threads ADD COLUMN project_id TEXT REFERENCES projects(id);

CREATE INDEX IF NOT EXISTS idx_threads_project ON threads(project_id, updated_at DESC);

-- Step 3: Create default project for each existing user and assign orphan threads
-- This is done in application code (see routes/projects.routes.ts ensureDefaultProject)
