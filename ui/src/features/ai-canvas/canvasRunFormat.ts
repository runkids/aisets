export function formatCanvasRunDuration(ms: number | null | undefined) {
  const safeMs = Number.isFinite(ms) && ms && ms > 0 ? ms : 0;
  if (safeMs < 60_000) return `${(safeMs / 1000).toFixed(2)}s`;
  const minutes = Math.floor(safeMs / 60_000);
  const seconds = ((safeMs % 60_000) / 1000).toFixed(2).padStart(5, "0");
  return `${minutes}:${seconds}`;
}
