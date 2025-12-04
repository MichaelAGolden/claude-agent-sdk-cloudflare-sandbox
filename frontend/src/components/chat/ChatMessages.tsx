import { useEffect, useRef } from "react";
import { ChatMessage } from "./ChatMessage";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Message } from "@/types";

/** Props for ChatMessages - accepts full Message[] but only displays user/assistant */
interface ChatMessagesProps {
  messages: Message[];
  isStreaming: boolean;
  sessionId: string | null;
}

export function ChatMessages({ messages, isStreaming, sessionId }: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive or during streaming
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isStreaming]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <div className="text-4xl mb-4">👋</div>
          <h2 className="text-xl font-semibold mb-2">Welcome to Claude Agent</h2>
          <p className="text-sm">Send a message to start the conversation</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1" ref={scrollAreaRef}>
      <div className="divide-y divide-border">
        {messages.map((msg, idx) => {
          const isLastMessage = idx === messages.length - 1;
          const isAssistant = msg.role === "assistant";
          const showStreamingIndicator = isLastMessage && isAssistant && isStreaming;

          return (
            <ChatMessage
              key={msg.uuid || `msg-${idx}`}
              role={msg.role}
              content={msg.content}
              isStreaming={showStreamingIndicator}
              sessionId={sessionId}
            />
          );
        })}
      </div>
      <div ref={bottomRef} className="h-4" />
    </ScrollArea>
  );
}
