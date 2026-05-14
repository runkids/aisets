import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { TFunction } from "i18next";
import { ConfirmDialog } from "@/components/ui";
import {
  AICursor,
  AssetCardBody,
  AssetContextMenu,
  AssistantCardBody,
  CardShell,
  CommentCardBody,
  OperationCardBody,
  ProposalCardBody,
  SelectionContextMenu,
  UploadCardBody,
  UploadContextMenu,
  VariantCardBody,
} from "./canvasCards";
import {
  CARD_WIDTH,
  isImageCard,
  selectionBounds,
  type CanvasSelection,
} from "./canvasUtils";
import type {
  AssetCanvasCard,
  CanvasCard,
  CommentCanvasCard,
} from "./aiCanvasState";

type CommentConnector = {
  id: string;
  active: boolean;
  fromX: number;
  fromY: number;
  targetX: number;
  targetY: number;
  path: string;
};

function isVisibleImageCard(card: CanvasCard) {
  return isImageCard(card) || card.kind === "variant";
}

type AICanvasStageProps = {
  t: TFunction;
  viewport: { x: number; y: number; scale: number };
  canvasInnerRef: RefObject<HTMLDivElement | null>;
  cards: CanvasCard[];
  setCards: Dispatch<SetStateAction<CanvasCard[]>>;
  selectedCardIds: string[];
  setSelectedCardIds: Dispatch<SetStateAction<string[]>>;
  cardWidths: Record<string, number>;
  setCardWidths: Dispatch<SetStateAction<Record<string, number>>>;
  hideNonImageCards: boolean;
  commentConnectors: CommentConnector[];
  commentsByAnchor: Map<string, CommentCanvasCard[]>;
  groupBounds: { x: number; y: number; w: number; h: number } | null;
  canvasSelection: CanvasSelection | null;
  dragPreview: { cardId: string; x: number; y: number } | null;
  aiCursor: {
    x: number;
    y: number;
    label?: string;
    status: "thinking" | "acting" | "idle";
  };
  aiNickname?: string;
  aiGreeting?: string;
  commentMode: boolean;
  setCommentMode: Dispatch<SetStateAction<boolean>>;
  isWorking: boolean;
  onOpenAsset?: (assetId: string) => void;
  onCanvasPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onCanvasPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onCanvasPointerEnd: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  onDragStart: (
    event: ReactPointerEvent<HTMLDivElement>,
    card: CanvasCard,
  ) => void;
  onDragMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDragEnd: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDeleteCard: (target: CanvasCard) => void;
  onDeleteSelectedCards: (ids: string[]) => void;
  onDuplicateCard: (target: CanvasCard) => void;
  onRegisterCard: (cardId: string, node: HTMLElement | null) => void;
  onAddComment: (
    anchorCard: CanvasCard,
    text?: string,
    region?: { x: number; y: number; width: number; height: number },
  ) => void;
  onCreateImagePreview: (
    assetCard: AssetCanvasCard,
    promptText: string,
    outputFormat?: string,
  ) => void | Promise<void>;
};

export function AICanvasStage({
  t,
  viewport,
  canvasInnerRef,
  cards,
  setCards,
  selectedCardIds,
  setSelectedCardIds,
  cardWidths,
  setCardWidths,
  hideNonImageCards,
  commentConnectors,
  commentsByAnchor,
  groupBounds,
  canvasSelection,
  dragPreview,
  aiCursor,
  aiNickname,
  aiGreeting,
  commentMode,
  setCommentMode,
  isWorking,
  onOpenAsset,
  onCanvasPointerDown,
  onCanvasPointerMove,
  onCanvasPointerEnd,
  onWheel,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDeleteCard,
  onDeleteSelectedCards,
  onDuplicateCard,
  onRegisterCard,
  onAddComment,
  onCreateImagePreview,
}: AICanvasStageProps) {
  const [deleteConfirmCard, setDeleteConfirmCard] = useState<CanvasCard | null>(
    null,
  );
  const [deleteConfirmSelectedIds, setDeleteConfirmSelectedIds] = useState<
    string[] | null
  >(null);
  const latestHandlersRef = useRef({
    onAddComment,
    onCreateImagePreview,
    onDeleteCard,
    onDeleteSelectedCards,
    onDragEnd,
    onDragMove,
    onDragStart,
    onDuplicateCard,
    onOpenAsset,
    onRegisterCard,
  });
  useEffect(() => {
    latestHandlersRef.current = {
      onAddComment,
      onCreateImagePreview,
      onDeleteCard,
      onDeleteSelectedCards,
      onDragEnd,
      onDragMove,
      onDragStart,
      onDuplicateCard,
      onOpenAsset,
      onRegisterCard,
    };
  }, [
    onAddComment,
    onCreateImagePreview,
    onDeleteCard,
    onDeleteSelectedCards,
    onDragEnd,
    onDragMove,
    onDragStart,
    onDuplicateCard,
    onOpenAsset,
    onRegisterCard,
  ]);
  const hasOpenAssetHandler = Boolean(onOpenAsset);

  const renderedCards = useMemo(() => {
    return cards.map((card) => {
      if (hideNonImageCards && !isVisibleImageCard(card)) return null;
      return (
        <CardShell
          key={card.id}
          card={card}
          selected={selectedCardIds.includes(card.id)}
          width={cardWidths[card.id]}
          canvasScale={viewport.scale}
          onSelect={(id, shiftKey) => {
            setSelectedCardIds((prev) =>
              shiftKey
                ? prev.includes(id)
                  ? prev.filter((x) => x !== id)
                  : [...prev, id]
                : [id],
            );
            setCards((prev) => {
              const idx = prev.findIndex((c) => c.id === id);
              if (idx < 0 || idx === prev.length - 1) return prev;
              const next = [...prev];
              next.push(next.splice(idx, 1)[0]);
              return next;
            });
          }}
          onDragStart={(event, target) =>
            latestHandlersRef.current.onDragStart(event, target)
          }
          onDragMove={(event) => latestHandlersRef.current.onDragMove(event)}
          onDragEnd={(event) => latestHandlersRef.current.onDragEnd(event)}
          onDelete={(target) => latestHandlersRef.current.onDeleteCard(target)}
          onResize={
            isImageCard(card)
              ? (id, w) => {
                  if (
                    selectedCardIds.length > 1 &&
                    selectedCardIds.includes(id)
                  ) {
                    const oldW = cardWidths[id] ?? CARD_WIDTH;
                    const ratio = w / oldW;
                    setCardWidths((prev) => {
                      const next = { ...prev, [id]: w };
                      for (const peerId of selectedCardIds) {
                        if (peerId === id) continue;
                        next[peerId] = Math.max(
                          80,
                          (prev[peerId] ?? CARD_WIDTH) * ratio,
                        );
                      }
                      return next;
                    });
                  } else {
                    setCardWidths((prev) => ({ ...prev, [id]: w }));
                  }
                }
              : undefined
          }
          onRegister={(id, node) =>
            latestHandlersRef.current.onRegisterCard(id, node)
          }
          position={
            dragPreview?.cardId === card.id
              ? { x: dragPreview.x, y: dragPreview.y }
              : undefined
          }
          contextMenu={
            selectedCardIds.length > 1 && selectedCardIds.includes(card.id) ? (
              <SelectionContextMenu
                count={selectedCardIds.length}
                onDelete={() =>
                  setDeleteConfirmSelectedIds([...selectedCardIds])
                }
              />
            ) : card.kind === "asset" ? (
              <AssetContextMenu
                card={card}
                onOpenAsset={
                  hasOpenAssetHandler
                    ? () =>
                        latestHandlersRef.current.onOpenAsset?.(card.asset.id)
                    : undefined
                }
                onRenderPreview={(outputFormat) =>
                  void latestHandlersRef.current.onCreateImagePreview(
                    card,
                    "",
                    outputFormat,
                  )
                }
                onAddComment={() => {
                  setSelectedCardIds([card.id]);
                  setCommentMode(true);
                }}
                onDuplicate={() =>
                  latestHandlersRef.current.onDuplicateCard(card)
                }
                onDelete={() => setDeleteConfirmCard(card)}
                working={isWorking}
              />
            ) : card.kind === "upload" ? (
              <UploadContextMenu
                card={card}
                onAddComment={() => {
                  setSelectedCardIds([card.id]);
                  setCommentMode(true);
                }}
                onDuplicate={() =>
                  latestHandlersRef.current.onDuplicateCard(card)
                }
                onDelete={() => setDeleteConfirmCard(card)}
              />
            ) : undefined
          }
        >
          {card.kind === "asset" ? (
            <AssetCardBody
              card={card}
              comments={commentsByAnchor.get(card.id) ?? []}
              hideOverlays={hideNonImageCards}
              commentEnabled={commentMode}
              canvasScale={viewport.scale}
              onSelectComment={(id) => setSelectedCardIds([id])}
              onCreateComment={(anchorCard, text, region) =>
                latestHandlersRef.current.onAddComment(anchorCard, text, region)
              }
            />
          ) : card.kind === "comment" ? (
            <CommentCardBody card={card} />
          ) : card.kind === "assistant" ? (
            <AssistantCardBody card={card} />
          ) : card.kind === "variant" ? (
            <VariantCardBody card={card} />
          ) : card.kind === "proposal" ? (
            <ProposalCardBody card={card} />
          ) : card.kind === "operation" ? (
            <OperationCardBody card={card} />
          ) : card.kind === "upload" ? (
            <UploadCardBody
              card={card}
              comments={commentsByAnchor.get(card.id) ?? []}
              hideOverlays={hideNonImageCards}
              commentEnabled={commentMode}
              canvasScale={viewport.scale}
              onSelectComment={(id) => setSelectedCardIds([id])}
              onCreateComment={(anchorCard, text, region) =>
                latestHandlersRef.current.onAddComment(anchorCard, text, region)
              }
            />
          ) : null}
        </CardShell>
      );
    });
  }, [
    cardWidths,
    cards,
    commentsByAnchor,
    commentMode,
    dragPreview,
    hideNonImageCards,
    hasOpenAssetHandler,
    isWorking,
    selectedCardIds,
    setCards,
    setCardWidths,
    setCommentMode,
    setSelectedCardIds,
    viewport.scale,
  ]);

  return (
    <>
      <div
        className="absolute inset-0 z-0 cursor-default overscroll-none overflow-hidden"
        data-ai-canvas-scroll-area="true"
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerEnd}
        onPointerCancel={onCanvasPointerEnd}
        onWheel={onWheel}
      >
        <div
          ref={canvasInnerRef}
          data-ai-canvas-inner="true"
          className="absolute left-0 top-0 origin-top-left will-change-transform"
          style={
            {
              transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})`,
              "--ai-canvas-scale": String(viewport.scale),
              "--ai-canvas-stable-scale": String(
                viewport.scale > 0 ? 1 / viewport.scale : 1,
              ),
            } as CSSProperties
          }
        >
          {commentConnectors.length > 0 && !hideNonImageCards && (
            <svg
              className="pointer-events-none absolute left-0 top-0 z-[36] overflow-visible"
              width="1"
              height="1"
              aria-hidden="true"
            >
              {commentConnectors.map((connector) => (
                <g key={connector.id}>
                  <path
                    d={connector.path}
                    fill="none"
                    stroke={
                      connector.active ? "var(--g-active-bg)" : "var(--g-amber)"
                    }
                    strokeWidth={connector.active ? 2 : 1.25}
                    strokeDasharray="5 7"
                    strokeLinecap="round"
                    opacity={connector.active ? 0.62 : 0.34}
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    cx={connector.fromX}
                    cy={connector.fromY}
                    r={3.5}
                    fill="var(--g-canvas)"
                    stroke={
                      connector.active ? "var(--g-active-bg)" : "var(--g-amber)"
                    }
                    strokeWidth={1.5}
                    opacity={connector.active ? 0.78 : 0.5}
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    cx={connector.targetX}
                    cy={connector.targetY}
                    r={4}
                    fill={
                      connector.active ? "var(--g-active-bg)" : "var(--g-amber)"
                    }
                    opacity={connector.active ? 0.78 : 0.42}
                  />
                </g>
              ))}
            </svg>
          )}
          {renderedCards}
          {groupBounds && !hideNonImageCards && (
            <div
              className="pointer-events-none absolute z-[38] rounded-g-sm border-2 border-dashed border-[#0d99ff]"
              style={{
                left: groupBounds.x - 8,
                top: groupBounds.y - 8,
                width: groupBounds.w + 16,
                height: groupBounds.h + 16,
              }}
            />
          )}
          {!hideNonImageCards && (
            <AICursor
              position={{ x: aiCursor.x, y: aiCursor.y }}
              label={aiCursor.label}
              status={aiCursor.status}
              nickname={aiNickname}
              greeting={aiGreeting}
              canvasScale={viewport.scale}
            />
          )}
        </div>
      </div>

      {canvasSelection && (
        <div
          className="pointer-events-none absolute z-10 border border-[#0d99ff] bg-[#0d99ff]/10"
          style={selectionBounds(canvasSelection)}
        />
      )}

      <ConfirmDialog
        open={!!deleteConfirmCard}
        onConfirm={() => {
          if (deleteConfirmCard) onDeleteCard(deleteConfirmCard);
          setDeleteConfirmCard(null);
        }}
        onCancel={() => setDeleteConfirmCard(null)}
        title={t("aiCanvas.deleteCard")}
        message={t("aiCanvas.deleteConfirmMessage")}
        confirmText={t("aiCanvas.deleteCard")}
        cancelText={t("common.cancel")}
        variant="danger"
      />

      <ConfirmDialog
        open={!!deleteConfirmSelectedIds}
        onConfirm={() => {
          if (deleteConfirmSelectedIds) {
            latestHandlersRef.current.onDeleteSelectedCards(
              deleteConfirmSelectedIds,
            );
          }
          setDeleteConfirmSelectedIds(null);
        }}
        onCancel={() => setDeleteConfirmSelectedIds(null)}
        title={t("aiCanvas.deleteSelected", {
          count: deleteConfirmSelectedIds?.length ?? 0,
        })}
        message={t("aiCanvas.deleteSelectedConfirmMessage", {
          count: deleteConfirmSelectedIds?.length ?? 0,
        })}
        confirmText={t("aiCanvas.deleteSelected", {
          count: deleteConfirmSelectedIds?.length ?? 0,
        })}
        cancelText={t("common.cancel")}
        variant="danger"
      />
    </>
  );
}
