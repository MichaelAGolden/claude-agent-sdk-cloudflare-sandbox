export interface ExtendedOptions {
  model?: string;
  systemPrompt?: string;
  [key: string]: any;
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
  | 'PreCompact';

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

export interface AgentState {
  isConnected: boolean;
  messages: Message[];
  isStreaming: boolean;
  socketId: string | null;
}
