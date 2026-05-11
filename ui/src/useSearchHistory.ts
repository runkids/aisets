import { useCallback, useState } from "react";

const STORAGE_KEY = "aisets-cmd-history";
const MAX_ENTRIES = 3;

function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is string => typeof v === "string")
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function save(entries: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function useSearchHistory() {
  const [history, setHistory] = useState(load);

  const add = useCallback((query: string) => {
    const q = query.trim();
    if (!q) return;
    setHistory((prev) => {
      const next = [
        q,
        ...prev.filter((h) => h.toLowerCase() !== q.toLowerCase()),
      ].slice(0, MAX_ENTRIES);
      save(next);
      return next;
    });
  }, []);

  const remove = useCallback((query: string) => {
    setHistory((prev) => {
      const next = prev.filter((h) => h !== query);
      save(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { history, add, remove, clear } as const;
}
