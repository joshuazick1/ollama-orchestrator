/**
 * urlUtils.ts
 * URL normalization and comparison utilities
 */

/**
 * Normalize a server URL to ensure consistent format:
 * - Removes trailing slashes
 * - Decodes URL-encoded characters
 * - Ensures proper URL format
 *
 * @param url - The URL to normalize
 * @returns Normalized URL string
 */
export function normalizeServerUrl(url: string): string {
  // First decode any URL-encoded characters (handles double-encoding issues)
  let normalized = url;
  try {
    // Keep decoding until no more changes (handles multiple levels of encoding)
    let decoded = decodeURIComponent(normalized);
    while (decoded !== normalized) {
      normalized = decoded;
      decoded = decodeURIComponent(normalized);
    }
  } catch {
    // If decoding fails, the URL wasn't encoded - use as is
  }

  // Remove trailing slashes
  normalized = normalized.replace(/\/+$/, '');

  return normalized;
}

/**
 * Compare two URLs for equality after normalization
 *
 * @param url1 - First URL
 * @param url2 - Second URL
 * @returns true if URLs are equivalent
 */
export function areUrlsEquivalent(url1: string, url2: string): boolean {
  return normalizeServerUrl(url1) === normalizeServerUrl(url2);
}
