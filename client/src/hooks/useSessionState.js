import { useEffect, useState } from 'react';

/** useState persisted to sessionStorage (best effort; works without storage). */
export function useSessionState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* quota or unavailable */
    }
  }, [key, value]);
  return [value, setValue];
}
