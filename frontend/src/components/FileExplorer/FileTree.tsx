import { memo } from 'react';
import {
  FolderIcon,
  FolderOpenIcon,
  FileIcon,
  FileTextIcon,
  FileCodeIcon,
  ImageIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  RefreshCwIcon,
  AlertCircleIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { useFileExplorer, type FileEntry } from '@/contexts/FileExplorerContext';

// ============================================================================
// FILE ICONS
// ============================================================================

const CODE_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'rb', 'php', 'swift', 'kt']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp']);
const TEXT_EXTENSIONS = new Set(['md', 'txt', 'json', 'yaml', 'yml', 'xml', 'html', 'css', 'log', 'csv']);

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';

  if (IMAGE_EXTENSIONS.has(ext)) return ImageIcon;
  if (CODE_EXTENSIONS.has(ext)) return FileCodeIcon;
  if (TEXT_EXTENSIONS.has(ext)) return FileTextIcon;
  return FileIcon;
}

function getFileIconColor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';

  if (ext === 'ts' || ext === 'tsx') return 'text-blue-500';
  if (ext === 'js' || ext === 'jsx') return 'text-yellow-500';
  if (ext === 'py') return 'text-green-500';
  if (ext === 'json') return 'text-orange-500';
  if (ext === 'md') return 'text-gray-500';
  if (IMAGE_EXTENSIONS.has(ext)) return 'text-purple-500';
  return 'text-gray-400';
}

// ============================================================================
// FILE SIZE FORMATTER
// ============================================================================

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// FILE TREE ITEM
// ============================================================================

interface FileTreeItemProps {
  entry: FileEntry;
  depth?: number;
}

const FileTreeItem = memo(function FileTreeItem({ entry, depth = 0 }: FileTreeItemProps) {
  const { state, toggleExpand, selectFile } = useFileExplorer();

  const isExpanded = state.expandedPaths.has(entry.path);
  const isSelected = state.selectedPath === entry.path;
  const dirState = state.directories[entry.path];
  const isLoading = dirState?.isLoading;
  const isStale = dirState?.isStale;

  const handleClick = () => {
    if (entry.type === 'directory') {
      toggleExpand(entry.path);
    } else {
      selectFile(entry.path);
    }
  };

  const Icon = entry.type === 'directory'
    ? (isExpanded ? FolderOpenIcon : FolderIcon)
    : getFileIcon(entry.name);

  const iconColor = entry.type === 'directory'
    ? 'text-amber-500'
    : getFileIconColor(entry.name);

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-1 cursor-pointer rounded group/item',
          'hover:bg-muted/50 transition-colors',
          isSelected && 'bg-accent text-accent-foreground',
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
      >
        {/* Expand/collapse chevron for directories */}
        {entry.type === 'directory' ? (
          <span className="w-4 flex-shrink-0 flex items-center justify-center">
            {isLoading ? (
              <RefreshCwIcon className="h-3 w-3 animate-spin text-muted-foreground" />
            ) : isExpanded ? (
              <ChevronDownIcon className="h-3 w-3" />
            ) : (
              <ChevronRightIcon className="h-3 w-3" />
            )}
          </span>
        ) : (
          <span className="w-4" />
        )}

        {/* File/folder icon */}
        <Icon className={cn('h-4 w-4 flex-shrink-0', iconColor)} />

        {/* Name */}
        <span className="truncate text-sm flex-1">{entry.name}</span>

        {/* Stale indicator */}
        {isStale && (
          <span title="Content may have changed">
            <AlertCircleIcon className="h-3 w-3 text-yellow-500 flex-shrink-0" />
          </span>
        )}

        {/* Size on hover for files */}
        {entry.type === 'file' && (
          <span className="text-xs text-muted-foreground opacity-0 group-hover/item:opacity-100 transition-opacity">
            {formatSize(entry.size)}
          </span>
        )}
      </div>

      {/* Render children if directory is expanded */}
      {entry.type === 'directory' && isExpanded && (
        <div>
          {isLoading && !dirState?.entries?.length ? (
            <div style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}>
              <Skeleton className="h-5 w-24 my-1" />
              <Skeleton className="h-5 w-32 my-1" />
              <Skeleton className="h-5 w-20 my-1" />
            </div>
          ) : dirState?.entries?.length ? (
            dirState.entries.map((child) => (
              <FileTreeItem key={child.path} entry={child} depth={depth + 1} />
            ))
          ) : (
            <div
              className="text-xs text-muted-foreground py-1 italic"
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            >
              Empty directory
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ============================================================================
// ROOT DIRECTORY SECTION
// ============================================================================

interface RootSectionProps {
  rootPath: string;
}

const RootSection = memo(function RootSection({ rootPath }: RootSectionProps) {
  const { state, toggleExpand, loadDirectory } = useFileExplorer();

  const dirState = state.directories[rootPath];
  const isExpanded = state.expandedPaths.has(rootPath);
  const isLoading = dirState?.isLoading && !dirState?.entries?.length;
  const rootName = rootPath.split('/').pop() || rootPath;

  const handleClick = () => {
    toggleExpand(rootPath);
    // Load if not loaded yet
    if (!dirState) {
      loadDirectory(rootPath);
    }
  };

  return (
    <div>
      {/* Root folder header */}
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-1.5 cursor-pointer rounded group/item',
          'hover:bg-muted/50 transition-colors font-medium'
        )}
        onClick={handleClick}
      >
        <span className="w-4 flex-shrink-0 flex items-center justify-center">
          {isLoading ? (
            <RefreshCwIcon className="h-3 w-3 animate-spin text-muted-foreground" />
          ) : isExpanded ? (
            <ChevronDownIcon className="h-3 w-3" />
          ) : (
            <ChevronRightIcon className="h-3 w-3" />
          )}
        </span>
        {isExpanded ? (
          <FolderOpenIcon className="h-4 w-4 flex-shrink-0 text-amber-500" />
        ) : (
          <FolderIcon className="h-4 w-4 flex-shrink-0 text-amber-500" />
        )}
        <span className="text-sm">{rootName}</span>
        <span className="text-xs text-muted-foreground ml-1">({rootPath})</span>
      </div>

      {/* Children when expanded */}
      {isExpanded && (
        <div>
          {isLoading ? (
            <div className="pl-6">
              <Skeleton className="h-5 w-24 my-1" />
              <Skeleton className="h-5 w-32 my-1" />
              <Skeleton className="h-5 w-20 my-1" />
            </div>
          ) : dirState?.entries?.length ? (
            dirState.entries.map((entry) => (
              <FileTreeItem key={entry.path} entry={entry} depth={1} />
            ))
          ) : (
            <div className="text-xs text-muted-foreground py-1 pl-10 italic">
              Empty directory
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ============================================================================
// FILE TREE
// ============================================================================

export function FileTree() {
  const { state } = useFileExplorer();

  // Check if all roots are loading (initial state)
  const allLoading = state.rootPaths.every((rootPath) => {
    const dir = state.directories[rootPath];
    return dir?.isLoading && !dir?.entries?.length;
  });

  // Check if all roots are empty
  const allEmpty = state.rootPaths.every((rootPath) => {
    const dir = state.directories[rootPath];
    return dir && !dir.isLoading && !dir.entries?.length;
  });

  if (allLoading) {
    return (
      <div className="p-2 space-y-1">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-32" />
      </div>
    );
  }

  if (allEmpty) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <FolderIcon className="h-8 w-8 text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground">All directories are empty</p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Files created by the agent will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="py-1">
      {state.rootPaths.map((rootPath) => (
        <RootSection key={rootPath} rootPath={rootPath} />
      ))}
    </div>
  );
}

export default FileTree;
