import type { Dispatch, SetStateAction } from "react";
import type {
  CanvasCardLayoutMetrics,
  CanvasChatEvent,
} from "@/api/canvasChat";
import type { TFunction } from "i18next";
import type { AssetItem } from "@/types";
import {
  createCanvasCardId,
  sanitizeCanvasChatContent,
  type CanvasCard,
  type ChatActivityEntry,
  type ChatMentionPreview,
  type ChatRunUsage,
  type CommentCanvasCard,
} from "./aiCanvasState";
import { adjacentCardPosition, nowISO } from "./canvasUtils";
import {
  canvasActionResultCardIds,
  canvasFocusCardFromEvent,
  canvasProposalCardFromEvent,
} from "./canvasChatEventContract";
import {
  assetsFromActionResult,
  canvasActionResultCreatesAssetCards,
  canvasRunUsageFromDone,
  canvasStatusCursorLabel,
  canvasStatusCursorStatus,
  candidatePreviewMentionsFromSearchResult,
  focusCursorPosition,
  formatOCRActionText,
  isCanvasRegion,
  isCaptureTool,
  isImageVariantTool,
  ocrItemsFromActionResult,
  searchResultNeedsUserConfirmation,
  type AICursorState,
} from "./canvasChatHelpers";

export interface ChatEventMutableState {
  assistantText: string;
  suppressModelTextAfterOCR: boolean;
  searchConfirmationNeeded: boolean;
  runUsage: ChatRunUsage | undefined;
  newCards: CanvasCard[];
  assistantMentionById: Map<string, ChatMentionPreview>;
  pendingVariantPreviews: Promise<void>[];
}

export interface ChatEventDispatchContext {
  state: ChatEventMutableState;
  canvasCards: CanvasCard[];
  canvasPrimarySelectedId: string;
  cardLayoutMetrics: CanvasCardLayoutMetrics;
  viewportScale: number;
  cancelToolStatusClear: () => void;
  scheduleToolStatusClear: () => void;
  pushChatActivity: (
    entry: Omit<ChatActivityEntry, "id" | "atMs"> & { atMs?: number },
  ) => void;
  compactActivityDetail: (value: string | undefined) => string | undefined;
  resolveCanvasCardId: (rawId: string) => string;
  simulateAICardDrag: (
    cardId: string,
    x: number,
    y: number,
    delay?: number,
  ) => void;
  simulateAICardResize: (cardId: string, width: number, delay?: number) => void;
  runCaptureTool: (tool: string, transparent: boolean) => void;
  addGeneratedImageCard: (
    event: Extract<CanvasChatEvent, { type: "generated_image" }>,
  ) => void;
  groupCardsFromResult: (result: unknown) => void;
  ungroupCardFromResult: (result: unknown) => void;
  renameGroupFromResult: (result: unknown) => void;
  duplicateCardsFromResult: (result: unknown) => void;
  addAssetCards: (assets: AssetItem[]) => void;
  addVariantCardsFromImageTool: (
    tool: string,
    result: unknown,
  ) => Promise<void>;
  runAlignTool: (result: unknown) => void;
  runDistributeTool: (result: unknown) => void;
  setAiCursor: Dispatch<SetStateAction<AICursorState>>;
  setCards: Dispatch<SetStateAction<CanvasCard[]>>;
  setSelectedCardIds: Dispatch<SetStateAction<string[]>>;
  setActiveChatUsage?: (usage: ChatRunUsage | undefined) => void;
  setError: Dispatch<SetStateAction<string>>;
  t: TFunction;
}

export function dispatchCanvasChatEvent(
  event: CanvasChatEvent,
  ctx: ChatEventDispatchContext,
): void {
  const {
    state,
    canvasCards,
    canvasPrimarySelectedId,
    cardLayoutMetrics,
    viewportScale,
    cancelToolStatusClear,
    scheduleToolStatusClear,
    pushChatActivity,
    compactActivityDetail,
    resolveCanvasCardId,
    simulateAICardDrag,
    simulateAICardResize,
    runCaptureTool,
    addGeneratedImageCard,
    groupCardsFromResult,
    ungroupCardFromResult,
    renameGroupFromResult,
    duplicateCardsFromResult,
    addAssetCards,
    addVariantCardsFromImageTool,
    runAlignTool,
    runDistributeTool,
    setAiCursor,
    setCards,
    setSelectedCardIds,
    setActiveChatUsage,
    setError,
    t,
  } = ctx;

  if (event.type === "done") {
    state.runUsage = canvasRunUsageFromDone(event);
    setActiveChatUsage?.(state.runUsage);
    pushChatActivity({
      kind: "done",
      label: t("aiCanvas.activityDone"),
      detail: compactActivityDetail(
        [event.providerName, event.modelName].filter(Boolean).join(" · "),
      ),
      tone: "success",
    });
    return;
  }
  if (event.type === "focus" && event.cardId) {
    cancelToolStatusClear();
    const target = canvasFocusCardFromEvent(event, canvasCards);
    if (target) {
      setAiCursor({
        ...focusCursorPosition(target, cardLayoutMetrics, viewportScale),
        label: t("aiCanvas.currentTarget"),
        emoji: "select",
        status: "acting",
      });
    }
  }
  if (event.type === "focus" && !event.cardId) {
    cancelToolStatusClear();
    setAiCursor((prev) => ({ ...prev, status: "idle", label: undefined }));
  }
  if (event.type === "thinking") {
    cancelToolStatusClear();
    setAiCursor((prev) => ({ ...prev, status: "thinking" }));
    pushChatActivity({
      kind: "thinking",
      label: t("aiCanvas.activityThinking"),
    });
  }
  if (event.type === "status") {
    cancelToolStatusClear();
    setAiCursor((prev) => ({
      ...prev,
      label: canvasStatusCursorLabel(event.phase, t),
      emoji: event.phase === "planning" ? "thinking" : "move",
      status: canvasStatusCursorStatus(event.phase),
    }));
    pushChatActivity({
      kind: "status",
      label: canvasStatusCursorLabel(event.phase, t),
      detail: compactActivityDetail(event.content),
    });
  }
  if (event.type === "text") {
    if (state.suppressModelTextAfterOCR) return;
    const text = sanitizeCanvasChatContent(event.content);
    if (text) {
      state.assistantText += (state.assistantText ? "\n\n" : "") + text;
    }
  }
  if (event.type === "proposal") {
    pushChatActivity({
      kind: "proposal",
      label: t("aiCanvas.activityProposal"),
      detail: compactActivityDetail(`${event.tool}: ${event.description}`),
    });
    if (isCaptureTool(event.tool)) {
      runCaptureTool(event.tool, event.params.transparent === true);
      return;
    }
    const card = canvasProposalCardFromEvent(event, {
      cards: canvasCards,
      selectedCardId: canvasPrimarySelectedId,
      cardLayoutMetrics,
      index: state.newCards.length,
    });
    state.newCards.push(card);
    setCards((current) => [...current, card]);
  }
  if (event.type === "generated_image") {
    pushChatActivity({
      kind: "image",
      label: t("aiCanvas.activityGeneratedImage"),
      detail: compactActivityDetail(event.fileName),
    });
    addGeneratedImageCard(event);
  }
  if (event.type === "action_result") {
    pushChatActivity({
      kind: "tool",
      label: event.error
        ? t("aiCanvas.activityToolFailed")
        : t("aiCanvas.activityToolCompleted"),
      detail: compactActivityDetail(event.tool),
      tone: event.error ? "danger" : "success",
    });
  }
  if (event.type === "action_result" && event.tool === "search_assets") {
    if (searchResultNeedsUserConfirmation(event.result)) {
      state.searchConfirmationNeeded = true;
      for (const mention of candidatePreviewMentionsFromSearchResult(
        event.result,
      )) {
        state.assistantMentionById.set(mention.id, mention);
      }
    }
  }
  if (event.type === "action_result" && event.tool === "select_cards") {
    const ids = canvasActionResultCardIds(event.result, canvasCards);
    if (ids.length > 0) {
      setSelectedCardIds(ids);
      const target = canvasCards.find((c) => c.id === ids[0]);
      if (target) {
        setAiCursor({
          ...focusCursorPosition(target, cardLayoutMetrics, viewportScale),
          label: t("aiCanvas.selectedAssets", { count: ids.length }),
          emoji: "select",
          status: "acting",
        });
      }
    }
  }
  if (event.type === "action_result" && event.tool === "remove_cards") {
    const result = event.result as { cardIds?: unknown };
    const ids = Array.isArray(result.cardIds)
      ? result.cardIds.filter(
          (id): id is string =>
            typeof id === "string" && canvasCards.some((c) => c.id === id),
        )
      : [];
    if (ids.length > 0) {
      const removeSet = new Set(ids);
      setCards((current) => current.filter((card) => !removeSet.has(card.id)));
      setSelectedCardIds((current) =>
        current.filter((id) => !removeSet.has(id)),
      );
      const target = canvasCards.find((c) => c.id === ids[0]);
      if (target) {
        setAiCursor({
          ...focusCursorPosition(target, cardLayoutMetrics, viewportScale),
          label: t("aiCanvas.removedCards", { count: ids.length }),
          emoji: "remove",
          status: "acting",
        });
      }
    }
  }
  if (event.type === "action_result" && event.tool === "group_cards") {
    groupCardsFromResult(event.result);
  }
  if (event.type === "action_result" && event.tool === "ungroup_card") {
    ungroupCardFromResult(event.result);
  }
  if (event.type === "action_result" && event.tool === "rename_group") {
    renameGroupFromResult(event.result);
  }
  if (event.type === "action_result" && event.tool === "duplicate_cards") {
    duplicateCardsFromResult(event.result);
  }
  if (event.type === "action_result" && isImageVariantTool(event.tool)) {
    state.pendingVariantPreviews.push(
      addVariantCardsFromImageTool(event.tool, event.result).catch((err) => {
        setError(
          err instanceof Error ? err.message : t("aiCanvas.operationError"),
        );
      }),
    );
  }
  if (event.type === "action_result" && event.tool === "focus_card") {
    const result = event.result as { cardId?: string };
    if (result?.cardId) {
      const target = canvasCards.find((c) => c.id === result.cardId);
      if (target) {
        setAiCursor({
          ...focusCursorPosition(target, cardLayoutMetrics, viewportScale),
          label: t("aiCanvas.currentTarget"),
          emoji: "select",
          status: "acting",
        });
      }
    }
  }
  if (event.type === "action_result" && event.tool === "create_comment") {
    const r = event.result as {
      anchorCardId?: string;
      text?: string;
      region?: { x: number; y: number; width: number; height: number };
    };
    if (r?.anchorCardId && r?.text) {
      const anchorCardId = resolveCanvasCardId(r.anchorCardId);
      const anchor = canvasCards.find((c) => c.id === anchorCardId);
      const position = anchor
        ? adjacentCardPosition(anchor, cardLayoutMetrics, {
            index: state.newCards.length,
            verticalStep: 88,
            allCards: [...canvasCards, ...state.newCards],
            newCardWidth: 280,
            newCardHeight: 100,
          })
        : { x: 84, y: 72 + state.newCards.length * 88 };
      const card: CommentCanvasCard = {
        id: createCanvasCardId("comment"),
        kind: "comment",
        x: position.x,
        y: position.y,
        createdAt: nowISO(),
        anchorId: anchorCardId,
        text: r.text,
        region: r.region ?? { x: 0, y: 0, width: 1, height: 1 },
        isAi: true,
      };
      state.newCards.push(card);
      setCards((current) => [...current, card]);
      if (anchor) {
        setAiCursor({
          ...focusCursorPosition(anchor, cardLayoutMetrics, viewportScale),
          label: t("aiCanvas.addedComment"),
          emoji: "comment",
          status: "acting",
        });
      }
    }
  }
  if (event.type === "action_result" && event.tool === "update_comment") {
    const r = event.result as {
      commentCardId?: string;
      text?: string;
      region?: unknown;
    };
    const region = isCanvasRegion(r?.region) ? r.region : undefined;
    const hasText = typeof r?.text === "string";
    if (r?.commentCardId && (hasText || region)) {
      setCards((current) =>
        current.map((card) =>
          card.kind === "comment" && card.id === r.commentCardId
            ? {
                ...card,
                ...(hasText ? { text: r.text ?? "" } : {}),
                ...(region ? { region } : {}),
              }
            : card,
        ),
      );
    }
  }
  if (event.type === "action_result" && event.tool === "delete_comment") {
    const r = event.result as { commentCardId?: string };
    if (r?.commentCardId) {
      setCards((current) =>
        current.filter((card) => card.id !== r.commentCardId),
      );
    }
  }
  if (event.type === "action_result" && event.tool === "move_card") {
    const r = event.result as {
      cardId?: string;
      x?: number;
      y?: number;
    };
    if (r?.cardId && typeof r.x === "number" && typeof r.y === "number") {
      simulateAICardDrag(r.cardId, r.x, r.y);
    }
  }
  if (event.type === "action_result" && event.tool === "bring_cards_to_front") {
    const r = event.result as {
      cardIds?: unknown;
      afterCardId?: unknown;
      label?: string;
    };
    const ids = Array.isArray(r.cardIds)
      ? r.cardIds.filter(
          (id): id is string =>
            typeof id === "string" && canvasCards.some((c) => c.id === id),
        )
      : [];
    const afterCardId =
      typeof r.afterCardId === "string" ? r.afterCardId : undefined;
    if (ids.length > 0) {
      setCards((current) => {
        const moving = current.filter((card) => ids.includes(card.id));
        const rest = current.filter((card) => !ids.includes(card.id));
        if (!afterCardId) return [...rest, ...moving];
        const targetIndex = rest.findIndex((card) => card.id === afterCardId);
        if (targetIndex < 0) return [...rest, ...moving];
        return [
          ...rest.slice(0, targetIndex + 1),
          ...moving,
          ...rest.slice(targetIndex + 1),
        ];
      });
      const target = canvasCards.find((c) => c.id === ids[0]);
      if (target) {
        setAiCursor({
          ...focusCursorPosition(target, cardLayoutMetrics, viewportScale),
          label: t("aiCanvas.layerChanged"),
          emoji: "layer",
          status: "acting",
        });
      }
    }
  }
  if (event.type === "action_result" && event.tool === "resize_card") {
    const r = event.result as {
      cardId?: string;
      width?: number;
    };
    if (r?.cardId && typeof r.width === "number" && Number.isFinite(r.width)) {
      simulateAICardResize(r.cardId, r.width);
    }
  }
  if (
    event.type === "action_result" &&
    (event.tool === "capture_viewport" ||
      event.tool === "capture_canvas" ||
      event.tool === "capture_selected")
  ) {
    const r = event.result as { transparent?: boolean };
    runCaptureTool(event.tool, r?.transparent === true);
  }
  if (event.type === "action_result" && event.tool === "arrange_cards") {
    const r = event.result as {
      positions?: Array<{ cardId?: string; x?: number; y?: number }>;
    };
    if (r?.positions?.length) {
      const posMap = new Map<string, { x: number; y: number }>();
      for (const p of r.positions) {
        if (
          typeof p.cardId !== "string" ||
          typeof p.x !== "number" ||
          typeof p.y !== "number"
        ) {
          continue;
        }
        const cardId = resolveCanvasCardId(p.cardId);
        if (!canvasCards.some((card) => card.id === cardId)) continue;
        posMap.set(cardId, { x: p.x, y: p.y });
      }
      let delay = 0;
      for (const [cardId, pos] of posMap) {
        simulateAICardDrag(cardId, pos.x, pos.y, delay);
        delay += 1100;
      }
    }
  }
  if (event.type === "action_result" && event.tool === "align_cards") {
    runAlignTool(event.result);
  }
  if (event.type === "action_result" && event.tool === "distribute_cards") {
    runDistributeTool(event.result);
  }
  if (
    event.type === "action_result" &&
    canvasActionResultCreatesAssetCards(event.tool)
  ) {
    const assets = assetsFromActionResult(event.result);
    if (assets.length) {
      addAssetCards(assets);
    }
  }
  if (event.type === "action_result" && event.tool === "extract_ocr_text") {
    state.suppressModelTextAfterOCR = true;
    const text = formatOCRActionText(event.result, t);
    if (text) {
      state.assistantText += (state.assistantText ? "\n\n" : "") + text;
    }
    const ocrItems = ocrItemsFromActionResult(event.result);
    const readyByAssetId = new Map(
      ocrItems
        .filter((item) => item.assetId && item.status === "ready")
        .map((item) => [item.assetId as string, item]),
    );
    if (readyByAssetId.size > 0) {
      setCards((current) =>
        current.map((card) => {
          if (card.kind !== "asset") return card;
          const item = readyByAssetId.get(card.asset.id);
          if (!item) return card;
          return {
            ...card,
            asset: {
              ...card.asset,
              ocr: {
                ...(card.asset.ocr ?? {}),
                status: "ready",
                engineName: "vlm",
                mode: "vlm",
                text: item.text ?? "",
                languages: item.languages ?? [],
              },
            },
          };
        }),
      );
    }
  }
  if (event.type === "action_result") {
    scheduleToolStatusClear();
  }
}
