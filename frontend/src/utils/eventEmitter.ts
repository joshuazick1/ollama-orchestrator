export interface EventEmitter {
  on(event: string, callback: (data: unknown) => void): void;
  off(event: string, callback: (data: unknown) => void): void;
  emit(event: string, data: unknown): void;
  clear(): void;
}

export const createEventEmitter = (): EventEmitter => {
  const listeners: Map<string, Set<(data: unknown) => void>> = new Map();

  return {
    on(event: string, callback: (data: unknown) => void) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(callback);
    },
    off(event: string, callback: (data: unknown) => void) {
      listeners.get(event)?.delete(callback);
    },
    emit(event: string, data: unknown) {
      listeners.get(event)?.forEach(callback => callback(data));
    },
    clear() {
      listeners.clear();
    },
  };
};
