import { useAgent } from "@/contexts/AgentContext";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ChatContainer() {
  const { state, sendMessage, interrupt, clearChat } = useAgent();

  // Filter to only user and assistant messages
  const displayMessages = state.messages.filter(
    (msg) => msg.role === "user" || msg.role === "assistant"
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header with clear button */}
      {displayMessages.length > 0 && (
        <div className="flex justify-end p-2 border-b">
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
        </div>
      )}

      {/* Messages area */}
      <ChatMessages
        messages={displayMessages.map(msg => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
          uuid: msg.uuid
        }))}
        isStreaming={state.isStreaming}
      />

      {/* Input area */}
      <ChatInput
        onSend={sendMessage}
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
