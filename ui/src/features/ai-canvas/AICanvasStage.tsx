import type {
  Dispatch,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
  WheelEvent as ReactWheelEvent,
} from "react";
import type { TFunction } from "i18next";
import {
  AICursor,
  AssetCardBody,
  AssistantCardBody,
  CardShell,
  CommentCardBody,
  OperationCardBody,
  ProposalCardBody,
  VariantCardBody,
} from "./canvasCards";
import {
  CARD_WIDTH,
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

type AICanvasStageProps = {
  t: TFunction;
  viewport: { x: number; y: number; scale: number };
  cards: CanvasCard[];
  setCards: Dispatch<SetStateAction<CanvasCard[]>>;
  selectedCardIds: string[];
  setSelectedCardIds: Dispatch<SetStateAction<string[]>>;
  cardWidths: Record<string, number>;
  setCardWidths: Dispatch<SetStateAction<Record<string, number>>>;
  compactCards: boolean;
  hideCards: boolean;
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
  commentMode: boolean;
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
  onRegisterCard: (cardId: string, node: HTMLElement | null) => void;
  onAddComment: (
    assetCard: AssetCanvasCard,
    text?: string,
    region?: { x: number; y: number; width: number; height: number },
  ) => void;
  onCreateImagePreview: (
    assetCard: AssetCanvasCard,
    promptText: string,
  ) => void | Promise<void>;
  onCreateOperationPreview: (
    assetCards: AssetCanvasCard[],
    promptText: string,
  ) => void | Promise<void>;
};

export function AICanvasStage({
  t,
  viewport,
  cards,
  setCards,
  selectedCardIds,
  setSelectedCardIds,
  cardWidths,
  setCardWidths,
  compactCards,
  hideCards,
  commentConnectors,
  commentsByAnchor,
  groupBounds,
  canvasSelection,
  dragPreview,
  aiCursor,
  aiNickname,
  commentMode,
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
  onRegisterCard,
  onAddComment,
  onCreateImagePreview,
  onCreateOperationPreview,
}: AICanvasStageProps) {
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
          data-ai-canvas-inner="true"
          className="absolute left-0 top-0 origin-top-left"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          }}
        >
          {commentConnectors.length > 0 && !hideCards && (
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
          {cards.map((card) => {
            if (hideCards && card.kind !== "asset") return null;
            return (
              <CardShell
                key={card.id}
                card={card}
                selected={selectedCardIds.includes(card.id)}
                compact={compactCards && card.kind === "asset"}
                width={cardWidths[card.id]}
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
                onDragStart={onDragStart}
                onDragMove={onDragMove}
                onDragEnd={onDragEnd}
                onDelete={onDeleteCard}
                onResize={
                  card.kind === "asset"
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
                                200,
                                Math.min(
                                  800,
                                  (prev[peerId] ?? CARD_WIDTH) * ratio,
                                ),
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
                onRegister={onRegisterCard}
                position={
                  dragPreview?.cardId === card.id
                    ? { x: dragPreview.x, y: dragPreview.y }
                    : undefined
                }
              >
                {card.kind === "asset" ? (
                  <AssetCardBody
                    card={card}
                    comments={commentsByAnchor.get(card.id) ?? []}
                    compact={compactCards && card.kind === "asset"}
                    hideOverlays={hideCards}
                    commentEnabled={commentMode}
                    onOpenAsset={onOpenAsset}
                    onSelectComment={(id) => setSelectedCardIds([id])}
                    onCreateComment={onAddComment}
                    onRenderPreview={(assetCard) =>
                      void onCreateImagePreview(assetCard, "")
                    }
                    onOperationPreview={(assetCard) =>
                      void onCreateOperationPreview(
                        [assetCard],
                        t("aiCanvas.safeVariantPrompt"),
                      )
                    }
                    working={isWorking}
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
                ) : null}
              </CardShell>
            );
          })}
          {groupBounds && !hideCards && (
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
          {!hideCards && (
            <AICursor
              position={{ x: aiCursor.x, y: aiCursor.y }}
              label={aiCursor.label}
              status={aiCursor.status}
              nickname={aiNickname}
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
    </>
  );
}
