import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  LayoutDashboard,
  Server,
  Database,
  Layers,
  BarChart2,
  Shield,
  FileText,
  Settings,
  X,
  ArrowRight,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getServers, getModelMap } from '../api';

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
        id: 'nav-queue',
        title: 'Queue',
        description: 'Monitor request queue',
        icon: Layers,
        action: () => navigate('/queue'),
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
    return servers.map((server: { id: string; url: string; healthy: boolean }) => ({
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

  if (!isOpen) return null;

  const groupedResults = {
    navigation: allResults.filter(r => r.category === 'navigation'),
    server: allResults.filter(r => r.category === 'server'),
    model: allResults.filter(r => r.category === 'model'),
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-xl bg-gray-900 rounded-xl border border-gray-700 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center px-4 border-b border-gray-700">
          <Search className="w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search pages, servers, models..."
            className="flex-1 px-3 py-4 bg-transparent text-white placeholder-gray-500 outline-none text-lg"
            autoFocus
          />
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {allResults.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p>No results found for "{query}"</p>
            </div>
          ) : (
            <div className="p-2">
              {groupedResults.navigation.length > 0 && (
                <div className="mb-2">
                  <div className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Pages
                  </div>
                  {groupedResults.navigation.map(item => {
                    const globalIdx = allResults.indexOf(item);
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          item.action();
                          onClose();
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left ${
                          globalIdx === selectedIndex
                            ? 'bg-blue-600 text-white'
                            : 'text-gray-300 hover:bg-gray-800'
                        }`}
                      >
                        <item.icon className="w-5 h-5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{item.title}</div>
                          <div
                            className={`text-sm truncate ${
                              globalIdx === selectedIndex ? 'text-blue-200' : 'text-gray-500'
                            }`}
                          >
                            {item.description}
                          </div>
                        </div>
                        {globalIdx === selectedIndex && (
                          <ArrowRight className="w-4 h-4 flex-shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {groupedResults.server.length > 0 && (
                <div className="mb-2">
                  <div className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Servers
                  </div>
                  {groupedResults.server.map(item => {
                    const globalIdx = allResults.indexOf(item);
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          item.action();
                          onClose();
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left ${
                          globalIdx === selectedIndex
                            ? 'bg-blue-600 text-white'
                            : 'text-gray-300 hover:bg-gray-800'
                        }`}
                      >
                        <item.icon className="w-5 h-5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{item.title}</div>
                          <div
                            className={`text-sm truncate ${
                              globalIdx === selectedIndex ? 'text-blue-200' : 'text-gray-500'
                            }`}
                          >
                            {item.description}
                          </div>
                        </div>
                        {globalIdx === selectedIndex && (
                          <ArrowRight className="w-4 h-4 flex-shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {groupedResults.model.length > 0 && (
                <div>
                  <div className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Models
                  </div>
                  {groupedResults.model.map(item => {
                    const globalIdx = allResults.indexOf(item);
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          item.action();
                          onClose();
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left ${
                          globalIdx === selectedIndex
                            ? 'bg-blue-600 text-white'
                            : 'text-gray-300 hover:bg-gray-800'
                        }`}
                      >
                        <item.icon className="w-5 h-5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{item.title}</div>
                          <div
                            className={`text-sm truncate ${
                              globalIdx === selectedIndex ? 'text-blue-200' : 'text-gray-500'
                            }`}
                          >
                            {item.description}
                          </div>
                        </div>
                        {globalIdx === selectedIndex && (
                          <ArrowRight className="w-4 h-4 flex-shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700 bg-gray-800/50 text-xs text-gray-500">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-400">↑↓</kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-400">↵</kbd>
              Select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-400">esc</kbd>
              Close
            </span>
          </div>
          <span>Quick Search</span>
        </div>
      </div>
    </div>
  );
};
