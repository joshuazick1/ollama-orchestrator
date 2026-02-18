import { useEffect, useCallback } from 'react';

type HotkeyCallback = () => void;

const useHotkeys = (keys: string, callback: HotkeyCallback) => {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const keyCombinations = keys.split(',').map(k => k.trim().toLowerCase());
      const pressedKey = event.key.toLowerCase();
      const isMeta = event.metaKey || event.ctrlKey;

      for (const combo of keyCombinations) {
        const parts = combo.split('+');
        const requiredKey = parts[0];
        const needsShift = parts.includes('shift');
        const needsCtrl = parts.includes('ctrl') || parts.includes('control');
        const needsMeta = parts.includes('cmd') || parts.includes('meta');

        const keyMatches =
          pressedKey === requiredKey || (pressedKey === 'k' && requiredKey === 'cmd' && isMeta);

        const modifierMatches =
          (needsMeta && (event.metaKey || event.key === 'Meta')) ||
          (needsCtrl && (event.ctrlKey || event.key === 'Control')) ||
          (needsShift && (event.shiftKey || event.key === 'Shift')) ||
          (!needsMeta && !needsCtrl && !needsShift);

        if (keyMatches && modifierMatches) {
          event.preventDefault();
          callback();
          return;
        }
      }
    },
    [keys, callback]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
};

export { useHotkeys };
