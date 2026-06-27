import { useServerTest, type TestStatus } from '../hooks/useServerTest';
import { Button } from './Button';
import { Loader2, CheckCircle, XCircle, AlertTriangle, HelpCircle } from 'lucide-react';
import type { TestConnectionResult } from '../types/generated/api';

export type ServerTestButtonProps = {
  serverUrl: string;
  apiKey?: string;
  serverId?: string;
  onComplete?: (result: TestConnectionResult) => void;
  mode: 'add' | 'edit' | 'detail';
};

function StatusIcon({ status }: { status: TestStatus }) {
  switch (status) {
    case 'completed':
      return <CheckCircle className="w-4 h-4 text-green-400" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-400" />;
    case 'partial':
      return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
    case 'custom-needed':
      return <HelpCircle className="w-4 h-4 text-blue-400" />;
    case 'running':
      return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />;
    default:
      return null;
  }
}

function StatusText({
  status,
  result,
  mode,
}: {
  status: TestStatus;
  result: TestConnectionResult | null;
  mode: 'add' | 'edit' | 'detail';
}) {
  switch (status) {
    case 'idle':
      return mode === 'detail' ? 'Re-test' : 'Test';
    case 'running':
      return 'Testing...';
    case 'completed':
      if (result) {
        const modelCount = result.models.merged.length;
        return modelCount > 0 ? `Success (${modelCount} models)` : 'Success';
      }
      return 'Success';
    case 'failed':
      return 'Failed';
    case 'partial':
      return 'Partial';
    case 'custom-needed':
      return 'Custom model list needed';
    default:
      return mode === 'detail' ? 'Re-test' : 'Test';
  }
}

export function ServerTestButton({
  serverUrl,
  apiKey,
  serverId,
  onComplete,
  mode,
}: ServerTestButtonProps) {
  const { status, result, error, start, reset } = useServerTest();

  const handleTest = () => {
    start({ url: serverUrl, apiKey, serverId });
  };

  const handleReset = (e: React.MouseEvent) => {
    e.stopPropagation();
    reset();
  };

  const handleComplete = () => {
    if (result && onComplete) {
      onComplete(result);
    }
  };

  if (
    result &&
    (status === 'completed' ||
      status === 'partial' ||
      status === 'failed' ||
      status === 'custom-needed')
  ) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <StatusIcon status={status} />
          <span
            className={`text-sm font-medium ${
              status === 'completed'
                ? 'text-green-400'
                : status === 'failed'
                  ? 'text-red-400'
                  : status === 'partial'
                    ? 'text-yellow-400'
                    : 'text-blue-400'
            }`}
          >
            <StatusText status={status} result={result} mode={mode} />
          </span>
          <Button variant="ghost" size="sm" onClick={handleReset}>
            Reset
          </Button>
        </div>

        {status === 'failed' && error && (
          <div className="p-2 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-400">
            {error}
          </div>
        )}

        {status === 'custom-needed' && (
          <div className="p-2 bg-blue-900/30 border border-blue-800 rounded-lg text-sm text-blue-400">
            The server did not return a model list. Please enter models manually.
          </div>
        )}

        {(status === 'completed' || status === 'partial') && result && (
          <div className="p-2 bg-surface-raised border border-surface-border rounded-lg text-xs space-y-1">
            {result.capabilities && (
              <div className="flex flex-wrap gap-2">
                {result.capabilities.supportsOllama && (
                  <span className="px-2 py-0.5 bg-green-900/50 text-green-400 rounded">Ollama</span>
                )}
                {result.capabilities.supportsV1 && (
                  <span className="px-2 py-0.5 bg-blue-900/50 text-blue-400 rounded">OpenAI</span>
                )}
                {result.capabilities.supportsAnthropic && (
                  <span className="px-2 py-0.5 bg-purple-900/50 text-purple-400 rounded">
                    Anthropic
                  </span>
                )}
                {result.capabilities.canListModels && (
                  <span className="px-2 py-0.5 bg-gray-700 text-gray-300 rounded">
                    Models Listed
                  </span>
                )}
              </div>
            )}
            {result.suggestedConfig && (
              <div className="text-gray-400">
                Suggested: concurrency={result.suggestedConfig.maxConcurrency}, timeout=
                {result.suggestedConfig.requestTimeoutMs}ms
                {result.suggestedConfig.supportsStreaming && ', streaming'}
              </div>
            )}
            {result.errors && result.errors.length > 0 && (
              <div className="text-yellow-400">{result.errors.length} endpoint(s) failed</div>
            )}
          </div>
        )}

        {onComplete && (
          <Button variant="secondary" size="sm" onClick={handleComplete}>
            Apply Result
          </Button>
        )}
      </div>
    );
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={handleTest}
      disabled={status === 'running' || !serverUrl}
      loading={status === 'running'}
    >
      <StatusIcon status={status} />
      <span className="ml-2">
        <StatusText status={status} result={result} mode={mode} />
      </span>
    </Button>
  );
}
