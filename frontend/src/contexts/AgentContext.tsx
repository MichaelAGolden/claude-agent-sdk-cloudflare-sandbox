import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import io, { type Socket } from 'socket.io-client';
import { useAuth } from '@clerk/clerk-react';
import type { AgentState, ExtendedOptions, HookEvent, HookEventType, Message, StreamTerminationInfo } from '../types/index.ts';
import { useThreads } from './ThreadContext';

const generateUUID = () => crypto.randomUUID();

// API base URL - empty string means same origin (works with frontend worker proxy)
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

/**
 * Normalizes a user ID to lowercase for sandbox compatibility.
 * Cloudflare Sandbox IDs are used in hostnames which are case-insensitive.
 */
const normalizeUserId = (userId: string): string => userId.toLowerCase();

// Create socket with user-specific sandbox
// userId determines the sandbox (one per user)
// SDK session resumption is handled via the 'resume' option in messages
// Note: userId should already be normalized before calling this
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
  /** Session ID for the current user's sandbox container */
  sessionId: string | null;
  isResuming: boolean;
  canSendMessage: boolean;
  sendMessage: (prompt: string, options?: ExtendedOptions) => void;
  interrupt: () => void;
  interruptForSwitch: (threadId: string) => Promise<boolean>;
  clearChat: () => void;
  /** Request diagnostics from the container - results logged to console */
  requestDiagnostics: () => void;
  /** Fetch container logs from the API - returns logs or null */
  fetchContainerLogs: () => Promise<string | null>;
}

const AgentContext = createContext<AgentContextType | null>(null);

// Helper: Restore transcript from R2 before resuming (now requires auth token)
const restoreTranscript = async (
  authFetch: (path: string, options?: RequestInit) => Promise<Response>,
  sandboxSessionId: string,
  sdkSessionId: string
): Promise<boolean> => {
  try {
    const response = await authFetch(`/api/sessions/${sandboxSessionId}/restore`, {
      method: 'POST',
      body: JSON.stringify({ sdkSessionId }),
    });
    const result = await response.json();
    console.log('[AgentContext] Restore transcript result:', result);
    return result.status === 'restored';
  } catch (error) {
    console.error('[AgentContext] Failed to restore transcript:', error);
    return false;
  }
};

// Helper: Sync transcript to R2 on session end (now requires auth token)
const syncTranscript = async (
  authFetch: (path: string, options?: RequestInit) => Promise<Response>,
  sandboxSessionId: string,
  sdkSessionId: string
): Promise<boolean> => {
  try {
    const response = await authFetch(`/api/sessions/${sandboxSessionId}/sync`, {
      method: 'POST',
      body: JSON.stringify({ sdkSessionId }),
    });
    const result = await response.json();
    console.log('[AgentContext] Sync transcript result:', result);
    return result.status === 'synced';
  } catch (error) {
    console.error('[AgentContext] Failed to sync transcript:', error);
    return false;
  }
};

// Helper: Sync files from hook event data to R2
const syncFilesFromHook = async (
  authFetch: (path: string, options?: RequestInit) => Promise<Response>,
  sandboxSessionId: string,
  hookData: unknown
): Promise<void> => {
  try {
    const response = await authFetch(`/api/files/${sandboxSessionId}/sync/hook`, {
      method: 'POST',
      body: JSON.stringify({ hookData }),
    });
    const result = await response.json();
    if (result.filesSynced > 0) {
      console.log('[AgentContext] Files synced from hook:', result);
    }
  } catch (error) {
    console.error('[AgentContext] Failed to sync files from hook:', error);
  }
};

// Helper: Full sync of all directories to R2
const fullSyncFiles = async (
  authFetch: (path: string, options?: RequestInit) => Promise<Response>,
  sandboxSessionId: string
): Promise<void> => {
  try {
    const response = await authFetch(`/api/files/${sandboxSessionId}/sync/full`, {
      method: 'POST',
    });
    const result = await response.json();
    console.log('[AgentContext] Full file sync result:', result);
  } catch (error) {
    console.error('[AgentContext] Failed to full sync files:', error);
  }
};

// Helper: Restore files from R2 to sandbox on session resume
const restoreFiles = async (
  authFetch: (path: string, options?: RequestInit) => Promise<Response>,
  sandboxSessionId: string
): Promise<boolean> => {
  try {
    const response = await authFetch(`/api/files/${sandboxSessionId}/restore`, {
      method: 'POST',
    });
    const result = await response.json();
    console.log('[AgentContext] Restore files result:', result);
    return result.status === 'restored';
  } catch (error) {
    console.error('[AgentContext] Failed to restore files:', error);
    return false;
  }
};

export function AgentProvider({ children }: { children: ReactNode }) {
  const { userId: rawUserId, getToken } = useAuth();
  // Normalize userId to lowercase for sandbox compatibility (Cloudflare hostnames are case-insensitive)
  const userId = rawUserId ? normalizeUserId(rawUserId) : null;
  const { state: threadState, createThread, updateThreadSessionId, generateTitle } = useThreads();

  // Create authenticated fetch function
  const authFetch = useCallback(
    (path: string, options?: RequestInit) => createAuthFetch(getToken)(path, options),
    [getToken]
  );

  // Store authFetch in ref so socket handlers can access it
  const authFetchRef = useRef(authFetch);
  useEffect(() => {
    authFetchRef.current = authFetch;
  }, [authFetch]);
  const { currentThreadId, currentThread } = threadState;

  const [state, setState] = useState<AgentState>({
    isConnected: false,
    messages: [],
    isStreaming: false,
    socketId: null,
    streamTermination: null,
  });

  // Helper to stop streaming with termination info
  const stopStreaming = useCallback((
    reason: StreamTerminationInfo['reason'],
    message: string,
    details?: Record<string, unknown>
  ) => {
    const termination: StreamTerminationInfo = {
      reason,
      message,
      timestamp: Date.now(),
      details,
    };
    console.log(`[AgentContext] Stream terminated: ${reason} - ${message}`, details);
    setState(prev => ({
      ...prev,
      isStreaming: false,
      streamTermination: termination,
    }));
  }, []);


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

  // Save message to thread via API (with auth)
  const saveMessageToThread = useCallback(async (threadId: string, message: Message) => {
    try {
      await authFetchRef.current(`/api/threads/${threadId}/messages`, {
        method: 'POST',
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

  // Load messages from thread (with auth)
  const loadThreadMessages = useCallback(async (threadId: string) => {
    try {
      const response = await authFetchRef.current(`/api/threads/${threadId}`);
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

      socket.on('disconnect', async (reason) => {
        console.log('[AgentContext] Socket disconnected:', reason);
        setState(prev => {
          // If we were streaming when disconnected, this is unexpected
          const wasStreaming = prev.isStreaming;
          return {
            ...prev,
            isConnected: false,
            socketId: null,
            isStreaming: false,
            streamTermination: wasStreaming ? {
              reason: 'disconnected',
              message: `Connection lost: ${reason}`,
              timestamp: Date.now(),
              details: { socketReason: reason },
            } : prev.streamTermination,
          };
        });

        // Sync transcript and files to R2 on disconnect (with auth)
        if (userIdRef.current) {
          // Full sync files first (captures everything in /workspace, /home, /root/.claude)
          console.log('[AgentContext] Full file sync on disconnect for user:', userIdRef.current);
          await fullSyncFiles(authFetchRef.current, userIdRef.current);

          // Then sync transcript if we have a session ID
          if (sdkSessionIdRef.current) {
            console.log('[AgentContext] Syncing transcript on disconnect:', sdkSessionIdRef.current);
            await syncTranscript(authFetchRef.current, userIdRef.current, sdkSessionIdRef.current);
          }
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

        // Filter out tool_result messages - these are SDK echoes, not actual user messages
        // Tool results appear as user messages with content containing tool_result blocks
        if (data.role === 'user' && Array.isArray(data.content)) {
          const hasToolResult = data.content.some((block: any) => block?.type === 'tool_result');
          if (hasToolResult) {
            console.log('[AgentContext] Filtering tool_result message (not displaying as user message)');
            return;
          }
        }

        // Filter out SDK interrupt messages - these are internal artifacts, not user messages
        // These appear when a user sends a message during an active stream
        if (data.role === 'user') {
          const contentStr = typeof data.content === 'string'
            ? data.content
            : Array.isArray(data.content)
              ? data.content.map((b: any) => b?.text || b).join('')
              : '';

          if (contentStr.includes('[Request interrupted') ||
              contentStr.includes('[Interrupted by user]') ||
              contentStr.startsWith('[') && contentStr.includes('interrupted')) {
            console.log('[AgentContext] Filtering interrupt notification message');
            return;
          }
        }

        // Handle skill command messages (internal SDK artifacts)
        // Instead of filtering them, we transform them into hook events for better UI display
        let role = data.role;
        let hookEvent = undefined;
        
        const checkContentForCommand = (c: any) => {
          if (typeof c === 'string') {
            return c.includes('<command-message>') || c.includes('<command-name>');
          }
          return false;
        };

        let isCommand = false;
        let commandContent = '';

        if (role === 'user') {
          if (typeof data.content === 'string') {
            if (checkContentForCommand(data.content)) {
              isCommand = true;
              commandContent = data.content;
            }
          } else if (Array.isArray(data.content)) {
            // Check array content (handle both objects with text prop and raw strings)
            for (const block of data.content) {
              if (block && typeof block === 'object' && 'text' in block && checkContentForCommand(block.text)) {
                isCommand = true;
                commandContent = block.text;
                break;
              } else if (typeof block === 'string' && checkContentForCommand(block)) {
                isCommand = true;
                commandContent = block;
                break;
              }
            }
          }
        }

        if (isCommand) {
          console.log('[AgentContext] Transforming skill command message to hook event');
          role = 'hook';
          hookEvent = {
            id: data.uuid || generateUUID(),
            eventType: 'SkillCommand' as HookEventType,
            timestamp: Date.now(),
            data: { content: commandContent },
            isRequest: false,
          };
        }

        const uuid = data.uuid || generateUUID();
        const message: Message = { uuid, role, content: data.content, hookEvent };

        setState(prev => {
          const exists = prev.messages.findIndex(m => m.uuid === uuid);
          if (exists >= 0) {
            const msgs = [...prev.messages];
            // If we detected a command, force the role to hook even for existing messages
            if (isCommand) {
               msgs[exists] = { ...msgs[exists], content: data.content, role: 'hook', hookEvent };
            } else {
               msgs[exists] = { ...msgs[exists], content: data.content };
            }
            // Don't set isStreaming to false here - wait for Stop hook
            return { ...prev, messages: msgs };
          }

          if (data.role === 'assistant' && prev.isStreaming) {
            const last = prev.messages[prev.messages.length - 1];
            if (last?.role === 'assistant') {
              const msgs = [...prev.messages];
              msgs[msgs.length - 1] = { ...last, content: data.content, uuid };
              // Don't set isStreaming to false here - wait for Stop hook
              return { ...prev, messages: msgs };
            }
          }

          // Don't set isStreaming to false on assistant messages - the agent may continue
          // working with tool calls. Only the Stop hook should clear isStreaming.
          return {
            ...prev,
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

      // Note: We no longer set isStreaming to false on 'result' event
      // Instead, we wait for the Stop hook which indicates the agent has truly finished
      // This keeps the working indicator visible through the entire agent execution
      socket.on('result', async () => {
        console.log('[AgentContext] Result event received (waiting for Stop hook to clear streaming state)');

        // Sync transcript to R2 after each query completion
        // This ensures transcripts are saved even if user doesn't explicitly disconnect
        if (sdkSessionIdRef.current && userIdRef.current) {
          console.log('[AgentContext] Syncing transcript after query completion:', sdkSessionIdRef.current);
          await syncTranscript(authFetchRef.current, userIdRef.current, sdkSessionIdRef.current);
        }
      });
      socket.on('cleared', () => {
        setState(prev => ({ ...prev, messages: [], streamTermination: null }));
        stopStreaming('completed', 'Conversation cleared');
      });
      socket.on('error', (errorData?: { message?: string; code?: string }) => {
        const errorMsg = errorData?.message || 'Unknown socket error';
        const errorCode = errorData?.code || 'UNKNOWN';
        stopStreaming('error', `Socket error: ${errorMsg}`, { code: errorCode, raw: errorData });
      });

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

        // Only the main Stop hook indicates the agent has finished
        // SubagentStop is just a subagent finishing, the main agent continues working
        const isMainStopHook = data.event === 'Stop';

        setState(prev => ({
          ...prev,
          messages: [...prev.messages, message],
        }));
        const threadId = activeThreadIdRef.current;
        if (threadId) saveMessageToThread(threadId, message);

        // Trigger file explorer refresh on PostToolUse events
        // This is simpler and more reliable than parsing file operations
        if (data.event === 'PostToolUse') {
          window.dispatchEvent(new CustomEvent('sandbox-refresh-files'));

          // Sync files from hook data to R2 (fire-and-forget)
          // This captures files immediately to ensure they're not lost
          if (userIdRef.current) {
            syncFilesFromHook(authFetchRef.current, userIdRef.current, data.data);
          }
        }

        // Stop streaming on main Stop hook - agent has truly finished
        if (isMainStopHook) {
          stopStreaming('completed', 'Agent completed successfully', { event: data.event });
          // Sync transcript
          if (sdkSessionIdRef.current && userIdRef.current) {
            console.log('[AgentContext] Syncing transcript on Stop hook:', sdkSessionIdRef.current);
            syncTranscript(authFetchRef.current, userIdRef.current, sdkSessionIdRef.current);
          }
        }
      });

      socket.on('hook_request', (data: { event: string; data: any }, cb: (r: any) => void) => {
        const requestTime = Date.now();
        const toolName = data.data?.tool_name || 'unknown';
        console.log(`%c[HOOK REQUEST] ${data.event} for ${toolName}`, 'background: orange; color: black', {
          timestamp: new Date(requestTime).toISOString(),
          hasCb: typeof cb === 'function',
        });

        const response = { action: 'continue' };
        const hookEvent: HookEvent = {
          id: generateUUID(),
          eventType: data.event as HookEventType,
          timestamp: requestTime,
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

        // Only the main Stop hook indicates the agent has finished
        // SubagentStop is just a subagent finishing, the main agent continues working
        const isMainStopHook = data.event === 'Stop';

        setState(prev => ({
          ...prev,
          messages: [...prev.messages, message],
        }));
        const threadId = activeThreadIdRef.current;
        if (threadId) saveMessageToThread(threadId, message);

        // Stop streaming on main Stop hook request - agent has truly finished
        if (isMainStopHook) {
          stopStreaming('completed', 'Agent completed successfully', { event: data.event, isRequest: true });
          // Sync transcript
          if (sdkSessionIdRef.current && userIdRef.current) {
            console.log('[AgentContext] Syncing transcript on Stop hook request:', sdkSessionIdRef.current);
            syncTranscript(authFetchRef.current, userIdRef.current, sdkSessionIdRef.current);
          }
        }

        // Call callback and log timing
        console.log(`%c[HOOK CALLBACK] Sending response for ${data.event}`, 'background: green; color: white', {
          response,
          responseTime: Date.now() - requestTime,
        });
        cb(response);
        console.log(`%c[HOOK CALLBACK SENT] ${data.event} callback invoked`, 'background: blue; color: white');
      });

      // Handle interrupt_complete from container
      socket.on('interrupt_complete', (data: { threadId: string; success: boolean; sessionId: string }) => {
        console.log('[AgentContext] Interrupt complete:', data);
        stopStreaming('interrupted', 'Agent was interrupted by user', {
          threadId: data.threadId,
          sessionId: data.sessionId,
          success: data.success,
        });
      });

      // Handle diagnostics from container - useful for debugging
      socket.on('diagnostics', (data: any) => {
        console.log('%c[CONTAINER DIAGNOSTICS]', 'background: purple; color: white; font-weight: bold', data);
      });

      // Handle live container logs - these are forwarded from the container's logger
      socket.on('container_log', (entry: { level: string; event?: string; message?: string; data?: any }) => {
        const prefix = `[CONTAINER ${entry.level}]`;
        const style = entry.level === 'ERROR' ? 'background: red; color: white' :
                      entry.level === 'WARN' ? 'background: orange; color: black' :
                      'background: #333; color: #0f0';
        const content = entry.event || entry.message || '';
        console.log(`%c${prefix}`, style, content, entry.data || '');
      });

      // Handle image creation events from the agent
      // The container detects when agent creates an image file and emits the path
      // NOTE: This is fire-and-forget - errors should not block the agent
      socket.on('image_created', (data: { sandboxPath: string; sessionId: string }) => {
        // Wrap in async IIFE with error handling to prevent unhandled rejections
        (async () => {
          try {
            console.log('[AgentContext] Image created:', data.sandboxPath);

            // Construct URL to fetch image from sandbox
            // The /sandbox/:sessionId/file endpoint serves files directly from the sandbox
            const socketUrl = await getSocketUrl();
            const imageUrl = `${socketUrl}/sandbox/${data.sessionId}/file?path=${encodeURIComponent(data.sandboxPath)}`;

            // Determine MIME type from extension
            const ext = data.sandboxPath.split('.').pop()?.toLowerCase() || '';
            const mimeTypeMap: Record<string, string> = {
              png: 'image/png',
              jpg: 'image/jpeg',
              jpeg: 'image/jpeg',
              gif: 'image/gif',
              webp: 'image/webp',
              svg: 'image/svg+xml',
            };
            const mimeType = mimeTypeMap[ext] || 'image/png';

            // Create an image message to display in the conversation
            const uuid = generateUUID();
            const message: Message = {
              uuid,
              role: 'assistant',
              content: [
                {
                  type: 'image',
                  url: imageUrl,
                  sandboxPath: data.sandboxPath,
                  mimeType,
                }
              ],
            };

            setState(prev => ({
              ...prev,
              messages: [...prev.messages, message],
            }));

            // Save to current thread
            const threadId = activeThreadIdRef.current;
            if (threadId) {
              saveMessageToThread(threadId, message);
            }
          } catch (error) {
            console.error('[AgentContext] Error handling image_created event:', error);
            // Don't rethrow - this is fire-and-forget, shouldn't block agent
          }
        })();
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

    // Clear messages and show loading - this is a thread switch, not an error
    setState(prev => ({ ...prev, messages: [], isStreaming: false, streamTermination: null }));
    setIsResuming(true);
    setCanSendMessage(false);

    // Load messages, restore transcript, and restore files in parallel (with auth)
    const loadThread = async () => {
      const [messages, transcriptRestored, filesRestored] = await Promise.all([
        loadThreadMessages(currentThreadId),
        currentThread?.session_id && userId
          ? restoreTranscript(authFetchRef.current, userId, currentThread.session_id)
          : Promise.resolve(true),
        // Always restore files if we have a userId (files are per-user, not per-thread)
        userId
          ? restoreFiles(authFetchRef.current, userId)
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

      if (!transcriptRestored && currentThread?.session_id) {
        console.warn('[AgentContext] Failed to restore transcript, will start fresh');
      }
      if (!filesRestored) {
        console.warn('[AgentContext] Failed to restore files from R2');
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

    // Start streaming and clear any previous termination info
    setState(prev => ({
      ...prev,
      isStreaming: true,
      streamTermination: null,
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
    setState(prev => ({ ...prev, messages: [], isStreaming: false, streamTermination: null }));
  }, []);

  // Request diagnostics from the container - useful for debugging stuck agents
  const requestDiagnostics = useCallback(() => {
    if (socketRef.current?.connected) {
      console.log('[AgentContext] Requesting container diagnostics...');
      socketRef.current.emit('get_diagnostics');
    } else {
      console.warn('[AgentContext] Cannot request diagnostics - socket not connected');
    }
  }, []);

  // Fetch container logs from the API
  const fetchContainerLogs = useCallback(async (): Promise<string | null> => {
    if (!userId) return null;
    try {
      const response = await authFetchRef.current(`/sandbox/${userId}/logs`);
      const data = await response.json();
      console.log('%c[CONTAINER LOGS]', 'background: darkblue; color: white; font-weight: bold', data.logs);
      return data.logs;
    } catch (error) {
      console.error('[AgentContext] Failed to fetch container logs:', error);
      return null;
    }
  }, [userId]);

  return (
    <AgentContext.Provider value={{
      state,
      sessionId: userId,
      isResuming,
      canSendMessage,
      sendMessage,
      interrupt,
      interruptForSwitch,
      clearChat,
      requestDiagnostics,
      fetchContainerLogs,
    }}>
      {children}
    </AgentContext.Provider>
  );
}

export function useAgent() {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useAgent must be within AgentProvider');
  return ctx;
}
