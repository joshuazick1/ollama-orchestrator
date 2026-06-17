import { useState, useRef, useCallback } from 'react';
import { api } from '../api';
import type { TestConnectionResult } from '../types/generated/api';

export type TestStatus = 'idle' | 'running' | 'completed' | 'failed' | 'partial' | 'custom-needed';

export type UseServerTestResult = {
  status: TestStatus;
  result: TestConnectionResult | null;
  error: string | null;
  start: (params: { url: string; apiKey?: string; serverId?: string }) => Promise<void>;
  reset: () => void;
};

export function useServerTest(): UseServerTestResult {
  const [status, setStatus] = useState<TestStatus>('idle');
  const [result, setResult] = useState<TestConnectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearPolling();
    setStatus('idle');
    setResult(null);
    setError(null);
  }, [clearPolling]);

  const start = useCallback(
    async (params: { url: string; apiKey?: string; serverId?: string }) => {
      reset();

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setStatus('running');
      setError(null);

      if (params.serverId) {
        try {
          const response = await api.post<TestConnectionResult>(
            `/servers/${params.serverId}/test`,
            {},
            { signal: controller.signal }
          );
          const testResult = response.data;

          if (testResult.status === 'failed') {
            setStatus('failed');
            setError(testResult.errors?.[0]?.reason || 'Test failed');
          } else if (testResult.needsCustomModelList) {
            setStatus('custom-needed');
          } else if (testResult.status === 'partial') {
            setStatus('partial');
          } else {
            setStatus('completed');
          }
          setResult(testResult);
          clearPolling();
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            return;
          }
          setStatus('failed');
          setError(err instanceof Error ? err.message : 'Test failed');
          clearPolling();
        }
        return;
      }

      try {
        const response = await api.post<{ testId: string }>('/servers/test-connection', {
          url: params.url,
          apiKey: params.apiKey,
        });

        const { testId } = response.data;

        const poll = () => {
          api
            .get<TestConnectionResult>(`/servers/test-connection/${testId}`, {
              signal: controller.signal,
            })
            .then(res => {
              const testResult = res.data;

              if (testResult.status === 'running') {
                setStatus('running');
              } else if (testResult.status === 'failed') {
                setStatus('failed');
                setError(testResult.errors?.[0]?.reason || 'Test failed');
                setResult(testResult);
                clearPolling();
              } else if (testResult.status === 'success') {
                if (testResult.needsCustomModelList) {
                  setStatus('custom-needed');
                } else {
                  setStatus('completed');
                }
                setResult(testResult);
                clearPolling();
              } else if (testResult.status === 'partial') {
                setStatus('partial');
                setResult(testResult);
                clearPolling();
              }
            })
            .catch((err: Error) => {
              if (err.name === 'AbortError' || err.name === 'CanceledError') {
                return;
              }
              setStatus('failed');
              setError(err.message || 'Polling failed');
              clearPolling();
            });
        };

        poll();
        pollIntervalRef.current = setInterval(poll, 1000);
      } catch (err) {
        setStatus('failed');
        setError(err instanceof Error ? err.message : 'Failed to start test');
        clearPolling();
      }
    },
    [reset, clearPolling]
  );

  return {
    status,
    result,
    error,
    start,
    reset,
  };
}
