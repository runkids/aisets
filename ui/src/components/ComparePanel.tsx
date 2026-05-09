import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TabItem } from "@/components/ui";
import { Range } from "@/components/ui";
import {
  imageBackgroundClassName,
  useImageBackgroundMode,
} from "@/imageBackground";
import { cn } from "@/lib/cn";
import { fileName, formatBytes } from "@/ui";
import type { CompareAsset, CompareMode } from "./compareTypes";

export type { CompareAsset, CompareMode };

const DIFF_THRESHOLD = 20;

function drawPixelDiff(
  canvas: HTMLCanvasElement,
  urlA: string,
  urlB: string,
  cancelled: { current: boolean },
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const imgA = new Image();
  const imgB = new Image();
  imgA.crossOrigin = "anonymous";
  imgB.crossOrigin = "anonymous";

  let loaded = 0;
  const onLoad = () => {
    loaded++;
    if (loaded < 2 || cancelled.current) return;

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

// eslint-disable-next-line react-refresh/only-export-components
export function useCompareTabs(): TabItem<CompareMode>[] {
  const { t } = useTranslation();
  return [
    { value: "side", label: t("compare.side") },
    { value: "blend", label: t("compare.blend") },
    { value: "overlay", label: t("compare.overlay") },
    { value: "diff", label: t("compare.diff") },
  ];
}

type Props = {
  left: CompareAsset;
  right: CompareAsset;
  mode: CompareMode;
  compact?: boolean;
};

export function ComparePanel({ left, right, mode, compact }: Props) {
  const { t } = useTranslation();
  const bgMode = useImageBackgroundMode();
  const [opacity, setOpacity] = useState(50);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (mode !== "diff" || !canvasRef.current) return;
    const cancelled = { current: false };
    drawPixelDiff(canvasRef.current, left.url, right.url, cancelled);
    return () => {
      cancelled.current = true;
    };
  }, [mode, left.url, right.url]);

  const bgCn = imageBackgroundClassName(bgMode);

  const sidePanelCn = cn(
    "relative aspect-[4/3] w-full overflow-hidden rounded-g-md",
    bgCn,
  );

  return (
    <div className="flex flex-col gap-3">
      {mode === "side" && (
        <div className="flex gap-3">
          {[left, right].map((asset) => (
            <div
              key={asset.repoPath}
              className="flex flex-1 flex-col items-center gap-2"
            >
              <div className={sidePanelCn}>
                <img
                  src={asset.url}
                  alt={fileName(asset.repoPath)}
                  className="absolute inset-0 h-full w-full object-contain"
                />
              </div>
              <span className="max-w-full truncate font-g-mono text-g-caption text-g-ink-2">
                {fileName(asset.repoPath)}
              </span>
            </div>
          ))}
        </div>
      )}

      {(mode === "blend" || mode === "overlay") && (
        <OverlayView
          left={left}
          right={right}
          bgCn={bgCn}
          opacity={opacity}
          onOpacityChange={setOpacity}
          blend={mode === "blend"}
          compact={compact}
          label={t(
            mode === "blend"
              ? "compare.blendOpacity"
              : "compare.overlayOpacity",
          )}
        />
      )}

      {mode === "diff" && (
        <div
          className={cn(
            "flex flex-col items-center gap-2",
            !compact && "mx-auto w-full max-w-md",
          )}
        >
          <canvas ref={canvasRef} className="max-h-60 w-full object-contain" />
          <div className="flex items-center gap-3 text-g-caption text-g-ink-3">
            <span className="flex items-center gap-1">
              <span className="inline-block size-2.5 rounded-full bg-red-500" />
              {t("compare.diffDifference")}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block size-2.5 rounded-full bg-g-ink-3" />
              {t("compare.diffIdentical")}
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-g-md border border-g-line bg-g-line">
        {[
          {
            label: t("assetDrawer.dimensions"),
            a: `${left.width}×${left.height}`,
            b: `${right.width}×${right.height}`,
          },
          {
            label: t("assetDrawer.size"),
            a: formatBytes(left.bytes),
            b: formatBytes(right.bytes),
          },
          {
            label: t("assetDrawer.format"),
            a: left.ext.toUpperCase().replace(".", ""),
            b: right.ext.toUpperCase().replace(".", ""),
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

function OverlayView({
  left,
  right,
  bgCn,
  opacity,
  onOpacityChange,
  blend,
  compact,
  label,
}: {
  left: CompareAsset;
  right: CompareAsset;
  bgCn: string;
  opacity: number;
  onOpacityChange: (v: number) => void;
  blend?: boolean;
  compact?: boolean;
  label: string;
}) {
  const leftSrc = left.thumbnailUrl || left.url;
  const rightSrc = right.thumbnailUrl || right.url;

  return (
    <div
      className={cn(
        "flex flex-col gap-3",
        !compact && "mx-auto w-full max-w-md",
      )}
    >
      <div
        className={cn(
          "overflow-hidden rounded-g-md",
          compact
            ? "relative flex items-center justify-center"
            : "relative aspect-square border border-g-line",
          bgCn,
        )}
        style={compact ? { minHeight: 200 } : undefined}
      >
        <img
          src={leftSrc}
          alt=""
          className={
            compact
              ? "max-h-60 w-full object-contain"
              : "absolute inset-0 size-full object-contain"
          }
        />
        <img
          src={rightSrc}
          alt=""
          className={cn(
            compact
              ? "absolute inset-0 max-h-60 w-full object-contain"
              : "absolute inset-0 size-full object-contain",
            blend && "mix-blend-difference",
          )}
          style={{ opacity: opacity / 100 }}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="max-w-24 shrink-0 truncate text-g-caption text-g-ink-3">
          {fileName(left.repoPath)}
        </span>
        <Range
          min={0}
          max={100}
          value={opacity}
          onChange={(e) => onOpacityChange(Number(e.target.value))}
          aria-label={label}
        />
        <span className="max-w-24 shrink-0 truncate text-g-caption text-g-ink-3">
          {fileName(right.repoPath)}
        </span>
      </div>
    </div>
  );
}
