/**
 * @fileoverview Container log forwarding service.
 *
 * This service polls container logs and outputs them to the Cloudflare Worker's
 * console, making them visible in wrangler output during development.
 *
 * @module services/log-forwarder
 */

import type { Sandbox } from "@cloudflare/sandbox";

/**
 * Tracks active log polling sessions to prevent duplicates.
 */
const activePollers = new Map<string, {
  intervalId: ReturnType<typeof setInterval> | null;
  lastLogLength: number;
  startedAt: number;
}>();

/**
 * Maximum time to poll logs (5 minutes) before auto-stopping.
 */
const MAX_POLL_DURATION_MS = 5 * 60 * 1000;

/**
 * Interval between log polls (2 seconds).
 */
const POLL_INTERVAL_MS = 2000;

/**
 * Starts polling container logs and forwarding them to wrangler console.
 *
 * This creates a background polling loop that:
 * 1. Fetches logs from the container every 2 seconds
 * 2. Outputs only NEW log lines (since last poll)
 * 3. Auto-stops after 5 minutes to prevent resource leaks
 *
 * @param sandbox - The sandbox instance to poll logs from
 * @param sessionId - Session identifier for tracking
 */
export function startLogForwarding(sandbox: Sandbox, sessionId: string): void {
  // Check if already polling for this session
  if (activePollers.has(sessionId)) {
    const existing = activePollers.get(sessionId)!;
    // Reset the timer if it's been running for a while
    if (Date.now() - existing.startedAt > MAX_POLL_DURATION_MS / 2) {
      stopLogForwarding(sessionId);
    } else {
      return; // Already polling, don't start another
    }
  }

  console.log(`[LogForwarder] Starting log polling for session ${sessionId}`);

  const state = {
    intervalId: null as ReturnType<typeof setInterval> | null,
    lastLogLength: 0,
    startedAt: Date.now(),
  };

  activePollers.set(sessionId, state);

  // Poll function
  const pollLogs = async () => {
    try {
      // Check if we've exceeded max duration
      if (Date.now() - state.startedAt > MAX_POLL_DURATION_MS) {
        console.log(`[LogForwarder] Max duration reached for ${sessionId}, stopping`);
        stopLogForwarding(sessionId);
        return;
      }

      // Fetch logs from container
      const logs = await sandbox.getProcessLogs("agent-sdk");
      const logText = typeof logs === 'string' ? logs : JSON.stringify(logs);

      // Only output new lines
      if (logText.length > state.lastLogLength) {
        const newContent = logText.substring(state.lastLogLength);

        // Split into lines and output each with prefix
        const lines = newContent.split('\n').filter(line => line.trim());
        for (const line of lines) {
          // Parse JSON log entries if possible
          try {
            const entry = JSON.parse(line);
            const level = entry.level || 'INFO';
            const event = entry.event || entry.message || '';
            const socketId = entry.socketId ? `[${entry.socketId.substring(0, 8)}]` : '';

            // Color-code by level (ANSI codes work in wrangler)
            const levelColor = level === 'ERROR' ? '\x1b[31m' :
                               level === 'WARN' ? '\x1b[33m' :
                               level === 'DEBUG' ? '\x1b[36m' : '\x1b[32m';
            const reset = '\x1b[0m';

            console.log(`${levelColor}[CONTAINER ${level}]${reset} ${socketId} ${event}`, entry.data || '');
          } catch {
            // Not JSON, output raw line
            if (line.startsWith('[HOOK') || line.startsWith('[SDK')) {
              // These are our debug console.log statements
              console.log(`\x1b[35m[CONTAINER]\x1b[0m ${line}`);
            }
          }
        }

        state.lastLogLength = logText.length;
      }
    } catch (error: any) {
      // Log fetch failed - agent might have crashed
      if (!error.message?.includes('not found')) {
        console.error(`[LogForwarder] Error fetching logs for ${sessionId}:`, error.message);
      }
    }
  };

  // Start polling
  state.intervalId = setInterval(pollLogs, POLL_INTERVAL_MS);

  // Do an immediate poll
  pollLogs();
}

/**
 * Stops log polling for a session.
 *
 * @param sessionId - Session identifier
 */
export function stopLogForwarding(sessionId: string): void {
  const state = activePollers.get(sessionId);
  if (state?.intervalId) {
    clearInterval(state.intervalId);
    console.log(`[LogForwarder] Stopped log polling for session ${sessionId}`);
  }
  activePollers.delete(sessionId);
}

/**
 * Checks if log forwarding is active for a session.
 *
 * @param sessionId - Session identifier
 * @returns True if actively polling
 */
export function isLogForwardingActive(sessionId: string): boolean {
  return activePollers.has(sessionId);
}

/**
 * Gets the number of active log polling sessions.
 */
export function getActivePollerCount(): number {
  return activePollers.size;
}
