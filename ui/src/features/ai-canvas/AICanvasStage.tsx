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
import { ConfirmDialog, PromptDialog } from "@/components/ui";
import { AICursor, CardShell } from "./canvasCards";
import {
  AssetCardBody,
  AssistantCardBody,
  CommentCardBody,
  GroupCardBody,
  OperationCardBody,
  ProposalCardBody,
  TextCardBody,
  UploadCardBody,
  VariantCardBody,
} from "./CanvasCardBodies";
import { CanvasTextToolbar } from "./CanvasTextToolbar";
import {
  AssetContextMenu,
  GroupContextMenu,
  SelectionContextMenu,
  TextContextMenu,
  UploadContextMenu,
  VariantContextMenu,
} from "./CanvasContextMenus";
import {
  CARD_WIDTH,
  imageFrameSize,
  isImageCard,
  selectionBounds,
  type CanvasSelection,
} from "./canvasUtils";
import type {
  AssetCanvasCard,
  CanvasCard,
  CommentCanvasCard,
  GroupCanvasCard,
  TextCanvasCard,
  TextStyle,
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
  return isImageCard(card) || card.kind === "text";
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
  onGroupSelectedCards: () => void;
  onUngroupCard: (target: GroupCanvasCard) => void;
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
  onMirrorImage: (
    card: CanvasCard,
    flip: "horizontal" | "vertical" | "both",
  ) => void | Promise<void>;
  onRotateImage: (card: CanvasCard, degrees: number) => void | Promise<void>;
  editingTextCardId: string | null;
  setEditingTextCardId: Dispatch<SetStateAction<string | null>>;
  onDiscardEmptyTextCard: (cardId: string) => void;
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
  onGroupSelectedCards,
  onUngroupCard,
  onRegisterCard,
  onAddComment,
  onCreateImagePreview,
  onMirrorImage,
  onRotateImage,
  editingTextCardId,
  setEditingTextCardId,
  onDiscardEmptyTextCard,
}: AICanvasStageProps) {
  const [deleteConfirmCard, setDeleteConfirmCard] = useState<CanvasCard | null>(
    null,
  );
  const [deleteConfirmSelectedIds, setDeleteConfirmSelectedIds] = useState<
    string[] | null
  >(null);
  const [renameGroupTarget, setRenameGroupTarget] =
    useState<GroupCanvasCard | null>(null);
  const [rotateCustomCard, setRotateCustomCard] = useState<CanvasCard | null>(
    null,
  );
  const textResizeStartRef = useRef<{
    id: string;
    startW: number;
    fontSize: number;
  } | null>(null);
  const [selectionMenuPos, setSelectionMenuPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const selectionContextMenuRef = useRef<HTMLDivElement | null>(null);
  const latestHandlersRef = useRef({
    onAddComment,
    onCreateImagePreview,
    onDeleteCard,
    onDeleteSelectedCards,
    onDragEnd,
    onDragMove,
    onDragStart,
    onDuplicateCard,
    onGroupSelectedCards,
    onMirrorImage,
    onOpenAsset,
    onRegisterCard,
    onRotateImage,
    onUngroupCard,
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
      onGroupSelectedCards,
      onMirrorImage,
      onOpenAsset,
      onRegisterCard,
      onRotateImage,
      onUngroupCard,
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
    onGroupSelectedCards,
    onMirrorImage,
    onOpenAsset,
    onRegisterCard,
    onRotateImage,
    onUngroupCard,
  ]);
  const hasOpenAssetHandler = Boolean(onOpenAsset);

  useEffect(() => {
    if (!selectionMenuPos) return;
    function dismiss(event: PointerEvent) {
      const menu = selectionContextMenuRef.current;
      if (menu && event.target instanceof Node && menu.contains(event.target)) {
        return;
      }
      setSelectionMenuPos(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectionMenuPos(null);
    }
    const frame = requestAnimationFrame(() => {
      document.addEventListener("pointerdown", dismiss);
      document.addEventListener("keydown", onKeyDown);
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [selectionMenuPos]);

  const selectedCards = useMemo(
    () =>
      selectedCardIds
        .map((id) => cards.find((card) => card.id === id))
        .filter((card): card is CanvasCard => Boolean(card)),
    [cards, selectedCardIds],
  );
  const canGroupSelection = useMemo(
    () =>
      selectedCards.length > 1 &&
      selectedCards.every(
        (card) =>
          card.kind === "asset" ||
          card.kind === "upload" ||
          card.kind === "variant",
      ),
    [selectedCards],
  );

  const selectedTextCard = useMemo<TextCanvasCard | null>(() => {
    if (selectedCards.length !== 1) return null;
    const only = selectedCards[0];
    return only.kind === "text" ? only : null;
  }, [selectedCards]);

  const updateTextStyle = (id: string, patch: Partial<TextStyle>) => {
    setCards((current) =>
      current.map((c) =>
        c.id === id && c.kind === "text"
          ? { ...c, style: { ...c.style, ...patch } }
          : c,
      ),
    );
  };

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
            isImageCard(card) || card.kind === "text"
              ? (id, w, startW) => {
                  if (card.kind === "text") {
                    const start = textResizeStartRef.current;
                    const isNewGesture =
                      !start || start.id !== id || start.startW !== startW;
                    if (isNewGesture) {
                      textResizeStartRef.current = {
                        id,
                        startW,
                        fontSize: card.style.fontSize,
                      };
                    }
                    const baseline = textResizeStartRef.current!;
                    const ratio = w / Math.max(1, baseline.startW);
                    const nextFontSize = Math.max(
                      8,
                      Math.min(400, baseline.fontSize * ratio),
                    );
                    setCards((current) =>
                      current.map((c) =>
                        c.id === id && c.kind === "text"
                          ? {
                              ...c,
                              width: w,
                              style: { ...c.style, fontSize: nextFontSize },
                            }
                          : c,
                      ),
                    );
                    setCardWidths((prev) => ({ ...prev, [id]: w }));
                    return;
                  }
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
          onTextEdit={
            card.kind === "text"
              ? () => setEditingTextCardId(card.id)
              : undefined
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
                onGroup={
                  canGroupSelection
                    ? () => latestHandlersRef.current.onGroupSelectedCards()
                    : undefined
                }
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
                onMirror={(flip) =>
                  void latestHandlersRef.current.onMirrorImage(card, flip)
                }
                onRotate={(degrees) =>
                  void latestHandlersRef.current.onRotateImage(card, degrees)
                }
                onRotateCustom={() => setRotateCustomCard(card)}
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
                onMirror={(flip) =>
                  void latestHandlersRef.current.onMirrorImage(card, flip)
                }
                onRotate={(degrees) =>
                  void latestHandlersRef.current.onRotateImage(card, degrees)
                }
                onRotateCustom={() => setRotateCustomCard(card)}
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
            ) : card.kind === "variant" ? (
              <VariantContextMenu
                card={card}
                onMirror={(flip) =>
                  void latestHandlersRef.current.onMirrorImage(card, flip)
                }
                onRotate={(degrees) =>
                  void latestHandlersRef.current.onRotateImage(card, degrees)
                }
                onRotateCustom={() => setRotateCustomCard(card)}
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
            ) : card.kind === "group" ? (
              <GroupContextMenu
                card={card}
                onRename={() => setRenameGroupTarget(card)}
                onUngroup={() => latestHandlersRef.current.onUngroupCard(card)}
                onDelete={() => setDeleteConfirmCard(card)}
              />
            ) : card.kind === "text" ? (
              <TextContextMenu
                card={card}
                onEdit={() => setEditingTextCardId(card.id)}
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
              commentRegionBasis={imageFrameSize(
                card,
                cardWidths[card.id] ?? CARD_WIDTH,
              )}
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
          ) : card.kind === "group" ? (
            <GroupCardBody card={card} />
          ) : card.kind === "text" ? (
            <TextCardBody
              card={card}
              editing={editingTextCardId === card.id}
              onConfirmEdit={(content, width, height) => {
                const trimmed = content.trim();
                if (!trimmed) {
                  onDiscardEmptyTextCard(card.id);
                  setEditingTextCardId(null);
                  return;
                }
                setCards((current) =>
                  current.map((c) =>
                    c.id === card.id && c.kind === "text"
                      ? { ...c, content, width, height }
                      : c,
                  ),
                );
                setEditingTextCardId(null);
              }}
            />
          ) : card.kind === "upload" ? (
            <UploadCardBody
              card={card}
              comments={commentsByAnchor.get(card.id) ?? []}
              hideOverlays={hideNonImageCards}
              commentEnabled={commentMode}
              canvasScale={viewport.scale}
              commentRegionBasis={imageFrameSize(
                card,
                cardWidths[card.id] ?? CARD_WIDTH,
              )}
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
    editingTextCardId,
    setEditingTextCardId,
    onDiscardEmptyTextCard,
    hideNonImageCards,
    hasOpenAssetHandler,
    isWorking,
    canGroupSelection,
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
          {selectedTextCard && !hideNonImageCards && (
            <div
              className="pointer-events-auto absolute z-[1250]"
              style={{
                left: selectedTextCard.x,
                top: selectedTextCard.y,
                transform: `translate(0, -8px) translateY(-100%) scale(${
                  viewport.scale > 0 ? 1 / viewport.scale : 1
                })`,
                transformOrigin: "left bottom",
              }}
            >
              <CanvasTextToolbar
                card={selectedTextCard}
                onUpdate={(patch) =>
                  updateTextStyle(selectedTextCard.id, patch)
                }
              />
            </div>
          )}
          {groupBounds && !hideNonImageCards && (
            <div
              className="absolute z-[38] rounded-g-sm border-2 border-dashed border-[#0d99ff]"
              style={{
                left: groupBounds.x - 8,
                top: groupBounds.y - 8,
                width: groupBounds.w + 16,
                height: groupBounds.h + 16,
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const innerBounds =
                  canvasInnerRef.current?.getBoundingClientRect();
                const scale = Math.max(0.01, viewport.scale);
                setSelectionMenuPos(
                  innerBounds
                    ? {
                        x: (event.clientX - innerBounds.left) / scale,
                        y: (event.clientY - innerBounds.top) / scale,
                      }
                    : { x: groupBounds.x, y: groupBounds.y },
                );
              }}
            />
          )}
          {selectionMenuPos && selectedCardIds.length > 1 && (
            <div
              ref={selectionContextMenuRef}
              className="z-[1300] min-w-[220px] max-w-[320px] rounded-[18px] border border-white/[0.08] bg-[rgba(31,31,31,0.98)] p-1.5 shadow-g-md"
              style={{
                position: "absolute",
                left: selectionMenuPos.x,
                top: selectionMenuPos.y,
                transform: `scale(${1 / Math.max(0.01, viewport.scale)})`,
                transformOrigin: "left top",
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setSelectionMenuPos(null)}
            >
              <SelectionContextMenu
                count={selectedCardIds.length}
                onGroup={
                  canGroupSelection
                    ? () => latestHandlersRef.current.onGroupSelectedCards()
                    : undefined
                }
                onDelete={() =>
                  setDeleteConfirmSelectedIds([...selectedCardIds])
                }
              />
            </div>
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

      <PromptDialog
        open={!!renameGroupTarget}
        onConfirm={(name) => {
          if (!renameGroupTarget) return;
          setCards((current) =>
            current.map((card) =>
              card.id === renameGroupTarget.id && card.kind === "group"
                ? { ...card, name }
                : card,
            ),
          );
          setRenameGroupTarget(null);
        }}
        onCancel={() => setRenameGroupTarget(null)}
        title={t("aiCanvas.renameGroupTitle")}
        placeholder={t("aiCanvas.groupNamePlaceholder")}
        defaultValue={renameGroupTarget?.name ?? ""}
        confirmText={t("aiCanvas.renameGroup")}
        cancelText={t("common.cancel")}
      />

      <PromptDialog
        open={!!rotateCustomCard}
        onConfirm={(value) => {
          if (!rotateCustomCard) return;
          const degrees = Number.parseInt(value, 10);
          if (Number.isFinite(degrees) && degrees !== 0) {
            void latestHandlersRef.current.onRotateImage(
              rotateCustomCard,
              degrees,
            );
          }
          setRotateCustomCard(null);
        }}
        onCancel={() => setRotateCustomCard(null)}
        title={t("aiCanvas.rotateCustomTitle")}
        placeholder={t("aiCanvas.rotateCustomPlaceholder")}
        defaultValue=""
        confirmText={t("aiCanvas.rotate")}
        cancelText={t("common.cancel")}
      />

      <ConfirmDialog
        open={!!deleteConfirmCard}
        onConfirm={() => {
          if (deleteConfirmCard) onDeleteCard(deleteConfirmCard);
          setDeleteConfirmCard(null);
        }}
        onCancel={() => setDeleteConfirmCard(null)}
        title={
          deleteConfirmCard?.kind === "group"
            ? t("aiCanvas.deleteGroup")
            : t("aiCanvas.deleteCard")
        }
        message={
          deleteConfirmCard?.kind === "group"
            ? t("aiCanvas.deleteGroupConfirmMessage", {
                count: deleteConfirmCard.cards.length,
              })
            : t("aiCanvas.deleteConfirmMessage")
        }
        confirmText={
          deleteConfirmCard?.kind === "group"
            ? t("aiCanvas.deleteGroup")
            : t("aiCanvas.deleteCard")
        }
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
