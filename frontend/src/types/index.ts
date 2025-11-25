export interface ExtendedOptions {
  model?: string;
  systemPrompt?: string;
  [key: string]: any;
}

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'interaction';
  content: string | any[];
  uuid?: string;
  type?: string; // for stream events

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
