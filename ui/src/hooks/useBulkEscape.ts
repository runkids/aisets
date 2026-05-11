import { useEffect } from "react";

export function useBulkEscape(
  bulkMode: boolean,
  cancel: () => void,
  locked?: boolean,
) {
  useEffect(() => {
    if (!bulkMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !locked) {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bulkMode, cancel, locked]);
}
