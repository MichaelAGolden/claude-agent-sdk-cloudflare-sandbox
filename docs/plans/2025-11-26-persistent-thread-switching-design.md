# Persistent Thread Switching Design

## Overview

Implement seamless thread switching without socket reconnection overhead. Users can switch between conversation threads while maintaining a single persistent connection to the container. The Agent SDK's native session management handles pause/resume functionality.

## Goals

1. **Persistent Socket Connection** - One socket per user session, not per thread
2. **Silent Thread Switching** - Seamless like claude.ai conversations
3. **Lazy Session Management** - SDK sessions resumed on-demand when messages sent
4. **Graceful Disconnect Handling** - Save state before container closes
5. **Complete Resume Context** - Both UI (D1) and SDK (R2) have full conversation state

## Architecture

### Current vs. New Behavior

**Current:**
```
Thread Switch → Disconnect Socket → Load Messages → Create New Socket → Wait for connect
```

**New:**
```
Thread Switch → [Confirm if active] → Interrupt → Save State → Load New Thread → Resume
```

### Two-Tier Session Management

| Identifier | Scope | Purpose |
|------------|-------|---------|
| `userId` (Clerk) | Socket/Container | One persistent connection per user |
| `session_id` (SDK) | Thread | Resume token stored per thread |

### Dual Data Sources

| Source | Contains | Purpose |
|--------|----------|---------|
| D1 Database | Messages (user, assistant, hooks) | UI display |
| R2 Storage | SDK transcript (tool calls, system prompts) | Claude's context |

Both must be synchronized before container closes.

## Component Changes

### AgentContext.tsx

**Split socket lifecycle from thread lifecycle:**

```typescript
// Effect 1: Socket lifecycle (runs once per user session)
useEffect(() => {
  if (!userId) return;

  const socket = io(socketUrl, {
    query: { sessionId: userId },
    transports: ['websocket', 'polling'],
  });

  socketRef.current = socket;
  setupEventHandlers(socket);

  return () => socket.disconnect(); // Only on unmount/logout
}, [userId]);

// Effect 2: Thread switch handling
useEffect(() => {
  if (!currentThreadId) return;

  setMessages([]);
  setIsLoadingMessages(true);

  Promise.all([
    loadThreadMessages(currentThreadId),
    currentThread?.session_id
      ? restoreTranscript(userId, currentThread.session_id)
      : Promise.resolve({ success: true, fresh: true })
  ]).then(([messages, restoreResult]) => {
    if (activeThreadIdRef.current !== currentThreadId) return;

    setMessages(messages);
    setCanSendMessage(restoreResult.success);
    setIsLoadingMessages(false);
  });

  activeThreadIdRef.current = currentThreadId;
  activeSessionIdRef.current = currentThread?.session_id || null;
}, [currentThreadId, currentThread?.session_id]);
```

**Key refs (avoid stale closures):**

```typescript
const socketRef = useRef<Socket | null>(null);
const activeThreadIdRef = useRef<string | null>(null);
const activeSessionIdRef = useRef<string | null>(null);
```

**Message sending with thread context:**

```typescript
function sendMessage(prompt: string) {
  socketRef.current?.emit('message', {
    prompt,
    threadId: activeThreadIdRef.current,
    options: { resume: activeSessionIdRef.current }
  });
}
```

### ThreadContext.tsx

**Add pending switch state for confirmation:**

```typescript
const [pendingThreadSwitch, setPendingThreadSwitch] = useState<{
  targetThreadId: string;
  targetThread: Thread;
} | null>(null);

function requestThreadSwitch(threadId: string) {
  const targetThread = threads.find(t => t.id === threadId);

  if (isStreaming || isProcessing) {
    setPendingThreadSwitch({ targetThreadId: threadId, targetThread });
  } else {
    executeThreadSwitch(threadId);
  }
}

function cancelPendingSwitch() {
  setPendingThreadSwitch(null);
}

function confirmPendingSwitch() {
  if (pendingThreadSwitch) {
    executeThreadSwitch(pendingThreadSwitch.targetThreadId);
    setPendingThreadSwitch(null);
  }
}
```

### Container (agent-sdk.ts)

**Track connection state:**

```typescript
const userConnectionState = new Map<string, {
  isConnected: boolean;
  pendingResponse: boolean;
  disconnectTime: number | null;
}>();

const agentInterruptFlag = new Map<string, boolean>();
```

**Handle interrupt event:**

```typescript
socket.on('interrupt', async ({ threadId, reason }) => {
  agentInterruptFlag.set(socket.userId, true);

  await waitForResponseComplete(socket.userId);

  const success = await cleanupBeforeClose(
    socket.userId,
    threadId,
    activeSessionId
  );

  socket.emit('interrupt_complete', { threadId, success, sessionId: activeSessionId });

  agentInterruptFlag.delete(socket.userId);
});
```

**Disconnect handling:**

```typescript
socket.on('disconnect', async () => {
  const state = userConnectionState.get(userId);
  state.isConnected = false;
  state.disconnectTime = Date.now();

  if (state.pendingResponse) {
    agentInterruptFlag.set(userId, true);
  }

  if (gracePeriodTimer) clearTimeout(gracePeriodTimer);

  gracePeriodTimer = setTimeout(async () => {
    if (!state.isConnected) {
      await cleanupBeforeClose(userId, threadId, sessionId);
      closeContainer(userId);
    }
  }, GRACE_PERIOD_MS);
});
```

**Cleanup sequence (MUST complete before close):**

```typescript
async function cleanupBeforeClose(userId: string, threadId: string, sessionId: string) {
  const errors: Error[] = [];

  // 1. Flush pending messages to D1
  const pendingMessages = getPendingMessages(userId);
  for (const msg of pendingMessages) {
    try {
      await saveMessageToD1(msg);
    } catch (err) {
      errors.push(err);
    }
  }

  // 2. Sync transcript to R2
  try {
    await syncTranscriptToR2(userId, sessionId);
  } catch (err) {
    errors.push(err);
  }

  // 3. Update thread timestamp
  try {
    await updateThreadTimestamp(threadId);
  } catch (err) {
    errors.push(err);
  }

  // 4. Retry failures
  if (errors.length > 0) {
    await retryFailedWrites(errors);
  }

  return errors.length === 0;
}
```

**Message buffer for reliable persistence:**

```typescript
interface PendingMessage {
  threadId: string;
  role: 'user' | 'assistant' | 'hook';
  content: string;
  hookEvent?: any;
  savedToD1: boolean;
}

const messageBuffer = new Map<string, PendingMessage[]>();

function bufferMessage(userId: string, msg: Omit<PendingMessage, 'savedToD1'>) {
  const buffer = messageBuffer.get(userId) || [];
  buffer.push({ ...msg, savedToD1: false });
  messageBuffer.set(userId, buffer);
}

function getPendingMessages(userId: string): PendingMessage[] {
  return (messageBuffer.get(userId) || []).filter(m => !m.savedToD1);
}
```

### New Component: ConfirmThreadSwitch.tsx

```typescript
interface Props {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  targetThreadTitle: string;
}

function ConfirmThreadSwitch({ isOpen, onCancel, onConfirm, targetThreadTitle }: Props) {
  return (
    <Dialog open={isOpen} onClose={onCancel}>
      <DialogTitle>Switch Conversation?</DialogTitle>
      <DialogContent>
        <p>The current conversation will be interrupted and saved.</p>
        <p>Switch to "{targetThreadTitle}"?</p>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Stay Here</Button>
        <Button onClick={onConfirm} variant="primary">Switch</Button>
      </DialogActions>
    </Dialog>
  );
}
```

## Socket Events

### Frontend → Container

| Event | Payload | Purpose |
|-------|---------|---------|
| `message` | `{ prompt, threadId, options: { resume? } }` | Send user message |
| `interrupt` | `{ threadId, reason }` | Request conversation interrupt |

### Container → Frontend

| Event | Payload | Purpose |
|-------|---------|---------|
| `message` | `{ role, content, threadId }` | Assistant message |
| `stream` | `{ chunk, threadId }` | Streaming chunk |
| `session_init` | `{ sessionId, threadId }` | New SDK session created |
| `interrupt_complete` | `{ threadId, success, sessionId }` | Interrupt finished |

## Critical Edge Cases

### 1. Stale Closures in Event Handlers

**Problem:** Socket handlers capture thread state at creation time.

**Solution:** Use refs that handlers read at execution time.

### 2. Cross-Thread Message Pollution

**Problem:** Thread switch during streaming causes chunks to appear in wrong thread.

**Solution:** All messages tagged with `threadId`. Frontend filters by active thread. All messages still saved to correct thread in D1.

### 3. Session ID Stored to Wrong Thread

**Problem:** Rapid thread switching while session_id response in flight.

**Solution:** Container echoes `threadId` with session_init event.

### 4. Resume Without Transcript

**Problem:** Message sent with `resume: sessionId` before R2 transcript loaded.

**Solution:** Call restore endpoint when switching to thread with session_id. Verify restore before enabling message input.

### 5. Storage Sync on Crash

**Problem:** Container crashes before R2 sync.

**Solution:** Message buffer tracks `savedToD1` flag. Cleanup retries failed writes. Grace period ensures time for sync.

## Thread Switch Flow

```
┌─────────────────────────────────────────────────────────────┐
│  1. User clicks Thread B                                    │
│  2. Frontend detects Thread A is streaming                  │
│  3. Show confirmation dialog                                │
│  4. User clicks "Switch"                                    │
├─────────────────────────────────────────────────────────────┤
│  5. Emit 'interrupt' to container                           │
│  6. Container sets interrupt flag                           │
│  7. Agent finishes current response                         │
│  8. Container saves to D1 (messages) and R2 (transcript)    │
│  9. Container emits 'interrupt_complete'                    │
├─────────────────────────────────────────────────────────────┤
│  10. Frontend clears UI                                     │
│  11. Frontend loads Thread B messages from D1               │
│  12. Frontend calls restore for Thread B transcript         │
│  13. Container loads Thread B transcript from R2            │
│  14. Frontend enables input                                 │
│  15. User sends message with resume: Thread B session_id    │
│  16. Agent continues Thread B conversation                  │
└─────────────────────────────────────────────────────────────┘
```

## Container Shutdown Sequence

```
User Disconnects
      │
      ▼
Agent finishes current response (hard stop after current)
      │
      ▼
┌─────────────────────────────────────────┐
│  SYNC PHASE (must complete before close) │
├─────────────────────────────────────────┤
│  1. Save unsaved messages to D1         │
│  2. Sync transcript to R2               │
│  3. Update thread metadata              │
│  4. Verify writes succeeded             │
└─────────────────────────────────────────┘
      │
      ▼
Grace period expires + user still disconnected?
      │
      ▼
Container closes (safe - state persisted)
```

## Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/contexts/AgentContext.tsx` | Split socket/thread effects, add refs, tag messages with threadId |
| `frontend/src/contexts/ThreadContext.tsx` | Add pending switch state, confirmation flow |
| `frontend/src/components/ConfirmThreadSwitch.tsx` | New component for switch confirmation |
| `frontend/src/components/ThreadListSidebar.tsx` | Use `requestThreadSwitch` instead of direct switch |
| `container/agent-sdk.ts` | Add interrupt handler, connection state, cleanup sequence, message buffer |
| `server.ts` | Ensure restore/sync endpoints handle new flow |

## Testing Checklist

- [ ] Switch threads while idle - no confirmation, immediate switch
- [ ] Switch threads while streaming - shows confirmation dialog
- [ ] Cancel switch - stays on current thread, streaming continues
- [ ] Confirm switch - interrupts, saves state, loads new thread
- [ ] Disconnect during streaming - agent completes response, saves state
- [ ] Reconnect after disconnect - can resume any thread
- [ ] Rapid thread switching - no cross-thread message pollution
- [ ] New thread (no session_id) - creates fresh SDK session
- [ ] Existing thread (has session_id) - resumes with full context
- [ ] Container shutdown - D1 and R2 in sync
