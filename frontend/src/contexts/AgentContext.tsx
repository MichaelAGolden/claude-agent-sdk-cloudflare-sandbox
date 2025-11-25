import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import io, { type Socket } from 'socket.io-client';
import type { AgentState, ExtendedOptions, HookEvent, HookEventType, Message } from '../types/index.ts';
import { useThreads } from './ThreadContext';

const generateUUID = () => crypto.randomUUID();

// API base URL - use proxy in development
const API_BASE = '';

// Create socket with thread-specific session
const createSocket = (sessionId: string) => {
  return io('http://localhost:8787', {
    query: { sessionId },
    transports: ['websocket', 'polling'],
    path: '/socket.io/',
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });
};

interface AgentContextType {
  state: AgentState;
  sendMessage: (prompt: string, options?: ExtendedOptions) => void;
  interrupt: () => void;
  clearChat: () => void;
}

const AgentContext = createContext<AgentContextType | null>(null);

export function AgentProvider({ children }: { children: ReactNode }) {
  const { state: threadState, createThread, updateThreadSessionId, generateTitle } = useThreads();
  const { currentThreadId, currentThread } = threadState;

  const [state, setState] = useState<AgentState>({
    isConnected: false,
    messages: [],
    isStreaming: false,
    socketId: null,
  });

  const socketRef = useRef<Socket | null>(null);
  const currentThreadIdRef = useRef<string | null>(null);
  const isFirstMessageRef = useRef(true);
  const hasTitleGenRef = useRef<Set<string>>(new Set());

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
      const messages: Message[] = (data.messages || []).map((msg: any) => ({
        uuid: msg.id,
        role: msg.role,
        content: msg.role === 'hook' ? JSON.parse(msg.content || '{}') : msg.content,
        hookEvent: msg.hook_event ? JSON.parse(msg.hook_event) : undefined,
      }));

      return messages;
    } catch (error) {
      console.error('[AgentContext] Failed to load messages:', error);
      return [];
    }
  }, []);

  // Handle thread changes
  useEffect(() => {
    if (currentThreadId === currentThreadIdRef.current) return;
    currentThreadIdRef.current = currentThreadId;

    console.log('[AgentContext] Thread changed to:', currentThreadId);

    // Disconnect existing socket
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    // Reset state
    setState({
      isConnected: false,
      messages: [],
      isStreaming: false,
      socketId: null,
    });

    if (!currentThreadId) return;

    // Get session ID - use existing if available, otherwise use thread ID
    const sessionId = currentThread?.session_id || currentThreadId;
    isFirstMessageRef.current = !currentThread?.session_id;

    // Load existing messages
    loadThreadMessages(currentThreadId).then((messages) => {
      if (messages.length > 0) {
        setState(prev => ({ ...prev, messages }));
        isFirstMessageRef.current = false; // Has messages, not first
      }
    });

    // Create new socket
    const socket = createSocket(sessionId);
    socketRef.current = socket;

    // Setup socket handlers
    const handleConnect = () => {
      console.log('[AgentContext] Connected:', socket.id);
      setState(prev => ({ ...prev, isConnected: true, socketId: socket.id || null }));
    };

    socket.on('connect', handleConnect);
    if (socket.connected) handleConnect();

    socket.on('disconnect', () => {
      setState(prev => ({ ...prev, isConnected: false, socketId: null }));
    });

    socket.on('message', (data: any) => {
      console.log('%c[AgentContext] MESSAGE', 'background: green; color: white', data.role);

      // Capture session ID from system init message
      if (data.role === 'system' && data.subtype === 'init' && data.session_id) {
        console.log('[AgentContext] Session ID received:', data.session_id);
        if (currentThreadIdRef.current) {
          updateThreadSessionId(currentThreadIdRef.current, data.session_id);
        }
        return; // Don't display system messages
      }

      // Skip other system messages
      if (data.role === 'system') return;

      const uuid = data.uuid || generateUUID();
      const message: Message = {
        uuid,
        role: data.role,
        content: data.content,
      };

      setState(prev => {
        const exists = prev.messages.findIndex(m => m.uuid === uuid);
        if (exists >= 0) {
          const msgs = [...prev.messages];
          msgs[exists] = { ...msgs[exists], content: data.content };
          return { ...prev, messages: msgs, isStreaming: false };
        }

        // If streaming and last is assistant, update it
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

      // Save to thread
      if (currentThreadIdRef.current && data.role === 'assistant') {
        saveMessageToThread(currentThreadIdRef.current, message);

        // Generate title after first assistant response
        if (!hasTitleGenRef.current.has(currentThreadIdRef.current)) {
          hasTitleGenRef.current.add(currentThreadIdRef.current);
          setTimeout(() => {
            if (currentThreadIdRef.current) {
              generateTitle(currentThreadIdRef.current);
            }
          }, 500);
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

    socket.on('result', () => {
      setState(prev => ({ ...prev, isStreaming: false }));
    });

    socket.on('cleared', () => {
      setState(prev => ({ ...prev, messages: [], isStreaming: false }));
    });

    socket.on('error', () => {
      setState(prev => ({ ...prev, isStreaming: false }));
    });

    // Handle hook notifications
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

      setState(prev => ({
        ...prev,
        messages: [...prev.messages, message]
      }));

      if (currentThreadIdRef.current) {
        saveMessageToThread(currentThreadIdRef.current, message);
      }
    });

    // Handle hook requests
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

      setState(prev => ({
        ...prev,
        messages: [...prev.messages, message]
      }));

      if (currentThreadIdRef.current) {
        saveMessageToThread(currentThreadIdRef.current, message);
      }

      cb(response);
    });

    return () => {
      console.log('[AgentContext] Cleaning up socket');
      socket.disconnect();
    };
  }, [currentThreadId, currentThread?.session_id, loadThreadMessages, saveMessageToThread, updateThreadSessionId, generateTitle]);

  const sendMessage = useCallback(async (prompt: string, options?: ExtendedOptions) => {
    // Auto-create thread if needed
    let threadId = currentThreadIdRef.current;
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

    // Send with session resume if available
    const messageOptions = { ...options };
    if (currentThread?.session_id && !isFirstMessageRef.current) {
      messageOptions.resume = currentThread.session_id;
    }
    isFirstMessageRef.current = false;

    socketRef.current.emit('message', { prompt, options: messageOptions });
  }, [createThread, currentThread?.session_id, saveMessageToThread]);

  const interrupt = useCallback(() => socketRef.current?.emit('interrupt'), []);

  const clearChat = useCallback(() => {
    socketRef.current?.emit('clear');
    setState(prev => ({ ...prev, messages: [], isStreaming: false }));
  }, []);

  return (
    <AgentContext.Provider value={{ state, sendMessage, interrupt, clearChat }}>
      {children}
    </AgentContext.Provider>
  );
}

export function useAgent() {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useAgent must be within AgentProvider');
  return ctx;
}
