/**
 * liveEventBus.ts — shared Server-Sent Events connection.
 *
 * Single module-level EventSource for /api/orchestrator/events, reference
 * counted across all subscribers. useServerEvents (app shell) and
 * useLiveUpdates (pages) consume it so the app opens exactly one SSE
 * connection instead of one per mounted hook. Status transitions are
 * synchronous — there is no queueMicrotask — so consumers read fresh state
 * immediately after subscribe.
 */

export type LiveStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export type LiveUpdateMessageType =
  | 'server_status'
  | 'model_status'
  | 'stats_update'
  | 'error'
  | 'unknown';

export interface LiveUpdateMessage {
  type: LiveUpdateMessageType;
  payload: Record<string, unknown>;
  timestamp: number;
}

interface LiveEventListener {
  onMessage?: (message: LiveUpdateMessage) => void;
  onStatus?: (status: LiveStatus) => void;
}

const EVENT_SOURCE_URL = '/api/orchestrator/events';

let eventSource: EventSource | null = null;
let status: LiveStatus = 'disconnected';
let lastMessage: LiveUpdateMessage | null = null;
let listenerCount = 0;
const listeners = new Set<LiveEventListener>();

function setStatus(next: LiveStatus): void {
  if (status === next) return;
  status = next;
  listeners.forEach(listener => listener.onStatus?.(next));
}

export function parseEvent(data: string): LiveUpdateMessage | null {
  try {
    const parsed = JSON.parse(data);
    let type: LiveUpdateMessageType = 'unknown';
    if (typeof parsed.type === 'string') {
      const t = parsed.type.toLowerCase();
      if (t === 'server_status' || t === 'server_status_change') {
        type = 'server_status';
      } else if (t === 'model_status' || t === 'model_status_change') {
        type = 'model_status';
      } else if (
        t === 'stats_update' ||
        t === 'metrics_update' ||
        t === 'stats' ||
        t === 'metrics'
      ) {
        type = 'stats_update';
      } else if (t === 'error') {
        type = 'error';
      }
    }
    return {
      type,
      payload: (parsed.payload ?? parsed) as Record<string, unknown>,
      timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now(),
    };
  } catch {
    // Silently ignore parse errors for unrecognized SSE events
    return null;
  }
}

function connect(): void {
  if (eventSource) return;
  const source = new EventSource(EVENT_SOURCE_URL);
  eventSource = source;
  setStatus('connecting');

  source.onopen = () => setStatus('connected');

  source.onmessage = event => {
    const message = parseEvent(event.data);
    if (!message) return;
    lastMessage = message;
    listeners.forEach(listener => listener.onMessage?.(message));
  };

  source.onerror = () => {
    setStatus('error');
    source.close();
    if (eventSource === source) {
      eventSource = null;
    }
  };
}

/**
 * Register a listener. The connection is opened when the first subscriber
 * arrives and closed when the last one unsubscribes. The listener's onStatus
 * is invoked immediately with the current bus status so consumer state is
 * fresh on mount.
 */
export function subscribeLiveEvents(listener: LiveEventListener): () => void {
  listenerCount += 1;
  connect();
  listeners.add(listener);
  listener.onStatus?.(status);

  return () => {
    listeners.delete(listener);
    listenerCount -= 1;
    if (listenerCount === 0 && eventSource) {
      eventSource.close();
      eventSource = null;
      setStatus('disconnected');
    }
  };
}

/** Snapshot of current bus state, safe for useState initializers. */
export function getLiveEventSnapshot(): {
  status: LiveStatus;
  lastMessage: LiveUpdateMessage | null;
} {
  return { status, lastMessage };
}

/**
 * Test-only: dispatch a message directly through all registered listeners.
 * Used by hook tests to simulate SSE events without a real EventSource.
 */
export function dispatchLiveEventForTests(message: LiveUpdateMessage): void {
  listeners.forEach(listener => listener.onMessage?.(message));
}

/**
 * Test-only: tear down module state so tests in one file are isolated.
 * Not used by application code.
 */
export function resetLiveEventBusForTests(): void {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  status = 'disconnected';
  lastMessage = null;
  listenerCount = 0;
  listeners.clear();
}