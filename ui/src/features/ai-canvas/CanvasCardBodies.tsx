import { useEffect, useRef } from "react";
import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { basePath } from "@/api/client";
import { Badge } from "@/components/ui";
import { fileName } from "@/ui";
import type {
  AssetCanvasCard,
  CanvasCard,
  CommentCanvasCard,
  GroupCanvasCard,
  GroupChildCanvasCard,
  OperationCanvasCard,
  ProposalCanvasCard,
  TextCanvasCard,
  UploadCanvasCard,
  VariantCanvasCard,
} from "./aiCanvasState";
import {
  CARD_WIDTH,
  compactImageAspectRatio,
  renderMarkdown,
} from "./canvasUtils";
import { proposalToolLabel } from "./proposalLabels";
import {
  CommentRegionButtons,
  useCommentOverlay,
  type CommentRegion,
} from "./useCommentOverlay";

export function AssetCardBody({
  card,
  comments,
  hideOverlays,
  commentEnabled,
  canvasScale = 1,
  commentRegionBasis,
  onSelectComment,
  onCreateComment,
}: {
  card: AssetCanvasCard;
  comments: CommentCanvasCard[];
  hideOverlays?: boolean;
  commentEnabled?: boolean;
  canvasScale?: number;
  commentRegionBasis?: { width: number; height: number };
  onSelectComment: (commentId: string) => void;
  onCreateComment: (
    anchorCard: CanvasCard,
    text?: string,
    region?: { x: number; y: number; width: number; height: number },
  ) => void;
}) {
  const asset = card.asset;
  const ar =
    asset.image.width > 0 && asset.image.height > 0
      ? asset.image.width / asset.image.height
      : 4 / 3;
  const {
    containerRef: commentContainerRef,
    pointerProps: commentPointerProps,
    overlay: commentOverlay,
  } = useCommentOverlay({
    enabled: !!commentEnabled && !hideOverlays,
    canvasScale,
    onSubmit: (text, region) => onCreateComment(card, text, region),
  });

  return (
    <div
      ref={commentContainerRef}
      data-ai-canvas-image-frame="true"
      data-ai-canvas-asset-frame="true"
      className="relative"
      style={{ aspectRatio: ar }}
      {...commentPointerProps}
    >
      <img
        src={asset.thumbnailUrl || asset.url}
        alt={fileName(asset.repoPath)}
        className="size-full select-none rounded-[inherit] object-contain"
        draggable={false}
        loading="lazy"
      />
      {!hideOverlays && (
        <CommentRegionButtons
          comments={comments}
          basis={
            commentRegionBasis ?? { width: CARD_WIDTH, height: CARD_WIDTH / ar }
          }
          onSelect={onSelectComment}
        />
      )}
      {commentOverlay}
    </div>
  );
}

export function CommentCardBody({ card }: { card: CommentCanvasCard }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 p-3">
      <Badge tone="amber">{t("aiCanvas.pinnedRegion")}</Badge>
      <p className="whitespace-pre-wrap text-g-body leading-[1.45] text-g-ink">
        {card.text || t("aiCanvas.emptyComment")}
      </p>
    </div>
  );
}

export function AssistantCardBody({
  card,
}: {
  card: Extract<CanvasCard, { kind: "assistant" }>;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <Badge tone="line">{t("aiCanvas.aiContext")}</Badge>
        <span className="truncate text-g-caption text-g-ink-3">
          {card.assetIds.length > 0
            ? t("aiCanvas.selectedAssets", { count: card.assetIds.length })
            : t("aiCanvas.noSelection")}
        </span>
      </div>
      <p className="text-g-body leading-[1.45] text-g-ink">
        {renderMarkdown(card.message)}
      </p>
      <ul className="flex flex-col gap-1.5">
        {card.bullets.map((bullet) => (
          <li
            key={bullet}
            className="rounded-g-sm bg-g-surface-2 px-2 py-1.5 text-g-caption leading-[1.45] text-g-ink-2"
          >
            {bullet}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function UploadCardBody({
  card,
  comments,
  hideOverlays,
  commentEnabled,
  canvasScale = 1,
  commentRegionBasis,
  onSelectComment,
  onCreateComment,
}: {
  card: UploadCanvasCard;
  comments: CommentCanvasCard[];
  hideOverlays?: boolean;
  commentEnabled?: boolean;
  canvasScale?: number;
  commentRegionBasis?: { width: number; height: number };
  onSelectComment: (commentId: string) => void;
  onCreateComment?: (
    anchorCard: CanvasCard,
    text?: string,
    region?: CommentRegion,
  ) => void;
}) {
  const previewSrc = `${basePath}/api/image-tools/preview/${card.token}`;
  const {
    containerRef: commentContainerRef,
    pointerProps: commentPointerProps,
    overlay: commentOverlay,
  } = useCommentOverlay({
    enabled: !!commentEnabled && !hideOverlays,
    canvasScale,
    onSubmit: (text, region) => onCreateComment?.(card, text, region),
  });

  return (
    <div
      ref={commentContainerRef}
      data-ai-canvas-image-frame="true"
      className="relative"
      style={{ aspectRatio: compactImageAspectRatio(card) }}
      {...commentPointerProps}
    >
      <img
        src={previewSrc}
        alt={card.fileName}
        className="size-full select-none rounded-[inherit] object-contain"
        draggable={false}
        onError={(e) => {
          if (card.thumbnailDataUrl)
            (e.target as HTMLImageElement).src = card.thumbnailDataUrl;
        }}
      />
      {!hideOverlays && (
        <CommentRegionButtons
          comments={comments}
          basis={commentRegionBasis}
          onSelect={onSelectComment}
        />
      )}
      {commentOverlay}
    </div>
  );
}

export function VariantCardBody({ card }: { card: VariantCanvasCard }) {
  return (
    <div
      data-ai-canvas-image-frame="true"
      className="relative"
      style={{ aspectRatio: compactImageAspectRatio(card) }}
    >
      <img
        src={card.previewUrl}
        alt={card.sourceName}
        className="size-full select-none rounded-[inherit] object-contain"
        draggable={false}
        loading="lazy"
      />
    </div>
  );
}

function groupChildImageSource(card: GroupChildCanvasCard) {
  if (card.kind === "asset") return card.asset.thumbnailUrl || card.asset.url;
  if (card.kind === "upload")
    return `${basePath}/api/image-tools/preview/${card.token}`;
  return card.previewUrl;
}

function groupChildImageAlt(card: GroupChildCanvasCard) {
  if (card.kind === "asset") return fileName(card.asset.repoPath);
  if (card.kind === "upload") return card.fileName;
  return card.sourceName;
}

export function GroupCardBody({ card }: { card: GroupCanvasCard }) {
  const groupWidth = Math.max(1, card.width);
  const groupHeight = Math.max(1, card.height);
  return (
    <div
      data-ai-canvas-image-frame="true"
      className="relative overflow-visible"
      style={{ aspectRatio: groupWidth / groupHeight }}
    >
      {card.cards.map((child) => {
        const width = card.cardWidths?.[child.id] ?? CARD_WIDTH;
        return (
          <div
            key={child.id}
            className="absolute rounded-[inherit]"
            style={{
              left: `${(child.x / groupWidth) * 100}%`,
              top: `${(child.y / groupHeight) * 100}%`,
              width: `${(width / groupWidth) * 100}%`,
              aspectRatio: compactImageAspectRatio(child),
            }}
          >
            <img
              src={groupChildImageSource(child)}
              alt={groupChildImageAlt(child)}
              className="size-full select-none rounded-[inherit] object-contain"
              draggable={false}
              loading="lazy"
              onError={(e) => {
                if (child.kind === "upload" && child.thumbnailDataUrl) {
                  (e.target as HTMLImageElement).src = child.thumbnailDataUrl;
                }
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

export function TextCardBody({
  card,
  editing,
  onConfirmEdit,
}: {
  card: TextCanvasCard;
  editing?: boolean;
  onConfirmEdit?: (content: string, width: number, height: number) => void;
}) {
  const { t } = useTranslation();
  const isEmpty = !card.content.trim();
  const placeholderColor =
    card.style.color === "#0f172a" ? "#94a3b8" : "rgba(160,160,160,0.55)";
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing && textareaRef.current) {
      const el = textareaRef.current;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    function handleOutsidePointer(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (
        target.closest("[data-ai-canvas-text-frame='true']") ||
        target.closest("[data-ai-canvas-text-toolbar='true']")
      ) {
        return;
      }
      textareaRef.current?.blur();
    }
    document.addEventListener("pointerdown", handleOutsidePointer, true);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointer, true);
    };
  }, [editing]);

  return (
    <div
      className="relative min-h-[24px] px-0.5 py-px"
      data-ai-canvas-text-frame="true"
      style={{ cursor: editing ? "text" : "pointer" }}
    >
      {editing ? (
        <textarea
          ref={textareaRef}
          className="w-full resize-none border-none bg-transparent p-0 outline-none"
          style={{
            fontFamily: card.style.fontFamily,
            fontSize: card.style.fontSize,
            fontWeight: card.style.fontWeight,
            fontStyle: card.style.fontStyle,
            color: card.style.color,
            textAlign: card.style.textAlign,
            lineHeight: 1.2,
          }}
          defaultValue={card.content}
          placeholder={t("aiCanvas.text.placeholder")}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            const el = e.currentTarget;
            onConfirmEdit?.(
              el.value,
              card.width,
              Math.max(24, el.scrollHeight + 4),
            );
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.currentTarget.blur();
            }
          }}
        />
      ) : (
        <div
          className="whitespace-pre-wrap break-words"
          style={{
            fontFamily: card.style.fontFamily,
            fontSize: card.style.fontSize,
            fontWeight: card.style.fontWeight,
            fontStyle: card.style.fontStyle,
            color: isEmpty ? placeholderColor : card.style.color,
            textAlign: card.style.textAlign,
            lineHeight: 1.2,
            minHeight: 24,
          }}
        >
          {isEmpty ? t("aiCanvas.text.placeholder") : card.content}
        </div>
      )}
    </div>
  );
}

export function OperationCardBody({ card }: { card: OperationCanvasCard }) {
  const { t } = useTranslation();
  const changes = card.preview.changes.length;
  const blockers = card.preview.blockers.length;
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap gap-1.5">
        <Badge tone="green">{t("aiCanvas.previewOnly")}</Badge>
        <Badge tone={card.preview.canApply ? "blue" : "line"}>
          {card.preview.canApply
            ? t("aiCanvas.canApply")
            : t("aiCanvas.blocked")}
        </Badge>
        <Badge tone="line">
          {t("aiCanvas.operationChanges", { count: changes })}
        </Badge>
        {blockers > 0 && (
          <Badge tone="amber">
            {t("aiCanvas.operationBlockers", { count: blockers })}
          </Badge>
        )}
      </div>
      <p className="text-g-caption leading-[1.45] text-g-ink-3">
        {card.prompt}
      </p>
      <div className="max-h-40 overflow-y-auto rounded-g-md border border-g-line bg-g-surface-2">
        {changes === 0 && blockers === 0 ? (
          <div className="px-3 py-2 text-g-caption text-g-ink-3">
            {t("aiCanvas.noPreviewChanges")}
          </div>
        ) : (
          <>
            {card.preview.changes.slice(0, 5).map((change) => (
              <div
                key={`${change.file}:${change.line}:${change.newSpecifier}`}
                className="border-b border-g-line px-3 py-2 last:border-b-0"
              >
                <div className="truncate text-g-caption font-[590] text-g-ink">
                  {change.file}:{change.line}
                </div>
                <div className="truncate font-g-mono text-[10px] tracking-g-mono text-g-ink-3">
                  {change.oldSpecifier} → {change.newSpecifier}
                </div>
              </div>
            ))}
            {card.preview.blockers.slice(0, 4).map((blocker) => (
              <div
                key={`${blocker.file}:${blocker.line}:${blocker.code}`}
                className="border-b border-g-line px-3 py-2 last:border-b-0"
              >
                <div className="truncate text-g-caption font-[590] text-g-amber">
                  {blocker.code}
                </div>
                <div className="text-g-caption text-g-ink-3">
                  {blocker.reason}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
      <div className="font-g-mono text-[10px] tracking-g-mono text-g-ink-4">
        {card.token}
      </div>
    </div>
  );
}

function proposalParamString(
  params: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function proposalParamTags(params: Record<string, unknown>) {
  const value = params.tags;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (tag): tag is string => typeof tag === "string" && tag.trim().length > 0,
  );
}

function proposalAssetIds(card: ProposalCanvasCard) {
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== "string" || !value.trim() || seen.has(value)) return;
    seen.add(value);
    ids.push(value);
  };
  card.sourceAssetIds?.forEach(add);
  const paramIds = card.params.assetIds;
  if (Array.isArray(paramIds)) paramIds.forEach(add);
  add(card.sourceAssetId);
  add(card.params.assetId);
  return ids;
}

type ProposalItemStatus = {
  assetId?: string;
  repoPath?: string;
  status?: string;
  error?: string;
};

function proposalItemStatuses(result: unknown): ProposalItemStatus[] {
  if (!result || typeof result !== "object") return [];
  const items = (result as { itemStatuses?: unknown }).itemStatuses;
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item): item is ProposalItemStatus =>
      Boolean(item) && typeof item === "object",
  );
}

export function ProposalCardBody({ card }: { card: ProposalCanvasCard }) {
  const { t } = useTranslation();
  const isPending = card.status === "pending";
  const isExecuting = card.status === "executing";
  const isCompleted = card.status === "completed";
  const isFailed = card.status === "failed";
  const isRejected = card.status === "rejected";
  const proposalTags =
    card.tool === "update_tags" || card.tool === "batch_update_tags"
      ? proposalParamTags(card.params)
      : [];
  const proposalDescription =
    card.tool === "update_description"
      ? proposalParamString(card.params, "description")
      : undefined;
  const targetAssetIds = proposalAssetIds(card);
  const itemStatuses = proposalItemStatuses(card.result);

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap gap-1.5">
        <Badge
          tone={
            isPending
              ? "amber"
              : isCompleted
                ? "green"
                : isRejected
                  ? "line"
                  : isFailed
                    ? "red"
                    : "blue"
          }
        >
          {proposalToolLabel(t, card.tool)}
        </Badge>
        {targetAssetIds.length > 1 && (
          <Badge tone="blue">
            {t("aiCanvas.batchAssetCount", {
              count: targetAssetIds.length,
            })}
          </Badge>
        )}
        <Badge
          tone={
            isCompleted
              ? "green"
              : isRejected
                ? "line"
                : isPending
                  ? "amber"
                  : "line"
          }
        >
          {isExecuting
            ? t("aiCanvas.executing")
            : isCompleted
              ? t("aiCanvas.completed")
              : isRejected
                ? t("aiCanvas.rejected")
                : isFailed
                  ? t("aiCanvas.failed")
                  : t("aiCanvas.pending")}
        </Badge>
      </div>
      {proposalTags.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-g-md border border-g-line bg-g-surface-2 px-2.5 py-2">
          <div className="font-g-mono text-[10px] font-[590] tracking-g-mono text-g-ink-4">
            {t("aiCanvas.proposalTags")}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {proposalTags.map((tag) => (
              <Badge key={tag} tone="line" className="max-w-full truncate">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )}
      {proposalDescription && (
        <div className="flex flex-col gap-1.5 rounded-g-md border border-g-line bg-g-surface-2 px-2.5 py-2">
          <div className="font-g-mono text-[10px] font-[590] tracking-g-mono text-g-ink-4">
            {t("aiCanvas.proposalDescription")}
          </div>
          <p className="text-g-caption leading-[1.45] text-g-ink-2 break-words">
            {proposalDescription}
          </p>
        </div>
      )}
      {itemStatuses.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-g-md border border-g-line bg-g-surface-2 px-2.5 py-2">
          <div className="font-g-mono text-[10px] font-[590] tracking-g-mono text-g-ink-4">
            {t("aiCanvas.batchStatus")}
          </div>
          <div className="flex flex-col gap-1">
            {itemStatuses.slice(0, 6).map((item) => (
              <div
                key={item.assetId ?? item.repoPath}
                className="flex min-w-0 items-center gap-2 text-g-caption"
              >
                <Badge tone={item.status === "completed" ? "green" : "red"}>
                  {item.status === "completed"
                    ? t("aiCanvas.completed")
                    : t("aiCanvas.failed")}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-g-ink-2">
                  {item.repoPath ? fileName(item.repoPath) : item.assetId}
                </span>
              </div>
            ))}
            {itemStatuses.length > 6 && (
              <div className="text-g-caption text-g-ink-4">
                {t("aiCanvas.batchMore", {
                  count: itemStatuses.length - 6,
                })}
              </div>
            )}
          </div>
        </div>
      )}
      {card.error && <p className="text-g-caption text-g-red">{card.error}</p>}
      {isExecuting && (
        <div className="flex items-center gap-2 text-g-caption text-g-ink-3">
          <LoaderCircle size={14} className="animate-spin" />
          {t("aiCanvas.executing")}
        </div>
      )}
    </div>
  );
}
