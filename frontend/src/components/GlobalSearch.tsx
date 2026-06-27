import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  LayoutDashboard,
  Server,
  Database,
  Zap,
  BarChart2,
  Shield,
  FileText,
  Settings,
  X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getServers, getModelMap } from '../api';
import type { AIServer } from '../types';
import { SearchResultGroup } from './SearchResultGroup';
import { Dialog, DialogContent } from './ui/dialog';
import { Input } from './ui/input';

interface SearchResult {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  action: () => void;
  category: 'navigation' | 'server' | 'model' | 'action';
}

interface GlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GlobalSearch = ({ isOpen, onClose }: GlobalSearchProps) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let savedScrollY = 0;

    if (isOpen) {
      savedScrollY = window.scrollY;
      setTimeout(() => inputRef.current?.focus(), 0);
      window.scrollTo(0, savedScrollY);
    }

    return () => {
      if (isOpen) {
        window.scrollTo(0, savedScrollY);
      }
    };
  }, [isOpen]);

  const { data: servers } = useQuery({
    queryKey: ['servers'],
    queryFn: getServers,
  });

  const { data: modelMap } = useQuery({
    queryKey: ['modelMap'],
    queryFn: getModelMap,
  });

  const navigationItems: SearchResult[] = useMemo(
    () => [
      {
        id: 'nav-dashboard',
        title: 'Dashboard',
        description: 'System overview and metrics',
        icon: LayoutDashboard,
        action: () => navigate('/'),
        category: 'navigation',
      },
      {
        id: 'nav-servers',
        title: 'Servers',
        description: 'Manage AI inference nodes',
        icon: Server,
        action: () => navigate('/servers'),
        category: 'navigation',
      },
      {
        id: 'nav-models',
        title: 'Models',
        description: 'View model distribution',
        icon: Database,
        action: () => navigate('/models'),
        category: 'navigation',
      },
      {
        id: 'nav-in-flight',
        title: 'In-Flight',
        description: 'Monitor active in-flight requests',
        icon: Zap,
        action: () => navigate('/in-flight'),
        category: 'navigation',
      },
      {
        id: 'nav-analytics',
        title: 'Analytics',
        description: 'Performance metrics and insights',
        icon: BarChart2,
        action: () => navigate('/analytics'),
        category: 'navigation',
      },
      {
        id: 'nav-circuit-breakers',
        title: 'Circuit Breakers',
        description: 'View circuit breaker status',
        icon: Shield,
        action: () => navigate('/circuit-breakers'),
        category: 'navigation',
      },
      {
        id: 'nav-logs',
        title: 'Logs',
        description: 'View system logs',
        icon: FileText,
        action: () => navigate('/logs'),
        category: 'navigation',
      },
      {
        id: 'nav-settings',
        title: 'Settings',
        description: 'Configure orchestrator',
        icon: Settings,
        action: () => navigate('/settings'),
        category: 'navigation',
      },
    ],
    [navigate]
  );

  const serverItems: SearchResult[] = useMemo(() => {
    if (!servers) return [];
    return servers.map((server: AIServer) => ({
      id: `server-${server.id}`,
      title: server.url,
      description: server.healthy ? 'Healthy' : 'Unhealthy',
      icon: Server,
      action: () => {
        navigate('/servers');
        onClose();
      },
      category: 'server' as const,
    }));
  }, [servers, navigate, onClose]);

  const modelItems: SearchResult[] = useMemo(() => {
    if (!modelMap) return [];
    return Object.keys(modelMap).map(model => ({
      id: `model-${model}`,
      title: model,
      description: `${modelMap[model].length} server(s)`,
      icon: Database,
      action: () => {
        navigate('/models');
        onClose();
      },
      category: 'model' as const,
    }));
  }, [modelMap, navigate, onClose]);

  const allResults = useMemo(() => {
    const items: SearchResult[] = [...navigationItems, ...serverItems, ...modelItems];

    if (!query.trim()) {
      return items.slice(0, 8);
    }

    const lowerQuery = query.toLowerCase();
    return items
      .filter(
        item =>
          item.title.toLowerCase().includes(lowerQuery) ||
          item.description.toLowerCase().includes(lowerQuery)
      )
      .slice(0, 10);
  }, [query, navigationItems, serverItems, modelItems]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(i => Math.min(i + 1, allResults.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(i => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (allResults[selectedIndex]) {
            allResults[selectedIndex].action();
            onClose();
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [allResults, selectedIndex, onClose]
  );

  const handleSelectItem = useCallback(
    (item: SearchResult) => {
      item.action();
      onClose();
    },
    [onClose]
  );

  const groupedResults = {
    navigation: allResults.filter(r => r.category === 'navigation'),
    server: allResults.filter(r => r.category === 'server'),
    model: allResults.filter(r => r.category === 'model'),
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="bg-surface-raised rounded-xl border border-surface-border shadow-2xl p-0 max-w-xl gap-0">
        <div className="flex items-center px-4 border-b border-surface-border">
          <Search className="w-5 h-5 text-text-muted" />
          <Input
            type="text"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search pages, servers, models..."
            className="flex-1 px-3 py-4 bg-transparent text-text-base placeholder:text-gray-500 outline-none text-lg border-0 shadow-none"
            ref={inputRef}
          />
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text-base transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {allResults.length === 0 ? (
            <div className="p-8 text-center text-text-subtle">
              <p>No results found for "{query}"</p>
            </div>
          ) : (
            <div className="p-2">
              <SearchResultGroup
                title="Pages"
                items={groupedResults.navigation}
                allResults={allResults}
                selectedIndex={selectedIndex}
                onSelect={handleSelectItem}
              />
              <SearchResultGroup
                title="Servers"
                items={groupedResults.server}
                allResults={allResults}
                selectedIndex={selectedIndex}
                onSelect={handleSelectItem}
              />
              <SearchResultGroup
                title="Models"
                items={groupedResults.model}
                allResults={allResults}
                selectedIndex={selectedIndex}
                onSelect={handleSelectItem}
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-surface-border bg-gray-800/50 text-xs text-text-subtle">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-surface rounded text-text-muted">↑↓</kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-surface rounded text-text-muted">↵</kbd>
              Select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-surface rounded text-text-muted">esc</kbd>
              Close
            </span>
          </div>
          <span>Quick Search</span>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default GlobalSearch;
