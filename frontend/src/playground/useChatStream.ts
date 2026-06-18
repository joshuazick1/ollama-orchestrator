import { useState, useCallback, useRef } from 'react';

export interface ChatStreamOptions {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string[];
}

export interface UseChatStreamReturn {
  response: string;
  isStreaming: boolean;
  error: Error | null;
  sendMessage: (messages: { role: string; content: string }[]) => Promise<string>;
  stop: () => void;
}

interface OllamaChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream: true;
  options?: Partial<ChatStreamOptions>;
}

interface OllamaChatResponse {
  message?: { content?: string };
  done?: boolean;
}

interface OpenAIChatRequest {
  model: string;
  messages: { role: string; content: string }[];
  stream: true;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string[];
}

interface AnthropicChatRequest {
  model: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  stream: true;
  max_tokens?: number;
}

export function useChatStream(
  provider: 'ollama' | 'openai' | 'anthropic',
  model: string,
  options?: ChatStreamOptions
): UseChatStreamReturn {
  const [response, setResponse] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const sendMessage = useCallback(
    async (messages: { role: string; content: string }[]): Promise<string> => {
      if (!model) {
        const err = new Error('No model selected');
        setError(err);
        return '';
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      setResponse('');
      setError(null);
      setIsStreaming(true);

      let finalResponse = '';

      try {
        let url: string;
        let body: unknown;

        if (provider === 'ollama') {
          url = '/api/chat';
          const ollamaReq: OllamaChatRequest = {
            model,
            messages: messages as OllamaChatMessage[],
            stream: true,
            options:
              options?.temperature !== undefined || options?.max_tokens !== undefined
                ? {
                    temperature: options.temperature,
                    num_predict: options.max_tokens,
                    top_p: options.top_p,
                  }
                : undefined,
          };
          body = ollamaReq;
        } else if (provider === 'openai') {
          url = '/v1/chat/completions';
          const openaiReq: OpenAIChatRequest = {
            model,
            messages,
            stream: true,
            temperature: options?.temperature,
            max_tokens: options?.max_tokens,
            top_p: options?.top_p,
            stop: options?.stop,
          };
          body = openaiReq;
        } else {
          url = '/v1/messages';
          const anthropicReq: AnthropicChatRequest = {
            model,
            messages: messages as { role: 'user' | 'assistant'; content: string }[],
            stream: true,
            max_tokens: options?.max_tokens ?? 4096,
          };
          body = anthropicReq;
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
                const parsed: OllamaChatResponse = JSON.parse(line);
                if (parsed.message?.content) {
                  finalResponse += parsed.message.content;
                  setResponse(prev => prev + parsed.message!.content!);
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
                  const content = parsed.choices?.[0]?.delta?.content ?? parsed.content?.[0]?.text;
                  if (content) {
                    finalResponse += content;
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
          const error = err instanceof Error ? err : new Error(String(err));
          setError(error);
        }
      } finally {
        setIsStreaming(false);
      }

      return finalResponse;
    },
    [provider, model, options]
  );

  return {
    response,
    isStreaming,
    error,
    sendMessage,
    stop,
  };
}

export type { ChatMessage } from '../playground/ChatPanel';
