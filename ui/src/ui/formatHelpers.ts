export function formatExt(ext: string) {
  return ext.replace(/^\./, "").toUpperCase();
}

export function formatDate(unixSeconds: number) {
  if (unixSeconds <= 0) return "";
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function fileName(path: string) {
  return path.split("/").pop() ?? path;
}
