import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import { useAgent } from "../contexts/AgentContext";
import { useRef, Component, useCallback } from "react";
import type { ReactNode } from "react";

// Counter for fallback IDs to ensure uniqueness
let messageIdCounter = 0;

// Error boundary to catch rendering errors
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error?: Error }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('AgentRuntimeProvider error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const errorText = this.state.error
        ? `${this.state.error.message}\n\n${this.state.error.stack}`
        : 'Unknown error';

      return (
        <div className="p-4 text-red-500">
          <h2>Something went wrong rendering messages.</h2>
          {this.state.error && (
            <pre className="mt-2 p-2 bg-red-100 text-red-800 text-xs rounded overflow-auto max-h-40">
              {errorText}
            </pre>
          )}
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => {
                navigator.clipboard.writeText(errorText);
              }}
              className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              Copy Error
            </button>
            <button
              onClick={() => {
                this.setState({ hasError: false });
                window.location.reload();
              }}
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Helper to extract text content from complex content structures
function extractTextContent(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(c => {
        if (typeof c === 'string') return c;
        if (c?.type === 'text' && c?.text) return c.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content?.type === 'text' && content?.text) return content.text;
  return '';
}

// Helper to convert SDK content to assistant-ui format
// Returns array compatible with ThreadMessageLike content
function convertContent(content: unknown, _stableId?: string) {
  try {
    // String content
    if (typeof content === 'string') {
      return [{ type: "text" as const, text: content }];
    }

    // Array content (from Claude SDK)
    if (Array.isArray(content)) {
      const result: Array<{ type: "text"; text: string }> = [];

      for (let i = 0; i < content.length; i++) {
        const block = content[i];

        if (typeof block === 'string') {
          result.push({ type: "text" as const, text: block });
        } else if (block?.type === 'text') {
          result.push({ type: "text" as const, text: block.text || '' });
        } else if (block?.type === 'tool_use') {
          // Convert tool calls to text representation
          // Our ThreadMessages component handles tool rendering directly
          result.push({
            type: "text" as const,
            text: `[Tool: ${block.name || 'unknown'}]`,
          });
        } else if (block?.type === 'tool_result') {
          // Tool results are converted to text
          const resultContent = typeof block.content === 'string'
            ? block.content
            : extractTextContent(block.content);
          if (resultContent) {
            result.push({
              type: "text" as const,
              text: resultContent,
            });
          }
        }
        // Skip unknown block types
      }

      // If no valid content, return empty text
      if (result.length === 0) {
        return [{ type: "text" as const, text: "" }];
      }

      return result;
    }

    // Object content
    if (content && typeof content === 'object') {
      const obj = content as Record<string, unknown>;
      if (obj.type === 'text' && typeof obj.text === 'string') {
        return [{ type: "text" as const, text: obj.text }];
      }
      return [{ type: "text" as const, text: JSON.stringify(content) }];
    }

    // Fallback
    return [{ type: "text" as const, text: String(content || '') }];
  } catch (error) {
    console.error('Error converting content:', error, content);
    return [{ type: "text" as const, text: "[Error displaying message]" }];
  }
}

export const AgentRuntimeProvider = ({ children }: { children: React.ReactNode }) => {
  const { state, sendMessage, interrupt } = useAgent();

  // Debug: Log every render
  console.log('[AgentRuntimeProvider] render - msgCount:', state.messages.length, 'isStreaming:', state.isStreaming);

  // Track message IDs we've assigned to ensure stability
  const messageIdMap = useRef<Map<string, string>>(new Map());

  // Filter and assign stable IDs to messages - create fresh array each render
  // to ensure the runtime detects changes
  const filteredMessages = state.messages
    .filter((msg) => {
      // Keep user and assistant messages
      if (msg.role === 'user' || msg.role === 'assistant') return true;
      // Filter out all other types
      return false;
    })
    .map((msg) => {
      // Use uuid if available, otherwise create a stable fallback based on content hash
      let stableId = msg.uuid;
      if (!stableId) {
        // Create a key based on role and content substring for stability
        const contentKey = `${msg.role}-${typeof msg.content === 'string' ? msg.content.substring(0, 50) : 'array'}`;
        if (!messageIdMap.current.has(contentKey)) {
          messageIdMap.current.set(contentKey, `msg-${++messageIdCounter}`);
        }
        stableId = messageIdMap.current.get(contentKey)!;
      }
      return {
        ...msg,
        stableId,
      };
    });

  // Get the total message count for determining last message
  const messageCount = filteredMessages.length;
  const isStreaming = state.isStreaming;

  // Convert message callback - needs to include status for proper UI updates
  // NOTE: status is ONLY supported on assistant messages, not user messages
  const convertMessage = useCallback((msg: any, idx: number) => {
    try {
      const messageContent = convertContent(msg.content, msg.stableId);
      const isLastMessage = idx === messageCount - 1;
      const isAssistant = msg.role === 'assistant';

      // User messages don't support status field
      if (!isAssistant) {
        return {
          id: msg.stableId,
          role: "user" as const,
          content: messageContent,
        };
      }

      // Assistant messages need status for proper UI updates
      if (isLastMessage && isStreaming) {
        // Last assistant message while streaming = running
        return {
          id: msg.stableId,
          role: "assistant" as const,
          content: messageContent,
          status: { type: "running" as const },
        };
      }

      // Completed assistant message
      return {
        id: msg.stableId,
        role: "assistant" as const,
        content: messageContent,
        status: { type: "complete" as const, reason: "stop" as const },
      };
    } catch (error) {
      console.error('Error in convertMessage:', error, msg);
      return {
        id: msg.stableId,
        role: msg.role as "user" | "assistant",
        content: [{ type: "text" as const, text: "[Error displaying message]" }],
      };
    }
  }, [messageCount, isStreaming]);

  // Callbacks - memoized
  const onNew = useCallback(async (message: any) => {
    if (message.content.length > 0 && message.content[0].type === 'text') {
      sendMessage(message.content[0].text);
    }
  }, [sendMessage]);

  const onCancel = useCallback(async () => {
    interrupt();
  }, [interrupt]);

  const runtime = useExternalStoreRuntime({
    messages: filteredMessages,
    convertMessage,
    onNew,
    onCancel,
    isRunning: state.isStreaming,
  });

  // Don't use a dynamic key - it causes unnecessary remounts that break the runtime's state tracking
  return (
    <ErrorBoundary>
      <AssistantRuntimeProvider runtime={runtime}>
        {children}
      </AssistantRuntimeProvider>
    </ErrorBoundary>
  );
};
