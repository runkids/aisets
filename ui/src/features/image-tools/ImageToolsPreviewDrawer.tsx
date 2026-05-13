import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  Check,
  GripVertical,
  LoaderCircle,
  MapPin,
  Shield,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  getImageToolMetadata,
  previewImageUrl,
  renderImageToolPreview,
  type ImageToolMetadata,
  type ImageToolSettings,
  type RenderPreviewResponse,
} from "@/api";
import { basePath } from "@/api/client";
import type { AssetItem } from "@/types";
import { formatBytes } from "@/ui";
import { Badge, Button, IconButton } from "@/components/ui";
import {
  DialogDrawerSurface,
  DialogOverlay,
} from "@/components/ui/DialogShell";

type FormatPreview = {
  format: string;
  label: string;
  loading: boolean;
  data?: RenderPreviewResponse;
  error?: string;
};

const FORMAT_CARDS: { format: string; label: string }[] = [
  { format: "webp", label: "WebP" },
  { format: "avif", label: "AVIF" },
  { format: "jpg", label: "JPEG" },
  { format: "png", label: "PNG" },
];

type Props = {
  asset: AssetItem | null;
  uploadFile?: File;
  settings: ImageToolSettings;
  onClose: () => void;
};

export function ImageToolsPreviewDrawer({
  asset,
  uploadFile,
  settings,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [closing, setClosing] = useState(false);
  const [sliderPos, setSliderPos] = useState(50);
  const [activeFormat, setActiveFormat] = useState(settings.outputFormat);
  const [formatPreviews, setFormatPreviews] = useState<FormatPreview[]>(() =>
    asset ? FORMAT_CARDS.map((f) => ({ ...f, loading: true })) : [],
  );
  const [metadata, setMetadata] = useState<ImageToolMetadata | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(!!asset);
  const sliderRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const isUpload = !asset && !!uploadFile;
  const displayName = asset
    ? asset.repoPath.split("/").pop() || asset.repoPath
    : uploadFile?.name || "";
  const ext = asset
    ? (asset.ext || "").replace(/^\./, "").toUpperCase()
    : (uploadFile?.name.split(".").pop() || "").toUpperCase();
  const bytes = asset ? asset.bytes : uploadFile?.size || 0;
  const dimensions =
    asset?.image?.width && asset?.image?.height
      ? `${asset.image.width}×${asset.image.height}`
      : "";
  const originalSrc = asset
    ? `${basePath}/api/assets/${encodeURIComponent(asset.id)}`
    : "";

  const requestClose = useCallback(() => {
    setClosing(true);
    setTimeout(onClose, 200);
  }, [onClose]);

  const assetId = asset?.id;

  // Load format previews for project assets
  useEffect(() => {
    if (!assetId) return;
    const controller = new AbortController();

    FORMAT_CARDS.forEach((f, i) => {
      renderImageToolPreview({
        assetId,
        outputFormat: f.format,
        quality: settings.quality,
        maxDimensionPx: settings.maxDimensionPx,
      })
        .then((data) => {
          if (controller.signal.aborted) return;
          setFormatPreviews((prev) =>
            prev.map((p, j) => (j === i ? { ...p, loading: false, data } : p)),
          );
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setFormatPreviews((prev) =>
            prev.map((p, j) =>
              j === i
                ? { ...p, loading: false, error: String(err?.message || err) }
                : p,
            ),
          );
        });
    });

    return () => controller.abort();
  }, [assetId, settings.quality, settings.maxDimensionPx]);

  // Load metadata for project assets
  useEffect(() => {
    if (!assetId) return;
    let cancelled = false;
    getImageToolMetadata(assetId)
      .then((data) => !cancelled && setMetadata(data))
      .catch(() => !cancelled && setMetadata(null))
      .finally(() => !cancelled && setMetadataLoading(false));
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  // Active format preview data (for Before/After slider)
  const activePreview = useMemo(
    () => formatPreviews.find((p) => p.format === activeFormat),
    [formatPreviews, activeFormat],
  );

  // Slider drag handlers
  const handleSliderMove = useCallback((clientX: number) => {
    if (!sliderRef.current) return;
    const rect = sliderRef.current.getBoundingClientRect();
    const pct = Math.max(
      0,
      Math.min(100, ((clientX - rect.left) / rect.width) * 100),
    );
    setSliderPos(pct);
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      handleSliderMove(e.clientX);
    },
    [handleSliderMove],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      handleSliderMove(e.clientX);
    },
    [handleSliderMove],
  );

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  const handleFormatClick = useCallback((format: string) => {
    setActiveFormat(format);
  }, []);

  const metadataFields = useMemo(() => {
    if (!metadata?.hasExif) return [];
    const fields: { label: string; value: string }[] = [];
    if (metadata.cameraMake || metadata.cameraModel) {
      fields.push({
        label: t("imageTools.metadataCamera"),
        value: [metadata.cameraMake, metadata.cameraModel]
          .filter(Boolean)
          .join(" "),
      });
    }
    if (metadata.gpsLatitude != null && metadata.gpsLongitude != null) {
      fields.push({
        label: t("imageTools.metadataGps"),
        value: `${metadata.gpsLatitude.toFixed(6)}, ${metadata.gpsLongitude.toFixed(6)}`,
      });
    }
    if (metadata.dateTimeOriginal) {
      fields.push({
        label: t("imageTools.metadataDate"),
        value: metadata.dateTimeOriginal,
      });
    }
    if (metadata.dpiX || metadata.dpiY) {
      fields.push({
        label: t("imageTools.metadataDpi"),
        value: `${metadata.dpiX || 0} × ${metadata.dpiY || 0}`,
      });
    }
    if (metadata.orientation) {
      fields.push({
        label: "Orientation",
        value: String(metadata.orientation),
      });
    }
    return fields;
  }, [metadata, t]);

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && requestClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay asChild>
          <DialogOverlay
            layer="drawer"
            style={{
              transition: "opacity 180ms var(--g-ease)",
              ...(closing ? { opacity: 0 } : {}),
            }}
          />
        </DialogPrimitive.Overlay>
        <DialogPrimitive.Content asChild>
          <DialogDrawerSurface
            className="!w-[720px]"
            style={{
              transition: "transform 200ms var(--g-ease)",
              ...(closing ? { transform: "translateX(100%)" } : {}),
            }}
          >
            {/* Header */}
            <header className="flex items-start gap-3 border-b border-g-line px-5 pb-3 pt-4">
              <div className="min-w-0 flex-1">
                <DialogPrimitive.Title asChild>
                  <h2 className="truncate font-g-mono text-g-body font-[590] text-g-ink">
                    {displayName}
                  </h2>
                </DialogPrimitive.Title>
                <div className="mt-0.5 flex items-center gap-1.5 text-g-chip text-g-ink-4">
                  <Badge tone="default">{ext}</Badge>
                  <span>{formatBytes(bytes)}</span>
                  {dimensions && <span>· {dimensions}</span>}
                </div>
              </div>
              <DialogPrimitive.Close asChild>
                <IconButton size="sm" aria-label={t("common.close")}>
                  <X size={15} />
                </IconButton>
              </DialogPrimitive.Close>
            </header>

            {/* Scrollable body */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* Upload-only message */}
              {isUpload && (
                <div className="px-5 py-8 text-center text-g-ui text-g-ink-4">
                  {t("imageTools.uploadPreviewOnly")}
                </div>
              )}

              {/* Before/After Slider (project assets only) */}
              {asset && (
                <section className="border-b border-g-line px-5 py-4">
                  <h3 className="mb-2 text-g-ui font-[590] text-g-ink">
                    {t("imageTools.beforeAfter")}
                  </h3>
                  {activePreview?.loading ? (
                    <div className="flex h-[280px] items-center justify-center rounded-g-md bg-g-surface-2">
                      <LoaderCircle
                        size={20}
                        className="animate-spin text-g-ink-4"
                      />
                    </div>
                  ) : (
                    <div
                      ref={sliderRef}
                      className="relative h-[280px] cursor-col-resize select-none overflow-hidden rounded-g-md bg-g-surface-2"
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                    >
                      {/* Original (full width, behind) */}
                      <img
                        src={originalSrc}
                        alt={t("imageTools.original")}
                        className="absolute inset-0 h-full w-full object-contain"
                        draggable={false}
                      />
                      {/* Compressed (clipped from left) */}
                      {activePreview?.data?.token && (
                        <img
                          src={previewImageUrl(activePreview.data.token)}
                          alt={t("imageTools.compressed")}
                          className="absolute inset-0 h-full w-full object-contain"
                          style={{
                            clipPath: `inset(0 0 0 ${sliderPos}%)`,
                          }}
                          draggable={false}
                        />
                      )}
                      {/* Divider line */}
                      <div
                        className="absolute top-0 bottom-0 z-10 w-0.5 bg-white shadow-[0_0_4px_rgba(0,0,0,0.5)]"
                        style={{ left: `${sliderPos}%` }}
                      >
                        <div className="absolute top-1/2 left-1/2 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white shadow-g-md">
                          <GripVertical size={14} className="text-g-ink-3" />
                        </div>
                      </div>
                      {/* Labels */}
                      <span className="absolute top-2 left-2 rounded-g-sm bg-black/50 px-1.5 py-0.5 text-g-chip font-[500] text-white backdrop-blur">
                        {t("imageTools.original")}
                      </span>
                      <span className="absolute top-2 right-2 rounded-g-sm bg-black/50 px-1.5 py-0.5 text-g-chip font-[500] text-white backdrop-blur">
                        {t("imageTools.compressed")}
                      </span>
                    </div>
                  )}
                  {/* Size comparison below slider */}
                  {activePreview?.data && (
                    <div className="mt-2 flex items-center justify-between text-g-chip text-g-ink-4">
                      <span>
                        {formatBytes(activePreview.data.inputBytes)} →{" "}
                        {formatBytes(activePreview.data.outputBytes)}
                      </span>
                      <SavingsBadge
                        inputBytes={activePreview.data.inputBytes}
                        outputBytes={activePreview.data.outputBytes}
                      />
                    </div>
                  )}
                </section>
              )}

              {/* Format Comparison Grid (project assets only) */}
              {asset && (
                <section className="border-b border-g-line px-5 py-4">
                  <h3 className="mb-2 text-g-ui font-[590] text-g-ink">
                    {t("imageTools.formatCompare")}
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {formatPreviews.map((fp) => (
                      <button
                        key={fp.format}
                        type="button"
                        className={cn(
                          "relative flex flex-col items-start gap-1 rounded-g-md border p-3 text-left transition-colors duration-100",
                          fp.format === activeFormat
                            ? "border-g-accent bg-g-accent/5"
                            : "border-g-line bg-g-surface hover:border-g-line-strong",
                        )}
                        onClick={() =>
                          !fp.loading && handleFormatClick(fp.format)
                        }
                        disabled={fp.loading}
                      >
                        <div className="flex w-full items-center justify-between">
                          <span className="font-g-mono text-g-ui font-[590] text-g-ink">
                            {fp.label}
                          </span>
                          {fp.format === activeFormat && (
                            <Check
                              size={14}
                              className="text-g-accent"
                              strokeWidth={2.5}
                            />
                          )}
                        </div>
                        {fp.loading ? (
                          <div className="h-4 w-20 animate-pulse rounded bg-g-surface-2" />
                        ) : fp.error ? (
                          <span className="text-g-chip text-g-red">
                            {t("imageTools.failed")}
                          </span>
                        ) : fp.data ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-g-chip text-g-ink-3">
                              {formatBytes(fp.data.outputBytes)}
                            </span>
                            <SavingsBadge
                              inputBytes={fp.data.inputBytes}
                              outputBytes={fp.data.outputBytes}
                            />
                          </div>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* EXIF Metadata Section */}
              {asset && (
                <section className="px-5 py-4">
                  <h3 className="mb-2 text-g-ui font-[590] text-g-ink">
                    {t("imageTools.metadata")}
                  </h3>
                  {metadataLoading ? (
                    <div className="flex h-16 items-center justify-center">
                      <LoaderCircle
                        size={16}
                        className="animate-spin text-g-ink-4"
                      />
                    </div>
                  ) : metadataFields.length === 0 ? (
                    <p className="text-g-ui text-g-ink-4">
                      {t("imageTools.noExif")}
                    </p>
                  ) : (
                    <>
                      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                        {metadataFields.map((field) => (
                          <div key={field.label} className="contents">
                            <span className="text-g-chip font-[500] text-g-ink-4">
                              {field.label}
                            </span>
                            <span className="truncate font-g-mono text-g-chip text-g-ink">
                              {field.value}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Button variant="secondary" size="sm">
                          <Shield size={14} />
                          {t("imageTools.stripAll")}
                        </Button>
                        {metadata?.gpsLatitude != null && (
                          <Button variant="secondary" size="sm">
                            <MapPin size={14} />
                            {t("imageTools.stripGps")}
                          </Button>
                        )}
                      </div>
                    </>
                  )}
                </section>
              )}
            </div>
          </DialogDrawerSurface>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function SavingsBadge({
  inputBytes,
  outputBytes,
}: {
  inputBytes: number;
  outputBytes: number;
}) {
  const { t } = useTranslation();
  const diff = inputBytes - outputBytes;
  const pct =
    inputBytes > 0 ? Math.round((Math.abs(diff) / inputBytes) * 100) : 0;
  if (diff > 0) {
    return (
      <span
        className={cn(
          "rounded-g-sm px-1 py-0.5 text-g-chip font-[500]",
          pct > 20
            ? "bg-g-green-soft text-g-green"
            : "bg-g-amber-soft text-g-amber",
        )}
      >
        {t("imageTools.compressionPct", { pct })}
      </span>
    );
  }
  if (diff < 0) {
    return (
      <span className="rounded-g-sm bg-g-surface-2 px-1 py-0.5 text-g-chip font-[500] text-g-ink-4">
        {t("imageTools.sizeIncrease", { pct })}
      </span>
    );
  }
  return (
    <span className="text-g-chip text-g-ink-4">
      {t("imageTools.noSavings")}
    </span>
  );
}
