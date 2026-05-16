import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  writeAICanvasSession,
  type CanvasCard,
  type ChatHistoryEntry,
} from "./aiCanvasState";
import { isImageCard } from "./canvasUtils";
import type { CapturePadding } from "./useCanvasCapture";

const COMPOSER_HEIGHT_STORAGE_KEY = "aisets.canvas.composerHeight";
const IMAGE_OPTIMIZATION_ADVICE_STORAGE_KEY =
  "aisets.canvas.imageOptimizationAdvice";
const CAPTURE_PADDING_X_STORAGE_KEY = "aisets.canvas.capturePaddingX";
const CAPTURE_PADDING_Y_STORAGE_KEY = "aisets.canvas.capturePaddingY";

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

interface UseCanvasEffectsOpts {
  cards: CanvasCard[];
  selectedCardIds: string[];
  viewport: { x: number; y: number; scale: number };
  chatHistory: ChatHistoryEntry[];
  cardWidths: Record<string, number>;
  hideNonImageCards: boolean;
  composerCollapsed: boolean;
  composerHeight: number;
  imageOptimizationAdvice: boolean;
  captureTransparent: boolean;
  capturePadding: CapturePadding;
  handleSaveRef: MutableRefObject<() => void>;
  handleSaveAsRef: MutableRefObject<() => void>;
  setSelectedCardIds: Dispatch<SetStateAction<string[]>>;
  setDebugOpen: Dispatch<SetStateAction<boolean>>;
  setCommentMode: Dispatch<SetStateAction<boolean>>;
  setComposerCollapsed: Dispatch<SetStateAction<boolean>>;
  setMentionMenuOpen: Dispatch<SetStateAction<boolean>>;
}

export function useCanvasEffects(opts: UseCanvasEffectsOpts) {
  const {
    cards,
    selectedCardIds,
    viewport,
    chatHistory,
    cardWidths,
    hideNonImageCards,
    composerCollapsed,
    composerHeight,
    imageOptimizationAdvice,
    captureTransparent,
    capturePadding,
    handleSaveRef,
    handleSaveAsRef,
    setSelectedCardIds,
    setDebugOpen,
    setCommentMode,
    setComposerCollapsed,
    setMentionMenuOpen,
  } = opts;

  useEffect(() => {
    if (typeof window === "undefined") return;
    writeAICanvasSession(window.sessionStorage, {
      version: 1,
      cards,
      selectedCardIds: selectedCardIds.length > 0 ? selectedCardIds : undefined,
      viewport,
      chatHistory: chatHistory.slice(-10),
      cardWidths: Object.keys(cardWidths).length > 0 ? cardWidths : undefined,
      viewMode: hideNonImageCards ? "hidden" : undefined,
    });
  }, [
    cards,
    selectedCardIds,
    viewport,
    chatHistory,
    cardWidths,
    hideNonImageCards,
  ]);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        "aisets.canvas.collapsed",
        composerCollapsed ? "true" : "false",
      );
    } catch {
      // sessionStorage unavailable
    }
  }, [composerCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(COMPOSER_HEIGHT_STORAGE_KEY, String(composerHeight));
    } catch {
      // localStorage unavailable
    }
  }, [composerHeight]);

  useEffect(() => {
    try {
      localStorage.setItem(
        IMAGE_OPTIMIZATION_ADVICE_STORAGE_KEY,
        imageOptimizationAdvice ? "true" : "false",
      );
    } catch {
      // localStorage unavailable
    }
  }, [imageOptimizationAdvice]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "aisets.canvas.captureTransparent",
        captureTransparent ? "true" : "false",
      );
    } catch {
      // localStorage unavailable
    }
  }, [captureTransparent]);

  useEffect(() => {
    try {
      localStorage.setItem(
        CAPTURE_PADDING_X_STORAGE_KEY,
        String(capturePadding.x),
      );
      localStorage.setItem(
        CAPTURE_PADDING_Y_STORAGE_KEY,
        String(capturePadding.y),
      );
    } catch {
      // localStorage unavailable
    }
  }, [capturePadding]);

  useEffect(() => {
    function onSaveShortcut(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        handleSaveAsRef.current();
      } else {
        handleSaveRef.current();
      }
    }
    window.addEventListener("keydown", onSaveShortcut, { capture: true });
    return () =>
      window.removeEventListener("keydown", onSaveShortcut, { capture: true });
  }, [handleSaveAsRef, handleSaveRef]);

  useEffect(() => {
    function onSelectAllImageCardsShortcut(e: KeyboardEvent) {
      if (e.isComposing || isTypingTarget(e.target)) return;
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "a") return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      setSelectedCardIds(cards.filter(isImageCard).map((card) => card.id));
    }
    document.addEventListener("keydown", onSelectAllImageCardsShortcut, {
      capture: true,
    });
    return () => {
      document.removeEventListener("keydown", onSelectAllImageCardsShortcut, {
        capture: true,
      });
    };
  }, [cards, setSelectedCardIds]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && e.key === "D") {
        e.preventDefault();
        setDebugOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [setDebugOpen]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.isComposing || isTypingTarget(e.target)) return;
      if (e.key === "Escape") {
        setCommentMode(false);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.shiftKey && e.key === "@") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setComposerCollapsed(true);
        setMentionMenuOpen(true);
        return;
      }
      if (!e.shiftKey || e.key.toLowerCase() !== "c") return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      setCommentMode((enabled) => !enabled);
    }
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [setCommentMode, setComposerCollapsed, setMentionMenuOpen]);
}
