/**
 * api-keys.ts
 * Helper utilities for API key resolution
 */

/**
 * Resolve API key from string (supports env:VARNAME format)
 */
export function resolveApiKey(apiKey?: string): string | undefined {
  if (!apiKey) {
    return undefined;
  }
  if (apiKey.startsWith('env:')) {
    const envVar = apiKey.substring(4);
    return process.env[envVar];
  }
  return apiKey;
}
