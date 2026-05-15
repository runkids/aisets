import type {
  CanvasCardLayoutMetrics,
  CanvasChatEvent,
} from "@/api/canvasChat";
import {
  createCanvasCardId,
  type CanvasCard,
  type ProposalCanvasCard,
} from "./aiCanvasState";
import { adjacentCardPosition, nowISO } from "./canvasUtils";

type ProposalEvent = Extract<CanvasChatEvent, { type: "proposal" }>;
type FocusEvent = Extract<CanvasChatEvent, { type: "focus" }>;

export function canvasActionResultCardIds(
  result: unknown,
  cards: CanvasCard[],
) {
  if (!result || typeof result !== "object") return [];
  const raw = (result as { cardIds?: unknown }).cardIds;
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const id of raw) {
    if (typeof id !== "string") continue;
    const card = canvasCardForRefs(cards, [id]);
    if (card && !ids.includes(card.id)) ids.push(card.id);
  }
  return ids;
}

export function canvasFocusCardFromEvent(
  event: FocusEvent,
  cards: CanvasCard[],
) {
  if (!event.cardId) return undefined;
  return canvasCardForRefs(cards, [event.cardId]);
}

function canvasCardForRefs(cards: CanvasCard[], refs: string[]) {
  return cards.find((card) => {
    if (refs.includes(card.id)) return true;
    return card.kind === "asset" && refs.includes(card.asset.id);
  });
}

export function canvasProposalCardFromEvent(
  event: ProposalEvent,
  options: {
    cards: CanvasCard[];
    selectedCardId?: string;
    cardLayoutMetrics: CanvasCardLayoutMetrics;
    index?: number;
    createId?: () => string;
    now?: () => string;
  },
): ProposalCanvasCard {
  const index = options.index ?? 0;
  const targetRefs = [
    event.targetAssetId,
    ...(event.targetAssetIds ?? []),
  ].filter((id): id is string => typeof id === "string" && !!id);
  const anchorCard =
    canvasCardForRefs(options.cards, targetRefs) ??
    options.cards.find((card) => card.id === options.selectedCardId);
  const position = anchorCard
    ? adjacentCardPosition(anchorCard, options.cardLayoutMetrics, {
        index,
        verticalStep: 88,
        allCards: options.cards,
      })
    : { x: 84, y: 72 + index * 88 };

  return {
    id: options.createId?.() ?? createCanvasCardId("proposal"),
    kind: "proposal",
    x: position.x,
    y: position.y,
    createdAt: options.now?.() ?? nowISO(),
    proposalId: event.id,
    tool: event.tool,
    params: event.params,
    description: "",
    impact: "",
    status: "pending",
    sourceAssetId: event.targetAssetId ?? event.targetAssetIds?.[0],
    sourceAssetIds: event.targetAssetIds,
  };
}
