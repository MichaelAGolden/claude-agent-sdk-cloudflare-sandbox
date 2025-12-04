import { memo, useState, useCallback, useRef, useEffect } from 'react';
import {
  FolderOpenIcon,
  XIcon,
  RefreshCwIcon,
  ChevronLeftIcon,
  GripVerticalIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useFileExplorer } from '@/contexts/FileExplorerContext';
import { FileTree } from './FileTree';
import { FileViewer } from './FileViewer';

// ============================================================================
// RESIZE HANDLE HOOK
// ============================================================================

const MIN_WIDTH = 280;
const MAX_WIDTH = 800;
const DEFAULT_WIDTH = 400;

function useResizable(initialWidth: number = DEFAULT_WIDTH) {
  const [width, setWidth] = useState(initialWidth);
  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
  }, [width]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Moving left (negative delta) should increase width (panel is on right side)
      const delta = startXRef.current - e.clientX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidthRef.current + delta));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // Prevent text selection during drag
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isResizing]);

  return { width, isResizing, handleMouseDown };
}

// ============================================================================
// FILE EXPLORER PANEL
// ============================================================================

interface FileExplorerPanelProps {
  className?: string;
}

export const FileExplorerPanel = memo(function FileExplorerPanel({
  className,
}: FileExplorerPanelProps) {
  const { state, setOpen, refreshPath, collapseAll } = useFileExplorer();
  const { width, isResizing, handleMouseDown } = useResizable();

  // Don't render anything when closed - toggle is in the header
  if (!state.isOpen) {
    return null;
  }

  return (
    <div
      className={cn(
        'flex h-full bg-background relative',
        isResizing && 'select-none',
        className
      )}
      style={{ width: `${width}px` }}
    >
      {/* Resize Handle */}
      <div
        className={cn(
          'absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10',
          'hover:bg-primary/20 active:bg-primary/30 transition-colors',
          'group flex items-center justify-center',
          isResizing && 'bg-primary/30'
        )}
        onMouseDown={handleMouseDown}
      >
        <div className={cn(
          'absolute left-0 w-4 h-12 flex items-center justify-center -translate-x-1/2',
          'opacity-0 group-hover:opacity-100 transition-opacity',
          isResizing && 'opacity-100'
        )}>
          <GripVerticalIcon className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      {/* Panel Content */}
      <div className="flex flex-col flex-1 border-l">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <FolderOpenIcon className="h-4 w-4 text-amber-500" />
          <span className="font-medium text-sm">File Explorer</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => state.rootPaths.forEach(p => refreshPath(p))}
            title="Refresh All"
          >
            <RefreshCwIcon className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={collapseAll}
            title="Collapse All"
          >
            <ChevronLeftIcon className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setOpen(false)}
            title="Close"
          >
            <XIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Content - Split View */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* File Tree Section */}
        <div
          className={cn(
            'overflow-y-auto',
            state.selectedPath ? 'h-[40%] min-h-[150px] border-b' : 'flex-1'
          )}
        >
          <FileTree />
        </div>

        {/* File Viewer Section - Only shown when a file is selected */}
        {state.selectedPath && (
          <div className="flex-1 overflow-hidden">
            <FileViewer />
          </div>
        )}
      </div>

      {/* Error Display */}
      {state.error && (
        <div className="px-3 py-2 bg-destructive/10 border-t border-destructive/20">
          <p className="text-xs text-destructive">{state.error}</p>
        </div>
      )}
      </div>
    </div>
  );
});

// ============================================================================
// TOGGLE BUTTON (for use in external headers)
// ============================================================================

interface FileExplorerToggleProps {
  className?: string;
}

export function FileExplorerToggle({ className }: FileExplorerToggleProps) {
  const { state, toggleOpen } = useFileExplorer();

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn('h-8 w-8', className)}
      onClick={toggleOpen}
      title={state.isOpen ? 'Close File Explorer' : 'Open File Explorer'}
    >
      <FolderOpenIcon
        className={cn(
          'h-4 w-4 transition-colors',
          state.isOpen ? 'text-amber-500' : 'text-muted-foreground'
        )}
      />
    </Button>
  );
}

export default FileExplorerPanel;
