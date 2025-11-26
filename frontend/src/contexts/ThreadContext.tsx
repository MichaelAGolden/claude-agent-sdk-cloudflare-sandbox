import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '@clerk/clerk-react';

// Thread types matching the backend
export interface Thread {
  id: string;
  user_id: string;
  session_id: string | null;
  title: string;
  summary: string | null;
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
  isLoading: boolean;
  error: string | null;
  pendingSwitch: PendingThreadSwitch | null;
}

interface ThreadContextType {
  state: ThreadState;
  createThread: (title?: string) => Promise<Thread | null>;
  deleteThread: (threadId: string) => Promise<boolean>;
  switchThread: (threadId: string) => Promise<void>;
  requestThreadSwitch: (threadId: string, isStreaming: boolean) => { needsConfirmation: boolean };
  cancelPendingSwitch: () => void;
  confirmPendingSwitch: () => Promise<string | null>;
  updateThreadTitle: (threadId: string, title: string) => Promise<void>;
  updateThreadSessionId: (threadId: string, sessionId: string) => Promise<void>;
  generateTitle: (threadId: string) => Promise<void>;
  refreshThreads: () => Promise<void>;
}

const ThreadContext = createContext<ThreadContextType | null>(null);

// API base URL - use proxy in development
const API_BASE = '';

export function ThreadProvider({ children }: { children: ReactNode }) {
  const { userId, isLoaded: isAuthLoaded } = useAuth();

  const [state, setState] = useState<ThreadState>({
    threads: [],
    currentThreadId: null,
    currentThread: null,
    isLoading: false,
    error: null,
    pendingSwitch: null,
  });

  // Fetch all threads for the current user
  const refreshThreads = useCallback(async () => {
    if (!userId) return;

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const response = await fetch(`${API_BASE}/api/threads?userId=${encodeURIComponent(userId)}`);
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
  }, [userId]);

  // Create a new thread
  const createThread = useCallback(async (title?: string): Promise<Thread | null> => {
    if (!userId) return null;

    try {
      const response = await fetch(`${API_BASE}/api/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, title }),
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
  }, [userId]);

  // Delete a thread
  const deleteThread = useCallback(async (threadId: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE}/api/threads/${threadId}`, {
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
  }, []);

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
      const response = await fetch(`${API_BASE}/api/threads/${threadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
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
  }, []);

  // Update thread session ID (called when SDK returns session)
  const updateThreadSessionId = useCallback(async (threadId: string, sessionId: string): Promise<void> => {
    try {
      const response = await fetch(`${API_BASE}/api/threads/${threadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
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
  }, []);

  // Generate title using Haiku
  const generateTitle = useCallback(async (threadId: string): Promise<void> => {
    try {
      const response = await fetch(`${API_BASE}/api/threads/${threadId}/title`, {
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
  }, []);

  // Fetch threads when user is authenticated
  useEffect(() => {
    if (isAuthLoaded && userId) {
      refreshThreads();
    }
  }, [isAuthLoaded, userId, refreshThreads]);

  return (
    <ThreadContext.Provider
      value={{
        state,
        createThread,
        deleteThread,
        switchThread,
        requestThreadSwitch,
        cancelPendingSwitch,
        confirmPendingSwitch,
        updateThreadTitle,
        updateThreadSessionId,
        generateTitle,
        refreshThreads,
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
