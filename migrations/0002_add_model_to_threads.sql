-- Migration: Add model column to threads table
-- This allows storing the selected model per thread for seamless switching
-- Run with: npx wrangler d1 execute claude-agent-threads --local --file=migrations/0002_add_model_to_threads.sql

-- Add model column with default value
ALTER TABLE threads ADD COLUMN model TEXT DEFAULT 'claude-sonnet-4-5-20250929';

-- Create index for efficient model-based queries (if needed for analytics)
CREATE INDEX IF NOT EXISTS idx_threads_model ON threads(model);
