import { useState, useCallback, useEffect } from "react";
import { useAgent } from "@/contexts/AgentContext";
import { useThreads } from "@/contexts/ThreadContext";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModelSelector } from "@/components/ModelSelector";
import { CLAUDE_MODELS } from "@/types";

export function ChatContainer() {
  const { state, sessionId, sendMessage, interrupt, clearChat } = useAgent();
  const { state: threadState, updateThreadModel } = useThreads();
  const { currentThread, currentThreadId } = threadState;

  // Initialize model from thread or default
  const [selectedModel, setSelectedModel] = useState(
    currentThread?.model || CLAUDE_MODELS.SONNET_4_5
  );

  // Sync model when thread changes
  useEffect(() => {
    if (currentThread?.model) {
      setSelectedModel(currentThread.model);
    } else {
      setSelectedModel(CLAUDE_MODELS.SONNET_4_5);
    }
  }, [currentThread?.model, currentThreadId]);

  // Filter to only user and assistant messages
  const displayMessages = state.messages.filter(
    (msg) => msg.role === "user" || msg.role === "assistant"
  );

  // Handle model change - update local state and persist to thread
  const handleModelChange = useCallback((model: string) => {
    setSelectedModel(model);
    if (currentThreadId) {
      updateThreadModel(currentThreadId, model);
    }
  }, [currentThreadId, updateThreadModel]);

  // Wrap sendMessage to include the selected model
  const handleSendMessage = useCallback((prompt: string) => {
    sendMessage(prompt, { model: selectedModel });
  }, [sendMessage, selectedModel]);

  return (
    <div className="flex flex-col h-full">
      {/* Header with model selector and clear button */}
      <div className="flex items-center justify-between p-2 border-b">
        <ModelSelector
          value={selectedModel}
          onChange={handleModelChange}
          disabled={state.isStreaming}
          compact
        />
        {displayMessages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearChat}
            className="text-muted-foreground hover:text-destructive"
            title="Clear conversation"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Messages area */}
      <ChatMessages
        messages={displayMessages}
        isStreaming={state.isStreaming}
        sessionId={sessionId}
      />

      {/* Input area */}
      <ChatInput
        onSend={handleSendMessage}
        onCancel={interrupt}
        disabled={!state.isConnected}
        isStreaming={state.isStreaming}
        placeholder={
          !state.isConnected
            ? "Connecting to server..."
            : state.isStreaming
            ? "Claude is responding..."
            : "Message Claude..."
        }
      />
    </div>
  );
}

// Re-export for convenience
export { ChatMessages } from "./ChatMessages";
export { ChatInput } from "./ChatInput";
export { ChatMessage } from "./ChatMessage";
