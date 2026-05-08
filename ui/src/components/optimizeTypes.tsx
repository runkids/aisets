import type { ActionPreview, AssetItem } from "../types";

export type Operation =
  | ""
  | "svg-minify"
  | "png-recompress"
  | "jpeg-recompress"
  | "convert-webp"
  | "convert-avif"
  | "webp-recompress"
  | "gif-optimize"
  | "resize-variant"
  | "resize-replace"
  | "manual-review";

export type Severity = "" | "critical" | "warning" | "info";
export type Category = "" | "size" | "format" | "svg-minify" | "dimensions";

export type OptimizationOperation = {
  assetId: string;
  repoPath: string;
  operation: string;
  outputFormat: string;
  outputMode: string;
  targetPath: string;
  currentBytes: number;
  estimatedBytes: number;
  savingsBytes: number;
  tool?: string;
  available: boolean;
  canApply: boolean;
  reasonCode?: string;
  blockedReason?: string;
  referencePolicy: string;
  referenceEditCount?: number;
  warnings?: string[];
};

export type CategoryBreakdown = {
  category: string;
  count: number;
  savingsBytes: number;
};

export type OptimizationEstimate = {
  itemCount: number;
  totalBytes: number;
  savingsBytes: number;
  byCategory?: CategoryBreakdown[];
  bySeverity?: Record<string, number>;
  operations: OptimizationOperation[];
  tools: Array<{ name: string; required: boolean; available: boolean }>;
};

export type PreviewResponse = {
  token: string;
  preview: ActionPreview & {
    payload?: {
      optimization?: {
        operations?: OptimizationOperation[];
        blockers?: Array<{ file: string; code: string; reason: string }>;
      };
    };
  };
};

export type PreviewBatch = {
  tokens: string[];
  preview: PreviewResponse["preview"];
};

export const operationLabels: Record<string, string> = {
  "svg-minify": "SVG minify",
  "png-recompress": "PNG compress",
  "jpeg-recompress": "JPEG compress",
  "convert-webp": "Convert WebP",
  "convert-avif": "Convert AVIF",
  "webp-recompress": "WebP compress",
  "gif-optimize": "GIF optimize",
  "resize-variant": "Resize variant",
  "resize-replace": "Resize original",
  "manual-review": "Manual review",
};

export function highlightBashLine(line: string): React.ReactNode {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("#"))
    return <span className="text-g-ink-4">{line}</span>;
  const parts: React.ReactNode[] = [];
  const stringRe = /(["'])(?:(?!\1|\\).|\\.)*?\1/g;
  let m: RegExpExecArray | null;
  let lastIdx = 0;
  let key = 0;
  while ((m = stringRe.exec(line)) !== null) {
    if (m.index > lastIdx) parts.push(line.slice(lastIdx, m.index));
    parts.push(
      <span key={key++} className="text-g-green">
        {m[0]}
      </span>,
    );
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < line.length) parts.push(line.slice(lastIdx));
  return parts.length > 0 ? parts : line;
}

export const toolInstallCommands: Record<string, string> = {
  "asset-studio-imgtools": "Bundled with Asset Studio",
  svgo: "npm install -g svgo",
};

export const batchActionButtonClassName =
  "inline-flex min-h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[calc(var(--g-r-md)-2px)] px-2.5 font-[510] text-g-body text-g-ink-2 transition-[background,color,box-shadow] duration-[120ms] ease-g hover:bg-g-surface hover:text-g-ink hover:shadow-g-sm focus-visible:shadow-g-focus disabled:cursor-not-allowed disabled:opacity-[0.38]";

export function operationFor(item: AssetItem): Operation {
  const rec = item.optimizationRecommendations[0];
  return (rec?.operation as Operation | undefined) ?? "";
}

export async function postJSON<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody?.error?.message || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function optimizationOperations(preview: PreviewResponse["preview"]) {
  return preview.payload?.optimization?.operations ?? [];
}

export function optimizationBlockers(preview: PreviewResponse["preview"]) {
  return preview.payload?.optimization?.blockers ?? [];
}
