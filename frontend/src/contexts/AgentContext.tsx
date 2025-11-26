import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import io, { type Socket } from 'socket.io-client';
import { useAuth } from '@clerk/clerk-react';
import type { AgentState, ExtendedOptions, HookEvent, HookEventType, Message } from '../types/index.ts';
import { useThreads } from './ThreadContext';

const generateUUID = () => crypto.randomUUID();

// API base URL - empty string means same origin (works with frontend worker proxy)
const API_BASE = '';

// Backend URL for Socket.IO (fetched from /_config in production)
let SOCKET_URL: string | null = null;

// Fetch backend config for Socket.IO URL
const getSocketUrl = async (): Promise<string> => {
  if (SOCKET_URL) return SOCKET_URL;

  // In development, use localhost
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    SOCKET_URL = 'http://localhost:8787';
    return SOCKET_URL;
  }

  // In production, fetch config from frontend worker
  try {
    const response = await fetch('/_config');
    if (response.ok) {
      const config = await response.json();
      SOCKET_URL = config.backendUrl || window.location.origin;
    } else {
      // Fallback to same origin if config unavailable
      SOCKET_URL = window.location.origin;
    }
  } catch {
    SOCKET_URL = window.location.origin;
  }

  console.log('[AgentContext] Socket URL:', SOCKET_URL);
  return SOCKET_URL!; // Non-null assertion - we always set it above
};

// Create socket with user-specific sandbox
// userId determines the sandbox (one per user)
// SDK session resumption is handled via the 'resume' option in messages
const createSocket = (userId: string, socketUrl: string) => {
  return io(socketUrl, {
    query: { sessionId: userId }, // Use userId as sandbox ID - one container per user
    transports: ['websocket', 'polling'],
    path: '/socket.io/',
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });
};

interface AgentContextType {
  state: AgentState;
  isResuming: boolean;
  canSendMessage: boolean;
  sendMessage: (prompt: string, options?: ExtendedOptions) => void;
  interrupt: () => void;
  interruptForSwitch: (threadId: string) => Promise<boolean>;
  clearChat: () => void;
}

const AgentContext = createContext<AgentContextType | null>(null);

// Helper: Restore transcript from R2 before resuming
const restoreTranscript = async (
  sandboxSessionId: string,
  userId: string,
  sdkSessionId: string
): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE}/api/sessions/${sandboxSessionId}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, sdkSessionId }),
    });
    const result = await response.json();
    console.log('[AgentContext] Restore transcript result:', result);
    return result.status === 'restored';
  } catch (error) {
    console.error('[AgentContext] Failed to restore transcript:', error);
    return false;
  }
};

// Helper: Sync transcript to R2 on session end
const syncTranscript = async (
  sandboxSessionId: string,
  userId: string,
  sdkSessionId: string
): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE}/api/sessions/${sandboxSessionId}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, sdkSessionId }),
    });
    const result = await response.json();
    console.log('[AgentContext] Sync transcript result:', result);
    return result.status === 'synced';
  } catch (error) {
    console.error('[AgentContext] Failed to sync transcript:', error);
    return false;
  }
};

export function AgentProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const { state: threadState, createThread, updateThreadSessionId, generateTitle } = useThreads();
  const { currentThreadId, currentThread } = threadState;

  const [state, setState] = useState<AgentState>({
    isConnected: false,
    messages: [],
    isStreaming: false,
    socketId: null,
  });

  // New state for thread switching
  const [isResuming, setIsResuming] = useState(false);
  const [canSendMessage, setCanSendMessage] = useState(true);

  const socketRef = useRef<Socket | null>(null);
  const isFirstMessageRef = useRef(true);
  const hasTitleGenRef = useRef<Set<string>>(new Set());
  // Track SDK session for transcript sync
  const sdkSessionIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);

  // Refs for persistent socket - thread-independent
  const activeThreadIdRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const socketInitializedRef = useRef(false);

  // Keep userId ref in sync
  useEffect(() => {
    userIdRef.current = userId || null;
  }, [userId]);

  // Save message to thread via API
  const saveMessageToThread = useCallback(async (threadId: string, message: Message) => {
    try {
      await fetch(`${API_BASE}/api/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: message.role,
          content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
          hookEvent: message.hookEvent,
        }),
      });
    } catch (error) {
      console.error('[AgentContext] Failed to save message:', error);
    }
  }, []);

  // Load messages from thread
  const loadThreadMessages = useCallback(async (threadId: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/threads/${threadId}`);
      if (!response.ok) return [];

      const data = await response.json();
      const messages: Message[] = (data.messages || []).map((msg: any) => {
        let content = msg.content;
        let hookEvent = undefined;

        // Parse assistant messages - content is stored as JSON array [{"type":"text","text":"..."}]
        if (msg.role === 'assistant' && typeof content === 'string') {
          try {
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed)) {
              // Extract text from content blocks
              content = parsed
                .filter((block: any) => block.type === 'text')
                .map((block: any) => block.text)
                .join('\n');
            }
          } catch {
            // If parsing fails, use content as-is
          }
        } else if (msg.role === 'hook') {
          // Hook messages: content is just a label string, hookEvent has the actual data
          // Parse hook_event JSON to restore the full HookEvent object
          if (msg.hook_event) {
            try {
              hookEvent = JSON.parse(msg.hook_event);
            } catch {
              console.warn('[AgentContext] Failed to parse hook_event:', msg.hook_event);
            }
          }
        }

        return {
          uuid: msg.id,
          role: msg.role,
          content,
          hookEvent,
        };
      });

      return messages;
    } catch (error) {
      console.error('[AgentContext] Failed to load messages:', error);
      return [];
    }
  }, []);

  // Effect 1: Socket lifecycle - ONE persistent socket per user session
  useEffect(() => {
    if (!userId || socketInitializedRef.current) return;

    let cleanedUp = false;

    const initSocket = async () => {
      const socketUrl = await getSocketUrl();
      if (cleanedUp) return;

      console.log('[AgentContext] Creating persistent socket for user:', userId);
      const socket = createSocket(userId, socketUrl);
      socketRef.current = socket;
      socketInitializedRef.current = true;

      // Connection handlers
      const handleConnect = () => {
        console.log('[AgentContext] Socket connected:', socket.id);
        setState(prev => ({ ...prev, isConnected: true, socketId: socket.id || null }));
      };

      socket.on('connect', handleConnect);
      if (socket.connected) handleConnect();

      socket.on('disconnect', async () => {
        console.log('[AgentContext] Socket disconnected');
        setState(prev => ({ ...prev, isConnected: false, socketId: null }));

        // Sync transcript to R2 on disconnect
        if (sdkSessionIdRef.current && userIdRef.current) {
          console.log('[AgentContext] Syncing transcript on disconnect:', sdkSessionIdRef.current);
          await syncTranscript(userIdRef.current, userIdRef.current, sdkSessionIdRef.current);
        }
      });

      // Message handlers - use refs to get current thread
      socket.on('message', (data: any) => {
        console.log('%c[AgentContext] MESSAGE', 'background: green; color: white', data.role);

        // Capture session ID from SDK's system init message
        if (data.role === 'system' && data.subtype === 'init' && data.session_id) {
          console.log('%c[AgentContext] SDK Session ID received:', 'background: blue; color: white', data.session_id);
          sdkSessionIdRef.current = data.session_id;

          // Save to the thread that initiated this session
          const threadId = activeThreadIdRef.current;
          if (threadId) {
            console.log('[AgentContext] Saving session_id to thread:', threadId);
            updateThreadSessionId(threadId, data.session_id);
          }
          return;
        }

        if (data.role === 'system') return;

        const uuid = data.uuid || generateUUID();
        const message: Message = { uuid, role: data.role, content: data.content };

        setState(prev => {
          const exists = prev.messages.findIndex(m => m.uuid === uuid);
          if (exists >= 0) {
            const msgs = [...prev.messages];
            msgs[exists] = { ...msgs[exists], content: data.content };
            return { ...prev, messages: msgs, isStreaming: false };
          }

          if (data.role === 'assistant' && prev.isStreaming) {
            const last = prev.messages[prev.messages.length - 1];
            if (last?.role === 'assistant') {
              const msgs = [...prev.messages];
              msgs[msgs.length - 1] = { ...last, content: data.content, uuid };
              return { ...prev, messages: msgs, isStreaming: false };
            }
          }

          return {
            ...prev,
            isStreaming: data.role === 'assistant' ? false : prev.isStreaming,
            messages: [...prev.messages, message]
          };
        });

        // Save to current thread
        const threadId = activeThreadIdRef.current;
        if (threadId && data.role === 'assistant') {
          saveMessageToThread(threadId, message);

          // Generate title after first assistant response
          if (!hasTitleGenRef.current.has(threadId)) {
            hasTitleGenRef.current.add(threadId);
            setTimeout(() => generateTitle(threadId), 500);
          }
        }
      });

      socket.on('stream', (data: any) => {
        if (data?.type === 'text' && data?.content) {
          setState(prev => {
            const last = prev.messages[prev.messages.length - 1];
            if (last?.role === 'assistant') {
              const msgs = [...prev.messages];
              msgs[msgs.length - 1] = { ...last, content: (last.content || '') + data.content };
              return { ...prev, messages: msgs, isStreaming: true };
            }
            return {
              ...prev,
              isStreaming: true,
              messages: [...prev.messages, { role: 'assistant', content: data.content, uuid: generateUUID() }]
            };
          });
        }
      });

      socket.on('result', () => setState(prev => ({ ...prev, isStreaming: false })));
      socket.on('cleared', () => setState(prev => ({ ...prev, messages: [], isStreaming: false })));
      socket.on('error', () => setState(prev => ({ ...prev, isStreaming: false })));

      socket.on('history', (data: { messages: any[] }) => {
        console.log('[AgentContext] Received history:', data.messages?.length);
        if (data.messages && data.messages.length > 0) {
          const messages: Message[] = data.messages.map((msg: any) => {
            let content = msg.content;
            if (msg.role === 'assistant' && Array.isArray(content)) {
              content = content
                .filter((block: any) => block.type === 'text')
                .map((block: any) => block.text)
                .join('\n');
            }
            return { uuid: msg.uuid || generateUUID(), role: msg.role, content };
          });
          setState(prev => ({
            ...prev,
            messages: messages.length > prev.messages.length ? messages : prev.messages
          }));
        }
      });

      // Hook handlers
      socket.on('hook_notification', (data: { event: string; data: any }) => {
        const hookEvent: HookEvent = {
          id: generateUUID(),
          eventType: data.event as HookEventType,
          timestamp: Date.now(),
          data: data.data,
          isRequest: false,
        };
        const message: Message = {
          role: 'hook',
          content: `Hook: ${data.event}`,
          uuid: hookEvent.id,
          hookEvent,
        };
        setState(prev => ({ ...prev, messages: [...prev.messages, message] }));
        const threadId = activeThreadIdRef.current;
        if (threadId) saveMessageToThread(threadId, message);
      });

      socket.on('hook_request', (data: { event: string; data: any }, cb: (r: any) => void) => {
        const response = { action: 'continue' };
        const hookEvent: HookEvent = {
          id: generateUUID(),
          eventType: data.event as HookEventType,
          timestamp: Date.now(),
          data: data.data,
          isRequest: true,
          response,
        };
        const message: Message = {
          role: 'hook',
          content: `Hook: ${data.event}`,
          uuid: hookEvent.id,
          hookEvent,
        };
        setState(prev => ({ ...prev, messages: [...prev.messages, message] }));
        const threadId = activeThreadIdRef.current;
        if (threadId) saveMessageToThread(threadId, message);
        cb(response);
      });

      // Handle interrupt_complete from container
      socket.on('interrupt_complete', (data: { threadId: string; success: boolean; sessionId: string }) => {
        console.log('[AgentContext] Interrupt complete:', data);
        setState(prev => ({ ...prev, isStreaming: false }));
      });
    };

    initSocket();

    return () => {
      cleanedUp = true;
      console.log('[AgentContext] Cleaning up socket');
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      socketInitializedRef.current = false;
    };
  }, [userId, saveMessageToThread, updateThreadSessionId, generateTitle]);

  // Effect 2: Thread switching - loads messages, updates refs (no socket reconnection)
  useEffect(() => {
    if (!currentThreadId || currentThreadId === activeThreadIdRef.current) return;

    console.log('[AgentContext] Thread changed to:', currentThreadId);

    // Update refs immediately
    activeThreadIdRef.current = currentThreadId;
    activeSessionIdRef.current = currentThread?.session_id || null;
    sdkSessionIdRef.current = currentThread?.session_id || null;
    isFirstMessageRef.current = !currentThread?.session_id;

    // Clear messages and show loading
    setState(prev => ({ ...prev, messages: [], isStreaming: false }));
    setIsResuming(true);
    setCanSendMessage(false);

    // Load messages and restore transcript in parallel
    const loadThread = async () => {
      const [messages, restored] = await Promise.all([
        loadThreadMessages(currentThreadId),
        currentThread?.session_id && userId
          ? restoreTranscript(userId, userId, currentThread.session_id)
          : Promise.resolve(true)
      ]);

      // Check we're still on this thread
      if (activeThreadIdRef.current !== currentThreadId) return;

      if (messages.length > 0) {
        setState(prev => ({ ...prev, messages }));
        isFirstMessageRef.current = false;
      }

      setIsResuming(false);
      setCanSendMessage(true);

      if (!restored && currentThread?.session_id) {
        console.warn('[AgentContext] Failed to restore transcript, will start fresh');
      }
    };

    loadThread();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentThreadId, currentThread?.session_id, userId, loadThreadMessages]);

  const sendMessage = useCallback(async (prompt: string, options?: ExtendedOptions) => {
    // Auto-create thread if needed
    let threadId = activeThreadIdRef.current;
    if (!threadId) {
      const newThread = await createThread();
      if (!newThread) {
        console.error('[AgentContext] Failed to create thread');
        return;
      }
      threadId = newThread.id;
      // Wait for thread change effect to run
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (!socketRef.current?.connected) {
      console.error('[AgentContext] Socket not connected');
      return;
    }

    const uuid = generateUUID();
    const message: Message = {
      uuid,
      role: 'user',
      content: prompt,
    };

    setState(prev => ({
      ...prev,
      isStreaming: true,
      messages: [...prev.messages, message]
    }));

    // Save user message to thread
    if (threadId) {
      saveMessageToThread(threadId, message);
    }

    // Send with session resume if available - use SDK's session_id to continue conversation
    const messageOptions = { ...options };
    const sessionId = activeSessionIdRef.current;
    if (sessionId && !isFirstMessageRef.current) {
      messageOptions.resume = sessionId;
      console.log('%c[AgentContext] RESUMING session:', 'background: purple; color: white', sessionId);
    }
    isFirstMessageRef.current = false;

    socketRef.current.emit('message', { prompt, options: messageOptions });
  }, [createThread, saveMessageToThread]);

  const interrupt = useCallback(() => socketRef.current?.emit('interrupt'), []);

  // Interrupt for thread switch - waits for state to be saved
  const interruptForSwitch = useCallback(async (threadId: string): Promise<boolean> => {
    if (!socketRef.current?.connected) return true;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('[AgentContext] Interrupt timeout');
        resolve(true);
      }, 5000);

      socketRef.current!.once('interrupt_complete', (data: { success: boolean }) => {
        clearTimeout(timeout);
        resolve(data.success);
      });

      socketRef.current!.emit('interrupt', { threadId, reason: 'thread_switch' });
    });
  }, []);

  const clearChat = useCallback(() => {
    socketRef.current?.emit('clear');
    setState(prev => ({ ...prev, messages: [], isStreaming: false }));
  }, []);

  return (
    <AgentContext.Provider value={{ state, isResuming, canSendMessage, sendMessage, interrupt, interruptForSwitch, clearChat }}>
      {children}
    </AgentContext.Provider>
  );
}

export function useAgent() {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useAgent must be within AgentProvider');
  return ctx;
}
