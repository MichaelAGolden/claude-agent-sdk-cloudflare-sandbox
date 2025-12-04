import { memo, useState, useEffect } from 'react';
import {
  XIcon,
  CopyIcon,
  CheckIcon,
  ExternalLinkIcon,
  FileIcon,
  AlertCircleIcon,
  Loader2Icon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useFileExplorer } from '@/contexts/FileExplorerContext';
import { useAgent } from '@/contexts/AgentContext';
import { StandaloneMarkdown } from '@/components/assistant-ui/standalone-markdown';

// ============================================================================
// FILE TYPE DETECTION
// ============================================================================

const CODE_EXTENSIONS: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json',
  xml: 'xml',
  html: 'html',
  css: 'css',
  scss: 'scss',
  sql: 'sql',
  toml: 'toml',
  dockerfile: 'dockerfile',
};

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp']);
const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx', 'markdown']);
const TEXT_EXTENSIONS = new Set(['txt', 'log', 'csv', 'env', 'gitignore', 'dockerignore']);

function getFileType(filename: string): 'code' | 'image' | 'markdown' | 'text' | 'binary' {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const name = filename.toLowerCase();

  // Special filenames
  if (name === 'dockerfile' || name === 'makefile') return 'code';
  if (name.startsWith('.')) return 'text'; // dotfiles

  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown';
  if (CODE_EXTENSIONS[ext]) return 'code';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';

  return 'binary';
}

function getLanguage(filename: string): string | undefined {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const name = filename.toLowerCase();

  if (name === 'dockerfile') return 'dockerfile';
  if (name === 'makefile') return 'makefile';

  return CODE_EXTENSIONS[ext];
}

// ============================================================================
// COPY HOOK
// ============================================================================

function useCopyToClipboard(duration = 2000) {
  const [isCopied, setIsCopied] = useState(false);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), duration);
    });
  };

  return { isCopied, copy };
}

// ============================================================================
// FILE VIEWER COMPONENT
// ============================================================================

export const FileViewer = memo(function FileViewer() {
  const { state, selectFile, getFileContent } = useFileExplorer();
  const { sessionId } = useAgent();
  const { isCopied, copy } = useCopyToClipboard();

  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPath = state.selectedPath;
  const filename = selectedPath?.split('/').pop() || '';
  const fileType = filename ? getFileType(filename) : 'binary';
  const language = getLanguage(filename);

  // Load file content when selection changes
  useEffect(() => {
    if (!selectedPath) {
      setContent(null);
      setError(null);
      return;
    }

    // For images, we don't need to fetch content - we'll use an img tag
    if (fileType === 'image') {
      setContent(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    getFileContent(selectedPath)
      .then((result) => {
        if (result) {
          setContent(result.content);
        } else {
          setError('Failed to load file');
        }
      })
      .catch((err) => {
        setError(err.message || 'Failed to load file');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [selectedPath, fileType, getFileContent]);

  if (!selectedPath) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <FileIcon className="h-8 w-8 text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground">Select a file to preview</p>
      </div>
    );
  }

  // Build the image URL for sandbox files
  const getImageUrl = () => {
    if (!sessionId || !selectedPath) return '';
    const baseUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://localhost:8787'
      : '';
    return `${baseUrl}/sandbox/${sessionId}/file?path=${encodeURIComponent(selectedPath)}`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header with Breadcrumb */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/20">
        <div className="flex items-center gap-1 min-w-0 text-xs font-mono">
          <Breadcrumb path={selectedPath} />
          {language && (
            <span className="ml-2 px-1.5 py-0.5 rounded bg-muted text-muted-foreground flex-shrink-0">
              {language}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {content && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => copy(content)}
              title="Copy content"
            >
              {isCopied ? (
                <CheckIcon className="h-3 w-3 text-green-500" />
              ) : (
                <CopyIcon className="h-3 w-3" />
              )}
            </Button>
          )}
          {sessionId && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => window.open(getImageUrl(), '_blank')}
              title="Open in new tab"
            >
              <ExternalLinkIcon className="h-3 w-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => selectFile(null)}
            title="Close preview"
          >
            <XIcon className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full p-4 text-center">
            <AlertCircleIcon className="h-6 w-6 text-destructive mb-2" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        ) : fileType === 'image' ? (
          <ImagePreview url={getImageUrl()} alt={filename} />
        ) : fileType === 'markdown' && content ? (
          <div className="p-4">
            <StandaloneMarkdown content={content} sessionId={sessionId || undefined} />
          </div>
        ) : fileType === 'code' && content ? (
          <CodePreview content={content} />
        ) : content ? (
          <TextPreview content={content} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full p-4 text-center">
            <FileIcon className="h-6 w-6 text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">Cannot preview this file type</p>
          </div>
        )}
      </div>
    </div>
  );
});

// ============================================================================
// PREVIEW COMPONENTS
// ============================================================================

interface ImagePreviewProps {
  url: string;
  alt: string;
}

const ImagePreview = memo(function ImagePreview({ url, alt }: ImagePreviewProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // Dark mode checkerboard pattern using CSS variables won't work in bg-image,
  // so we use Tailwind's dark mode class for theme-aware background
  return (
    <div className="flex items-center justify-center h-full p-4 bg-[length:20px_20px] bg-[image:linear-gradient(45deg,_hsl(var(--muted))_25%,_transparent_25%),linear-gradient(-45deg,_hsl(var(--muted))_25%,_transparent_25%),linear-gradient(45deg,_transparent_75%,_hsl(var(--muted))_75%),linear-gradient(-45deg,_transparent_75%,_hsl(var(--muted))_75%)] bg-[position:0_0,_0_10px,_10px_-10px,_-10px_0px]">
      {isLoading && (
        <div className="absolute">
          <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {hasError ? (
        <div className="flex flex-col items-center">
          <AlertCircleIcon className="h-6 w-6 text-destructive mb-2" />
          <p className="text-sm text-destructive">Failed to load image</p>
        </div>
      ) : (
        <img
          src={url}
          alt={alt}
          className={cn(
            'max-w-full max-h-full object-contain rounded shadow-lg',
            isLoading && 'opacity-0'
          )}
          onLoad={() => setIsLoading(false)}
          onError={() => {
            setIsLoading(false);
            setHasError(true);
          }}
        />
      )}
    </div>
  );
});

interface CodePreviewProps {
  content: string;
}

const CodePreview = memo(function CodePreview({ content }: CodePreviewProps) {
  const lines = content.split('\n');

  return (
    <div className="relative">
      <pre className="overflow-auto p-4 text-sm font-mono bg-zinc-950 text-zinc-100">
        <code>
          {lines.map((line, i) => (
            <div key={i} className="flex">
              <span className="select-none pr-4 text-zinc-500 text-right w-12 flex-shrink-0">
                {i + 1}
              </span>
              <span className="flex-1 whitespace-pre">{line || ' '}</span>
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
});

interface TextPreviewProps {
  content: string;
}

const TextPreview = memo(function TextPreview({ content }: TextPreviewProps) {
  return (
    <pre className="overflow-auto p-4 text-sm font-mono whitespace-pre-wrap">
      {content}
    </pre>
  );
});

// ============================================================================
// BREADCRUMB COMPONENT
// ============================================================================

interface BreadcrumbProps {
  path: string;
}

const Breadcrumb = memo(function Breadcrumb({ path }: BreadcrumbProps) {
  const parts = path.split('/').filter(Boolean);

  return (
    <div className="flex items-center gap-0.5 truncate text-muted-foreground">
      <span className="text-muted-foreground/50">/</span>
      {parts.map((part, index) => (
        <span key={index} className="flex items-center gap-0.5">
          <span
            className={cn(
              'truncate',
              index === parts.length - 1
                ? 'text-foreground font-medium'
                : 'hover:text-foreground cursor-default'
            )}
            title={part}
          >
            {part}
          </span>
          {index < parts.length - 1 && (
            <span className="text-muted-foreground/50 flex-shrink-0">/</span>
          )}
        </span>
      ))}
    </div>
  );
});

export default FileViewer;
