/**
 * Ollama Cloud quota parser.
 *
 * Extracts upstream user ID and quota type from Ollama Cloud 429 error messages.
 * Supported formats:
 * - Plain: "HTTP 429: you (amohsen2011) have reached your weekly usage limit, ..."
 * - Wrapped: "HTTP 429: 429 Too Many Requests: you (amohsen2011) have reached your weekly usage limit, ... (api_error)"
 */

export const OLLAMA_CLOUD_QUOTA_REGEX =
  /you\s+\((?<upstreamUserId>[^)]+)\)\s+have reached your\s+(?<quotaType>\w+)\s+usage limit/i;

export interface OllamaQuotaInfo {
  upstreamUserId: string;
  quotaType: string;
}

export function parseOllamaCloudQuota(message: string): OllamaQuotaInfo | null {
  if (!message) {
    return null;
  }

  const match = message.match(OLLAMA_CLOUD_QUOTA_REGEX);
  if (!match || !match.groups) {
    return null;
  }

  return {
    upstreamUserId: match.groups.upstreamUserId,
    quotaType: match.groups.quotaType,
  };
}
