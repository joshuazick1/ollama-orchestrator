import React from 'react';
import { ArrowRight } from 'lucide-react';

interface SearchResult {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  action: () => void;
  category: 'navigation' | 'server' | 'model' | 'action';
}

interface SearchResultGroupProps {
  title: string;
  items: SearchResult[];
  allResults: SearchResult[];
  selectedIndex: number;
  onSelect: (item: SearchResult) => void;
}

export const SearchResultGroup = ({
  title,
  items,
  allResults,
  selectedIndex,
  onSelect,
}: SearchResultGroupProps) => {
  if (items.length === 0) return null;

  return (
    <div className="mb-2">
      <div className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
        {title}
      </div>
      {items.map(item => {
        const globalIdx = allResults.indexOf(item);
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item)}
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
            {globalIdx === selectedIndex && <ArrowRight className="w-4 h-4 flex-shrink-0" />}
          </button>
        );
      })}
    </div>
  );
};
