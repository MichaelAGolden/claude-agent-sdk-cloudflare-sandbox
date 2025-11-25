import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckIcon, CopyIcon, User, Bot } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

// Helper to extract text content from complex content structures
function extractTextContent(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        if (c?.type === "text" && c?.text) return c.text;
        if (c?.type === "tool_use") {
          return `\n\`\`\`json\n// Tool: ${c.name}\n${JSON.stringify(c.input, null, 2)}\n\`\`\`\n`;
        }
        if (c?.type === "tool_result") {
          const resultText = typeof c.content === "string" ? c.content : extractTextContent(c.content);
          return `\n> Tool Result:\n> ${resultText}\n`;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content?.type === "text" && content?.text) return content.text;
  return "";
}

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 p-1.5 rounded bg-muted/80 hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
      title="Copy code"
    >
      {copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
    </button>
  );
};

export const ChatMessage = memo(function ChatMessage({ role, content, isStreaming }: ChatMessageProps) {
  const textContent = extractTextContent(content);
  const isUser = role === "user";

  return (
    <div className={cn("flex gap-3 py-4 px-4", isUser ? "bg-background" : "bg-muted/30")}>
      {/* Avatar */}
      <div
        className={cn(
          "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
          isUser ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      {/* Message content */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="font-medium text-sm mb-1">{isUser ? "You" : "Claude"}</div>
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Code blocks with copy button
              pre: ({ children, ...props }) => (
                <div className="relative group">
                  <pre
                    className="overflow-x-auto rounded-lg bg-zinc-900 dark:bg-zinc-950 p-4 text-sm text-zinc-100"
                    {...props}
                  >
                    {children}
                  </pre>
                  {typeof children === "object" && (
                    <CopyButton
                      text={
                        // Extract text from code element
                        (children as any)?.props?.children || ""
                      }
                    />
                  )}
                </div>
              ),
              // Inline code
              code: ({ className, children, ...props }) => {
                const isInline = !className;
                if (isInline) {
                  return (
                    <code
                      className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                }
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              },
              // Links
              a: ({ children, ...props }) => (
                <a
                  className="text-primary underline underline-offset-2 hover:text-primary/80"
                  target="_blank"
                  rel="noopener noreferrer"
                  {...props}
                >
                  {children}
                </a>
              ),
              // Paragraphs
              p: ({ children }) => <p className="mb-4 last:mb-0 leading-7">{children}</p>,
              // Lists
              ul: ({ children }) => <ul className="mb-4 ml-6 list-disc [&>li]:mt-2">{children}</ul>,
              ol: ({ children }) => <ol className="mb-4 ml-6 list-decimal [&>li]:mt-2">{children}</ol>,
              // Headings
              h1: ({ children }) => <h1 className="text-2xl font-bold mb-4 mt-6 first:mt-0">{children}</h1>,
              h2: ({ children }) => <h2 className="text-xl font-semibold mb-3 mt-5 first:mt-0">{children}</h2>,
              h3: ({ children }) => <h3 className="text-lg font-semibold mb-2 mt-4 first:mt-0">{children}</h3>,
              // Blockquotes
              blockquote: ({ children }) => (
                <blockquote className="border-l-4 border-muted-foreground/30 pl-4 italic my-4">
                  {children}
                </blockquote>
              ),
              // Tables
              table: ({ children }) => (
                <div className="overflow-x-auto my-4">
                  <table className="w-full border-collapse">{children}</table>
                </div>
              ),
              th: ({ children }) => (
                <th className="border border-border bg-muted px-4 py-2 text-left font-semibold">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border border-border px-4 py-2">{children}</td>
              ),
            }}
          >
            {textContent}
          </ReactMarkdown>
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-foreground/70 animate-pulse ml-0.5" />
          )}
        </div>
      </div>
    </div>
  );
});
