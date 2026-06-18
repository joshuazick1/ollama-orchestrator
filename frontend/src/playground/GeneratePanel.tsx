import { useState } from 'react';
import { Play, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
import { cn } from '../lib/utils';

export interface GenerateOptions {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  top_k?: number;
}

export interface GeneratePanelProps {
  provider: string;
  model: string;
  options?: GenerateOptions;
  onResponse?: (chunk: string) => void;
  className?: string;
}

export const GeneratePanel = ({ provider, model, options = {}, className }: GeneratePanelProps) => {
  const [prompt, setPrompt] = useState('');
  const [output, setOutput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [localOptions, setLocalOptions] = useState<GenerateOptions>({
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 512,
    top_p: options.top_p ?? 0.9,
    top_k: options.top_k ?? 40,
  });

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;

    setIsGenerating(true);
    setOutput('');

    setIsGenerating(false);
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      <div className="flex-1 p-4 space-y-4 overflow-y-auto">
        <Textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder={`Enter your prompt for ${provider}...`}
          className="min-h-[200px] resize-none"
          disabled={isGenerating}
        />

        <div>
          <button
            type="button"
            onClick={() => setShowOptions(!showOptions)}
            className="flex items-center gap-2 text-sm text-text-subtle hover:text-text-base transition-colors"
          >
            {showOptions ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {showOptions ? 'Hide Options' : 'Show Options'}
          </button>

          {showOptions && (
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-text-subtle mb-1 block">Temperature</label>
                <Input
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={localOptions.temperature}
                  onChange={e =>
                    setLocalOptions(prev => ({
                      ...prev,
                      temperature: parseFloat(e.target.value) || 0,
                    }))
                  }
                />
              </div>
              <div>
                <label className="text-xs text-text-subtle mb-1 block">Max Tokens</label>
                <Input
                  type="number"
                  min={1}
                  max={4096}
                  value={localOptions.max_tokens}
                  onChange={e =>
                    setLocalOptions(prev => ({
                      ...prev,
                      max_tokens: parseInt(e.target.value) || 512,
                    }))
                  }
                />
              </div>
              <div>
                <label className="text-xs text-text-subtle mb-1 block">Top P</label>
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  value={localOptions.top_p}
                  onChange={e =>
                    setLocalOptions(prev => ({
                      ...prev,
                      top_p: parseFloat(e.target.value) || 0,
                    }))
                  }
                />
              </div>
              <div>
                <label className="text-xs text-text-subtle mb-1 block">Top K</label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={localOptions.top_k}
                  onChange={e =>
                    setLocalOptions(prev => ({
                      ...prev,
                      top_k: parseInt(e.target.value) || 40,
                    }))
                  }
                />
              </div>
            </div>
          )}
        </div>

        <Button onClick={handleGenerate} disabled={!prompt.trim() || isGenerating}>
          <Play className="w-4 h-4 mr-2" />
          {isGenerating ? 'Generating...' : 'Generate'}
        </Button>

        {output && (
          <Card className="p-4 mt-4">
            <div className="text-xs text-text-subtle mb-2">Output</div>
            <div className="text-sm whitespace-pre-wrap">{output}</div>
          </Card>
        )}

        <div className="text-xs text-text-subtle">
          Provider: {provider} | Model: {model || 'Not selected'}
        </div>
      </div>
    </div>
  );
};

export default GeneratePanel;
