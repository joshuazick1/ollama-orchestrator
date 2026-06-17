export type SuggestServerConfigOptions = {
  avgLatencyMs?: number;
  supportsStreaming?: boolean;
};

export type SuggestedConfig = {
  maxConcurrency: number;
  requestTimeoutMs: number;
  supportsStreaming: boolean;
};

export function suggestServerConfig(options?: SuggestServerConfigOptions): SuggestedConfig {
  const latency = options?.avgLatencyMs;
  const supportsStreaming = options?.supportsStreaming ?? false;

  if (latency !== undefined && latency < 100) {
    return {
      maxConcurrency: 8,
      requestTimeoutMs: 10000,
      supportsStreaming,
    };
  }

  if (latency === undefined || latency <= 1000) {
    return {
      maxConcurrency: 4,
      requestTimeoutMs: 30000,
      supportsStreaming,
    };
  }

  return {
    maxConcurrency: 2,
    requestTimeoutMs: 60000,
    supportsStreaming,
  };
}
