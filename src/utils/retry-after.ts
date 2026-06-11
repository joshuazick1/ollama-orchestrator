/**
 * retry-after.ts
 * Parses the Retry-After header per RFC 7231 Section 7.1.3
 * Supports delta-seconds and HTTP-date formats
 */

import { logger } from './logger.js';

/**
 * Regular expression to match HTTP-date format (RFC 7231)
 * Example: "Sat, 01 Jan 2026 00:00:00 GMT"
 */
const HTTP_DATE_PATTERN =
  /^[A-Za-z]{3},?\s+\d{2}\s+[A-Za-z]{3}\s+\d{4}\s+\d{2}:\d{2}:\d{2}\s+GMT$/;

const HTTP_DATE_NO_DAY_PATTERN =
  /^\d{2}\s+[A-Za-z]{3}\s+\d{4}\s+\d{2}:\d{2}:\d{2}\s+GMT$/;

function isHttpDate(dateStr: string): boolean {
  return HTTP_DATE_PATTERN.test(dateStr) || HTTP_DATE_NO_DAY_PATTERN.test(dateStr);
}

/**
 * Parse HTTP-date string to milliseconds since epoch
 * Returns null if parsing fails
 */
function parseHttpDate(dateStr: string): number | null {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      logger.debug('[parseRetryAfter] Failed to parse HTTP-date', { dateStr });
      return null;
    }
    return date.getTime();
  } catch (err) {
    logger.debug('[parseRetryAfter] Exception parsing HTTP-date', { dateStr, error: err });
    return null;
  }
}

/**
 * Parse delta-seconds (integer) to milliseconds
 * Returns null if the value is not a valid positive integer
 */
function _parseDeltaSeconds(deltaStr: string): number | null {
  const trimmed = deltaStr.trim();
  const seconds = parseInt(trimmed, 10);

  // Must be a valid positive integer
  if (isNaN(seconds) || seconds < 0 || !Number.isInteger(seconds)) {
    logger.debug('[parseRetryAfter] Invalid delta-seconds value', { deltaStr });
    return null;
  }

  return seconds * 1000;
}

/**
 * Parse the Retry-After header value to milliseconds
 *
 * Supports two formats per RFC 7231 Section 7.1.3:
 * - delta-seconds: e.g., "120" means wait 120 seconds
 * - HTTP-date: e.g., "Sat, 01 Jan 2026 00:00:00 GMT" - absolute timestamp
 *
 * @param header - The Retry-After header value (may be undefined)
 * @returns Milliseconds to wait, or null if header is missing or invalid
 */
export function parseRetryAfter(header: string | undefined): number | null {
  if (!header) {
    return null;
  }

  const trimmed = header.trim();

  if (!trimmed) {
    return null;
  }

  // Delta-seconds: plain number
  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    if (!isNaN(seconds) && seconds >= 0 && Number.isInteger(seconds)) {
      return seconds * 1000;
    }
    return null;
  }

  // HTTP-date format
  if (isHttpDate(trimmed)) {
    const httpDateMs = parseHttpDate(trimmed);
    if (httpDateMs !== null) {
      const nowMs = Date.now();
      const deltaMs = httpDateMs - nowMs;

      if (deltaMs < 0) {
        return 0;
      }
      if (deltaMs > 24 * 60 * 60 * 1000) {
        logger.warn('[parseRetryAfter] HTTP-date too far in future, capping to 24h', {
          dateStr: trimmed,
          deltaMs,
        });
        return 24 * 60 * 60 * 1000;
      }
      return deltaMs;
    }
  }

  logger.debug('[parseRetryAfter] Unrecognized Retry-After format', { header: trimmed });
  return null;
}
