# Persistent Thread Switching Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement seamless thread switching with persistent socket connection, graceful disconnect handling, and confirmation dialogs.

**Architecture:** Split socket lifecycle from thread lifecycle. Socket persists per user session. Thread switching loads messages from D1, restores transcripts from R2, and uses SDK's resume feature. Container saves all state before closing.

**Tech Stack:** React, TypeScript, Socket.IO, Cloudflare D1/R2, Claude Agent SDK

---

## Task 1: Add Thread Switching State to ThreadContext

**Files:**
- Modify: `frontend/src/contexts/ThreadContext.tsx`

**Step 1: Add pending switch state and types**

After line 30 (after ThreadState interface), add:

```typescript
interface PendingThreadSwitch {
  targetThreadId: string;
  targetThread: Thread;
}
```

**Step 2: Add state for pending switch**

After line 57 (after error: null in initial state), add pendingSwitch to state interface and initial state:

```typescript
// In ThreadState interface (around line 25), add:
  pendingSwitch: PendingThreadSwitch | null;

// In useState initial state (around line 57), add:
  pendingSwitch: null,
```

**Step 3: Add requestThreadSwitch function**

After the `switchThread` function (around line 175), add:

```typescript
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
```

**Step 4: Update ThreadContextType interface**

Around line 33, update the interface:

```typescript
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
```

**Step 5: Update Provider value**

Around line 280, add the new functions to the provider value:

```typescript
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
```

**Step 6: Verify changes compile**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no type errors

**Step 7: Commit**

```bash
git add frontend/src/contexts/ThreadContext.tsx
git commit -m "feat(threads): add pending switch state for confirmation flow"
```

---

## Task 2: Create ConfirmThreadSwitch Dialog Component

**Files:**
- Create: `frontend/src/components/ConfirmThreadSwitch.tsx`

**Step 1: Create the dialog component**

```typescript
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ConfirmThreadSwitchProps {
  isOpen: boolean;
  targetThreadTitle: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmThreadSwitch({
  isOpen,
  targetThreadTitle,
  onCancel,
  onConfirm,
}: ConfirmThreadSwitchProps) {
  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Switch Conversation?</AlertDialogTitle>
          <AlertDialogDescription>
            The current conversation will be interrupted and saved. You can resume it later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="py-2">
          <p className="text-sm text-muted-foreground">
            Switch to: <span className="font-medium text-foreground">{targetThreadTitle}</span>
          </p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Stay Here</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Switch</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

**Step 2: Verify component compiles**

Run: `cd frontend && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add frontend/src/components/ConfirmThreadSwitch.tsx
git commit -m "feat(ui): add ConfirmThreadSwitch dialog component"
```

---

## Task 3: Refactor AgentContext - Split Socket and Thread Effects

**Files:**
- Modify: `frontend/src/contexts/AgentContext.tsx`

**Step 1: Add new refs for persistent socket**

After line 127 (after sdkSessionIdRef), add:

```typescript
// Refs for thread-independent socket management
const activeThreadIdRef = useRef<string | null>(null);
const activeSessionIdRef = useRef<string | null>(null);
const socketInitializedRef = useRef(false);
```

**Step 2: Add state for resuming/loading**

After line 119 (in AgentState), add to the state:

```typescript
const [isResuming, setIsResuming] = useState(false);
const [canSendMessage, setCanSendMessage] = useState(true);
```

**Step 3: Create socket initialization effect (runs once per userId)**

Replace the existing large useEffect (lines 204-479) with TWO separate effects.

First, add the socket lifecycle effect:

```typescript
// Effect 1: Socket lifecycle - ONE socket per user session
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
```

**Step 4: Create thread switch effect (runs on thread change)**

Add the second effect right after the first one:

```typescript
// Effect 2: Thread switching - loads messages, updates refs
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
}, [currentThreadId, currentThread?.session_id, userId, loadThreadMessages]);
```

**Step 5: Add interrupt function for thread switching**

After the existing `interrupt` function (around line 529), add:

```typescript
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
```

**Step 6: Update context type and provider**

Update AgentContextType interface:

```typescript
interface AgentContextType {
  state: AgentState;
  isResuming: boolean;
  canSendMessage: boolean;
  sendMessage: (prompt: string, options?: ExtendedOptions) => void;
  interrupt: () => void;
  interruptForSwitch: (threadId: string) => Promise<boolean>;
  clearChat: () => void;
}
```

Update provider value:

```typescript
<AgentContext.Provider value={{ state, isResuming, canSendMessage, sendMessage, interrupt, interruptForSwitch, clearChat }}>
```

**Step 7: Verify changes compile**

Run: `cd frontend && npm run build`
Expected: Build succeeds

**Step 8: Commit**

```bash
git add frontend/src/contexts/AgentContext.tsx
git commit -m "feat(agent): split socket lifecycle from thread lifecycle"
```

---

## Task 4: Update ThreadListSidebar to Use Confirmation Flow

**Files:**
- Modify: `frontend/src/components/ThreadListSidebar.tsx`

**Step 1: Import new dependencies**

Update imports at the top:

```typescript
import { useState } from "react";
import { PlusIcon, TrashIcon, MessageSquareIcon, PencilIcon, CheckIcon, XIcon } from "lucide-react";
import { useThreads } from "@/contexts/ThreadContext";
import { useAgent } from "@/contexts/AgentContext";
import { ConfirmThreadSwitch } from "@/components/ConfirmThreadSwitch";
// ... rest of imports
```

**Step 2: Add agent context and handlers**

After the useThreads hook (line 23), add:

```typescript
const { state: agentState, interruptForSwitch } = useAgent();
const { isStreaming } = agentState;

const handleSwitchThread = (threadId: string) => {
  if (threadId === currentThreadId) return;

  const { needsConfirmation } = requestThreadSwitch(threadId, isStreaming);
  // If needsConfirmation is true, the dialog will show via state.pendingSwitch
};

const handleConfirmSwitch = async () => {
  // Interrupt current conversation
  if (isStreaming && currentThreadId) {
    await interruptForSwitch(currentThreadId);
  }
  // Execute the switch
  await confirmPendingSwitch();
};
```

**Step 3: Update the onClick handler**

Around line 123, change:

```typescript
onClick={() => switchThread(thread.id)}
```

To:

```typescript
onClick={() => handleSwitchThread(thread.id)}
```

**Step 4: Add the confirmation dialog**

Before the closing `</Sidebar>` tag (around line 206), add:

```typescript
{/* Confirmation dialog for switching during active conversation */}
<ConfirmThreadSwitch
  isOpen={!!state.pendingSwitch}
  targetThreadTitle={state.pendingSwitch?.targetThread.title || ''}
  onCancel={cancelPendingSwitch}
  onConfirm={handleConfirmSwitch}
/>
```

**Step 5: Update destructuring to include new functions**

Update line 23:

```typescript
const { state, createThread, deleteThread, requestThreadSwitch, cancelPendingSwitch, confirmPendingSwitch, updateThreadTitle } = useThreads();
```

**Step 6: Verify changes compile**

Run: `cd frontend && npm run build`
Expected: Build succeeds

**Step 7: Commit**

```bash
git add frontend/src/components/ThreadListSidebar.tsx
git commit -m "feat(sidebar): add thread switch confirmation flow"
```

---

## Task 5: Add Interrupt Handler to Container

**Files:**
- Modify: `container/agent-sdk.ts`

**Step 1: Add interrupt tracking state**

After line 205 (after the sessions Map), add:

```typescript
// Track interrupt requests per session
const interruptFlags = new Map<string, { reason: string; threadId: string }>();
```

**Step 2: Add interrupt socket handler**

After the 'clear' handler (around line 692), add:

```typescript
// Handle 'interrupt' with thread context (for thread switching)
socket.on("interrupt", async (data: { threadId: string; reason: string }) => {
  log.incoming(socket.id, 'interrupt_switch', data);
  const session = sessions.get(effectiveSessionId);

  if (!session) {
    socket.emit("interrupt_complete", { threadId: data.threadId, success: true, sessionId: null });
    return;
  }

  // Set interrupt flag
  interruptFlags.set(effectiveSessionId, { reason: data.reason, threadId: data.threadId });

  // If query is running, interrupt it
  if (session.queryIterator) {
    try {
      log.info(`Interrupting query for thread switch`, socket.id);
      await session.queryIterator.interrupt();
    } catch (err) {
      log.error("Error interrupting query", err, socket.id);
    }
  }

  // Mark session as not running
  session.isQueryRunning = false;

  // Emit completion - state is already in memory, will be synced on next message
  log.outgoing(socket.id, 'interrupt_complete', { threadId: data.threadId, success: true });
  socket.emit("interrupt_complete", {
    threadId: data.threadId,
    success: true,
    sessionId: effectiveSessionId
  });

  // Clear interrupt flag
  interruptFlags.delete(effectiveSessionId);
});
```

**Step 3: Verify changes compile**

Run: `cd container && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add container/agent-sdk.ts
git commit -m "feat(container): add interrupt handler for thread switching"
```

---

## Task 6: Integration Testing

**Step 1: Start development servers**

```bash
# Terminal 1: Backend
npm run dev

# Terminal 2: Frontend
cd frontend && npm run dev
```

**Step 2: Test basic thread switching (no streaming)**

1. Create a new conversation
2. Send a message, wait for response
3. Create another conversation
4. Switch between them - should work without confirmation

**Step 3: Test thread switching during streaming**

1. Send a message
2. While assistant is responding, click another thread
3. Confirmation dialog should appear
4. Click "Stay Here" - should stay on current thread
5. Click "Switch" - should interrupt and switch

**Step 4: Test resume functionality**

1. Have a conversation in Thread A
2. Switch to Thread B, have a conversation
3. Switch back to Thread A
4. Send a message - should resume Thread A's context

**Step 5: Commit final integration**

```bash
git add -A
git commit -m "feat: complete persistent thread switching implementation"
```

---

## Summary of Changes

| File | Changes |
|------|---------|
| `ThreadContext.tsx` | Added pendingSwitch state, requestThreadSwitch, cancelPendingSwitch, confirmPendingSwitch |
| `ConfirmThreadSwitch.tsx` | New dialog component |
| `AgentContext.tsx` | Split into socket lifecycle + thread switch effects, added interruptForSwitch |
| `ThreadListSidebar.tsx` | Uses new confirmation flow |
| `agent-sdk.ts` | Added interrupt handler with thread context |

## Testing Checklist

- [ ] Switch threads while idle - no confirmation
- [ ] Switch threads while streaming - shows confirmation
- [ ] Cancel switch - stays on current thread
- [ ] Confirm switch - interrupts and switches
- [ ] Resume after switch - continues previous context
- [ ] Disconnect/reconnect - socket persists
- [ ] New thread - creates fresh session
