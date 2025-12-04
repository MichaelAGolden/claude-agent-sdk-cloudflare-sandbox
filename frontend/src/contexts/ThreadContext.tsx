import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '@clerk/clerk-react';

// Thread types matching the backend
export interface Thread {
  id: string;
  user_id: string;
  project_id: string | null;
  session_id: string | null;
  title: string;
  summary: string | null;
  /** Claude model API ID for this thread */
  model: string | null;
  created_at: string;
  updated_at: string;
}

export interface ThreadMessage {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  hook_event: string | null;
  created_at: string;
}

interface PendingThreadSwitch {
  targetThreadId: string;
  targetThread: Thread;
}

interface ThreadState {
  threads: Thread[];
  currentThreadId: string | null;
  currentThread: Thread | null;
  currentProjectId: string | null;
  isLoading: boolean;
  error: string | null;
  pendingSwitch: PendingThreadSwitch | null;
}

interface ThreadContextType {
  state: ThreadState;
  /** Threads filtered by current project */
  filteredThreads: Thread[];
  createThread: (title?: string) => Promise<Thread | null>;
  deleteThread: (threadId: string) => Promise<boolean>;
  switchThread: (threadId: string) => Promise<void>;
  requestThreadSwitch: (threadId: string, isStreaming: boolean) => { needsConfirmation: boolean };
  cancelPendingSwitch: () => void;
  confirmPendingSwitch: () => Promise<string | null>;
  updateThreadTitle: (threadId: string, title: string) => Promise<void>;
  updateThreadSessionId: (threadId: string, sessionId: string) => Promise<void>;
  updateThreadModel: (threadId: string, model: string) => Promise<void>;
  generateTitle: (threadId: string) => Promise<void>;
  refreshThreads: () => Promise<void>;
  setCurrentProjectId: (projectId: string | null) => void;
}

const ThreadContext = createContext<ThreadContextType | null>(null);

// API base URL - use proxy in development
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
    if (options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    return fetch(`${API_BASE}${path}`, { ...options, headers });
  };
};

export function ThreadProvider({ children }: { children: ReactNode }) {
  const { userId, isLoaded: isAuthLoaded, getToken } = useAuth();

  const [state, setState] = useState<ThreadState>({
    threads: [],
    currentThreadId: null,
    currentThread: null,
    currentProjectId: null,
    isLoading: false,
    error: null,
    pendingSwitch: null,
  });

  // Filter threads by current project
  const filteredThreads = state.currentProjectId
    ? state.threads.filter(t => t.project_id === state.currentProjectId)
    : state.threads;

  // Create authenticated fetch function
  const authFetch = useCallback(
    (path: string, options?: RequestInit) => createAuthFetch(getToken)(path, options),
    [getToken]
  );

  // Fetch all threads for the current user (userId comes from JWT, not query param)
  const refreshThreads = useCallback(async () => {
    if (!userId) return;

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // No userId in URL - backend extracts it from JWT
      const response = await authFetch('/api/threads');
      if (!response.ok) {
        throw new Error('Failed to fetch threads');
      }

      const data = await response.json();
      const threads: Thread[] = data.threads || [];

      setState(prev => ({
        ...prev,
        threads,
        isLoading: false,
        // Update current thread if it exists in the new list
        currentThread: prev.currentThreadId
          ? threads.find(t => t.id === prev.currentThreadId) || null
          : null,
      }));
    } catch (error: any) {
      console.error('[ThreadContext] Failed to fetch threads:', error);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error.message,
      }));
    }
  }, [userId, authFetch]);

  // Set current project ID (called by ProjectContext when project changes)
  const setCurrentProjectId = useCallback((projectId: string | null) => {
    setState(prev => {
      // Clear current thread if it doesn't belong to the new project
      const shouldClearThread = prev.currentThread && prev.currentThread.project_id !== projectId;
      return {
        ...prev,
        currentProjectId: projectId,
        currentThreadId: shouldClearThread ? null : prev.currentThreadId,
        currentThread: shouldClearThread ? null : prev.currentThread,
      };
    });
  }, []);

  // Create a new thread (userId comes from JWT, not request body)
  const createThread = useCallback(async (title?: string): Promise<Thread | null> => {
    if (!userId) return null;

    try {
      const response = await authFetch('/api/threads', {
        method: 'POST',
        body: JSON.stringify({ title, projectId: state.currentProjectId }),
      });

      if (!response.ok) {
        throw new Error('Failed to create thread');
      }

      const thread: Thread = await response.json();

      setState(prev => ({
        ...prev,
        threads: [thread, ...prev.threads],
        currentThreadId: thread.id,
        currentThread: thread,
      }));

      return thread;
    } catch (error: any) {
      console.error('[ThreadContext] Failed to create thread:', error);
      setState(prev => ({ ...prev, error: error.message }));
      return null;
    }
  }, [userId, authFetch, state.currentProjectId]);

  // Delete a thread
  const deleteThread = useCallback(async (threadId: string): Promise<boolean> => {
    try {
      const response = await authFetch(`/api/threads/${threadId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete thread');
      }

      setState(prev => {
        const threads = prev.threads.filter(t => t.id !== threadId);
        const wasCurrentThread = prev.currentThreadId === threadId;

        return {
          ...prev,
          threads,
          // If we deleted the current thread, switch to the first available or null
          currentThreadId: wasCurrentThread
            ? (threads[0]?.id || null)
            : prev.currentThreadId,
          currentThread: wasCurrentThread
            ? (threads[0] || null)
            : prev.currentThread,
        };
      });

      return true;
    } catch (error: any) {
      console.error('[ThreadContext] Failed to delete thread:', error);
      setState(prev => ({ ...prev, error: error.message }));
      return false;
    }
  }, [authFetch]);

  // Switch to a different thread
  const switchThread = useCallback(async (threadId: string): Promise<void> => {
    const thread = state.threads.find(t => t.id === threadId);
    if (!thread) {
      console.warn('[ThreadContext] Thread not found:', threadId);
      return;
    }

    setState(prev => ({
      ...prev,
      currentThreadId: threadId,
      currentThread: thread,
    }));
  }, [state.threads]);

  // Request thread switch (checks if confirmation needed)
  const requestThreadSwitch = useCallback((threadId: string, isStreaming: boolean): { needsConfirmation: boolean } => {
    const thread = state.threads.find(t => t.id === threadId);
    if (!thread) {
      console.warn('[ThreadContext] Thread not found:', threadId);
      return { needsConfirmation: false };
    }

    if (isStreaming) {
      // Need confirmation - set pending switch
      setState(prev => ({
        ...prev,
        pendingSwitch: { targetThreadId: threadId, targetThread: thread },
      }));
      return { needsConfirmation: true };
    }

    // No streaming - switch immediately
    setState(prev => ({
      ...prev,
      currentThreadId: threadId,
      currentThread: thread,
    }));
    return { needsConfirmation: false };
  }, [state.threads]);

  // Cancel pending switch
  const cancelPendingSwitch = useCallback(() => {
    setState(prev => ({ ...prev, pendingSwitch: null }));
  }, []);

  // Confirm and execute pending switch
  const confirmPendingSwitch = useCallback(async (): Promise<string | null> => {
    const pending = state.pendingSwitch;
    if (!pending) return null;

    setState(prev => ({
      ...prev,
      pendingSwitch: null,
      currentThreadId: pending.targetThreadId,
      currentThread: pending.targetThread,
    }));

    return pending.targetThreadId;
  }, [state.pendingSwitch]);

  // Update thread title
  const updateThreadTitle = useCallback(async (threadId: string, title: string): Promise<void> => {
    try {
      const response = await authFetch(`/api/threads/${threadId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      });

      if (!response.ok) {
        throw new Error('Failed to update thread title');
      }

      const updatedThread: Thread = await response.json();

      setState(prev => ({
        ...prev,
        threads: prev.threads.map(t =>
          t.id === threadId ? updatedThread : t
        ),
        currentThread: prev.currentThreadId === threadId
          ? updatedThread
          : prev.currentThread,
      }));
    } catch (error: any) {
      console.error('[ThreadContext] Failed to update title:', error);
      setState(prev => ({ ...prev, error: error.message }));
    }
  }, [authFetch]);

  // Update thread session ID (called when SDK returns session)
  const updateThreadSessionId = useCallback(async (threadId: string, sessionId: string): Promise<void> => {
    try {
      const response = await authFetch(`/api/threads/${threadId}`, {
        method: 'PATCH',
        body: JSON.stringify({ sessionId }),
      });

      if (!response.ok) {
        throw new Error('Failed to update thread session');
      }

      const updatedThread: Thread = await response.json();

      setState(prev => ({
        ...prev,
        threads: prev.threads.map(t =>
          t.id === threadId ? updatedThread : t
        ),
        currentThread: prev.currentThreadId === threadId
          ? updatedThread
          : prev.currentThread,
      }));
    } catch (error: any) {
      console.error('[ThreadContext] Failed to update session:', error);
    }
  }, [authFetch]);

  // Update thread model (called when user changes model in UI)
  const updateThreadModel = useCallback(async (threadId: string, model: string): Promise<void> => {
    try {
      const response = await authFetch(`/api/threads/${threadId}`, {
        method: 'PATCH',
        body: JSON.stringify({ model }),
      });

      if (!response.ok) {
        throw new Error('Failed to update thread model');
      }

      const updatedThread: Thread = await response.json();

      setState(prev => ({
        ...prev,
        threads: prev.threads.map(t =>
          t.id === threadId ? updatedThread : t
        ),
        currentThread: prev.currentThreadId === threadId
          ? updatedThread
          : prev.currentThread,
      }));
    } catch (error: any) {
      console.error('[ThreadContext] Failed to update model:', error);
    }
  }, [authFetch]);

  // Generate title using Haiku
  const generateTitle = useCallback(async (threadId: string): Promise<void> => {
    try {
      const response = await authFetch(`/api/threads/${threadId}/title`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to generate title');
      }

      const { title } = await response.json();

      setState(prev => ({
        ...prev,
        threads: prev.threads.map(t =>
          t.id === threadId ? { ...t, title } : t
        ),
        currentThread: prev.currentThreadId === threadId
          ? { ...prev.currentThread!, title }
          : prev.currentThread,
      }));
    } catch (error: any) {
      console.error('[ThreadContext] Failed to generate title:', error);
    }
  }, [authFetch]);

  // Fetch threads when user is authenticated
  useEffect(() => {
    if (isAuthLoaded && userId) {
      refreshThreads();
    }
  }, [isAuthLoaded, userId, refreshThreads]);

  // Listen for project switch events from ProjectContext
  useEffect(() => {
    const handleProjectSwitch = (event: CustomEvent<{ projectId: string }>) => {
      setCurrentProjectId(event.detail.projectId);
      // Refresh threads to pick up any project_id assignments from backend migration
      refreshThreads();
    };

    window.addEventListener('project-switched', handleProjectSwitch as EventListener);
    return () => {
      window.removeEventListener('project-switched', handleProjectSwitch as EventListener);
    };
  }, [setCurrentProjectId, refreshThreads]);

  return (
    <ThreadContext.Provider
      value={{
        state,
        filteredThreads,
        createThread,
        deleteThread,
        switchThread,
        requestThreadSwitch,
        cancelPendingSwitch,
        confirmPendingSwitch,
        updateThreadTitle,
        updateThreadSessionId,
        updateThreadModel,
        generateTitle,
        refreshThreads,
        setCurrentProjectId,
      }}
    >
      {children}
    </ThreadContext.Provider>
  );
}

export function useThreads() {
  const ctx = useContext(ThreadContext);
  if (!ctx) {
    throw new Error('useThreads must be used within a ThreadProvider');
  }
  return ctx;
}
