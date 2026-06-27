import { useState, lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { ChatPanel } from '../playground/ChatPanel';
import { GeneratePanel } from '../playground/GeneratePanel';
import { HistoryPanel } from '../playground/HistoryPanel';
import { getModels } from '../api';
import { getOpenAIModels } from '../api/servers';

const EmbedPanel = lazy(() =>
  import('../playground/EmbedPanel').then(m => ({ default: m.EmbedPanel }))
);

const ANTHROPIC_MODELS = [
  'claude-3-5-sonnet-20241022',
  'claude-3-opus-20240229',
  'claude-3-haiku-20240307',
];

export const Playground = () => {
  const [provider, setProvider] = useState<'ollama' | 'openai' | 'anthropic'>('ollama');
  const [model, setModel] = useState('');
  const [activeMode, setActiveMode] = useState<'chat' | 'generate' | 'embeddings'>('chat');

  const { data: ollamaModels = [] } = useQuery({
    queryKey: ['ollama-models'],
    queryFn: getModels,
    enabled: provider === 'ollama',
  });

  const { data: openaiModels = [] } = useQuery({
    queryKey: ['openai-models'],
    queryFn: getOpenAIModels,
    enabled: provider === 'openai',
  });

  const availableModels =
    provider === 'ollama' ? ollamaModels : provider === 'openai' ? openaiModels : ANTHROPIC_MODELS;

  const handleRestoreConversation = (conv: { provider: string; model: string; mode: string }) => {
    setProvider(conv.provider as 'ollama' | 'openai' | 'anthropic');
    setModel(conv.model);
    setActiveMode(conv.mode as 'chat' | 'generate' | 'embeddings');
  };

  const handleNewChat = () => {
    setActiveMode('chat');
  };

  return (
    <div className="flex h-full">
      <div className="w-64 border-r border-surface-border flex-shrink-0">
        <HistoryPanel onRestoreConversation={handleRestoreConversation} onNewChat={handleNewChat} />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="p-4 border-b border-surface-border space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-48">
              <label className="text-xs text-text-subtle mb-1 block">Provider</label>
              <Select
                value={provider}
                onValueChange={value => setProvider(value as 'ollama' | 'openai' | 'anthropic')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ollama">Ollama</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1">
              <label className="text-xs text-text-subtle mb-1 block">Model</label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.length === 0 ? (
                    <SelectItem value="no-models" disabled>
                      No models available
                    </SelectItem>
                  ) : (
                    availableModels.map((m: string) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Tabs value={activeMode} onValueChange={v => setActiveMode(v as typeof activeMode)}>
            <TabsList>
              <TabsTrigger value="chat">Chat</TabsTrigger>
              <TabsTrigger value="generate">Generate</TabsTrigger>
              <TabsTrigger value="embeddings">Embeddings</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="flex-1 overflow-hidden">
          {activeMode === 'chat' && <ChatPanel provider={provider} model={model} />}
          {activeMode === 'generate' && <GeneratePanel provider={provider} model={model} />}
          {activeMode === 'embeddings' && provider !== 'anthropic' && (
            <Suspense
              fallback={<div className="flex items-center justify-center h-full">Loading...</div>}
            >
              <EmbedPanel provider={provider as 'ollama' | 'openai'} model={model} />
            </Suspense>
          )}
          {activeMode === 'embeddings' && provider === 'anthropic' && (
            <div className="flex items-center justify-center h-full text-text-subtle">
              <p>Embeddings not supported for Anthropic</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Playground;
