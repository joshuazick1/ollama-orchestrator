import {
  createContext,
  useContext,
  useCallback,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { streamPullModelToServer, streamCopyModelToServer, type PullProgressEvent } from '../api';

/** Represents the state of a single pull/copy operation */
export interface PullOperation {
  id: string;
  serverId: string;
  serverUrl: string;
  model: string;
  type: 'pull' | 'copy';
  status: 'downloading' | 'complete' | 'error';
  /** Human-readable status from Ollama (e.g., "pulling manifest", "downloading sha256:abc...") */
  statusText: string;
  /** Current digest being downloaded */
  digest?: string;
  /** Total bytes for current layer */
  total?: number;
  /** Completed bytes for current layer */
  completed?: number;
  /** Overall percentage (0-100) */
  percentage: number;
  /** Error message if status is 'error' */
  error?: string;
  /** Timestamp when the pull started */
  startedAt: number;
  /** Timestamp when the pull completed or errored */
  finishedAt?: number;
}

interface PullStore {
  operations: Map<string, PullOperation>;
  // Cache the array version of operations to return stable reference in getSnapshot
  operationsList: PullOperation[];
  abortControllers: Map<string, AbortController>;
  listeners: Set<() => void>;
}

function createPullStore(): PullStore {
  return {
    operations: new Map(),
    operationsList: [],
    abortControllers: new Map(),
    listeners: new Set(),
  };
}

function updateOperationsList(store: PullStore) {
  store.operationsList = Array.from(store.operations.values());
}

function emitChange(store: PullStore): void {
  for (const listener of store.listeners) {
    listener();
  }
}

function makePullId(serverId: string, model: string): string {
  return `${serverId}::${model}`;
}

interface ModelPullsContextValue {
  store: PullStore;
  startPull: (serverId: string, serverUrl: string, model: string, sourceServerId?: string) => void;
  cancelPull: (serverId: string, model: string) => void;
  dismissPull: (serverId: string, model: string) => void;
}

const ModelPullsContext = createContext<ModelPullsContextValue | null>(null);

export function ModelPullsProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<PullStore>(createPullStore());
  const store = storeRef.current;

  const startPull = useCallback(
    (serverId: string, serverUrl: string, model: string, sourceServerId?: string) => {
      const id = makePullId(serverId, model);

      // If already in progress, don't start another
      const existing = store.operations.get(id);
      if (existing && existing.status === 'downloading') return;

      const operation: PullOperation = {
        id,
        serverId,
        serverUrl,
        model,
        type: sourceServerId ? 'copy' : 'pull',
        status: 'downloading',
        statusText: 'Starting...',
        percentage: 0,
        startedAt: Date.now(),
      };
      store.operations.set(id, operation);
      updateOperationsList(store);
      emitChange(store);

      const onProgress = (event: PullProgressEvent) => {
        const op = store.operations.get(id);
        if (!op) return;

        if (event.type === 'progress') {
          let percentage = 0;
          if (event.total && event.total > 0 && event.completed !== undefined) {
            percentage = Math.round((event.completed / event.total) * 100);
          }

          store.operations.set(id, {
            ...op,
            statusText: event.status || op.statusText,
            digest: event.digest || op.digest,
            total: event.total ?? op.total,
            completed: event.completed ?? op.completed,
            percentage: percentage || op.percentage,
          });
          updateOperationsList(store);
          emitChange(store);
        } else if (event.type === 'complete') {
          store.operations.set(id, {
            ...op,
            status: 'complete',
            statusText: 'Complete',
            percentage: 100,
            finishedAt: Date.now(),
          });
          store.abortControllers.delete(id);
          updateOperationsList(store);
          emitChange(store);
        } else if (event.type === 'error') {
          store.operations.set(id, {
            ...op,
            status: 'error',
            statusText: 'Failed',
            error: event.error || 'Unknown error',
            finishedAt: Date.now(),
          });
          store.abortControllers.delete(id);
          updateOperationsList(store);
          emitChange(store);
        }
      };

      const onError = (error: Error) => {
        const op = store.operations.get(id);
        if (!op) return;
        store.operations.set(id, {
          ...op,
          status: 'error',
          statusText: 'Failed',
          error: error.message,
          finishedAt: Date.now(),
        });
        store.abortControllers.delete(id);
        updateOperationsList(store);
        emitChange(store);
      };

      let abortController: AbortController;
      if (sourceServerId) {
        abortController = streamCopyModelToServer(
          serverId,
          model,
          sourceServerId,
          onProgress,
          onError
        );
      } else {
        abortController = streamPullModelToServer(serverId, model, onProgress, onError);
      }

      store.abortControllers.set(id, abortController);
    },
    [store]
  );

  const cancelPull = useCallback(
    (serverId: string, model: string) => {
      const id = makePullId(serverId, model);
      const controller = store.abortControllers.get(id);
      if (controller) {
        controller.abort();
        store.abortControllers.delete(id);
      }
      const op = store.operations.get(id);
      if (op && op.status === 'downloading') {
        store.operations.set(id, {
          ...op,
          status: 'error',
          statusText: 'Cancelled',
          error: 'Pull was cancelled',
          finishedAt: Date.now(),
        });
        updateOperationsList(store);
        emitChange(store);
      }
    },
    [store]
  );

  const dismissPull = useCallback(
    (serverId: string, model: string) => {
      const id = makePullId(serverId, model);
      store.operations.delete(id);
      updateOperationsList(store);
      emitChange(store);
    },
    [store]
  );

  return (
    <ModelPullsContext.Provider value={{ store, startPull, cancelPull, dismissPull }}>
      {children}
    </ModelPullsContext.Provider>
  );
}

/**
 * Hook to access model pull operations.
 * Returns all pull operations and functions to start/cancel/dismiss them.
 * The operations list re-renders efficiently via useSyncExternalStore.
 */
export function useModelPulls() {
  const ctx = useContext(ModelPullsContext);
  if (!ctx) {
    throw new Error('useModelPulls must be used within a ModelPullsProvider');
  }

  const { store, startPull, cancelPull, dismissPull } = ctx;

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      store.listeners.add(onStoreChange);
      return () => {
        store.listeners.delete(onStoreChange);
      };
    },
    [store]
  );

  const getSnapshot = useCallback(() => {
    return store.operationsList;
  }, [store]);

  const operations = useSyncExternalStore(subscribe, getSnapshot);

  const getServerPulls = useCallback(
    (serverId: string) => operations.filter(op => op.serverId === serverId),
    [operations]
  );

  const isServerPulling = useCallback(
    (serverId: string) =>
      operations.some(op => op.serverId === serverId && op.status === 'downloading'),
    [operations]
  );

  const activePullCount = operations.filter(op => op.status === 'downloading').length;

  return {
    operations,
    activePullCount,
    startPull,
    cancelPull,
    dismissPull,
    getServerPulls,
    isServerPulling,
  };
}
