"use client";

import "@assistant-ui/react-markdown/styles/dot.css";

import { type FC, memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckIcon, CopyIcon, ImageIcon, ExternalLink } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { cn } from "@/lib/utils";

interface StandaloneMarkdownProps {
  content: string;
  className?: string;
  /** Session ID for fetching sandbox files (userId in our architecture) */
  sessionId?: string;
}

const useCopyToClipboard = ({
  copiedDuration = 3000,
}: {
  copiedDuration?: number;
} = {}) => {
  const [isCopied, setIsCopied] = useState<boolean>(false);

  const copyToClipboard = (value: string) => {
    if (!value) return;

    navigator.clipboard.writeText(value).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), copiedDuration);
    });
  };

  return { isCopied, copyToClipboard };
};

/**
 * Checks if a path is a sandbox file path that should be served via the file endpoint
 */
const isSandboxPath = (src: string): boolean => {
  return src.startsWith('/workspace') || src.startsWith('/tmp');
};

/**
 * Converts a sandbox path to a URL that fetches from the backend file endpoint
 */
const getSandboxFileUrl = (sessionId: string, filePath: string): string => {
  const encodedPath = encodeURIComponent(filePath);
  // In production, use same origin; in dev, use the backend URL
  const baseUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8787'
    : '';
  return `${baseUrl}/sandbox/${sessionId}/file?path=${encodedPath}`;
};

/**
 * Image component that handles sandbox file paths
 */
const SandboxImage: FC<{
  src: string;
  alt?: string;
  sessionId?: string;
}> = ({ src, alt, sessionId }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // Determine the actual image URL
  const imageUrl = sessionId && isSandboxPath(src)
    ? getSandboxFileUrl(sessionId, src)
    : src;

  const handleLoad = () => setIsLoading(false);
  const handleError = () => {
    setIsLoading(false);
    setHasError(true);
  };

  if (hasError) {
    return (
      <div className="my-4 flex items-center gap-2 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/50 p-4 text-sm text-muted-foreground">
        <ImageIcon className="h-5 w-5" />
        <span>Failed to load image: {alt || src}</span>
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
        src={imageUrl}
        alt={alt || "Image"}
        onLoad={handleLoad}
        onError={handleError}
        className={cn(
          "max-w-full rounded-lg shadow-md transition-opacity",
          isLoading ? "hidden" : "opacity-100"
        )}
      />
      {!isLoading && sessionId && isSandboxPath(src) && (
        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <span className="font-mono">{src}</span>
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

/**
 * Extracts image paths from text content
 * Supports paths in various formats:
 * - Plain text: /tmp/image.png
 * - In backticks: `/tmp/image.png`
 * - In markdown code: `path/to/image.png`
 * - After "saved to": saved to /tmp/image.png
 */
const extractImagePaths = (text: string): string[] => {
  const matches: string[] = [];

  // Pattern 1: Paths in backticks like `/tmp/image.png`
  const backtickPattern = /`(\/(?:workspace|tmp)\/[^`\s]+\.(?:png|jpg|jpeg|gif|webp|svg))`/gi;
  let match;
  while ((match = backtickPattern.exec(text)) !== null) {
    matches.push(match[1]);
  }

  // Pattern 2: Plain paths with word boundary or whitespace
  // This catches: "saved to /tmp/file.png" or "at /workspace/output.jpg"
  const plainPattern = /(?:^|[\s:])(\/?(?:workspace|tmp)\/[^\s`"'<>]+\.(?:png|jpg|jpeg|gif|webp|svg))(?:[\s.,!?)]|$)/gi;
  while ((match = plainPattern.exec(text)) !== null) {
    // Clean up the path (remove leading slash if doubled)
    let path = match[1];
    if (!path.startsWith('/')) {
      path = '/' + path;
    }
    matches.push(path);
  }

  // Deduplicate and return
  return [...new Set(matches)];
};

/**
 * Component that renders detected image paths as inline images
 */
const DetectedImages: FC<{ content: string; sessionId?: string }> = ({ content, sessionId }) => {
  const imagePaths = extractImagePaths(content);

  // Debug logging
  if (imagePaths.length > 0) {
    console.log('[DetectedImages] Found image paths:', imagePaths, 'sessionId:', sessionId);
  }

  if (imagePaths.length === 0 || !sessionId) {
    if (imagePaths.length > 0 && !sessionId) {
      console.warn('[DetectedImages] Found images but no sessionId available');
    }
    return null;
  }

  return (
    <div className="mt-4 space-y-4">
      {imagePaths.map((path, index) => (
        <SandboxImage key={`detected-${index}-${path}`} src={path} sessionId={sessionId} />
      ))}
    </div>
  );
};

const CodeBlock: FC<{ language?: string; code: string }> = ({ language, code }) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const onCopy = () => {
    if (!code || isCopied) return;
    copyToClipboard(code);
  };

  return (
    <div className="my-4">
      <div className="aui-code-header-root flex items-center justify-between gap-4 rounded-t-lg bg-muted-foreground/15 px-4 py-2 text-sm font-semibold text-foreground dark:bg-muted-foreground/20">
        <span className="aui-code-header-language lowercase [&>span]:text-xs">
          {language || "code"}
        </span>
        <TooltipIconButton tooltip="Copy" onClick={onCopy}>
          {!isCopied && <CopyIcon />}
          {isCopied && <CheckIcon />}
        </TooltipIconButton>
      </div>
      <pre className="aui-md-pre overflow-x-auto !rounded-t-none rounded-b-lg bg-black p-4 text-white">
        <code>{code}</code>
      </pre>
    </div>
  );
};

const StandaloneMarkdownImpl: FC<StandaloneMarkdownProps> = ({ content, className, sessionId }) => {
  // Guard against null/undefined content
  if (!content || typeof content !== 'string') {
    console.warn("[StandaloneMarkdown] Invalid content:", content);
    return null;
  }

  return (
    <div className={cn("aui-md", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
        // Custom image renderer for sandbox files
        img: ({ src, alt }) => {
          if (!src) return null;
          return <SandboxImage src={src} alt={alt} sessionId={sessionId} />;
        },
        h1: ({ className: classNameProp, ...props }) => (
          <h1
            className={cn(
              "aui-md-h1 mb-8 scroll-m-20 text-4xl font-extrabold tracking-tight last:mb-0",
              classNameProp,
            )}
            {...props}
          />
        ),
        h2: ({ className: classNameProp, ...props }) => (
          <h2
            className={cn(
              "aui-md-h2 mt-8 mb-4 scroll-m-20 text-3xl font-semibold tracking-tight first:mt-0 last:mb-0",
              classNameProp,
            )}
            {...props}
          />
        ),
        h3: ({ className: classNameProp, ...props }) => (
          <h3
            className={cn(
              "aui-md-h3 mt-6 mb-4 scroll-m-20 text-2xl font-semibold tracking-tight first:mt-0 last:mb-0",
              classNameProp,
            )}
            {...props}
          />
        ),
        h4: ({ className: classNameProp, ...props }) => (
          <h4
            className={cn(
              "aui-md-h4 mt-6 mb-4 scroll-m-20 text-xl font-semibold tracking-tight first:mt-0 last:mb-0",
              classNameProp,
            )}
            {...props}
          />
        ),
        h5: ({ className: classNameProp, ...props }) => (
          <h5
            className={cn(
              "aui-md-h5 my-4 text-lg font-semibold first:mt-0 last:mb-0",
              classNameProp,
            )}
            {...props}
          />
        ),
        h6: ({ className: classNameProp, ...props }) => (
          <h6
            className={cn(
              "aui-md-h6 my-4 font-semibold first:mt-0 last:mb-0",
              classNameProp,
            )}
            {...props}
          />
        ),
        p: ({ className: classNameProp, ...props }) => (
          <p
            className={cn(
              "aui-md-p mt-5 mb-5 leading-7 first:mt-0 last:mb-0",
              classNameProp,
            )}
            {...props}
          />
        ),
        a: ({ className: classNameProp, ...props }) => (
          <a
            className={cn(
              "aui-md-a font-medium text-primary underline underline-offset-4",
              classNameProp,
            )}
            {...props}
          />
        ),
        blockquote: ({ className: classNameProp, ...props }) => (
          <blockquote
            className={cn("aui-md-blockquote border-l-2 pl-6 italic", classNameProp)}
            {...props}
          />
        ),
        ul: ({ className: classNameProp, ...props }) => (
          <ul
            className={cn("aui-md-ul my-5 ml-6 list-disc [&>li]:mt-2", classNameProp)}
            {...props}
          />
        ),
        ol: ({ className: classNameProp, ...props }) => (
          <ol
            className={cn("aui-md-ol my-5 ml-6 list-decimal [&>li]:mt-2", classNameProp)}
            {...props}
          />
        ),
        hr: ({ className: classNameProp, ...props }) => (
          <hr className={cn("aui-md-hr my-5 border-b", classNameProp)} {...props} />
        ),
        table: ({ className: classNameProp, ...props }) => (
          <table
            className={cn(
              "aui-md-table my-5 w-full border-separate border-spacing-0 overflow-y-auto",
              classNameProp,
            )}
            {...props}
          />
        ),
        th: ({ className: classNameProp, ...props }) => (
          <th
            className={cn(
              "aui-md-th bg-muted px-4 py-2 text-left font-bold first:rounded-tl-lg last:rounded-tr-lg [&[align=center]]:text-center [&[align=right]]:text-right",
              classNameProp,
            )}
            {...props}
          />
        ),
        td: ({ className: classNameProp, ...props }) => (
          <td
            className={cn(
              "aui-md-td border-b border-l px-4 py-2 text-left last:border-r [&[align=center]]:text-center [&[align=right]]:text-right",
              classNameProp,
            )}
            {...props}
          />
        ),
        tr: ({ className: classNameProp, ...props }) => (
          <tr
            className={cn(
              "aui-md-tr m-0 border-b p-0 first:border-t [&:last-child>td:first-child]:rounded-bl-lg [&:last-child>td:last-child]:rounded-br-lg",
              classNameProp,
            )}
            {...props}
          />
        ),
        sup: ({ className: classNameProp, ...props }) => (
          <sup
            className={cn("aui-md-sup [&>a]:text-xs [&>a]:no-underline", classNameProp)}
            {...props}
          />
        ),
        pre: ({ children }) => {
          // Safely extract code content and language from children
          try {
            const codeChild = children as any;
            if (codeChild?.props) {
              const rawCode = codeChild.props.children;
              // Handle both string and array children
              const code = Array.isArray(rawCode) ? rawCode.join('') : String(rawCode || '');
              const className = codeChild.props.className || "";
              const match = /language-(\w+)/.exec(className);
              const language = match ? match[1] : undefined;
              return <CodeBlock language={language} code={code} />;
            }
          } catch (err) {
            console.error("[StandaloneMarkdown] Error in pre block:", err);
          }
          return <pre className="aui-md-pre overflow-x-auto rounded-lg bg-black p-4 text-white">{children}</pre>;
        },
        code: ({ className: classNameProp, children, ...props }) => {
          // Check if this is inline code (no className with language)
          const isInline = !classNameProp?.includes("language-");
          if (isInline) {
            return (
              <code
                className={cn(
                  "aui-md-inline-code rounded border bg-muted px-1 font-semibold",
                  classNameProp,
                )}
                {...props}
              >
                {children}
              </code>
            );
          }
          // For code blocks, just return the content (parent pre will handle)
          return <>{children}</>;
        },
      }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export const StandaloneMarkdown = memo(StandaloneMarkdownImpl);

// Export utilities for detecting images in raw text
export { DetectedImages, extractImagePaths, isSandboxPath, getSandboxFileUrl };
