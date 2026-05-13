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
import {
  createCanvasCardId,
  type AssetCanvasCard,
  type CanvasCard,
  type ChatHistoryEntry,
  type CommentCanvasCard,
  type ProposalCanvasCard,
} from "./aiCanvasState";
import { CARD_WIDTH, nextCardPosition, nowISO } from "./canvasUtils";

type AICursorState = {
  x: number;
  y: number;
  label?: string;
  status: "thinking" | "acting" | "idle";
};

type WorkingState = "idle" | "search" | "ai" | "imagePreview" | "operation";

export function useCanvasChat(opts: {
  scanId: number | undefined;
  cards: CanvasCard[];
  selectedCardId: string | undefined;
  viewport: { x: number; y: number; scale: number };
  chatHistory: ChatHistoryEntry[];
  prompt: string;
  t: TFunction;
  rootRef: RefObject<HTMLDivElement | null>;
  setCards: Dispatch<SetStateAction<CanvasCard[]>>;
  setChatHistory: Dispatch<SetStateAction<ChatHistoryEntry[]>>;
  setAiCursor: Dispatch<SetStateAction<AICursorState>>;
  setError: Dispatch<SetStateAction<string>>;
  setWorking: Dispatch<SetStateAction<WorkingState>>;
  setPrompt: Dispatch<SetStateAction<string>>;
}) {
  const {
    scanId,
    cards,
    selectedCardId,
    viewport,
    chatHistory,
    prompt,
    t,
    rootRef,
    setCards,
    setChatHistory,
    setAiCursor,
    setError,
    setWorking,
    setPrompt,
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
    setPrompt("");
    setError("");
    setWorking("ai");

    setChatHistory((prev) => [
      ...prev.slice(-9),
      { role: "user", content: promptText },
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
