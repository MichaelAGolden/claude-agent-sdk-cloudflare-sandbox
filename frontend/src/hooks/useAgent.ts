import { useEffect, useState, useRef, useCallback } from 'react';
import io, { type Socket } from 'socket.io-client';
import type { AgentState, ExtendedOptions } from '../types/index.ts';

// Generate a stable UUID for messages
const generateUUID = () => crypto.randomUUID();

// Singleton socket instance to survive React StrictMode double-mounting
let globalSocket: Socket | null = null;
let globalSessionId: string | null = null;

const getOrCreateSocket = () => {
  if (!globalSessionId) {
    globalSessionId = localStorage.getItem('agent_session_id');
    if (!globalSessionId) {
      globalSessionId = crypto.randomUUID();
      localStorage.setItem('agent_session_id', globalSessionId);
    }
    console.log('[useAgent] Session ID:', globalSessionId);
  }

  if (!globalSocket || globalSocket.disconnected) {
    console.log('[useAgent] Creating new socket connection to localhost:8787');
    globalSocket = io('http://localhost:8787', {
      query: { sessionId: globalSessionId },
      transports: ['websocket', 'polling'],
      path: '/socket.io/',
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    // Log socket connection events at the global level
    globalSocket.on('connect', () => {
      console.log('[useAgent] Global socket connected, id:', globalSocket?.id);
    });
    globalSocket.on('disconnect', (reason) => {
      console.log('[useAgent] Global socket disconnected, reason:', reason);
    });
    globalSocket.on('connect_error', (error) => {
      console.error('[useAgent] Global socket connect error:', error.message);
    });
  } else {
    console.log('[useAgent] Reusing existing socket, connected:', globalSocket.connected, 'id:', globalSocket.id);
  }

  return globalSocket;
};

export const useAgent = () => {
  const [state, setState] = useState<AgentState>({
    isConnected: false,
    messages: [],
    isStreaming: false,
    socketId: null,
    streamTermination: null,
  });

  const socketRef = useRef<Socket | null>(null);
  const interactionCallbacks = useRef<Map<string, (response: any) => void>>(new Map());
  const isSetup = useRef(false);

  useEffect(() => {
    // Prevent double setup from StrictMode
    if (isSetup.current) {
      console.log('[useAgent] Already setup, skipping');
      return;
    }
    isSetup.current = true;

    const socket = getOrCreateSocket();
    socketRef.current = socket;

    // Helper to request history and update state
    const handleConnect = () => {
      console.log('[useAgent] handleConnect called, socket.id:', socket.id);
      setState((prev: AgentState) => ({ ...prev, isConnected: true, socketId: socket.id || null }));
      // Request conversation history from server
      console.log('[useAgent] Emitting get_history');
      socket.emit('get_history');
    };

    socket.on('connect', handleConnect);

    // If socket is already connected, manually trigger the connect logic
    if (socket.connected) {
      console.log('[useAgent] Socket already connected, manually triggering handleConnect');
      handleConnect();
    }

    socket.on('disconnect', () => {
      console.log('[useAgent] Socket disconnected');
      setState((prev: AgentState) => ({ ...prev, isConnected: false, socketId: null }));
    });

    // Handle reconnection - request history again
    socket.on('reconnect', () => {
      console.log('[useAgent] Socket reconnected');
      handleConnect();
    });

    // Handle history from server (initial load)
    socket.on('history', (data: { messages: any[] }) => {
      console.log('[useAgent] Received history event, messages:', data.messages?.length || 0);
      if (Array.isArray(data.messages) && data.messages.length > 0) {
        console.log('[useAgent] Setting state with history messages');
        setState((prev: AgentState) => ({
          ...prev,
          messages: data.messages.map((msg, idx) => ({
            ...msg,
            uuid: msg.uuid || `history-${idx}`
          }))
        }));
      } else {
        console.log('[useAgent] No history messages to load');
      }
    });

    socket.on('message', (data: any) => {
      console.log('[useAgent] Received message event:', data.role, 'uuid:', data.uuid?.substring(0, 8));
      setState((prev: AgentState) => {
        const msgUuid = data.uuid || generateUUID();

        // Check if we already have this message (by uuid) or if we're updating a streaming message
        const existingIndex = prev.messages.findIndex(m => m.uuid === msgUuid);
        if (existingIndex >= 0) {
          // Update existing message
          console.log('[useAgent] Updating existing message at index:', existingIndex);
          const newMessages = [...prev.messages];
          newMessages[existingIndex] = { ...newMessages[existingIndex], content: data.content };
          // If this is an assistant message, stop streaming
          const shouldStopStreaming = data.role === 'assistant' ? false : prev.isStreaming;
          return { ...prev, messages: newMessages, isStreaming: shouldStopStreaming };
        }

        // If assistant message while streaming, update the last streaming message if it exists
        if (data.role === 'assistant' && prev.isStreaming) {
          const lastMsg = prev.messages[prev.messages.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            console.log('[useAgent] Updating last streaming message');
            const newMessages = [...prev.messages];
            newMessages[newMessages.length - 1] = {
              ...lastMsg,
              content: data.content,
              uuid: msgUuid
            };
            return { ...prev, messages: newMessages, isStreaming: false };
          }
        }

        // Add new message - if it's an assistant message, stop streaming
        console.log('[useAgent] Adding new message, current count:', prev.messages.length);
        return {
          ...prev,
          isStreaming: data.role === 'assistant' ? false : prev.isStreaming,
          messages: [...prev.messages, { role: data.role, content: data.content, uuid: msgUuid }]
        };
      });
    });

    socket.on('stream', (data: any) => {
      console.log('%c[STREAM EVENT RECEIVED]', 'color: #ff00ff; font-weight: bold; font-size: 14px', data);
      console.log('[useAgent] stream event:', data?.type, data?.content?.substring?.(0, 50));

      if (data?.type === 'text' && data?.content) {
        console.log('%c[STREAM TEXT] Processing text chunk:', 'color: #ff00ff', data.content.length, 'chars');
        setState((prev: AgentState) => {
          const lastMsg = prev.messages[prev.messages.length - 1];
          console.log('[useAgent] stream state - isStreaming:', prev.isStreaming, 'lastRole:', lastMsg?.role, 'msgCount:', prev.messages.length);

          // Check if the last message is an assistant message we can append to
          if (lastMsg && lastMsg.role === 'assistant') {
            // Append to existing assistant message
            console.log('%c[STREAM] Appending to existing assistant message', 'color: #ff00ff');
            const newMessages = [...prev.messages];
            const currentContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';
            newMessages[newMessages.length - 1] = {
              ...lastMsg,
              content: currentContent + data.content
            };
            return { ...prev, messages: newMessages, isStreaming: true };
          } else {
            // No assistant message yet - create a new one
            console.log('%c[STREAM] Creating NEW assistant message for streaming', 'color: #ff00ff; font-weight: bold');
            return {
              ...prev,
              isStreaming: true,
              messages: [...prev.messages, { role: 'assistant', content: data.content, uuid: generateUUID() }]
            };
          }
        });
      } else {
        console.log('%c[STREAM] Ignoring non-text stream event:', 'color: #ff00ff', data);
      }
    });

    socket.on('result', (data: any) => {
      console.log('[useAgent] result event received, data:', data);
      setState((prev: AgentState) => ({ ...prev, isStreaming: false }));
    });

    socket.on('cleared', () => {
      setState((prev: AgentState) => ({ ...prev, messages: [], isStreaming: false }));
    });

    socket.on('hook_request', (data: any, callback: (response: any) => void) => {
      // Automatically continue all hooks for this demo UI
      const autoContinueHooks = [
        'SubagentStop',
        'UserPromptSubmit',
        'Stop',
        'SessionStart',
        'SessionEnd',
        'PreToolUse',
        'PostToolUse',
        'PreCompact',
        'Notification',
      ];

      if (autoContinueHooks.includes(data.event)) {
        callback({ action: 'continue' });
        return;
      }

      // For unknown hooks, log and auto-continue
      console.log('Unknown hook event, auto-continuing:', data.event, data);
      callback({ action: 'continue' });
    });

    socket.on('hook_notification', (data: any) => {
      // Silently handle hook notifications - don't add to messages
      console.log('Hook notification:', data.event);
    });

    socket.on('error', (err: any) => {
      console.error('Socket error:', err);
      // Reset streaming state on error so user can send again
      setState((prev: AgentState) => ({ ...prev, isStreaming: false }));
    });

    // Handle status messages from server (session resume, etc.)
    socket.on('status', (data: any) => {
      console.log('[useAgent] Status from server:', data.type, data.message);
    });

    // Debug: Log ALL events from the socket with full data - VERY VERBOSE
    socket.onAny((eventName, ...args) => {
      const timestamp = new Date().toISOString();
      console.log(`%c[${timestamp}] SOCKET EVENT: ${eventName}`, 'color: #00ff00; font-weight: bold');
      if (args.length > 0) {
        try {
          console.log(`%c[${timestamp}] Event data:`, 'color: #00ff00', JSON.stringify(args[0]).substring(0, 500));
        } catch (e) {
          console.log(`%c[${timestamp}] Event data (non-stringifiable):`, 'color: #00ff00', args[0]);
        }
      }
    });

    // Also log outgoing events
    socket.onAnyOutgoing((eventName, ...args) => {
      const timestamp = new Date().toISOString();
      console.log(`%c[${timestamp}] SOCKET EMIT: ${eventName}`, 'color: #ff9900; font-weight: bold');
      if (args.length > 0) {
        try {
          console.log(`%c[${timestamp}] Emit data:`, 'color: #ff9900', JSON.stringify(args[0]).substring(0, 200));
        } catch (e) {
          console.log(`%c[${timestamp}] Emit data (non-stringifiable):`, 'color: #ff9900', args[0]);
        }
      }
    });

    // Also listen for stream_event (the full SDK event)
    socket.on('stream_event', (data: any) => {
      console.log('[useAgent] stream_event received:', data?.type, data?.event?.type);
    });

    // Listen for sdk_event (catch-all from server)
    socket.on('sdk_event', (data: any) => {
      console.log('[useAgent] sdk_event received:', data?.type);
    });

    // Don't disconnect on cleanup - socket is a singleton that survives StrictMode
    return () => {
      console.log('[useAgent] Effect cleanup (socket stays connected)');
    };
  }, []);

  const sendMessage = useCallback((prompt: string, options?: ExtendedOptions) => {
    console.log('[useAgent] sendMessage called, prompt length:', prompt.length, 'socket connected:', socketRef.current?.connected);
    if (socketRef.current && socketRef.current.connected) {
      // Optimistic update with stable UUID and set streaming state
      const userMessageId = generateUUID();
      console.log('[useAgent] Adding user message with uuid:', userMessageId.substring(0, 8));
      setState((prev: AgentState) => ({
        ...prev,
        isStreaming: true, // Block input while waiting for response
        messages: [...prev.messages, { role: 'user', content: prompt, uuid: userMessageId }]
      }));
      console.log('[useAgent] Emitting message to server');
      socketRef.current.emit('message', { prompt, options });
    } else {
      console.error('[useAgent] Cannot send message - socket not connected');
    }
  }, []);

  const interrupt = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.emit('interrupt');
    }
  }, []);

  const clearChat = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.emit('clear');
    }
  }, []);

  const resolveInteraction = useCallback((requestId: string, result: any) => {
    const callback = interactionCallbacks.current.get(requestId);
    if (callback) {
      callback(result);
      interactionCallbacks.current.delete(requestId);

      setState((prev: AgentState) => ({
        ...prev,
        messages: prev.messages.map(msg =>
          msg.requestId === requestId
            ? { ...msg, interactionState: 'resolved', interactionResult: result }
            : msg
        )
      }));
    }
  }, []);

  return {
    state,
    sendMessage,
    interrupt,
    clearChat,
    resolveInteraction
  };
};
