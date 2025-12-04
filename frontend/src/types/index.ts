/**
 * Claude model API IDs.
 * These are the exact strings required for Anthropic API calls.
 */
export const CLAUDE_MODELS = {
  // Current frontier models (4.5 series)
  SONNET_4_5: "claude-sonnet-4-5-20250929",
  HAIKU_4_5: "claude-haiku-4-5-20251001",
  OPUS_4_5: "claude-opus-4-5-20251101",

  // Legacy models (for compatibility)
  OPUS_4_1: "claude-opus-4-1-20250805",
  SONNET_4: "claude-sonnet-4-20250514",
  OPUS_4: "claude-opus-4-20250514",
  SONNET_3_7: "claude-3-7-sonnet-20250219",
  HAIKU_3_5: "claude-3-5-haiku-20241022",
  HAIKU_3: "claude-3-haiku-20240307",
} as const;

export type ClaudeModelId = (typeof CLAUDE_MODELS)[keyof typeof CLAUDE_MODELS];

/**
 * Model display names for UI.
 */
export const MODEL_DISPLAY_NAMES: Record<string, string> = {
  [CLAUDE_MODELS.SONNET_4_5]: "Claude Sonnet 4.5",
  [CLAUDE_MODELS.HAIKU_4_5]: "Claude Haiku 4.5",
  [CLAUDE_MODELS.OPUS_4_5]: "Claude Opus 4.5",
  [CLAUDE_MODELS.OPUS_4_1]: "Claude Opus 4.1",
  [CLAUDE_MODELS.SONNET_4]: "Claude Sonnet 4",
  [CLAUDE_MODELS.OPUS_4]: "Claude Opus 4",
  [CLAUDE_MODELS.SONNET_3_7]: "Claude Sonnet 3.7",
  [CLAUDE_MODELS.HAIKU_3_5]: "Claude Haiku 3.5",
  [CLAUDE_MODELS.HAIKU_3]: "Claude Haiku 3",
};

/**
 * Model alias type used by Claude Agent SDK for subagents.
 */
export type ModelAlias = 'sonnet' | 'opus' | 'haiku' | 'inherit';

/**
 * Subagent definition for Claude Agent SDK.
 * @see https://platform.claude.com/docs/en/agent-sdk/subagents
 */
export interface AgentDefinition {
  /** Natural language description of when to use this agent */
  description: string;
  /** The agent's system prompt defining its role and behavior */
  prompt: string;
  /** Array of allowed tool names. If omitted, inherits all tools */
  tools?: string[];
  /** Model override for this agent. Defaults to main model if omitted */
  model?: ModelAlias;
}

/**
 * Stored agent with metadata for persistence.
 */
export interface StoredAgent {
  /** Unique name/identifier for the agent */
  name: string;
  /** Scope: user-level or project-level */
  scope: 'user' | 'project';
  /** Project ID if project-scoped */
  projectId?: string;
  /** The agent definition */
  definition: AgentDefinition;
  /** Upload timestamp */
  uploadedAt?: string;
}

export interface ExtendedOptions {
  model?: string;
  systemPrompt?: string;
  /** Agents to use for this query */
  agents?: Record<string, AgentDefinition>;
  [key: string]: any;
}

// Image artifact types for agent-generated images
export interface ImageArtifact {
  type: 'image';
  /** URL to fetch the image */
  url: string;
  /** Original sandbox path where the image was created */
  sandboxPath?: string;
  /** MIME type of the image */
  mimeType: string;
}

// Image content block that can appear in messages
export interface ImageContentBlock {
  type: 'image';
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
  url?: string;
  sandboxPath?: string;
  alt?: string;
}

// Hook event types from Claude Agent SDK
export type HookEventType =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Notification'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop'
  | 'SubagentStop'
  | 'PreCompact'
  | 'SkillCommand';

export interface HookEvent {
  id: string;
  eventType: HookEventType;
  timestamp: number;
  data: any;
  // For hook_request events that need responses
  isRequest: boolean;
  response?: { action: string; [key: string]: any };
}

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'hook';
  content: string | any[];
  uuid?: string;
  type?: string; // for stream events

  // For hook events (role: 'hook')
  hookEvent?: HookEvent;

  // For interactions (hooks, permissions, etc.)
  requestId?: string;
  interactionType?: string; // e.g., 'hook_request'
  interactionData?: any;
  interactionState?: 'pending' | 'resolved';
  interactionResult?: any;
}

/**
 * Describes why the agent stopped working.
 * Used to show informative messages to the user.
 */
export interface StreamTerminationInfo {
  reason: 'completed' | 'error' | 'interrupted' | 'disconnected' | 'unknown';
  message: string;
  timestamp: number;
  details?: Record<string, unknown>;
}

export interface AgentState {
  isConnected: boolean;
  messages: Message[];
  isStreaming: boolean;
  socketId: string | null;
  /** Info about why streaming stopped (null while streaming or before first stream) */
  streamTermination: StreamTerminationInfo | null;
}
