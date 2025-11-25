import { createContext, useContext, useEffect, useState, useRef, useCallback, ReactNode } from 'react';
import io, { type Socket } from 'socket.io-client';
import type { AgentState, ExtendedOptions } from '../types/index.ts';

const generateUUID = () => crypto.randomUUID();

// Singleton socket
let globalSocket: Socket | null = null;
let globalSessionId: string | null = null;

const getOrCreateSocket = () => {
  if (!globalSessionId) {
    globalSessionId = localStorage.getItem('agent_session_id');
    if (!globalSessionId) {
      globalSessionId = crypto.randomUUID();
      localStorage.setItem('agent_session_id', globalSessionId);
    }
  }

  if (!globalSocket || globalSocket.disconnected) {
    globalSocket = io('http://localhost:8787', {
      query: { sessionId: globalSessionId },
      transports: ['websocket', 'polling'],
      path: '/socket.io/',
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
  }

  return globalSocket;
};

interface AgentContextType {
  state: AgentState;
  sendMessage: (prompt: string, options?: ExtendedOptions) => void;
  interrupt: () => void;
  clearChat: () => void;
}

const AgentContext = createContext<AgentContextType | null>(null);

export function AgentProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AgentState>({
    isConnected: false,
    messages: [],
    isStreaming: false,
    socketId: null,
  });

  const socketRef = useRef<Socket | null>(null);
  const isSetup = useRef(false);

  useEffect(() => {
    if (isSetup.current) return;
    isSetup.current = true;

    console.log('[AgentProvider] Setting up socket');
    const socket = getOrCreateSocket();
    socketRef.current = socket;

    const handleConnect = () => {
      console.log('[AgentProvider] Connected:', socket.id);
      setState(prev => ({ ...prev, isConnected: true, socketId: socket.id || null }));
      socket.emit('get_history');
    };

    socket.on('connect', handleConnect);
    if (socket.connected) handleConnect();

    socket.on('disconnect', () => {
      setState(prev => ({ ...prev, isConnected: false, socketId: null }));
    });

    socket.on('history', (data: { messages: any[] }) => {
      console.log('[AgentProvider] History:', data.messages?.length);
      if (data.messages?.length > 0) {
        setState(prev => ({
          ...prev,
          messages: data.messages.map((msg, i) => ({ ...msg, uuid: msg.uuid || `h-${i}` }))
        }));
      }
    });

    socket.on('message', (data: any) => {
      console.log('%c[AgentProvider] MESSAGE', 'background: green; color: white', data.role);
      setState(prev => {
        const uuid = data.uuid || generateUUID();
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

        console.log('%c[AgentProvider] Adding new message', 'background: blue; color: white', prev.messages.length);
        return {
          ...prev,
          isStreaming: data.role === 'assistant' ? false : prev.isStreaming,
          messages: [...prev.messages, { role: data.role, content: data.content, uuid }]
        };
      });
    });

    socket.on('stream', (data: any) => {
      if (data?.type === 'text' && data?.content) {
        console.log('%c[AgentProvider] STREAM', 'background: purple; color: white', data.content.substring(0, 20));
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

    socket.on('hook_request', (_: any, cb: (r: any) => void) => cb({ action: 'continue' }));

    return () => { console.log('[AgentProvider] Cleanup'); };
  }, []);

  const sendMessage = useCallback((prompt: string, options?: ExtendedOptions) => {
    if (!socketRef.current?.connected) return;

    console.log('%c[AgentProvider] SEND', 'background: orange; color: black', prompt.substring(0, 30));
    const uuid = generateUUID();

    setState(prev => ({
      ...prev,
      isStreaming: true,
      messages: [...prev.messages, { role: 'user', content: prompt, uuid }]
    }));

    socketRef.current.emit('message', { prompt, options });
  }, []);

  const interrupt = useCallback(() => socketRef.current?.emit('interrupt'), []);
  const clearChat = useCallback(() => socketRef.current?.emit('clear'), []);

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
