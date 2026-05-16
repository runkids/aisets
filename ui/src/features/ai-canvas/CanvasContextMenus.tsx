import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  ImagePlus,
  Layers3,
  MessageCircle,
  Pencil,
  Trash2,
  Ungroup,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { fileName, formatExt } from "@/ui";
import type {
  AssetCanvasCard,
  GroupCanvasCard,
  UploadCanvasCard,
  VariantCanvasCard,
} from "./aiCanvasState";
import { imageMeta, tagLabel } from "./canvasUtils";

const ctxMenuItemCls =
  "flex w-full min-h-8 cursor-pointer items-center gap-2 rounded-[10px] px-3 py-1.5 font-g text-g-ui text-white outline-none transition-colors duration-[120ms] ease-g hover:bg-white/[0.08] disabled:opacity-40 disabled:cursor-default";
const ctxMenuSepCls = "mx-2 my-1 h-px bg-white/[0.08]";
const ctxMenuLabelCls =
  "px-3 py-1.5 font-g text-g-caption text-white/50 select-text";
const CANVAS_CONVERT_FORMATS = ["avif", "webp", "jpeg", "png"] as const;

function normalizeImageFormat(format: string) {
  const normalized = format.replace(/^\./, "").toLowerCase();
  if (normalized === "jpg") return "jpeg";
  return normalized || "image";
}

function autoConvertFormat(asset: AssetCanvasCard["asset"]) {
  const source = normalizeImageFormat(asset.image.format || asset.ext);
  if (source === "png" && asset.image.alpha) return "webp";
  if (source === "avif") return "webp";
  if (source === "gif") return "webp";
  return "avif";
}

export type ImageCardContextMenuProps = {
  onAddComment?: () => void;
  onDuplicate?: () => void;
  onDelete: () => void;
};

export type AssetContextMenuProps = ImageCardContextMenuProps & {
  card: AssetCanvasCard;
  onOpenAsset?: () => void;
  onRenderPreview?: (outputFormat?: string) => void;
  working?: boolean;
};

export function AssetContextMenu({
  card,
  onOpenAsset,
  onRenderPreview,
  onAddComment,
  onDuplicate,
  onDelete,
  working,
}: AssetContextMenuProps) {
  const { t } = useTranslation();
  const asset = card.asset;
  const tags = tagLabel(asset);
  const [convertOpen, setConvertOpen] = useState(false);
  const sourceFormat = normalizeImageFormat(
    asset.image.format || asset.ext,
  ).toUpperCase();
  const autoFormat = autoConvertFormat(asset).toUpperCase();
  return (
    <>
      <div className={ctxMenuLabelCls}>
        <div className="truncate font-[590] text-white">
          {fileName(asset.repoPath)}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-white/36">
          {asset.repoPath}
        </div>
      </div>
      <div className={ctxMenuSepCls} />
      <div className="px-3 py-1.5 font-g text-[11px] text-white/50">
        <span>{formatExt(asset.ext).toUpperCase()}</span>
        <span className="mx-1.5 text-white/20">·</span>
        <span>{imageMeta(asset)}</span>
        {asset.usedBy.length > 0 && (
          <>
            <span className="mx-1.5 text-white/20">·</span>
            <span className="text-white/60">
              {t("aiCanvas.references", { count: asset.usedBy.length })}
            </span>
          </>
        )}
        {tags && <div className="mt-1 truncate text-white/40">{tags}</div>}
      </div>
      {asset.aiTag?.description && (
        <div className="line-clamp-2 px-3 pb-1 font-g text-[11px] leading-[1.45] text-white/36">
          {asset.aiTag.description}
        </div>
      )}
      <div className={ctxMenuSepCls} />
      {onRenderPreview && (
        <div className="px-1 py-1">
          <button
            type="button"
            className={ctxMenuItemCls}
            disabled={working}
            aria-expanded={convertOpen}
            onClick={(event) => {
              event.stopPropagation();
              setConvertOpen((open) => !open);
            }}
          >
            <ImagePlus size={14} className="shrink-0 text-white/46" />
            <span className="min-w-0 flex-1 text-left">
              <span className="font-[590]">
                {t("aiCanvas.convertHeader", { ext: sourceFormat })}
              </span>
              <span className="ml-1.5 font-g-mono text-white/54">
                {autoFormat}
              </span>
            </span>
            <ChevronDown
              size={14}
              className={cn(
                "shrink-0 text-white/42 transition-transform duration-[120ms] ease-g",
                convertOpen && "rotate-180",
              )}
            />
          </button>
          {convertOpen && (
            <div className="mt-1 border-t border-white/[0.08] pt-1">
              <button
                type="button"
                className={ctxMenuItemCls}
                disabled={working}
                onClick={() => onRenderPreview(autoConvertFormat(asset))}
              >
                <span className="w-5 shrink-0" />
                <span className="min-w-0 flex-1 text-left">
                  <span className="font-[590]">
                    {t("aiCanvas.convertAuto")}
                  </span>
                  <span className="mx-1.5 text-white/28">·</span>
                  <span className="text-white/54">{autoFormat}</span>
                </span>
                <Check size={14} className="shrink-0 text-white/78" />
              </button>
              {CANVAS_CONVERT_FORMATS.map((format) => (
                <button
                  key={format}
                  type="button"
                  className={ctxMenuItemCls}
                  disabled={working}
                  onClick={() => onRenderPreview(format)}
                >
                  <span className="w-5 shrink-0" />
                  <span className="font-g-mono text-[15px] font-[590] uppercase tracking-[-0.02em]">
                    {format}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {onAddComment && (
        <button type="button" className={ctxMenuItemCls} onClick={onAddComment}>
          <MessageCircle size={14} className="shrink-0 text-white/46" />
          {t("aiCanvas.comment")}
        </button>
      )}
      {onOpenAsset && (
        <button type="button" className={ctxMenuItemCls} onClick={onOpenAsset}>
          <ExternalLink size={14} className="shrink-0 text-white/46" />
          {t("aiCanvas.openAsset")}
        </button>
      )}
      {onDuplicate && (
        <button type="button" className={ctxMenuItemCls} onClick={onDuplicate}>
          <Copy size={14} className="shrink-0 text-white/46" />
          {t("aiCanvas.duplicateImage")}
        </button>
      )}
      <div className={ctxMenuSepCls} />
      <button
        type="button"
        className={cn(ctxMenuItemCls, "text-[#ff453a]")}
        onClick={onDelete}
      >
        <Trash2 size={14} className="shrink-0" />
        {t("aiCanvas.deleteCard")}
      </button>
    </>
  );
}

export type UploadContextMenuProps = ImageCardContextMenuProps & {
  card: UploadCanvasCard;
};

export function UploadContextMenu({
  card,
  onAddComment,
  onDuplicate,
  onDelete,
}: UploadContextMenuProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className={ctxMenuLabelCls}>
        <div className="truncate font-[590] text-white">{card.fileName}</div>
        <div className="mt-0.5 text-[11px] text-white/36">
          {card.uploadWidth}×{card.uploadHeight} · upload
        </div>
      </div>
      <div className={ctxMenuSepCls} />
      {onAddComment && (
        <button type="button" className={ctxMenuItemCls} onClick={onAddComment}>
          <MessageCircle size={14} className="shrink-0 text-white/46" />
          {t("aiCanvas.comment")}
        </button>
      )}
      {onDuplicate && (
        <button type="button" className={ctxMenuItemCls} onClick={onDuplicate}>
          <Copy size={14} className="shrink-0 text-white/46" />
          {t("aiCanvas.duplicateImage")}
        </button>
      )}
      <div className={ctxMenuSepCls} />
      <button
        type="button"
        className={cn(ctxMenuItemCls, "text-[#ff453a]")}
        onClick={onDelete}
      >
        <Trash2 size={14} className="shrink-0" />
        {t("aiCanvas.deleteCard")}
      </button>
    </>
  );
}

export type VariantContextMenuProps = ImageCardContextMenuProps & {
  card: VariantCanvasCard;
};

export function VariantContextMenu({
  card,
  onAddComment,
  onDuplicate,
  onDelete,
}: VariantContextMenuProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className={ctxMenuLabelCls}>
        <div className="truncate font-[590] text-white">{card.sourceName}</div>
        <div className="mt-0.5 truncate text-[11px] text-white/36">
          {t("aiCanvas.cardKind.variant")}
        </div>
      </div>
      <div className={ctxMenuSepCls} />
      {onAddComment && (
        <button type="button" className={ctxMenuItemCls} onClick={onAddComment}>
          <MessageCircle size={14} className="shrink-0 text-white/46" />
          {t("aiCanvas.comment")}
        </button>
      )}
      {onDuplicate && (
        <button type="button" className={ctxMenuItemCls} onClick={onDuplicate}>
          <Copy size={14} className="shrink-0 text-white/46" />
          {t("aiCanvas.duplicateImage")}
        </button>
      )}
      <div className={ctxMenuSepCls} />
      <button
        type="button"
        className={cn(ctxMenuItemCls, "text-[#ff453a]")}
        onClick={onDelete}
      >
        <Trash2 size={14} className="shrink-0" />
        {t("aiCanvas.deleteCard")}
      </button>
    </>
  );
}

export function GroupContextMenu({
  card,
  onRename,
  onUngroup,
  onDelete,
}: {
  card: GroupCanvasCard;
  onRename: () => void;
  onUngroup: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className={ctxMenuLabelCls}>
        <div className="truncate font-[590] text-white">
          {card.name || t("aiCanvas.groupLabel", { count: card.cards.length })}
        </div>
        <div className="mt-0.5 text-[11px] text-white/36">
          {Math.round(card.width)}×{Math.round(card.height)}
        </div>
      </div>
      <div className={ctxMenuSepCls} />
      <button type="button" className={ctxMenuItemCls} onClick={onRename}>
        <Pencil size={14} className="shrink-0 text-white/46" />
        {t("aiCanvas.renameGroup")}
      </button>
      <button type="button" className={ctxMenuItemCls} onClick={onUngroup}>
        <Ungroup size={14} className="shrink-0 text-white/46" />
        {t("aiCanvas.ungroup")}
      </button>
      <div className={ctxMenuSepCls} />
      <button
        type="button"
        className={cn(ctxMenuItemCls, "text-[#ff453a]")}
        onClick={onDelete}
      >
        <Trash2 size={14} className="shrink-0" />
        {t("aiCanvas.deleteCard")}
      </button>
    </>
  );
}

export function SelectionContextMenu({
  count,
  onGroup,
  onDelete,
}: {
  count: number;
  onGroup?: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className={ctxMenuLabelCls}>
        <div className="font-[590] text-white">
          {t("aiCanvas.selectedCount", { count })}
        </div>
      </div>
      <div className={ctxMenuSepCls} />
      {onGroup && (
        <button type="button" className={ctxMenuItemCls} onClick={onGroup}>
          <Layers3 size={14} className="shrink-0 text-white/46" />
          {t("aiCanvas.groupSelected")}
        </button>
      )}
      <button
        type="button"
        className={cn(ctxMenuItemCls, "text-[#ff453a]")}
        onClick={onDelete}
      >
        <Trash2 size={14} className="shrink-0" />
        {t("aiCanvas.deleteSelected", { count })}
      </button>
    </>
  );
}
