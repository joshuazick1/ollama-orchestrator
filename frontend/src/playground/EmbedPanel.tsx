import { useState } from 'react';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Card } from '../components/ui/card';
import { cn } from '../lib/utils';
import { useEmbeddings } from './useEmbeddings';

export interface EmbedPanelProps {
  provider: 'ollama' | 'openai';
  model: string;
  className?: string;
}

function HeatmapCell({ value, maxAbs }: { value: number; maxAbs: number }) {
  const intensity = maxAbs > 0 ? Math.abs(value) / maxAbs : 0;
  const bucket = Math.min(4, Math.floor(intensity * 5));
  const isNegative = value < 0;
  const colorClass = isNegative
    ? ['bg-blue-100', 'bg-blue-200', 'bg-blue-300', 'bg-blue-400', 'bg-blue-500'][bucket]
    : ['bg-red-100', 'bg-red-200', 'bg-red-300', 'bg-red-400', 'bg-red-500'][bucket];
  return (
    <div
      className={cn('w-4 h-4 border border-surface-border', colorClass)}
      title={value.toFixed(4)}
    />
  );
}

export const EmbedPanel = ({ provider, model, className }: EmbedPanelProps) => {
  const [input, setInput] = useState('');
  const { embeddings, usage, error, isLoading, embed } = useEmbeddings(provider, model);

  const handleEmbed = async () => {
    if (!input.trim() || isLoading) return;
    await embed(input.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEmbed();
    }
  };

  const embedding = embeddings[0] ?? [];
  const dimensions = embedding.length;
  const firstFive = embedding.slice(0, 5);
  const maxAbs = Math.max(...embedding.map(Math.abs), 0.001);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      <div className="flex-1 p-4 space-y-4 overflow-y-auto">
        <Textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter text to embed..."
          className="min-h-[120px] resize-none"
          disabled={isLoading}
        />

        <Button onClick={handleEmbed} disabled={!input.trim() || isLoading}>
          {isLoading ? 'Embedding...' : 'Embed'}
        </Button>

        {error && (
          <Card className="p-3 border-danger/50">
            <p className="text-sm text-danger">{error.message}</p>
          </Card>
        )}

        {embedding.length > 0 && (
          <Card className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="text-text-subtle">Model: </span>
                <span className="font-medium">{model || 'Unknown'}</span>
              </div>
              <div className="text-sm">
                <span className="text-text-subtle">Dimensions: </span>
                <span className="font-medium">{dimensions}</span>
              </div>
            </div>

            {usage && (
              <div className="text-xs text-text-subtle">
                Tokens: {usage.prompt_tokens ?? 0} prompt, {usage.total_tokens ?? 0} total
              </div>
            )}

            <div className="space-y-2">
              <div className="text-xs text-text-subtle font-medium">First 5 dimensions:</div>
              <div className="flex gap-2 flex-wrap">
                {firstFive.map((val, i) => (
                  <div key={i} className="px-2 py-1 bg-surface-raised rounded text-xs font-mono">
                    [{i}]: {val.toFixed(4)}
                  </div>
                ))}
                {dimensions > 5 && (
                  <div className="px-2 py-1 text-xs text-text-subtle">
                    ... +{dimensions - 5} more
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs text-text-subtle font-medium">Heatmap (first 50 dims):</div>
              <div className="flex flex-wrap gap-0.5">
                {embedding.slice(0, 50).map((val, i) => (
                  <HeatmapCell key={i} value={val} maxAbs={maxAbs} />
                ))}
              </div>
              <div className="flex items-center gap-2 text-xs text-text-subtle">
                <span>Low</span>
                <div className="h-3 w-[100px] bg-gradient-to-r from-blue-200 via-blue-500 to-red-200 rounded" />
                <span>High</span>
              </div>
            </div>
          </Card>
        )}
      </div>

      <div className="p-4 border-t border-surface-border text-xs text-text-subtle">
        Provider: {provider} | Model: {model || 'Not selected'}
      </div>
    </div>
  );
};

export default EmbedPanel;
