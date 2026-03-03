import { useEffect, useCallback, useRef } from 'react';

type HotkeyCallback = () => void;

interface HotkeyOptions {
  enabled?: boolean;
}

const useHotkeys = (keys: string, callback: HotkeyCallback, options: HotkeyOptions = {}) => {
  const { enabled = true } = options;
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      const keyCombinations = keys.split(',').map(k => k.trim().toLowerCase());
      const pressedKey = event.key.toLowerCase();

      for (const combo of keyCombinations) {
        const parts = combo.split('+');
        const requiredKey = parts[parts.length - 1];
        const modifiers = new Set(parts.slice(0, -1));

        const keyMatches = pressedKey === requiredKey;

        const hasRequiredModifiers =
          (modifiers.has('cmd') || modifiers.has('meta')) === event.metaKey &&
          (modifiers.has('ctrl') || modifiers.has('control')) === event.ctrlKey &&
          modifiers.has('shift') === event.shiftKey &&
          modifiers.has('alt') === event.altKey;

        if (keyMatches && hasRequiredModifiers) {
          event.preventDefault();
          callbackRef.current();
          return;
        }
      }
    },
    [keys, enabled]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
};

export { useHotkeys };
