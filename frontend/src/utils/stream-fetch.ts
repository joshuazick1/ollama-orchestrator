export interface StreamFetchOptions<T> {
  url: string;
  method?: string;
  body?: unknown;
  onEvent: (data: T) => void;
  onError: (error: Error) => void;
  signal?: AbortSignal;
}

/**
 * Starts an SSE stream fetch and returns an AbortController that can cancel it.
 *
 * If a `signal` is provided in options it is chained with the internal controller,
 * so either source can cancel the request.
 */
export function streamFetch<T>(options: StreamFetchOptions<T>): AbortController {
  const { url, method = 'POST', body, onEvent, onError, signal: externalSignal } = options;

  const controller = new AbortController();

  // If an external signal is provided, abort our controller when it fires.
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => controller.abort());
    }
  }

  (async () => {
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        onError(
          new Error((data as { error?: string }).error || `Request failed: ${response.statusText}`)
        );
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onError(new Error('No response body'));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events (format: "data: {...}\n\n")
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const event of events) {
          const dataLine = event.trim();
          if (!dataLine.startsWith('data: ')) continue;
          const json = dataLine.slice(6);
          try {
            const parsed = JSON.parse(json) as T;
            onEvent(parsed);
          } catch {
            // Skip malformed events
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return; // Intentional cancellation
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return controller;
}
