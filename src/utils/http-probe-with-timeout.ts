/**
 * http-probe-with-timeout.ts
 * Lightweight HTTP probe helper that wraps fetch with a hard timeout via
 * AbortController. Returns a discriminated result (not a thrown error) so
 * callers can distinguish timeouts from network failures without try/catch
 * boilerplate at every probe site.
 *
 * Designed for probe code paths (perf probes, capability probes, model
 * discovery). The helper never consumes the response body itself — callers
 * always receive the raw `Response` and decide how to read it (`.json()`,
 * `.text()`, or `body.getReader()` for streaming).
 *
 * For streaming callers (`stream: true`), the helper hands the timeout
 * cleanup back via `clearTimeout` so the caller can release the timer when
 * streaming completes; for non-streaming callers, the helper clears the
 * timer once the response headers are received.
 */

export interface HttpProbeOptions {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  /** Hard timeout in milliseconds. */
  timeoutMs: number;
  apiKey?: string;
  /**
   * If true, the pending timeout is NOT cleared by the helper. The caller
   * receives a `clearTimeout` callback in the result and is responsible
   * for invoking it once streaming finishes. Use this when the caller
   * needs to stream the response body (e.g. perf probes that capture
   * TTFT and chunk metrics inline).
   */
  stream?: boolean;
}

export interface HttpProbeResult {
  /** True when the upstream responded with status 2xx. */
  ok: boolean;
  /** HTTP status code, or 0 on timeout/network error. */
  status: number;
  /** True when the request was aborted because the timeout fired. */
  aborted: boolean;
  /** Response headers (always set on a successful fetch). */
  headers?: Headers;
  /**
   * Raw `Response`. Set on a successful fetch. The body has NOT been
   * consumed by the helper — caller is responsible for reading it.
   */
  response?: Response;
  /**
   * Releases the pending timeout. Set only when `stream: true`; otherwise
   * the helper clears the timeout itself before returning.
   */
  clearTimeout?: () => void;
}

/**
 * Execute an HTTP probe with a hard timeout. Distinguishes between
 * timeout (aborted: true), network error (aborted: false, ok: false),
 * and HTTP non-2xx (ok: false, aborted: false).
 */
export async function httpProbeWithTimeout(
  url: string,
  options: HttpProbeOptions
): Promise<HttpProbeResult> {
  const { method = 'GET', body, headers, timeoutMs, apiKey, stream = false } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const requestHeaders: Record<string, string> = { ...(headers ?? {}) };
  if (apiKey) {
    requestHeaders['Authorization'] = `Bearer ${apiKey}`;
  }
  if (body && !requestHeaders['Content-Type']) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body,
      signal: controller.signal,
    });

    if (stream) {
      return {
        ok: response.ok,
        status: response.status,
        aborted: false,
        headers: response.headers,
        response,
        clearTimeout: () => clearTimeout(timeoutId),
      };
    }

    clearTimeout(timeoutId);
    return {
      ok: response.ok,
      status: response.status,
      aborted: false,
      headers: response.headers,
      response,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, status: 0, aborted: true };
    }
    return { ok: false, status: 0, aborted: false };
  }
}
