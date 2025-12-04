import { createContext, useContext, useReducer, useEffect, useCallback, type ReactNode } from 'react';
import { useAuth } from '@clerk/clerk-react';

const API_BASE = '';

/**
 * Helper to create authenticated fetch with Clerk JWT
 */
const createAuthFetch = (getToken: () => Promise<string | null>) => {
  return async (path: string, options: RequestInit = {}): Promise<Response> => {
    const token = await getToken();
    const headers = new Headers(options.headers);

    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    return fetch(`${API_BASE}${path}`, { ...options, headers });
  };
};

// ============================================================================
// TYPES
// ============================================================================

export interface FileEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  path: string;
}

interface DirectoryState {
  entries: FileEntry[];
  isLoading: boolean;
  isStale: boolean;
  lastLoaded: number | null;
}

interface FileExplorerState {
  directories: Record<string, DirectoryState>;
  expandedPaths: Set<string>;
  selectedPath: string | null;
  rootPaths: string[];  // Multiple root paths supported
  error: string | null;
  isOpen: boolean;
}

type FileExplorerAction =
  | { type: 'SET_DIRECTORY'; path: string; entries: FileEntry[] }
  | { type: 'SET_LOADING'; path: string; isLoading: boolean }
  | { type: 'TOGGLE_EXPAND'; path: string }
  | { type: 'SET_EXPANDED'; paths: string[] }
  | { type: 'COLLAPSE_ALL' }
  | { type: 'SELECT_FILE'; path: string | null }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_OPEN'; isOpen: boolean }
  | { type: 'CLEAR_ALL' };

// Root paths that the file explorer will show
// /home is included because Claude sometimes creates files there instead of /workspace
const ROOT_PATHS = ['/workspace', '/home', '/tmp'];

const initialState: FileExplorerState = {
  directories: {},
  expandedPaths: new Set(ROOT_PATHS), // All roots expanded by default
  selectedPath: null,
  rootPaths: ROOT_PATHS,
  error: null,
  isOpen: false,
};

function fileExplorerReducer(state: FileExplorerState, action: FileExplorerAction): FileExplorerState {
  switch (action.type) {
    case 'SET_DIRECTORY':
      return {
        ...state,
        directories: {
          ...state.directories,
          [action.path]: {
            entries: action.entries,
            isLoading: false,
            isStale: false,
            lastLoaded: Date.now(),
          },
        },
        error: null,
      };
    case 'SET_LOADING': {
      const existing = state.directories[action.path];
      return {
        ...state,
        directories: {
          ...state.directories,
          [action.path]: {
            entries: existing?.entries || [],
            isLoading: action.isLoading,
            isStale: existing?.isStale || false,
            lastLoaded: existing?.lastLoaded || null,
          },
        },
      };
    }
    case 'TOGGLE_EXPAND': {
      const newExpanded = new Set(state.expandedPaths);
      if (newExpanded.has(action.path)) {
        newExpanded.delete(action.path);
      } else {
        newExpanded.add(action.path);
      }
      return { ...state, expandedPaths: newExpanded };
    }
    case 'SET_EXPANDED':
      return { ...state, expandedPaths: new Set(action.paths) };
    case 'COLLAPSE_ALL':
      return { ...state, expandedPaths: new Set(ROOT_PATHS) }; // Keep roots expanded
    case 'SELECT_FILE':
      return { ...state, selectedPath: action.path };
    case 'SET_ERROR':
      return { ...state, error: action.error };
    case 'SET_OPEN':
      return { ...state, isOpen: action.isOpen };
    case 'CLEAR_ALL':
      return { ...initialState, isOpen: state.isOpen };
    default:
      return state;
  }
}

// ============================================================================
// CONTEXT
// ============================================================================

interface FileExplorerContextValue {
  state: FileExplorerState;
  loadDirectory: (path: string, force?: boolean) => Promise<void>;
  toggleExpand: (path: string) => void;
  collapseAll: () => void;
  selectFile: (path: string | null) => void;
  refreshPath: (path: string) => Promise<void>;
  getFileContent: (path: string) => Promise<{ content: string; mimeType: string } | null>;
  toggleOpen: () => void;
  setOpen: (isOpen: boolean) => void;
}

const FileExplorerContext = createContext<FileExplorerContextValue | null>(null);

interface FileExplorerProviderProps {
  children: ReactNode;
  sessionId: string | null;
}

export function FileExplorerProvider({ children, sessionId }: FileExplorerProviderProps) {
  const [state, dispatch] = useReducer(fileExplorerReducer, initialState);
  const { getToken } = useAuth();

  // Create authenticated fetch function
  const authFetch = useCallback(
    (path: string, options?: RequestInit) => createAuthFetch(getToken)(path, options),
    [getToken]
  );

  // Load a directory from the sandbox
  const loadDirectory = useCallback(async (path: string, force = false) => {
    if (!sessionId) return;

    const existing = state.directories[path];
    if (!force && existing && !existing.isStale && existing.entries.length > 0) {
      return; // Already loaded and not stale
    }

    dispatch({ type: 'SET_LOADING', path, isLoading: true });

    try {
      const response = await authFetch(
        `/sandbox/${sessionId}/dir?path=${encodeURIComponent(path)}`
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to load directory');
      }
      const data = await response.json();
      dispatch({ type: 'SET_DIRECTORY', path, entries: data.entries || [] });
    } catch (error: any) {
      console.error('[FileExplorer] Load error:', error);
      dispatch({ type: 'SET_ERROR', error: error.message });
      dispatch({ type: 'SET_LOADING', path, isLoading: false });
    }
  }, [sessionId, authFetch, state.directories]);

  // Toggle directory expansion
  const toggleExpand = useCallback((path: string) => {
    dispatch({ type: 'TOGGLE_EXPAND', path });
    // Load directory if expanding and not loaded
    if (!state.expandedPaths.has(path)) {
      loadDirectory(path);
    }
  }, [state.expandedPaths, loadDirectory]);

  const collapseAll = useCallback(() => {
    dispatch({ type: 'COLLAPSE_ALL' });
  }, []);

  const selectFile = useCallback((path: string | null) => {
    dispatch({ type: 'SELECT_FILE', path });
  }, []);

  const refreshPath = useCallback(async (path: string) => {
    await loadDirectory(path, true);
  }, [loadDirectory]);

  // Get file content for preview
  const getFileContent = useCallback(async (path: string): Promise<{ content: string; mimeType: string } | null> => {
    if (!sessionId) return null;

    try {
      const response = await authFetch(
        `/sandbox/${sessionId}/file?path=${encodeURIComponent(path)}`
      );
      if (!response.ok) return null;

      const contentType = response.headers.get('Content-Type') || 'text/plain';
      const content = await response.text();

      return { content, mimeType: contentType };
    } catch (error) {
      console.error('[FileExplorer] Get content error:', error);
      return null;
    }
  }, [sessionId, authFetch]);

  const toggleOpen = useCallback(() => {
    dispatch({ type: 'SET_OPEN', isOpen: !state.isOpen });
  }, [state.isOpen]);

  const setOpen = useCallback((isOpen: boolean) => {
    dispatch({ type: 'SET_OPEN', isOpen });
  }, []);

  // Listen for refresh events from AgentContext (triggered on every PostToolUse)
  // This is simpler and more reliable than trying to parse file operations
  useEffect(() => {
    const handleRefresh = () => {
      // Only refresh if panel is open
      if (!state.isOpen) return;

      // Refresh all expanded directories
      for (const path of state.expandedPaths) {
        loadDirectory(path, true);
      }
    };

    window.addEventListener('sandbox-refresh-files', handleRefresh);
    return () => {
      window.removeEventListener('sandbox-refresh-files', handleRefresh);
    };
  }, [state.isOpen, state.expandedPaths, loadDirectory]);

  // Clear state when session changes
  useEffect(() => {
    dispatch({ type: 'CLEAR_ALL' });
  }, [sessionId]);

  // Load root directories when panel is opened
  useEffect(() => {
    if (state.isOpen && sessionId) {
      // Load all root paths that haven't been loaded yet
      for (const rootPath of state.rootPaths) {
        if (!state.directories[rootPath]) {
          loadDirectory(rootPath);
        }
      }
    }
  }, [state.isOpen, sessionId, state.rootPaths, state.directories, loadDirectory]);

  return (
    <FileExplorerContext.Provider value={{
      state,
      loadDirectory,
      toggleExpand,
      collapseAll,
      selectFile,
      refreshPath,
      getFileContent,
      toggleOpen,
      setOpen,
    }}>
      {children}
    </FileExplorerContext.Provider>
  );
}

export function useFileExplorer() {
  const context = useContext(FileExplorerContext);
  if (!context) {
    throw new Error('useFileExplorer must be used within a FileExplorerProvider');
  }
  return context;
}
