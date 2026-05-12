import {
  CheckCircle,
  Copy,
  Download,
  ExternalLink,
  FileCode,
  LoaderCircle,
  Pencil,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useFavoriteAssetMutation, useSettingsQuery } from "../../queries";
import { errorMessage } from "../../i18n";
import {
  canDeleteUnused,
  notApplicableUsageLabel,
  usageClassification,
} from "../../projectScanIntent";
import type { AssetItem, NearDuplicate } from "../../types";
import { cn } from "../../lib/cn";
import { fileName, formatBytes } from "../../ui";
import { AssetDrawerAI } from "./AssetDrawerAI";
import { AssetDrawerOCR } from "./AssetDrawerOCR";
import { AssetDrawerOptimize } from "./AssetDrawerOptimize";
import { AssetDrawerTags } from "./AssetDrawerTags";
import {
  useOptimizeVariants,
  type VariantInfo,
} from "../optimize/useOptimizeVariants";
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
} from "../ui";
import { DialogDrawerSurface, DialogOverlay } from "../ui/DialogShell";
import { useToast } from "../shared/ToastProvider";
import { FavoriteButton } from "../shared/FavoriteButton";

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

const absoluteAssetUrl = (url: string) =>
  new URL(url, window.location.href).href;

const downloadAsset = (url: string, name: string) => {
  const link = document.createElement("a");
  link.href = absoluteAssetUrl(url);
  link.download = name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const EDITOR_SCHEMES: Record<string, (path: string, line: number) => string> = {
  vscode: (p, l) => `vscode://file/${p}:${l}`,
  cursor: (p, l) => `cursor://file/${p}:${l}`,
  windsurf: (p, l) => `windsurf://file/${p}:${l}`,
  antigravity: (p, l) => `antigravity://file/${p}:${l}`,
  trae: (p, l) => `trae://file/${p}:${l}`,
  webstorm: (p, l) =>
    `jetbrains://webstorm/navigate/reference?path=${p}&line=${l}`,
  idea: (p, l) => `jetbrains://idea/navigate/reference?path=${p}&line=${l}`,
  goland: (p, l) => `jetbrains://goland/navigate/reference?path=${p}&line=${l}`,
  pycharm: (p, l) =>
    `jetbrains://pycharm/navigate/reference?path=${p}&line=${l}`,
  rubymine: (p, l) =>
    `jetbrains://rubymine/navigate/reference?path=${p}&line=${l}`,
  phpstorm: (p, l) =>
    `jetbrains://phpstorm/navigate/reference?path=${p}&line=${l}`,
  zed: (p, l) => `zed://file/${p}:${l}`,
  sublime: (p, l) => `subl://open?url=file://${p}&line=${l}`,
};

function editorUrl(editor: string, path: string, line: number) {
  return (EDITOR_SCHEMES[editor] ?? EDITOR_SCHEMES.vscode)(path, line);
}

function projectRoot(localPath: string, repoPath: string) {
  if (localPath.endsWith(repoPath)) {
    return localPath.slice(0, localPath.length - repoPath.length);
  }
  return "";
}

type DrawerTab =
  | "overview"
  | "usage"
  | "similar"
  | "optimize"
  | "ocr"
  | "tags"
  | "ai";

type Props = {
  asset: AssetItem;
  assetIds?: string[];
  scanId?: number;
  onClose: () => void;
  onRename?: (item: AssetItem) => void;
  onDelete?: (item: AssetItem) => void;
  onOpenAsset?: (id: string) => void;
  duplicateItems?: AssetItem[];
  similarItems?: AssetItem[];
  nearDuplicates?: NearDuplicate[];
  detailLoading?: boolean;
  detailError?: string;
  onRetryDetail?: () => void;
};

export function AssetDrawer({
  asset,
  assetIds,
  scanId,
  onClose,
  onRename,
  onDelete,
  onOpenAsset,
  duplicateItems = [],
  similarItems = [],
  nearDuplicates = [],
  detailLoading = false,
  detailError,
  onRetryDetail,
}: Props) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [rawTab, setRawTab] = useState<DrawerTab>("overview");
  const [closing, setClosing] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  const requestClose = useCallback(() => {
    if (aiBusy) {
      toast.info(t("drawer.aiAction.busyHint"));
      return;
    }
    setClosing(true);
  }, [aiBusy, toast, t]);

  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(onClose, 220);
    return () => window.clearTimeout(timer);
  }, [closing, onClose]);
  const settingsQuery = useSettingsQuery();
  const favoriteMut = useFavoriteAssetMutation();
  const ocrVisible = Boolean(
    settingsQuery.data?.settings.ocrEnabled &&
    asset.ocr &&
    asset.ocr.status === "ready" &&
    asset.ocr.engineName !== "vlm",
  );
  const vlmOcrReady = Boolean(
    asset.ocr && asset.ocr.status === "ready" && asset.ocr.engineName === "vlm",
  );
  const llmEnabled = Boolean(settingsQuery.data?.settings.llmEnabled);
  const aiTagVisible = Boolean(
    llmEnabled ||
    (asset.aiTag && asset.aiTag.status === "ready") ||
    vlmOcrReady,
  );
  const preferredEditor =
    settingsQuery.data?.settings.preferredEditor ?? "vscode";
  const assetFileName = fileName(asset.repoPath);
  const variants = useOptimizeVariants(asset, scanId);
  const displayAICategory = asset.aiTag?.category
    ? (asset.aiTag.categoryI18n?.[i18n.language] ??
      t(`settings.aiCategory.${asset.aiTag.category}`, {
        defaultValue: asset.aiTag.category,
      }))
    : "";

  const dimensions =
    asset.image.width > 0 && asset.image.height > 0
      ? `${asset.image.width} × ${asset.image.height}`
      : null;
  const similarCount =
    (duplicateItems.length || asset.duplicates.length) +
    (similarItems.length || asset.similar.length);
  const usage = usageClassification(asset);
  const isUnused = usage === "unused";
  const isPossiblyUnused = usage === "possiblyUnused";
  const isNotApplicable = usage === "notApplicable";

  function handleToggleFavorite() {
    favoriteMut.mutate(
      {
        assetId: asset.id,
        favorite: !asset.favorite,
        scanId,
      },
      {
        onSuccess: () => {
          toast.success(
            asset.favorite
              ? t("toast.favoriteRemoved")
              : t("toast.favoriteAdded"),
          );
        },
        onError: (error) => {
          toast.error(errorMessage(error));
        },
      },
    );
  }

  async function handleShareAsset() {
    const url = absoluteAssetUrl(asset.url);
    if (navigator.share) {
      try {
        await navigator.share({
          title: assetFileName,
          text: asset.repoPath,
          url,
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    }
    copyText(url);
    toast.success(t("toast.shareLinkCopied"));
  }

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
    const hasAiTags = asset.aiTag && asset.aiTag.status === "ready";
    if (hasAiTags || llmEnabled) {
      const tagCount = asset.aiTag?.tags?.length ?? 0;
      items.push({
        value: "tags",
        label: t("assetDrawer.tabTags"),
        ...(tagCount > 0 && {
          badge: (
            <Badge tone="line" className="h-[18px] px-1.5 text-[10px]">
              {tagCount}
            </Badge>
          ),
        }),
      });
    }
    if (aiTagVisible) {
      items.push({ value: "ai", label: t("drawer.tab.ai") });
    }
    return items;
  }, [asset, llmEnabled, ocrVisible, aiTagVisible, similarCount, t]);

  const tabValues = useMemo(() => tabs.map((t) => t.value), [tabs]);
  const tab = tabValues.includes(rawTab) ? rawTab : "overview";

  const handleTabChange = useCallback(
    (value: DrawerTab) => {
      if (tabValues.includes(value)) setRawTab(value);
    },
    [tabValues],
  );

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
      if (
        (e.key === "ArrowUp" || e.key === "ArrowDown") &&
        assetIds &&
        assetIds.length > 0 &&
        onOpenAsset
      ) {
        const idx = assetIds.indexOf(asset.id);
        if (idx === -1) return;
        const nextIdx =
          e.key === "ArrowUp"
            ? Math.max(0, idx - 1)
            : Math.min(assetIds.length - 1, idx + 1);
        if (nextIdx !== idx) {
          e.preventDefault();
          onOpenAsset(assetIds[nextIdx]);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, tabValues, asset.id, assetIds, onOpenAsset]);

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
            style={{
              transition: "transform 200ms var(--g-ease)",
              ...(closing ? { transform: "translateX(100%)" } : {}),
            }}
          >
            <header className="relative flex flex-col gap-3 border-b border-g-line bg-gradient-to-b from-g-surface-2 to-g-surface px-5 pb-3 pt-3.5 max-[600px]:px-4">
              <DialogPrimitive.Close asChild>
                <IconButton
                  size="sm"
                  aria-label={t("common.close")}
                  className="absolute right-3 top-3 z-10"
                >
                  <X size={15} />
                </IconButton>
              </DialogPrimitive.Close>

              <div className="grid grid-cols-[80px_minmax(0,1fr)] items-start gap-3.5 pr-9 max-[600px]:grid-cols-[64px_minmax(0,1fr)] max-[600px]:gap-3">
                <AssetThumbnail
                  src={asset.thumbnailUrl || asset.url}
                  alt={assetFileName}
                  size="fill"
                  loading="eager"
                  className="size-[80px] rounded-g-lg p-1 max-[600px]:size-[64px] [&_img]:max-h-full [&_img]:max-w-full"
                />

                <div className="min-w-0">
                  <div className="flex min-w-0 items-start gap-2">
                    <DialogPrimitive.Title asChild>
                      <h2
                        className="line-clamp-2 min-w-0 flex-1 break-all font-g-display text-[17px] font-[590] leading-tight tracking-[-0.02em] text-g-ink"
                        title={assetFileName}
                      >
                        {assetFileName}
                      </h2>
                    </DialogPrimitive.Title>
                    {onRename && (
                      <Tooltip label={t("action.rename")}>
                        <IconButton
                          size="sm"
                          onClick={() => onRename(asset)}
                          aria-label={t("action.rename")}
                          className="mt-[-3px] shrink-0"
                        >
                          <Pencil size={14} />
                        </IconButton>
                      </Tooltip>
                    )}
                    <FavoriteButton
                      favorite={Boolean(asset.favorite)}
                      pending={favoriteMut.isPending}
                      label={
                        asset.favorite
                          ? t("favorites.remove")
                          : t("favorites.add")
                      }
                      className="mt-[-3px] shrink-0"
                      onToggle={handleToggleFavorite}
                    />
                  </div>
                  <div
                    className="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap font-g-mono text-g-ui text-g-ink-3"
                    title={asset.repoPath}
                  >
                    {asset.repoPath}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-g-mono text-g-caption tabular-nums text-g-ink-2">
                    <span className="font-medium text-g-ink">
                      {asset.ext.replace(".", "").toUpperCase()}
                    </span>
                    {dimensions && (
                      <>
                        <span className="text-g-ink-5">·</span>
                        <span>{dimensions}</span>
                      </>
                    )}
                    <span className="text-g-ink-5">·</span>
                    <span>{formatBytes(asset.bytes)}</span>
                    <span className="text-g-ink-5">·</span>
                    <span className="text-g-ink-3">
                      {t("assetDrawer.refCount", {
                        count: asset.references.length,
                      })}
                    </span>
                  </div>

                  {(isUnused ||
                    asset.duplicates.length > 0 ||
                    asset.similar.length > 0 ||
                    isPossiblyUnused ||
                    isNotApplicable ||
                    asset.optimizationRecommendations.length > 0 ||
                    ocrVisible ||
                    vlmOcrReady ||
                    aiTagVisible) && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {isUnused && (
                        <HeroBadgeButton
                          onClick={() => handleTabChange("usage")}
                        >
                          <Badge tone="red">
                            {t("assetDrawer.chipUnused")}
                          </Badge>
                        </HeroBadgeButton>
                      )}
                      {isPossiblyUnused && (
                        <HeroBadgeButton
                          onClick={() => handleTabChange("usage")}
                        >
                          <Badge tone="amber">
                            {t("assetDrawer.chipPossiblyUnused")}
                          </Badge>
                        </HeroBadgeButton>
                      )}
                      {isNotApplicable && (
                        <HeroBadgeButton
                          onClick={() => handleTabChange("usage")}
                        >
                          <Badge tone="line">
                            {notApplicableUsageLabel(t, asset)}
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
                      {asset.optimizationRecommendations.length > 0 &&
                        (() => {
                          const optimized =
                            asset.optimizationRecommendations.every(
                              (r) => r.hasExistingVariant,
                            );
                          return (
                            <HeroBadgeButton
                              onClick={() => handleTabChange("optimize")}
                            >
                              <Badge tone={optimized ? "green" : "blue"}>
                                {optimized
                                  ? t("assetDrawer.chipOptimized")
                                  : t("assetDrawer.chipOptimizable")}
                              </Badge>
                            </HeroBadgeButton>
                          );
                        })()}
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
                      {vlmOcrReady && (
                        <HeroBadgeButton onClick={() => handleTabChange("ai")}>
                          <Badge tone="purple">{t("ocr.badge.shortAI")}</Badge>
                        </HeroBadgeButton>
                      )}
                      {asset.aiTag && asset.aiTag.status === "ready" && (
                        <HeroBadgeButton onClick={() => handleTabChange("ai")}>
                          <Badge tone="purple">
                            {displayAICategory || t("drawer.tab.ai")}
                          </Badge>
                        </HeroBadgeButton>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {variants.length > 0 && (
                <div className="flex gap-2">
                  {variants.map((v) => (
                    <VariantCard
                      key={v.repoPath}
                      variant={v}
                      originalBytes={asset.bytes}
                      onOpen={
                        v.item ? () => onOpenAsset?.(v.item!.id) : undefined
                      }
                    />
                  ))}
                </div>
              )}

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
                  leadingIcon={<FileCode size={14} />}
                  onClick={() => {
                    window.open(editorUrl(preferredEditor, asset.localPath, 1));
                  }}
                >
                  {t("assetDrawer.openInEditor", {
                    editor: preferredEditor,
                  })}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  leadingIcon={<Copy size={14} />}
                  onClick={() => {
                    copyText(asset.localPath);
                    toast.success(t("toast.copied"));
                  }}
                >
                  {t("action.copyPath")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  leadingIcon={<Copy size={14} />}
                  onClick={() => {
                    copyText(assetFileName);
                    toast.success(t("toast.copied"));
                  }}
                >
                  {t("action.copyFileName")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  leadingIcon={<Share2 size={14} />}
                  onClick={() => void handleShareAsset()}
                >
                  {t("action.share")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  leadingIcon={<Download size={14} />}
                  onClick={() => downloadAsset(asset.url, assetFileName)}
                >
                  {t("action.downloadImage")}
                </Button>
                {onDelete && canDeleteUnused(asset) && (
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

            <div
              key={asset.id}
              className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5 max-[600px]:p-4"
            >
              {detailLoading && (
                <div className="mb-3 flex min-h-8 items-center gap-2 rounded-g-md border border-g-line bg-g-surface-2 px-3 text-g-caption text-g-ink-3">
                  <LoaderCircle size={14} className="animate-spin" />
                  {t("common.loading")}
                </div>
              )}
              {detailError && (
                <div className="mb-3 flex min-h-10 items-center gap-3 rounded-g-md border border-g-line bg-g-surface-2 px-3 text-g-caption text-g-ink-2">
                  <span className="min-w-0 flex-1">{detailError}</span>
                  {onRetryDetail && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={onRetryDetail}
                    >
                      {t("common.retry")}
                    </Button>
                  )}
                </div>
              )}
              <div className={tab !== "overview" ? "hidden" : undefined}>
                <AssetDrawerOverview asset={asset} />
              </div>
              <div className={tab !== "usage" ? "hidden" : undefined}>
                <AssetDrawerUsage
                  asset={asset}
                  references={asset.references}
                  preferredEditor={preferredEditor}
                  rootPath={projectRoot(asset.localPath, asset.repoPath)}
                />
              </div>
              {similarCount > 0 && (
                <div className={tab !== "similar" ? "hidden" : undefined}>
                  <AssetDrawerSimilar
                    asset={asset}
                    duplicateItems={duplicateItems}
                    similarItems={similarItems}
                    nearDuplicates={nearDuplicates}
                    onOpenAsset={onOpenAsset}
                    aiEnabled={settingsQuery.data?.settings.llmEnabled}
                  />
                </div>
              )}
              {asset.optimizationRecommendations.length > 0 && (
                <div className={tab !== "optimize" ? "hidden" : undefined}>
                  <AssetDrawerOptimize
                    asset={asset}
                    variants={variants}
                    aiEnabled={settingsQuery.data?.settings.llmEnabled}
                    onOpenAsset={onOpenAsset}
                  />
                </div>
              )}
              {ocrVisible && asset.ocr && (
                <div className={tab !== "ocr" ? "hidden" : undefined}>
                  <AssetDrawerOCR ocr={asset.ocr} />
                </div>
              )}
              {(asset.aiTag?.status === "ready" || llmEnabled) && (
                <div className={tab !== "tags" ? "hidden" : undefined}>
                  <AssetDrawerTags asset={asset} />
                </div>
              )}
              {aiTagVisible && (
                <div className={tab !== "ai" ? "hidden" : undefined}>
                  <AssetDrawerAI
                    asset={asset}
                    scanId={scanId}
                    aiTag={asset.aiTag}
                    ocr={vlmOcrReady ? asset.ocr : undefined}
                    llmEnabled={llmEnabled}
                    onBusyChange={setAiBusy}
                  />
                </div>
              )}
            </div>
          </DialogDrawerSurface>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function VariantCard({
  variant,
  originalBytes,
  onOpen,
}: {
  variant: VariantInfo;
  originalBytes: number;
  onOpen?: () => void;
}) {
  const { t } = useTranslation();
  const savingsPct =
    variant.savings > 0
      ? Math.round((variant.savings / originalBytes) * 100)
      : 0;

  return (
    <Tooltip
      label={onOpen ? t("optimize.drawerViewVariant") : variant.name}
      placement="top"
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        className={cn(
          "flex items-center gap-2.5 rounded-g-md border bg-g-surface px-2.5 py-2 text-left",
          "transition-[border-color] duration-[120ms] ease-g",
          "focus-visible:outline-none focus-visible:shadow-g-focus",
          onOpen
            ? "cursor-pointer border-g-green/30 hover:border-g-green"
            : "cursor-default border-g-line opacity-60",
        )}
      >
        {variant.item ? (
          <img
            src={variant.item.thumbnailUrl || variant.item.url}
            alt={variant.name}
            loading="eager"
            className="w-[44px] shrink-0 rounded-g-sm object-contain"
          />
        ) : (
          <div className="flex w-[44px] shrink-0 items-center justify-center rounded-g-sm bg-g-surface-2 py-3">
            <CheckCircle size={18} className="text-g-green/40" />
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate font-g-mono text-g-caption font-medium text-g-ink">
            {variant.ext.replace(".", "").toUpperCase()}
          </div>
          {variant.variantBytes > 0 && (
            <div className="mt-0.5 font-g-mono text-g-chip text-g-green">
              {formatBytes(variant.variantBytes)}
              {savingsPct > 0 && ` (−${savingsPct}%)`}
            </div>
          )}
        </div>
      </button>
    </Tooltip>
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
