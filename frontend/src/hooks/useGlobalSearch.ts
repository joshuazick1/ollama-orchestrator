import { useState } from 'react';
import { useHotkeys } from './useHotkeys';

export const useGlobalSearch = () => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  useHotkeys('cmd+k,ctrl+k', () => {
    setIsSearchOpen(prev => !prev);
  });

  return {
    isSearchOpen,
    openSearch: () => setIsSearchOpen(true),
    closeSearch: () => setIsSearchOpen(false),
  };
};
