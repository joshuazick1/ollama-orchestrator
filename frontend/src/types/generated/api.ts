export type TestConnectionResult = {
  reachable: boolean;
  status: 'success' | 'partial' | 'failed' | 'running';
  progress: number;
  capabilities: {
    supportsOllama: boolean;
    supportsV1: boolean;
    supportsAnthropic: boolean;
    canListModels: boolean;
  };
  models: {
    ollama: string[];
    openai: string[];
    merged: string[];
  };
  needsCustomModelList: boolean;
  suggestedConfig: {
    maxConcurrency: number;
    requestTimeoutMs: number;
    supportsStreaming: boolean;
  };
  errors: Array<{ endpoint: string; reason: string; status?: number }>;
  durationMs: number;
};
