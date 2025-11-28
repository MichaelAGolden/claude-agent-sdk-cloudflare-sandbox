/**
 * @fileoverview Type definitions for the Claude Agent SDK Cloudflare Workers server.
 *
 * This module contains all shared TypeScript types used across the application,
 * including Cloudflare bindings, domain models, and service interfaces.
 *
 * @module lib/types
 */

import type { Sandbox } from "@cloudflare/sandbox";

/**
 * Cloudflare Workers environment bindings configuration.
 *
 * These bindings are configured in wrangler.toml and provide access to
 * Cloudflare services and environment variables at runtime.
 *
 * @property {DurableObjectNamespace<Sandbox>} Sandbox - Durable Object namespace for managing
 *   isolated sandbox environments. Each sandbox runs a Claude Agent SDK instance.
 * @property {R2Bucket} USER_DATA - R2 bucket for storing user-specific data including
 *   skills, conversation transcripts, and saved conversations.
 * @property {D1Database} DB - D1 SQLite database for structured data storage
 *   (threads, messages, users).
 * @property {string} [ANTHROPIC_API_KEY] - Anthropic API key for Claude model access.
 *   Takes precedence over CLAUDE_CODE_OAUTH_TOKEN.
 * @property {string} [CLAUDE_CODE_OAUTH_TOKEN] - OAuth token for Claude API access.
 *   Used as fallback when ANTHROPIC_API_KEY is not set.
 * @property {string} [MODEL] - Claude model identifier to use. Defaults to claude-sonnet-4-5-20250929.
 * @property {string} API_KEY - Server API key for authenticating protected endpoints.
 *   Required for /users/*, /setup/*, and /sandbox/* routes.
 * @property {string} [CLERK_SECRET_KEY] - Clerk authentication secret key (reserved for future use).
 * @property {string} [ACCOUNT_ID] - Cloudflare account ID, required for R2 bucket mounting
 *   in production mode.
 * @property {string} [ENVIRONMENT] - Runtime environment identifier.
 *   - "production": Enables R2 mounting, full persistence
 *   - "development": Uses file copying, limited persistence
 * @property {string} [PUBLIC_URL] - Public URL for WebSocket connections, used by
 *   frontend worker to discover backend endpoint.
 */
export type Bindings = {
  Sandbox: DurableObjectNamespace<Sandbox>;
  USER_DATA: R2Bucket;
  DB: D1Database;
  ANTHROPIC_API_KEY?: string;
  CLAUDE_CODE_OAUTH_TOKEN?: string;
  MODEL?: string;
  API_KEY: string;
  CLERK_SECRET_KEY?: string;
  ACCOUNT_ID?: string;
  ENVIRONMENT?: string;
  PUBLIC_URL?: string;
};

/**
 * Represents a Claude Code skill definition.
 *
 * Skills are markdown files that extend Claude's capabilities with custom
 * instructions, workflows, or domain knowledge. They are stored in R2 and
 * loaded into the sandbox filesystem at `/workspace/.claude/skills/{name}/SKILL.md`.
 *
 * @property {string} name - Unique identifier for the skill, used as the directory name.
 *   Should be lowercase with hyphens (e.g., "code-review", "testing-patterns").
 * @property {string} content - The full markdown content of the skill file,
 *   including frontmatter and instructions.
 *
 * @example
 * const skill: Skill = {
 *   name: "code-review",
 *   content: "---\nname: code-review\n---\n\n# Code Review Skill\n\nReview code for..."
 * };
 */
export type Skill = {
  name: string;
  content: string;
};

/**
 * Represents a conversation thread stored in D1 database.
 *
 * Threads are the top-level container for conversations. Each thread belongs
 * to a user and can optionally be linked to a Claude SDK session for resumption.
 * Messages are stored separately and linked via thread_id.
 *
 * @property {string} id - Unique UUID identifier for the thread.
 * @property {string} user_id - Foreign key reference to the owning user.
 * @property {string|null} session_id - Claude SDK session ID for conversation resumption.
 *   Null until the first message is sent and a session is established.
 * @property {string} title - Human-readable title for the thread.
 *   Auto-generated using Claude Haiku after the first message.
 * @property {string|null} summary - Optional summary of the conversation.
 *   Reserved for future use with conversation summarization.
 * @property {string} created_at - ISO 8601 timestamp of thread creation.
 * @property {string} updated_at - ISO 8601 timestamp of last modification.
 *   Updated whenever messages are added or thread metadata changes.
 *
 * @see {@link Message} - Messages belonging to a thread
 */
export type Thread = {
  id: string;
  user_id: string;
  session_id: string | null;
  title: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Represents a single message within a conversation thread.
 *
 * Messages capture the full conversation history including user inputs,
 * assistant responses, and hook events. Content is stored as text and
 * may contain markdown formatting or JSON for structured data.
 *
 * @property {string} id - Unique UUID identifier for the message.
 * @property {string} thread_id - Foreign key reference to the parent thread.
 * @property {string} role - The sender role, typically one of:
 *   - "user": Human user input
 *   - "assistant": Claude's response
 *   - "hook": System event from Claude Code hooks
 *   - "system": System-generated messages
 * @property {string} content - The message content. May be plain text,
 *   markdown, or JSON stringified for complex content types.
 * @property {string|null} hook_event - JSON stringified hook event data
 *   when role is "hook". Contains event type and metadata.
 * @property {string} created_at - ISO 8601 timestamp of message creation.
 *
 * @see {@link Thread} - Parent thread container
 */
export type Message = {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  hook_event: string | null;
  created_at: string;
};

/**
 * Tracks the lifecycle state of a Claude Agent SDK process within a sandbox.
 *
 * @property {boolean} started - Whether the agent has been started
 * @property {number} startedAt - Unix timestamp when agent was started
 * @property {string} [processId] - The sandbox process ID for the agent
 */
export type AgentState = {
  started: boolean;
  startedAt: number;
  processId?: string;
};
