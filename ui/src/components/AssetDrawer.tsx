import { Check, Copy, ExternalLink, Pencil, Trash2, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useSettingsQuery } from "../queries";
import type { AssetItem } from "../types";
import { fileName, formatBytes } from "../ui";
import { AssetDrawerOCR } from "./AssetDrawerOCR";
import { AssetDrawerOptimize } from "./AssetDrawerOptimize";
import { AssetDrawerOverview } from "./AssetDrawerOverview";
import { AssetDrawerSimilar } from "./AssetDrawerSimilar";
import { AssetDrawerUsage } from "./AssetDrawerUsage";
import {
  AssetThumbnail,
  Badge,
  Button,
  IconButton,
  Tabs,
  Tooltip,
  type TabItem,
} from "./ui";
import { DialogDrawerSurface, DialogOverlay } from "./ui/DialogShell";

const copyText = (text: string) => {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    return;
  }
  fallbackCopy(text);
};

const fallbackCopy = (text: string) => {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
};

type DrawerTab = "overview" | "usage" | "similar" | "optimize" | "ocr";

type Props = {
  asset: AssetItem;
  onClose: () => void;
  onRename?: (item: AssetItem) => void;
  onDelete?: (item: AssetItem) => void;
  onOpenAsset?: (id: string) => void;
};

export function AssetDrawer({
  asset,
  onClose,
  onRename,
  onDelete,
  onOpenAsset,
}: Props) {
  const { t } = useTranslation();
  const [rawTab, setRawTab] = useState<DrawerTab>("overview");
  const [copiedPath, setCopiedPath] = useState("");
  const settingsQuery = useSettingsQuery();
  const ocrVisible = Boolean(
    settingsQuery.data?.settings.ocrEnabled && asset.ocr,
  );
  const preferredEditor =
    settingsQuery.data?.settings.preferredEditor ?? "vscode";

  const dimensions =
    asset.image.width > 0 && asset.image.height > 0
      ? `${asset.image.width} × ${asset.image.height}`
      : null;
  const similarCount = asset.duplicates.length + asset.similar.length;
  const isUnused = asset.references.length === 0;

  const tabs = useMemo(() => {
    const items: TabItem<DrawerTab>[] = [
      { value: "overview", label: t("assetDrawer.tabOverview") },
      {
        value: "usage",
        label: t("assetDrawer.tabUsage"),
        badge: (
          <Badge tone="line" className="h-[18px] px-1.5 text-[10px]">
            {asset.references.length}
          </Badge>
        ),
      },
    ];
    if (similarCount > 0) {
      items.push({
        value: "similar",
        label: t("assetDrawer.tabSimilar"),
        badge: (
          <Badge tone="line" className="h-[18px] px-1.5 text-[10px]">
            {similarCount}
          </Badge>
        ),
      });
    }
    if (asset.optimizationRecommendations.length > 0) {
      items.push({
        value: "optimize",
        label: t("assetDrawer.tabOptimize"),
        badge: (
          <Badge tone="amber" className="h-[18px] px-1.5 text-[10px]">
            {asset.optimizationRecommendations.length}
          </Badge>
        ),
      });
    }
    if (ocrVisible) {
      items.push({ value: "ocr", label: t("assetDrawer.tabOCR") });
    }
    return items;
  }, [asset, ocrVisible, similarCount, t]);

  const tabValues = useMemo(() => tabs.map((t) => t.value), [tabs]);
  const tab = tabValues.includes(rawTab) ? rawTab : "overview";

  const handleTabChange = useCallback(
    (value: DrawerTab) => {
      if (tabValues.includes(value)) setRawTab(value);
    },
    [tabValues],
  );

  const pathCopied = copiedPath === asset.repoPath;

  useEffect(() => {
    if (!copiedPath) return;
    const timer = window.setTimeout(() => setCopiedPath(""), 1500);
    return () => window.clearTimeout(timer);
  }, [copiedPath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const idx = tabValues.indexOf(tab);
        if (idx === -1) return;
        const next =
          e.key === "ArrowLeft"
            ? tabValues[Math.max(0, idx - 1)]
            : tabValues[Math.min(tabValues.length - 1, idx + 1)];
        setRawTab(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, tabValues]);

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay asChild>
          <DialogOverlay layer="drawer" />
        </DialogPrimitive.Overlay>
        <DialogPrimitive.Content asChild>
          <DialogDrawerSurface>
            <header className="relative flex flex-col gap-3.5 border-b border-g-line bg-gradient-to-b from-g-surface-2 to-g-surface px-5 pb-3.5 pt-4 max-[600px]:px-4">
              <DialogPrimitive.Close asChild>
                <IconButton
                  size="sm"
                  aria-label={t("common.close")}
                  className="absolute right-3 top-3 z-10"
                >
                  <X size={15} />
                </IconButton>
              </DialogPrimitive.Close>

              <div className="grid grid-cols-[104px_minmax(0,1fr)] items-start gap-4 pr-9 max-[600px]:grid-cols-[84px_minmax(0,1fr)] max-[600px]:gap-3">
                <AssetThumbnail
                  src={asset.thumbnailUrl || asset.url}
                  alt={fileName(asset.repoPath)}
                  size="fill"
                  loading="eager"
                  className="size-[104px] rounded-g-lg p-1.5 max-[600px]:size-[84px] [&_img]:max-h-full [&_img]:max-w-full"
                />

                <div className="min-w-0">
                  <DialogPrimitive.Title asChild>
                    <h2
                      className="line-clamp-2 break-all font-g-display text-lg font-[650] leading-tight tracking-[-0.025em] text-g-ink"
                      title={fileName(asset.repoPath)}
                    >
                      {fileName(asset.repoPath)}
                    </h2>
                  </DialogPrimitive.Title>
                  <div
                    className="mt-1 overflow-hidden text-ellipsis whitespace-nowrap font-g-mono text-g-ui text-g-ink-3"
                    title={asset.repoPath}
                  >
                    {asset.repoPath}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                    <HeroStat
                      label={t("assetDrawer.format")}
                      value={asset.ext.replace(".", "").toUpperCase()}
                    />
                    {dimensions && (
                      <HeroStat
                        label={t("assetDrawer.dimensions")}
                        value={dimensions}
                      />
                    )}
                    <HeroStat
                      label={t("assetDrawer.size")}
                      value={formatBytes(asset.bytes)}
                    />
                    <HeroStat
                      label={t("assetDrawer.usedFiles")}
                      value={asset.references.length.toString()}
                    />
                  </div>

                  {(isUnused ||
                    asset.duplicates.length > 0 ||
                    asset.similar.length > 0 ||
                    asset.optimizationRecommendations.length > 0 ||
                    ocrVisible) && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {isUnused && (
                        <HeroBadgeButton
                          onClick={() => handleTabChange("usage")}
                        >
                          <Badge tone="red">
                            {t("assetDrawer.chipUnused")}
                          </Badge>
                        </HeroBadgeButton>
                      )}
                      {asset.duplicates.length > 0 && (
                        <HeroBadgeButton
                          onClick={() => handleTabChange("similar")}
                        >
                          <Badge tone="amber">
                            {t("assetDrawer.chipDuplicate")}
                          </Badge>
                        </HeroBadgeButton>
                      )}
                      {asset.similar.length > 0 && (
                        <HeroBadgeButton
                          onClick={() => handleTabChange("similar")}
                        >
                          <Badge tone="purple">
                            {t("assetDrawer.chipSimilar")}
                          </Badge>
                        </HeroBadgeButton>
                      )}
                      {asset.optimizationRecommendations.length > 0 && (
                        <HeroBadgeButton
                          onClick={() => handleTabChange("optimize")}
                        >
                          <Badge tone="blue">
                            {t("assetDrawer.chipOptimizable")}
                          </Badge>
                        </HeroBadgeButton>
                      )}
                      {ocrVisible && asset.ocr && (
                        <HeroBadgeButton onClick={() => handleTabChange("ocr")}>
                          <Badge
                            tone={
                              asset.ocr.status === "ready"
                                ? "green"
                                : asset.ocr.status === "failed"
                                  ? "red"
                                  : asset.ocr.status === "skipped"
                                    ? "amber"
                                    : "line"
                            }
                          >
                            {t("assetDrawer.chipOCR")}
                          </Badge>
                        </HeroBadgeButton>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  leadingIcon={<ExternalLink size={14} />}
                  onClick={() => window.open(asset.url, "_blank", "noopener")}
                >
                  {t("action.openFile")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  leadingIcon={
                    pathCopied ? <Check size={14} /> : <Copy size={14} />
                  }
                  onClick={() => {
                    copyText(asset.repoPath);
                    setCopiedPath(asset.repoPath);
                  }}
                >
                  {pathCopied ? t("toast.copied") : t("action.copyPath")}
                </Button>
                {onRename && (
                  <Tooltip label={t("action.rename")}>
                    <IconButton
                      size="sm"
                      onClick={() => onRename(asset)}
                      aria-label={t("action.rename")}
                    >
                      <Pencil size={14} />
                    </IconButton>
                  </Tooltip>
                )}
                {onDelete && asset.usedBy.length === 0 && (
                  <Tooltip label={t("action.delete")}>
                    <IconButton
                      size="sm"
                      onClick={() => onDelete(asset)}
                      aria-label={t("action.delete")}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </Tooltip>
                )}
              </div>
            </header>

            <div className="sticky top-0 z-10 bg-g-surface">
              <Tabs
                value={tab}
                items={tabs}
                onChange={handleTabChange}
                ariaLabel="Asset detail tabs"
                variant="underline"
                size="sm"
              />
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5 max-[600px]:p-4">
              {tab === "overview" && <AssetDrawerOverview asset={asset} />}
              {tab === "usage" && (
                <AssetDrawerUsage
                  references={asset.references}
                  preferredEditor={preferredEditor}
                />
              )}
              {tab === "similar" && (
                <AssetDrawerSimilar asset={asset} onOpenAsset={onOpenAsset} />
              )}
              {tab === "optimize" && (
                <AssetDrawerOptimize
                  recommendations={asset.optimizationRecommendations}
                />
              )}
              {tab === "ocr" && ocrVisible && asset.ocr && (
                <AssetDrawerOCR ocr={asset.ocr} />
              )}
            </div>
          </DialogDrawerSurface>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-g-ink-4">
        {label}
      </span>
      <span className="font-g-mono text-g-caption text-g-ink tabular-nums">
        {value}
      </span>
    </span>
  );
}

function HeroBadgeButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="rounded-g-pill focus-visible:outline-none focus-visible:shadow-g-focus"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
