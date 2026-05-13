import type { Dispatch, RefObject, SetStateAction } from "react";
import { useRef } from "react";
import type { TFunction } from "i18next";
import { getCatalogItems } from "@/api";
import {
  canvasChat,
  serializeCanvasSnapshot,
  type CanvasChatEvent,
} from "@/api/canvasChat";
import type { AssetItem } from "@/types";
import { fileName } from "@/ui";
import {
  createCanvasCardId,
  type AssetCanvasCard,
  type CanvasCard,
  type ChatHistoryEntry,
  type ChatMentionPreview,
  type CommentCanvasCard,
  type ProposalCanvasCard,
} from "./aiCanvasState";
import { CARD_WIDTH, imageMeta, nextCardPosition, nowISO } from "./canvasUtils";

type AICursorState = {
  x: number;
  y: number;
  label?: string;
  status: "thinking" | "acting" | "idle";
};

type WorkingState = "idle" | "search" | "ai" | "imagePreview" | "operation";

function mentionPreviewForCard(card: CanvasCard): ChatMentionPreview | undefined {
  if (card.kind === "asset") {
    return {
      id: card.id,
      name: fileName(card.asset.repoPath),
      meta: imageMeta(card.asset),
      src: card.asset.thumbnailUrl || card.asset.url,
    };
  }
  if (card.kind === "variant") {
    return {
      id: card.id,
      name: card.sourceName,
      meta: `${card.inputFormat.toUpperCase()} → ${card.outputFormat.toUpperCase()}`,
      src: card.previewUrl,
    };
  }
  return undefined;
}

export function useCanvasChat(opts: {
  scanId: number | undefined;
  cards: CanvasCard[];
  selectedCardId: string | undefined;
  viewport: { x: number; y: number; scale: number };
  chatHistory: ChatHistoryEntry[];
  prompt: string;
  mentionedCardIds: string[];
  imageOptimizationAdvice: boolean;
  t: TFunction;
  rootRef: RefObject<HTMLDivElement | null>;
  setCards: Dispatch<SetStateAction<CanvasCard[]>>;
  setChatHistory: Dispatch<SetStateAction<ChatHistoryEntry[]>>;
  setAiCursor: Dispatch<SetStateAction<AICursorState>>;
  setError: Dispatch<SetStateAction<string>>;
  setWorking: Dispatch<SetStateAction<WorkingState>>;
  setPrompt: Dispatch<SetStateAction<string>>;
  setMentionedCardIds: Dispatch<SetStateAction<string[]>>;
}) {
  const {
    scanId,
    cards,
    selectedCardId,
    viewport,
    chatHistory,
    prompt,
    mentionedCardIds,
    imageOptimizationAdvice,
    t,
    rootRef,
    setCards,
    setChatHistory,
    setAiCursor,
    setError,
    setWorking,
    setPrompt,
    setMentionedCardIds,
  } = opts;

  const abortRef = useRef<AbortController | null>(null);
  const searchResultsRef = useRef<Array<{ id: string; repoPath: string }>>([]);

  async function handleAsk(overrides?: {
    prompt?: string;
    selectedCardId?: string;
    cards?: CanvasCard[];
  }) {
    const promptText = (overrides?.prompt ?? prompt).trim();
    if (!promptText) return;
    const canvasCards = overrides?.cards ?? cards;
    const canvasSelectedCardId = overrides?.selectedCardId ?? selectedCardId;
    const canvasMentionedCardIds = mentionedCardIds.filter((id) =>
      canvasCards.some((card) => card.id === id),
    );
    setPrompt("");
    setMentionedCardIds([]);
    setError("");
    setWorking("ai");

    const mentionPreviews = canvasMentionedCardIds
      .map((id) => canvasCards.find((card) => card.id === id))
      .map((card) => (card ? mentionPreviewForCard(card) : undefined))
      .filter((mention): mention is ChatMentionPreview => Boolean(mention));

    setChatHistory((prev) => [
      ...prev.slice(-9),
      {
        role: "user",
        content: promptText,
        mentions: mentionPreviews.length > 0 ? mentionPreviews : undefined,
      },
    ]);

    const abort = new AbortController();
    abortRef.current = abort;

    const messages: ChatHistoryEntry[] = [
      ...chatHistory,
      { role: "user", content: promptText },
    ];
    const snapshot = serializeCanvasSnapshot(
      canvasCards,
      canvasSelectedCardId,
      viewport,
      canvasMentionedCardIds,
    );

    let assistantText = "";
    const newCards: CanvasCard[] = [];

    function handleEvent(event: CanvasChatEvent) {
      if (event.type === "focus" && event.cardId) {
        const target = canvasCards.find((c) => c.id === event.cardId);
        if (target) {
          setAiCursor({
            x: target.x + CARD_WIDTH / 2,
            y: target.y - 24,
            label: event.label,
            status: "acting",
          });
        }
      }
      if (event.type === "focus" && !event.cardId) {
        setAiCursor((prev) => ({ ...prev, status: "idle", label: undefined }));
      }
      if (event.type === "thinking") {
        setAiCursor((prev) => ({ ...prev, status: "thinking" }));
      }
      if (event.type === "text") {
        assistantText += (assistantText ? "\n\n" : "") + event.content;
      }
      if (event.type === "proposal") {
        const selectedCard = canvasCards.find(
          (c) => c.id === canvasSelectedCardId,
        );
        const baseX = selectedCard ? selectedCard.x - CARD_WIDTH - 36 : 84;
        const baseY = selectedCard ? selectedCard.y : 72;
        const card: ProposalCanvasCard = {
          id: createCanvasCardId("proposal"),
          kind: "proposal",
          x: baseX,
          y: baseY + newCards.length * 220,
          createdAt: nowISO(),
          proposalId: event.id,
          tool: event.tool,
          params: event.params,
          description: event.description,
          impact: event.impact,
          status: "pending",
          sourceAssetId: event.targetAssetId,
        };
        newCards.push(card);
        setCards((current) => [...current, card]);
      }
      if (event.type === "action_result" && event.tool === "focus_card") {
        const result = event.result as { cardId?: string; label?: string };
        if (result?.cardId) {
          const target = canvasCards.find((c) => c.id === result.cardId);
          if (target) {
            setAiCursor({
              x: target.x + CARD_WIDTH / 2,
              y: target.y - 24,
              label: result.label,
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
          const anchor = canvasCards.find((c) => c.id === r.anchorCardId);
          const card: CommentCanvasCard = {
            id: createCanvasCardId("comment"),
            kind: "comment",
            x: anchor ? anchor.x - CARD_WIDTH - 24 : 84,
            y: anchor ? anchor.y + 100 + newCards.length * 160 : 72,
            createdAt: nowISO(),
            anchorId: r.anchorCardId,
            text: r.text,
            region: r.region ?? { x: 0, y: 0, width: 1, height: 1 },
          };
          newCards.push(card);
          setCards((current) => [...current, card]);
        }
      }
      if (event.type === "action_result" && event.tool === "move_card") {
        const r = event.result as {
          cardId?: string;
          x?: number;
          y?: number;
        };
        if (r?.cardId && typeof r.x === "number" && typeof r.y === "number") {
          setCards((cur) =>
            cur.map((c) =>
              c.id === r.cardId ? { ...c, x: r.x!, y: r.y! } : c,
            ),
          );
        }
      }
      if (event.type === "action_result" && event.tool === "arrange_cards") {
        const r = event.result as {
          positions?: Array<{ cardId?: string; x?: number; y?: number }>;
        };
        if (r?.positions?.length) {
          const posMap = new Map(
            r.positions
              .filter(
                (p): p is { cardId: string; x: number; y: number } =>
                  typeof p.cardId === "string" &&
                  typeof p.x === "number" &&
                  typeof p.y === "number",
              )
              .map((p) => [p.cardId, { x: p.x, y: p.y }]),
          );
          setCards((cur) =>
            cur.map((c) => {
              const pos = posMap.get(c.id);
              return pos ? { ...c, x: pos.x, y: pos.y } : c;
            }),
          );
        }
      }
      if (event.type === "action_result" && event.tool === "search_assets") {
        const r = event.result as {
          q?: string;
          items?: Array<{ id: string; repoPath: string }>;
        };
        if (r?.items?.length) {
          for (const it of r.items) {
            if (!searchResultsRef.current.some((s) => s.id === it.id)) {
              searchResultsRef.current.push({
                id: it.id,
                repoPath: it.repoPath,
              });
            }
          }
        }
      }
    }

    try {
      await canvasChat({
        messages,
        canvas: snapshot,
        locale: "zh-TW",
        options: { imageOptimizationAdvice },
        onEvent: handleEvent,
        signal: abort.signal,
      });

      if (assistantText) {
        setChatHistory((prev) => [
          ...prev.slice(-10),
          { role: "assistant", content: assistantText },
        ]);
      }

      if (searchResultsRef.current.length > 0 && scanId) {
        try {
          const wanted = [...searchResultsRef.current];
          searchResultsRef.current = [];
          const wantedIds = new Set(wanted.map((w) => w.id));
          const names = [
            ...new Set(
              wanted.map((w) => {
                const parts = w.repoPath.split("/");
                return parts[parts.length - 1].replace(/\.[^.]+$/, "");
              }),
            ),
          ];
          const allItems: AssetItem[] = [];
          const seenIds = new Set<string>();
          for (const name of names.slice(0, 12)) {
            const page = await getCatalogItems({
              scanId,
              q: name,
              limit: 3,
            });
            for (const item of page.items) {
              if (!seenIds.has(item.id)) {
                seenIds.add(item.id);
                allItems.push(item);
              }
            }
          }
          const matchedAssets = allItems.filter((a) => wantedIds.has(a.id));
          const rect = rootRef.current?.getBoundingClientRect();
          const containerSize = rect
            ? { width: rect.width, height: rect.height }
            : undefined;
          const addedCards: AssetCanvasCard[] = [];
          for (const asset of matchedAssets) {
            const exists = canvasCards.some(
              (c): c is AssetCanvasCard =>
                c.kind === "asset" && c.asset.id === asset.id,
            );
            if (exists) continue;
            const pos = nextCardPosition(
              canvasCards.length + newCards.length + addedCards.length,
              viewport,
              containerSize,
            );
            const card: AssetCanvasCard = {
              id: createCanvasCardId("asset"),
              kind: "asset",
              x: pos.x + (addedCards.length % 3) * (CARD_WIDTH + 24),
              y: pos.y + Math.floor(addedCards.length / 3) * 420,
              createdAt: nowISO(),
              asset,
            };
            addedCards.push(card);
          }
          if (addedCards.length > 0) {
            setCards((cur) => [...cur, ...addedCards]);
          }
        } catch {
          // search result fetch failed — non-critical
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(
          err instanceof Error ? err.message : t("aiCanvas.operationError"),
        );
      }
    } finally {
      setWorking("idle");
      setAiCursor((prev) => ({ ...prev, status: "idle", label: undefined }));
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  return { handleAsk, handleStop };
}
