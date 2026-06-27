// Security utilities for frontend

/**
 * Safely encode a URL parameter to prevent injection attacks
 */
export function encodeUrlParam(param: string): string {
  return encodeURIComponent(param);
}

/**
 * Safely decode a URL parameter
 */
export function decodeUrlParam(param: string): string {
  try {
    return decodeURIComponent(param);
  } catch {
    // If decoding fails, return the original (it might already be decoded)
    return param;
  }
}

/**
 * Sanitize a string for safe display (basic XSS prevention)
 * Note: React already escapes content, but this provides extra safety
 */
export function sanitizeDisplayText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Validate if a string is a safe URL
 */
export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Safely construct a URL with query parameters
 */
export function buildUrl(
  baseUrl: string,
  params: Record<string, string | number | boolean>
): string {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

/**
 * Extract domain from URL safely
 */
export function getDomainFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return null;
  }
}
