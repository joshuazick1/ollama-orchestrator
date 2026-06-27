import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEmbeddings } from '../useEmbeddings';

describe('useEmbeddings', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as typeof fetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return embeddings on successful request', async () => {
    const mockEmbedding = [0.1, 0.2, 0.3, 0.4];
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        embeddings: [mockEmbedding],
      }),
    });

    const { result } = renderHook(() => useEmbeddings('ollama', 'nomic-embed-text'));

    await act(async () => {
      await result.current.embed('Hello world');
    });

    await waitFor(() => {
      expect(result.current.embeddings).toEqual([mockEmbedding]);
      expect(result.current.error).toBeNull();
    });
  });

  it('should set loading state while embedding', async () => {
    let resolveJson: (value: unknown) => void;
    const jsonPromise = new Promise<unknown>(resolve => {
      resolveJson = resolve;
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockImplementation(() => jsonPromise),
    });

    const { result } = renderHook(() => useEmbeddings('ollama', 'nomic-embed-text'));

    expect(result.current.isLoading).toBe(false);

    act(() => {
      result.current.embed('Hello');
    });

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolveJson!({ embeddings: [[0.1, 0.2]] });
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('should handle error when fetch fails', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: vi.fn().mockResolvedValue({ error: 'Server error' }),
    });

    const { result } = renderHook(() => useEmbeddings('ollama', 'nomic-embed-text'));

    await act(async () => {
      await result.current.embed('Hello');
    });

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
      expect(result.current.embeddings).toEqual([]);
    });
  });
});
