import { useCallback, useState } from "react";
import type { FC } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import * as m from "motion/react-m";

import { useAgent } from "@/contexts/AgentContext";
import { StandaloneMarkdown } from "@/components/assistant-ui/standalone-markdown";
import { StandaloneToolFallback } from "@/components/assistant-ui/standalone-tool-fallback";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { HookEventDisplay } from "@/components/HookEventDisplay";
import type { Message, HookEvent } from "@/types/index";

// Helper to extract text content from complex content structures
function extractTextContent(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        if (c?.type === "text" && c?.text) return c.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content?.type === "text" && content?.text) return content.text;
  return "";
}

// Get tool calls from content
function getToolCalls(content: any): any[] {
  if (!Array.isArray(content)) return [];
  return content.filter((block) => block?.type === "tool_use");
}

// User message component
const UserMessageItem: FC<{ message: Message; index: number }> = ({ message }) => {
  const textContent = extractTextContent(message.content);

  return (
    <m.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 }}
      className="aui-user-message-root mx-auto grid w-full max-w-[var(--thread-max-width)] animate-in auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] gap-y-2 px-2 py-4 duration-150 ease-out fade-in slide-in-from-bottom-1 first:mt-3 last:mb-5 [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content rounded-3xl bg-muted px-5 py-2.5 break-words text-foreground">
          {textContent}
        </div>
      </div>
    </m.div>
  );
};

// Assistant message component with copy functionality
const AssistantMessageItem: FC<{ message: Message; index: number; isLast: boolean; isStreaming: boolean }> = ({
  message,
  index,
  isLast,
  isStreaming
}) => {
  const [copied, setCopied] = useState(false);

  // Safely extract content with error handling
  let textContent = "";
  let toolCalls: any[] = [];

  try {
    textContent = extractTextContent(message.content);
    toolCalls = getToolCalls(message.content);
  } catch (err) {
    console.error("[AssistantMessageItem] Error extracting content:", err, message);
    textContent = "[Error processing message content]";
  }

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("[AssistantMessageItem] Error copying to clipboard:", err);
    }
  }, [textContent]);

  // Log for debugging
  console.log("[AssistantMessageItem] Rendering message:", index, "textContent length:", textContent.length, "toolCalls:", toolCalls.length);

  return (
    <div
      className="aui-assistant-message-root relative mx-auto w-full max-w-[var(--thread-max-width)] py-4 last:mb-24"
      data-role="assistant"
    >
      <div className="aui-assistant-message-content mx-2 leading-7 break-words text-foreground">
        {/* Render text content with markdown */}
        {textContent && textContent.length > 0 && (
          <StandaloneMarkdown content={textContent} />
        )}

        {/* Render tool calls */}
        {toolCalls.map((tool, toolIndex) => (
          <StandaloneToolFallback
            key={tool?.id || `tool-${index}-${toolIndex}`}
            toolName={tool?.name || "unknown"}
            argsText={JSON.stringify(tool?.input || {}, null, 2)}
            result={undefined}
          />
        ))}

        {/* Show streaming indicator */}
        {isLast && isStreaming && (
          <span className="inline-block w-2 h-4 bg-foreground/50 animate-pulse ml-1" />
        )}
      </div>

      {/* Action bar - only show when not streaming and has content */}
      {!(isLast && isStreaming) && textContent && (
        <div className="aui-assistant-message-footer mt-2 ml-2 flex">
          <div className="aui-assistant-action-bar-root -ml-1 flex gap-1 text-muted-foreground">
            <TooltipIconButton tooltip="Copy" onClick={handleCopy}>
              {copied ? <CheckIcon /> : <CopyIcon />}
            </TooltipIconButton>
          </div>
        </div>
      )}
    </div>
  );
};

// Hook event wrapper for consistent styling in the message flow
const HookMessageItem: FC<{ message: Message & { hookEvent: HookEvent }; index: number }> = ({ message }) => {
  return (
    <m.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.02 }}
    >
      <HookEventDisplay hookEvent={message.hookEvent} />
    </m.div>
  );
};

// Main ThreadMessages component that renders all messages including hooks
export const ThreadMessages: FC = () => {
  const { state } = useAgent();
  const { messages, isStreaming } = state;

  // Debug logging
  console.log("[ThreadMessages] Rendering", messages.length, "messages, isStreaming:", isStreaming);

  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="aui-thread-messages">
      {messages.map((message, index) => {
        try {
          const isLast = index === messages.length - 1;

          // Render hook events inline
          if (message.role === "hook" && message.hookEvent) {
            return (
              <HookMessageItem
                key={message.uuid || `hook-${index}`}
                message={message as Message & { hookEvent: HookEvent }}
                index={index}
              />
            );
          }

          // Render user messages
          if (message.role === "user") {
            return (
              <UserMessageItem
                key={message.uuid || `user-${index}`}
                message={message}
                index={index}
              />
            );
          }

          // Render assistant messages
          if (message.role === "assistant") {
            return (
              <AssistantMessageItem
                key={message.uuid || `assistant-${index}`}
                message={message}
                index={index}
                isLast={isLast}
                isStreaming={isStreaming}
              />
            );
          }

          // Skip system and other message types
          return null;
        } catch (err) {
          console.error("[ThreadMessages] Error rendering message:", index, message, err);
          return (
            <div key={`error-${index}`} className="text-red-500 p-2 text-sm">
              Error rendering message {index}
            </div>
          );
        }
      })}
    </div>
  );
};
