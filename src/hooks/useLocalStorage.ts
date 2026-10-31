import { useEffect, useState } from "react";

export function useLocalStorage<T>(key: string, initialValue: T, normalize?: (value: T) => T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (!stored) return initialValue;
      const parsed = JSON.parse(stored) as T;
      // Arrays and primitives: use parsed directly; objects: merge with defaults for forward-compat
      if (Array.isArray(initialValue) || Array.isArray(parsed) || typeof initialValue !== "object" || initialValue === null) {
        return parsed;
      }
      const merged = { ...initialValue, ...parsed } as T;
      return normalize ? normalize(merged) : merged;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private/restricted mode */ }
  }, [key, value]);

  return [value, setValue];
}
