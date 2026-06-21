import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useChatStream } from '../useChatStream';

describe('useChatStream', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as typeof fetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should set isStreaming to true when sending message', async () => {
    let resolveRead: (value: { done: boolean; value?: Uint8Array }) => void;
    const readPromise = new Promise<{ done: boolean; value?: Uint8Array }>(resolve => {
      resolveRead = resolve;
    });

    mockFetch.mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: vi.fn().mockReturnValue(readPromise),
        }),
      },
    });

    const { result } = renderHook(() => useChatStream('ollama', 'llama2'));

    const messages = [{ role: 'user' as const, content: 'Hi' }];

    act(() => {
      result.current.sendMessage(messages);
    });

    expect(result.current.isStreaming).toBe(true);

    await act(async () => {
      resolveRead!({
        done: true,
        value: new TextEncoder().encode(JSON.stringify({ done: true }) + '\n'),
      });
    });
  });

  it('should handle error when fetch fails', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: vi.fn().mockResolvedValue({ error: 'Server error' }),
    });

    const { result } = renderHook(() => useChatStream('ollama', 'llama2'));

    const messages = [{ role: 'user' as const, content: 'Hi' }];

    await act(async () => {
      await result.current.sendMessage(messages);
    });

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });
  });

  it('should set error when no model is selected', async () => {
    const { result } = renderHook(() => useChatStream('ollama', ''));

    const messages = [{ role: 'user' as const, content: 'Hi' }];

    await act(async () => {
      await result.current.sendMessage(messages);
    });

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
      expect(result.current.error?.message).toBe('No model selected');
    });
  });

  it('should call stop to abort request', async () => {
    const readPromise = new Promise<{ done: boolean; value?: Uint8Array }>(() => {});

    mockFetch.mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: vi.fn().mockReturnValue(readPromise),
        }),
      },
    });

    const { result } = renderHook(() => useChatStream('ollama', 'llama2'));

    const messages = [{ role: 'user' as const, content: 'Hi' }];

    act(() => {
      result.current.sendMessage(messages);
    });

    expect(result.current.isStreaming).toBe(true);

    act(() => {
      result.current.stop();
    });

    expect(result.current.isStreaming).toBe(false);
  });
});
