import { useEffect, useState } from "react";

export function useRotatingGhost(enabled: boolean, count: number) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!enabled || count < 2) return undefined;
    const id = window.setInterval(() => {
      setIdx((i) => (i + 1) % count);
    }, 3200);
    return () => window.clearInterval(id);
  }, [count, enabled]);
  return idx;
}
