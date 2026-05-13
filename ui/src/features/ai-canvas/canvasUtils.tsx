import type { ReactNode } from "react";
import type { ImageToolSettings } from "@/api/imageTools";
import type { AssetItem } from "@/types";
import { formatBytes } from "@/ui";
import type {
  AssetCanvasCard,
  CanvasCard,
  CommentCanvasCard,
} from "./aiCanvasState";

export type CanvasSelection = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

export const CARD_WIDTH = 320;

export const DEFAULT_IMAGE_TOOL_SETTINGS: ImageToolSettings = {
  outputFormat: "webp",
  quality: 82,
  maxDimensionPx: 1600,
  outputMode: "safeVariants",
};

export function nowISO() {
  return new Date().toISOString();
}

export function renderInline(line: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokens = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  for (let j = 0; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.startsWith("**") && t.endsWith("**")) {
      nodes.push(<strong key={`${keyPrefix}-${j}`}>{t.slice(2, -2)}</strong>);
    } else if (t.startsWith("`") && t.endsWith("`")) {
      nodes.push(
        <code
          key={`${keyPrefix}-${j}`}
          className="rounded bg-black/10 px-1 py-0.5 text-[0.9em] dark:bg-white/10"
        >
          {t.slice(1, -1)}
        </code>,
      );
    } else if (t) {
      nodes.push(t);
    }
  }
  return nodes;
}

export function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const elements: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("|") && line.includes("|", 1)) {
      const tableRows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        const row = lines[i]
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim());
        if (!row.every((c) => /^[-:]+$/.test(c))) {
          tableRows.push(row);
        }
        i++;
      }
      if (tableRows.length > 0) {
        const [header, ...body] = tableRows;
        elements.push(
          <table
            key={`tbl-${i}`}
            className="my-1 w-full border-collapse text-[0.85em]"
          >
            <thead>
              <tr>
                {header.map((h, ci) => (
                  <th
                    key={ci}
                    className="border border-white/10 px-2 py-1 text-left font-[590]"
                  >
                    {renderInline(h, `th-${i}-${ci}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="border border-white/10 px-2 py-1">
                      {renderInline(cell, `td-${i}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>,
        );
      }
      continue;
    }

    if (/^#{1,3}\s/.test(line)) {
      const level = line.match(/^(#{1,3})\s/)![1].length;
      const headingText = line.replace(/^#{1,3}\s+/, "");
      const cls =
        level === 1
          ? "text-[1.1em] font-[590]"
          : level === 2
            ? "text-[1em] font-[590]"
            : "text-[0.95em] font-[590]";
      elements.push(
        <div key={`h-${i}`} className={`mt-1 ${cls}`}>
          {renderInline(headingText, `h-${i}`)}
        </div>,
      );
      i++;
      continue;
    }

    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="my-0.5 list-disc pl-4">
          {items.map((item, li) => (
            <li key={li}>{renderInline(item, `li-${i}-${li}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="my-0.5 list-decimal pl-4">
          {items.map((item, li) => (
            <li key={li}>{renderInline(item, `li-${i}-${li}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (line.trim() === "") {
      elements.push(<div key={`sp-${i}`} className="h-2" />);
      i++;
      continue;
    }

    elements.push(<div key={`p-${i}`}>{renderInline(line, `p-${i}`)}</div>);
    i++;
  }
  return elements;
}

export function nextCardPosition(
  count: number,
  viewport?: { x: number; y: number; scale: number },
  containerSize?: { width: number; height: number },
) {
  const jitterX = (count % 5) * 34;
  const jitterY = (count % 4) * 42;
  if (viewport && containerSize && containerSize.width > 0) {
    const cx =
      (-viewport.x + containerSize.width / 2) / viewport.scale -
      CARD_WIDTH / 2 +
      jitterX;
    const cy =
      (-viewport.y + containerSize.height / 2) / viewport.scale - 120 + jitterY;
    return { x: Math.round(cx), y: Math.round(cy) };
  }
  return { x: 84 + jitterX, y: 72 + jitterY };
}

export function selectedAssetIds(cards: AssetCanvasCard[]) {
  return cards.map((card) => card.asset.id);
}

export function commentIds(cards: CommentCanvasCard[]) {
  return cards.map((card) => card.id);
}

export function imageMeta(asset: AssetItem) {
  return `${asset.image.width}x${asset.image.height} · ${formatBytes(asset.bytes)}`;
}

export function tagLabel(asset: AssetItem) {
  return asset.aiTag?.tags?.slice(0, 4).join(", ") || "";
}

export function zoomViewportAtPoint(
  viewport: { x: number; y: number; scale: number },
  point: { x: number; y: number },
  nextScale: number,
) {
  const worldX = (point.x - viewport.x) / viewport.scale;
  const worldY = (point.y - viewport.y) / viewport.scale;
  return {
    x: point.x - worldX * nextScale,
    y: point.y - worldY * nextScale,
    scale: nextScale,
  };
}

export function selectionBounds(selection: CanvasSelection) {
  const left = Math.min(selection.startX, selection.currentX);
  const top = Math.min(selection.startY, selection.currentY);
  return {
    left,
    top,
    width: Math.abs(selection.currentX - selection.startX),
    height: Math.abs(selection.currentY - selection.startY),
  };
}

export function intersects(
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number },
) {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

export function cardTone(card: CanvasCard) {
  if (card.kind === "asset") return "border-g-line";
  if (card.kind === "comment") return "border-g-amber/50";
  if (card.kind === "assistant") return "border-g-purple/50";
  if (card.kind === "variant") return "border-g-blue/50";
  return "border-g-green/50";
}
