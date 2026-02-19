/**
 * fetchWithTimeout.ts
 * Wrapper around fetch with configurable timeout support
 */

import { logger } from './logger.js';

export interface FetchWithTimeoutOptions extends RequestInit {
  timeout?: number;
}

export interface FetchWithActivityTimeoutOptions extends RequestInit {
  /** Initial timeout for the connection (ms) */
  connectionTimeout?: number;
  /** Timeout between chunks during streaming - resets on each chunk (ms) */
  activityTimeout?: number;
}

export interface ActivityTimeoutController {
  /** AbortController for the fetch request */
  controller: AbortController;
  /** Call this when data is received to reset the activity timeout */
  resetTimeout: () => void;
  /** Call this when streaming is complete */
  clearTimeout: () => void;
}

/**
 * Fetch with timeout support
 * @param url - URL to fetch
 * @param options - Fetch options including optional timeout in milliseconds
 * @returns Promise<Response>
 * @throws Error if timeout exceeded or fetch fails
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const { timeout = 30000, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms: ${url}`);
      }
      throw new Error(`Fetch failed: ${error.message}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Create an activity timeout controller for streaming requests.
 * The timeout resets every time resetTimeout() is called (e.g., on each chunk received).
 * This allows long-running streams to continue as long as data is actively flowing.
 *
 * @param activityTimeout - Timeout between chunks in milliseconds
 * @param url - URL being fetched (for logging)
 * @returns ActivityTimeoutController with abort controller and reset/clear functions
 */
export function createActivityTimeoutController(
  activityTimeout: number,
  url?: string
): ActivityTimeoutController {
  const controller = new AbortController();
  let timeoutId: NodeJS.Timeout | null = null;
  let resetCount = 0;
  let lastResetTime = Date.now();

  const resetTimeout = (): void => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    resetCount++;
    lastResetTime = Date.now();

    timeoutId = setTimeout(() => {
      const timeSinceLastReset = Date.now() - lastResetTime;
      logger.warn('Activity timeout fired - no data received', {
        activityTimeout,
        timeSinceLastReset,
        resetCount,
        url: url ? new URL(url).pathname : undefined,
      });
      controller.abort();
    }, activityTimeout);
  };

  const clearTimeoutFn = (): void => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
      logger.debug('Activity timeout cleared', {
        resetCount,
        url: url ? new URL(url).pathname : undefined,
      });
    }
  };

  // Start the initial timeout
  resetTimeout();

  return {
    controller,
    resetTimeout,
    clearTimeout: clearTimeoutFn,
  };
}

/**
 * Fetch with activity-based timeout for streaming requests.
 * The connection timeout applies to the initial connection.
 * The activity timeout resets on each chunk received.
 *
 * @param url - URL to fetch
 * @param options - Fetch options including connection and activity timeouts
 * @returns Object containing the response and the activity timeout controller
 */
export async function fetchWithActivityTimeout(
  url: string,
  options: FetchWithActivityTimeoutOptions = {}
): Promise<{ response: Response; activityController: ActivityTimeoutController }> {
  const { connectionTimeout = 30000, activityTimeout = 60000, ...fetchOptions } = options;

  logger.debug('Starting fetch with activity timeout', {
    url: new URL(url).pathname,
    connectionTimeout,
    activityTimeout,
  });

  // Use a regular timeout for the initial connection
  const connectionController = new AbortController();
  const connectionTimeoutId = setTimeout(() => {
    logger.warn('Connection timeout fired', { connectionTimeout, url: new URL(url).pathname });
    connectionController.abort();
  }, connectionTimeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: connectionController.signal,
    });

    clearTimeout(connectionTimeoutId);

    logger.debug('Connection established, switching to activity timeout', {
      url: new URL(url).pathname,
      status: response.status,
      activityTimeout,
    });

    // Create activity timeout controller for streaming phase
    const activityController = createActivityTimeoutController(activityTimeout, url);

    return { response, activityController };
  } catch (error) {
    clearTimeout(connectionTimeoutId);
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`Connection timeout after ${connectionTimeout}ms: ${url}`);
      }
      throw new Error(`Fetch failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Create a fetch function with default timeout
 * @param defaultTimeout - Default timeout in milliseconds
 * @returns Configured fetch function
 */
export function createFetchWithTimeout(
  defaultTimeout: number
): (url: string, options?: FetchWithTimeoutOptions) => Promise<Response> {
  return (url: string, options?: FetchWithTimeoutOptions): Promise<Response> =>
    fetchWithTimeout(url, { ...options, timeout: options?.timeout ?? defaultTimeout });
}

/**
 * Parse and validate JSON response
 * @param response - Fetch Response object
 * @returns Parsed JSON or null on error
 */
export async function parseResponse<T = Record<string, unknown>>(
  response: Response
): Promise<T | null> {
  try {
    const data = await response.json();
    return data as T;
  } catch (error) {
    logger.debug('Failed to parse response JSON', { error });
    return null;
  }
}

/**
 * Parse JSON response and check for errors
 * @param response - Fetch Response object
 * @returns Tuple of [data, errorMessage] - one will be null
 */
export async function parseResponseWithError<T extends object = Record<string, unknown>>(
  response: Response
): Promise<[T | null, string | null]> {
  try {
    const data = (await response.json()) as T;
    if ('error' in data && typeof data.error === 'string') {
      return [null, data.error];
    }
    return [data, null];
  } catch {
    return [null, 'Failed to parse response'];
  }
}
