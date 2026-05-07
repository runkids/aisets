import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, ZoomableImage, type TabItem } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/ui";

type AssetInfo = {
  thumbnailUrl: string;
  url: string;
  repoPath: string;
  bytes: number;
  width: number;
  height: number;
  ext: string;
};

type Props = {
  currentAsset: AssetInfo;
  similarAsset: AssetInfo;
  similarity: number;
  mirrored: boolean;
};

type Mode = "side" | "overlay" | "diff";

const DIFF_THRESHOLD = 20;

function drawPixelDiff(canvas: HTMLCanvasElement, urlA: string, urlB: string) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const imgA = new Image();
  const imgB = new Image();
  imgA.crossOrigin = "anonymous";
  imgB.crossOrigin = "anonymous";

  let loaded = 0;
  const onLoad = () => {
    loaded++;
    if (loaded < 2) return;

    const w = Math.max(imgA.naturalWidth, imgB.naturalWidth);
    const h = Math.max(imgA.naturalHeight, imgB.naturalHeight);
    canvas.width = w;
    canvas.height = h;

    const offA = document.createElement("canvas");
    offA.width = w;
    offA.height = h;
    offA.getContext("2d")!.drawImage(imgA, 0, 0, w, h);

    const offB = document.createElement("canvas");
    offB.width = w;
    offB.height = h;
    offB.getContext("2d")!.drawImage(imgB, 0, 0, w, h);

    const dataA = offA.getContext("2d")!.getImageData(0, 0, w, h).data;
    const dataB = offB.getContext("2d")!.getImageData(0, 0, w, h).data;
    const out = ctx.createImageData(w, h);

    for (let i = 0; i < dataA.length; i += 4) {
      const dr = Math.abs(dataA[i] - dataB[i]);
      const dg = Math.abs(dataA[i + 1] - dataB[i + 1]);
      const db = Math.abs(dataA[i + 2] - dataB[i + 2]);
      const diff =
        dr > DIFF_THRESHOLD || dg > DIFF_THRESHOLD || db > DIFF_THRESHOLD;

      if (diff) {
        out.data[i] = 220;
        out.data[i + 1] = 40;
        out.data[i + 2] = 40;
      } else {
        const gray = Math.round(
          0.299 * dataA[i] + 0.587 * dataA[i + 1] + 0.114 * dataA[i + 2],
        );
        out.data[i] = gray;
        out.data[i + 1] = gray;
        out.data[i + 2] = gray;
      }
      out.data[i + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
  };

  imgA.onload = onLoad;
  imgB.onload = onLoad;
  imgA.src = urlA;
  imgB.src = urlB;
}

function fileName(path: string) {
  return path.split("/").pop() ?? path;
}

export function SimilarCompare({
  currentAsset,
  similarAsset,
  similarity,
  mirrored,
}: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("side");
  const [opacity, setOpacity] = useState(0.5);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const tabItems: TabItem<Mode>[] = [
    { value: "side", label: t("assetDrawer.similarSideBySide") },
    { value: "overlay", label: t("assetDrawer.similarOverlay") },
    { value: "diff", label: t("assetDrawer.similarDiff") },
  ];

  useEffect(() => {
    if (mode === "diff" && canvasRef.current) {
      drawPixelDiff(canvasRef.current, currentAsset.url, similarAsset.url);
    }
  }, [mode, currentAsset.url, similarAsset.url]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Tabs
          value={mode}
          items={tabItems}
          onChange={setMode}
          ariaLabel="Comparison mode"
          size="sm"
        />
        <div className="flex items-center gap-2 text-g-caption text-g-ink-2">
          <span>{t("assetDrawer.similarScore", { score: similarity })}</span>
          {mirrored && (
            <span className="rounded-g-md bg-g-surface-2 border border-g-line px-1.5 py-0.5 text-g-chip">
              {t("assetDrawer.similarMirrored")}
            </span>
          )}
        </div>
      </div>

      <div className="rounded-g-md border border-g-line bg-g-surface-2 p-3">
        {mode === "side" && (
          <div className="flex gap-3">
            {[currentAsset, similarAsset].map((asset) => (
              <div
                key={asset.repoPath}
                className="flex flex-1 flex-col items-center gap-2"
              >
                <ZoomableImage
                  key={asset.url}
                  src={asset.url}
                  alt={fileName(asset.repoPath)}
                  className="aspect-[4/3] w-full"
                />
                <span className="max-w-full truncate font-g-mono text-g-caption text-g-ink-2">
                  {fileName(asset.repoPath)}
                </span>
                <span className="text-g-caption text-g-ink-3">
                  {asset.width}×{asset.height} · {formatBytes(asset.bytes)}
                </span>
              </div>
            ))}
          </div>
        )}

        {mode === "overlay" && (
          <div className="flex flex-col gap-3">
            <div
              className="relative flex items-center justify-center"
              style={{ minHeight: 200 }}
            >
              <img
                src={currentAsset.thumbnailUrl}
                alt={fileName(currentAsset.repoPath)}
                className="max-h-60 w-full object-contain"
              />
              <img
                src={similarAsset.thumbnailUrl}
                alt={fileName(similarAsset.repoPath)}
                className="absolute inset-0 max-h-60 w-full object-contain"
                style={{ opacity }}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="shrink-0 truncate text-g-caption text-g-ink-3 max-w-24">
                {fileName(currentAsset.repoPath)}
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-g-line accent-g-active-text"
                aria-label="Overlay opacity"
              />
              <span className="shrink-0 truncate text-g-caption text-g-ink-3 max-w-24">
                {fileName(similarAsset.repoPath)}
              </span>
            </div>
          </div>
        )}

        {mode === "diff" && (
          <div className="flex flex-col items-center gap-2">
            <canvas
              ref={canvasRef}
              className="max-h-60 w-full object-contain"
            />
            <div className="flex items-center gap-3 text-g-caption text-g-ink-3">
              <span className="flex items-center gap-1">
                <span className="inline-block size-2.5 rounded-full bg-red-500" />
                Difference
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block size-2.5 rounded-full bg-g-ink-3" />
                Identical
              </span>
            </div>
          </div>
        )}
      </div>

      <div
        className={cn(
          "grid grid-cols-3 gap-px overflow-hidden rounded-g-md border border-g-line bg-g-line",
        )}
      >
        {[
          {
            label: t("assetDrawer.dimensions"),
            a: `${currentAsset.width}×${currentAsset.height}`,
            b: `${similarAsset.width}×${similarAsset.height}`,
          },
          {
            label: t("assetDrawer.size"),
            a: formatBytes(currentAsset.bytes),
            b: formatBytes(similarAsset.bytes),
          },
          {
            label: t("assetDrawer.format"),
            a: currentAsset.ext.toUpperCase().replace(".", ""),
            b: similarAsset.ext.toUpperCase().replace(".", ""),
          },
        ].map((row) => (
          <div
            key={row.label}
            className="flex flex-col items-center gap-1 bg-g-surface-2 px-3 py-2"
          >
            <span className="text-g-chip text-g-ink-3">{row.label}</span>
            <span className="font-g-mono text-g-caption text-g-ink">
              {row.a}
            </span>
            <span className="font-g-mono text-g-caption text-g-ink-2">
              {row.b}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
