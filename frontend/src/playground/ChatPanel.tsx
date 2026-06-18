import { useRef, useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Card } from '../components/ui/card';
import { cn } from '../lib/utils';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatPanelProps {
  provider: string;
  model: string;
  onResponse?: (chunk: string) => void;
  className?: string;
}

export const ChatPanel = ({ provider, model, className }: ChatPanelProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    setIsLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-text-subtle">
            <p className="text-sm">Send a message to start the conversation</p>
          </div>
        )}
        {messages.map(message => (
          <div
            key={message.id}
            className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}
          >
            <Card
              className={cn(
                'max-w-[80%] p-3',
                message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-surface-raised'
              )}
            >
              <div className="text-sm whitespace-pre-wrap">{message.content}</div>
            </Card>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <Card className="max-w-[80%] p-3 bg-surface-raised">
              <div className="flex items-center gap-2 text-sm text-text-subtle">
                <div className="w-2 h-2 bg-text-subtle rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-text-subtle rounded-full animate-bounce [animation-delay:0.1s]" />
                <div className="w-2 h-2 bg-text-subtle rounded-full animate-bounce [animation-delay:0.2s]" />
              </div>
            </Card>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-surface-border">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${provider}...`}
            className="min-h-[80px] resize-none"
            disabled={isLoading}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            size="icon"
            className="h-[80px] w-[80px]"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-2 text-xs text-text-subtle">
          Provider: {provider} | Model: {model || 'Not selected'}
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
