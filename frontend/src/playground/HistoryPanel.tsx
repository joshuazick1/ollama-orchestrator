import { useState } from 'react';
import { Plus, Trash2, MessageSquare } from 'lucide-react';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';

const STORAGE_KEY = 'playground-history';

export interface PlaygroundConversation {
  id: string;
  provider: string;
  model: string;
  mode: 'chat' | 'generate' | 'embeddings';
  title: string;
  messages?: { role: string; content: string }[];
  prompt?: string;
  createdAt: number;
  updatedAt: number;
  timeAgo?: string;
}

export interface HistoryPanelProps {
  onRestoreConversation: (conversation: PlaygroundConversation) => void;
  onNewChat: () => void;
  className?: string;
}

function computeTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function sortAndAddTimeAgo(convs: PlaygroundConversation[]): PlaygroundConversation[] {
  return convs
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(c => ({ ...c, timeAgo: computeTimeAgo(c.updatedAt) }));
}

function loadFromStorage(): PlaygroundConversation[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as PlaygroundConversation[];
      return sortAndAddTimeAgo(parsed);
    }
  } catch {
    // ignore
  }
  return [];
}

export const HistoryPanel = ({
  onRestoreConversation,
  onNewChat,
  className,
}: HistoryPanelProps) => {
  const [conversations, setConversations] = useState<PlaygroundConversation[]>(loadFromStorage);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const filtered = conversations.filter(c => c.id !== id);
    const sorted = sortAndAddTimeAgo(filtered);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
    setConversations(sorted);
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      <div className="p-3 border-b border-surface-border">
        <Button onClick={onNewChat} variant="outline" className="w-full gap-2">
          <Plus className="w-4 h-4" />
          New Chat
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-subtle p-4">
            <MessageSquare className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm text-center">No conversation history</p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {conversations.map(conv => (
              <button
                key={conv.id}
                type="button"
                onClick={() => onRestoreConversation(conv)}
                className="w-full text-left p-2 rounded hover:bg-surface-raised transition-colors group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{conv.title || 'Untitled'}</div>
                    <div className="text-xs text-text-subtle truncate">
                      {conv.provider} / {conv.model}
                    </div>
                    <div className="text-xs text-text-subtle mt-1">{conv.timeAgo || 'Unknown'}</div>
                  </div>
                  <button
                    type="button"
                    onClick={e => handleDelete(conv.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-surface-border rounded transition-opacity"
                    aria-label="Delete conversation"
                  >
                    <Trash2 className="w-4 h-4 text-text-subtle hover:text-danger" />
                  </button>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default HistoryPanel;
