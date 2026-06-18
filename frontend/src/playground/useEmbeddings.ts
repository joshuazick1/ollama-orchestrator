import { useState, useCallback } from 'react';

export interface UseEmbeddingsReturn {
  embeddings: number[][];
  usage: { prompt_tokens?: number; total_tokens?: number } | null;
  error: Error | null;
  isLoading: boolean;
  embed: (input: string | string[]) => Promise<void>;
}

interface OllamaEmbedRequest {
  model: string;
  input: string | string[];
}

interface OllamaEmbedResponse {
  embeddings?: number[][];
}

interface OpenAIEmbedRequest {
  model: string;
  input: string | string[];
}

interface OpenAIEmbedResponse {
  data?: { embedding: number[] }[];
  usage?: { prompt_tokens: number; total_tokens: number };
}

export function useEmbeddings(provider: 'ollama' | 'openai', model: string): UseEmbeddingsReturn {
  const [embeddings, setEmbeddings] = useState<number[][]>([]);
  const [usage, setUsage] = useState<{ prompt_tokens?: number; total_tokens?: number } | null>(
    null
  );
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const embed = useCallback(
    async (input: string | string[]) => {
      if (!model) {
        setError(new Error('No model selected'));
        return;
      }

      setError(null);
      setIsLoading(true);
      setEmbeddings([]);
      setUsage(null);

      try {
        let url: string;
        let body: unknown;

        if (provider === 'ollama') {
          url = '/api/embeddings';
          const ollamaReq: OllamaEmbedRequest = {
            model,
            input,
          };
          body = ollamaReq;
        } else {
          url = '/v1/embeddings';
          const openaiReq: OpenAIEmbedRequest = {
            model,
            input,
          };
          body = openaiReq;
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            (data as { error?: string }).error || `Request failed: ${res.statusText}`
          );
        }

        const data = await res.json();

        if (provider === 'ollama') {
          const ollamaResp = data as OllamaEmbedResponse;
          if (ollamaResp.embeddings) {
            setEmbeddings(ollamaResp.embeddings);
          }
        } else {
          const openaiResp = data as OpenAIEmbedResponse;
          if (openaiResp.data) {
            setEmbeddings(openaiResp.data.map(d => d.embedding));
          }
          if (openaiResp.usage) {
            setUsage(openaiResp.usage);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setIsLoading(false);
      }
    },
    [provider, model]
  );

  return {
    embeddings,
    usage,
    error,
    isLoading,
    embed,
  };
}
