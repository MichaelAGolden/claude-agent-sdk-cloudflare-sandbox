import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckIcon, CopyIcon, User, Bot, ImageIcon, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Message, ImageContentBlock } from "@/types";

interface ChatMessageProps {
  role: Message["role"];
  content: Message["content"];
  isStreaming?: boolean;
  sessionId?: string | null;
}

// Image extensions for detection
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

/**
 * Extracts sandbox image paths from text content
 */
function extractSandboxImagePaths(text: string): string[] {
  const matches: string[] = [];
  const extPattern = IMAGE_EXTENSIONS.join('|');

  // Pattern: paths in backticks like `/tmp/image.png`
  const backtickRegex = new RegExp(`\`(\\/(?:workspace|tmp)\\/[^\`\\s]+\\.(?:${extPattern}))\``, 'gi');
  let match;
  while ((match = backtickRegex.exec(text)) !== null) {
    matches.push(match[1]);
  }

  // Pattern: plain paths after common prefixes
  const plainRegex = new RegExp(`(?:saved to|created|wrote|output|file:?)\\s*(\\/(?:workspace|tmp)\\/[^\\s\`"'<>]+\\.(?:${extPattern}))`, 'gi');
  while ((match = plainRegex.exec(text)) !== null) {
    matches.push(match[1]);
  }

  // Pattern: paths at end of sentences or on their own
  const standaloneRegex = new RegExp(`(?:^|[\\s:])(\\/(?:workspace|tmp)\\/[^\\s\`"'<>]+\\.(?:${extPattern}))(?:[\\s.,!?)]|$)`, 'gim');
  while ((match = standaloneRegex.exec(text)) !== null) {
    matches.push(match[1]);
  }

  return [...new Set(matches)];
}

/**
 * Builds URL for sandbox file endpoint
 */
function getSandboxImageUrl(sessionId: string, filePath: string): string {
  const baseUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8787'
    : '';
  return `${baseUrl}/sandbox/${sessionId}/file?path=${encodeURIComponent(filePath)}`;
}

// Extract image blocks from content
function extractImageBlocks(content: any): ImageContentBlock[] {
  if (!Array.isArray(content)) return [];
  return content.filter((c) => c?.type === "image") as ImageContentBlock[];
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
        // Skip image blocks - they're rendered separately
        if (c?.type === "image") return "";
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content?.type === "text" && content?.text) return content.text;
  return "";
}

// Inline sandbox image component
const InlineSandboxImage = ({
  path,
  sessionId
}: {
  path: string;
  sessionId: string;
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const imageUrl = getSandboxImageUrl(sessionId, path);

  if (hasError) {
    return (
      <div className="my-4 flex items-center gap-2 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/50 p-4 text-sm text-muted-foreground">
        <ImageIcon className="h-5 w-5" />
        <span>Failed to load: {path}</span>
      </div>
    );
  }

  return (
    <div className="my-4">
      {isLoading && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/50 p-4 text-sm text-muted-foreground">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span>Loading {path}...</span>
        </div>
      )}
      <img
        src={imageUrl}
        alt={path}
        onLoad={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false);
          setHasError(true);
        }}
        className={cn(
          "max-w-full rounded-lg shadow-md transition-opacity",
          isLoading ? "hidden" : "opacity-100"
        )}
      />
      {!isLoading && (
        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <span className="font-mono">{path}</span>
          <a
            href={imageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}
    </div>
  );
};

// Image display component for base64/URL images
const ImageBlock = ({ image }: { image: ImageContentBlock }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const handleLoad = () => setIsLoading(false);
  const handleError = () => {
    setIsLoading(false);
    setHasError(true);
  };

  if (hasError) {
    return (
      <div className="my-4 flex items-center gap-2 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/50 p-4 text-sm text-muted-foreground">
        <ImageIcon className="h-5 w-5" />
        <span>Failed to load image{image.sandboxPath ? `: ${image.sandboxPath}` : ""}</span>
      </div>
    );
  }

  return (
    <div className="my-4">
      {isLoading && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/50 p-4 text-sm text-muted-foreground">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span>Loading image...</span>
        </div>
      )}
      <img
        src={image.url}
        alt={image.alt || "Generated image"}
        onLoad={handleLoad}
        onError={handleError}
        className={cn(
          "max-w-full rounded-lg shadow-md transition-opacity",
          isLoading ? "hidden" : "opacity-100"
        )}
      />
      {!isLoading && image.sandboxPath && (
        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <span className="font-mono">{image.sandboxPath}</span>
          {image.url && (
            <a
              href={image.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
};

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

export const ChatMessage = memo(function ChatMessage({
  role,
  content,
  isStreaming,
  sessionId
}: ChatMessageProps) {
  const textContent = extractTextContent(content);
  const imageBlocks = extractImageBlocks(content);
  const hasImages = imageBlocks.length > 0;
  const isUser = role === "user";

  // Detect sandbox image paths in assistant messages
  const detectedImagePaths = !isUser && sessionId
    ? extractSandboxImagePaths(textContent)
    : [];

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

        {/* Render image blocks first (base64/URL images from message content) */}
        {hasImages && (
          <div className="mb-4">
            {imageBlocks.map((img, idx) => (
              <ImageBlock key={`img-${idx}`} image={img} />
            ))}
          </div>
        )}

        {/* Render text content */}
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Code blocks with copy button
              pre: ({ children, ...props }) => (
                <div className="relative group">
                  <pre
                    className="overflow-x-auto rounded-lg bg-secondary p-4 text-sm text-secondary-foreground"
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

        {/* Render detected sandbox images inline */}
        {detectedImagePaths.length > 0 && sessionId && (
          <div className="mt-4 space-y-4">
            {detectedImagePaths.map((path, idx) => (
              <InlineSandboxImage
                key={`detected-${idx}-${path}`}
                path={path}
                sessionId={sessionId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
