/**
 * failure-classifier-negative.ts
 * Pure function for classifying "negative" HTTP responses into capability gap categories.
 * Used to detect when an upstream server returns an error response that indicates
 * a capability gap (model not found, endpoint absent, mid-stream error, etc.)
 * rather than a transient or auth failure.
 */

export type NegativeFailureKind =
  | 'capability_gap'
  | 'suspicious'
  | 'rate_limited'
  | 'transient'
  | 'permanent';

export type NegativeClassification = {
  kind: NegativeFailureKind;
  retryable: boolean;
  reason: string;
  retryAfterMs?: number;
};

/**
 * Try to parse JSON body safely, returning undefined if not valid JSON.
 */
function tryParseJson(body: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Check if body contains an error indicator.
 * Handles both { error: "..." } and { error: { message: "..." } } patterns.
 */
function hasErrorInBody(body: string): boolean {
  const parsed = tryParseJson(body);
  if (!parsed) {
    return false;
  }

  if ('error' in parsed) {
    const error = parsed.error;
    if (typeof error === 'string' && error.length > 0) {
      return true;
    }
    if (typeof error === 'object' && error !== null) {
      return true;
    }
  }
  return false;
}

/**
 * Check if body looks like HTML content.
 * Detects: starts with '<', or contains "page not found" (case-insensitive).
 */
function looksLikeHtml(body: string, contentType: string): boolean {
  const trimmedBody = body.trim();
  if (trimmedBody.startsWith('<')) {
    return true;
  }
  if (trimmedBody.toLowerCase().includes('page not found')) {
    return true;
  }
  if (contentType.includes('text/html')) {
    return true;
  }
  return false;
}

/**
 * Check if body indicates a model-related not found error.
 * Applies when status is 404 and contentType is JSON.
 */
function hasModelNotFoundInBody(body: string): boolean {
  const lowerBody = body.toLowerCase();
  return lowerBody.includes('not found') || lowerBody.includes('model');
}

/**
 * Check if body is a valid successful response (no error).
 * A response is considered valid if it's parsed JSON without an error key.
 * Empty body is treated as a valid "empty" response.
 */
function isValidResponse(body: string): boolean {
  if (body.trim() === '') {
    return true;
  }
  const parsed = tryParseJson(body);
  if (!parsed) {
    return false;
  }
  return !('error' in parsed);
}

/**
 * Classify a "negative" HTTP response from an upstream Ollama server.
 *
 * This function is specifically designed to detect capability gaps:
 * - The server responded (not a network error)
 * - But the response indicates the server can't fulfill the request
 *   (model not found, endpoint doesn't exist, mid-stream error, etc.)
 *
 * Rules (in priority order):
 * 1. HTTP 429 → rate_limited (retryable)
 * 2. HTTP 503 → transient (retryable, fixed 5000ms)
 * 3. HTTP 200 with error body → capability_gap (mid_stream_error)
 * 4. HTTP 404 with HTML → capability_gap (endpoint_absent)
 * 5. HTTP 404 with JSON + model/not found → capability_gap (model_not_found)
 * 6. HTTP 200 with valid response → suspicious (no_validation)
 * 7. Default → transient (unknown)
 *
 * @param input - The negative result input containing status, body, and contentType
 * @returns Classification result with kind, retryable flag, and reason string
 */
export function classifyNegativeResult(input: {
  status: number;
  body: string;
  contentType: string;
}): NegativeClassification {
  const { status, body, contentType } = input;

  // Rule 1: HTTP 429 (Rate Limited)
  if (status === 429) {
    return {
      kind: 'rate_limited',
      retryable: true,
      reason: 'rate_limit',
    };
  }

  // Rule 2: HTTP 503 (Service Unavailable)
  if (status === 503) {
    return {
      kind: 'transient',
      retryable: true,
      reason: 'unavailable',
      retryAfterMs: 5000,
    };
  }

  // Rule 3: HTTP 200 with error body (mid-stream error)
  if (status === 200 && hasErrorInBody(body)) {
    return {
      kind: 'capability_gap',
      retryable: false,
      reason: 'mid_stream_error',
    };
  }

  // Rule 3b: HTTP 200 with malformed or non-JSON body (suspicious)
  // Server returned 200 but body is not valid JSON - suspicious (no_validation)
  if (status === 200 && body.trim() !== '' && !tryParseJson(body)) {
    return {
      kind: 'suspicious',
      retryable: false,
      reason: 'no_validation',
    };
  }

  // Rule 4: HTTP 404 with HTML content (endpoint absent)
  if (status === 404 && looksLikeHtml(body, contentType)) {
    return {
      kind: 'capability_gap',
      retryable: false,
      reason: 'endpoint_absent',
    };
  }

  // Rule 5: HTTP 404 with JSON indicating model not found
  if (status === 404 && contentType.includes('application/json') && hasModelNotFoundInBody(body)) {
    return {
      kind: 'capability_gap',
      retryable: false,
      reason: 'model_not_found',
    };
  }

  // Rule 5b: HTTP 404 (any content) - capability gap (endpoint absent)
  // 404 always indicates resource not found, so it's a capability gap
  if (status === 404) {
    return {
      kind: 'capability_gap',
      retryable: false,
      reason: 'endpoint_absent',
    };
  }

  // Rule 6: HTTP 200 with valid response (no error) - suspicious
  if (status === 200 && isValidResponse(body)) {
    return {
      kind: 'suspicious',
      retryable: false,
      reason: 'no_validation',
    };
  }

  // Rule 7: Default - transient unknown
  return {
    kind: 'transient',
    retryable: true,
    reason: 'unknown',
  };
}
