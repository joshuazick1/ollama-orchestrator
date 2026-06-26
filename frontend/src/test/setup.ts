import '@testing-library/jest-dom';
import { vi } from 'vitest';

// jsdom does not implement EventSource — provide a minimal stub for SSE
class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  url: string;
  readyState: number;
  onopen: ((event: MessageEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  dispatchEvent = vi.fn(() => true);
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    this.readyState = MockEventSource.CONNECTING;
    queueMicrotask(() => {
      this.readyState = MockEventSource.OPEN;
      if (this.onopen) this.onopen(new MessageEvent('open'));
    });
  }
}
(globalThis as unknown as { EventSource: typeof MockEventSource }).EventSource = MockEventSource;

// jsdom does not implement window.matchMedia — provide a minimal stub
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// jsdom does not implement Element.prototype.scrollIntoView — provide a minimal stub
Element.prototype.scrollIntoView = vi.fn();
