"use client";

import "@assistant-ui/react-markdown/styles/dot.css";

import { type FC, memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckIcon, CopyIcon } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { cn } from "@/lib/utils";

interface StandaloneMarkdownProps {
  content: string;
  className?: string;
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

const StandaloneMarkdownImpl: FC<StandaloneMarkdownProps> = ({ content, className }) => {
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
