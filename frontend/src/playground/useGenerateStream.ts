import { useState, useCallback, useRef } from 'react';

export interface GenerateStreamOptions {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  top_k?: number;
  stop?: string[];
}

export interface UseGenerateStreamReturn {
  response: string;
  isStreaming: boolean;
  error: Error | null;
  generate: (prompt: string) => void;
  stop: () => void;
}

interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream: true;
  options?: Partial<GenerateStreamOptions>;
}

interface OllamaGenerateResponse {
  response?: string;
  done?: boolean;
}

interface OpenAICompleteRequest {
  model: string;
  prompt: string;
  stream: true;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string[];
}

export function useGenerateStream(
  provider: 'ollama' | 'openai',
  model: string,
  options?: GenerateStreamOptions
): UseGenerateStreamReturn {
  const [response, setResponse] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const generate = useCallback(
    async (prompt: string) => {
      if (!model) {
        setError(new Error('No model selected'));
        return;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      setResponse('');
      setError(null);
      setIsStreaming(true);

      try {
        let url: string;
        let body: unknown;

        if (provider === 'ollama') {
          url = '/api/generate';
          const ollamaReq: OllamaGenerateRequest = {
            model,
            prompt,
            stream: true,
            options:
              options?.temperature !== undefined || options?.max_tokens !== undefined
                ? {
                    temperature: options.temperature,
                    num_predict: options.max_tokens,
                    top_p: options.top_p,
                    top_k: options.top_k,
                  }
                : undefined,
          };
          body = ollamaReq;
        } else {
          url = '/v1/completions';
          const openaiReq: OpenAICompleteRequest = {
            model,
            prompt,
            stream: true,
            temperature: options?.temperature,
            max_tokens: options?.max_tokens,
            top_p: options?.top_p,
            stop: options?.stop,
          };
          body = openaiReq;
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            (data as { error?: string }).error || `Request failed: ${res.statusText}`
          );
        }

        const reader = res.body?.getReader();
        if (!reader) {
          throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        if (provider === 'ollama') {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const parsed: OllamaGenerateResponse = JSON.parse(line);
                if (parsed.response) {
                  setResponse(prev => prev + parsed.response);
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }
        } else {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            const events = buffer.split('\n\n');
            buffer = events.pop() ?? '';

            for (const event of events) {
              const lines = event.split('\n');
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data: ')) continue;
                if (trimmed === 'data: [DONE]') continue;

                const json = trimmed.slice(6);
                try {
                  const parsed = JSON.parse(json);
                  const content = parsed.choices?.[0]?.text;
                  if (content) {
                    setResponse(prev => prev + content);
                  }
                } catch {
                  // Skip malformed JSON
                }
              }
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        setIsStreaming(false);
      }
    },
    [provider, model, options]
  );

  return {
    response,
    isStreaming,
    error,
    generate,
    stop,
  };
}
