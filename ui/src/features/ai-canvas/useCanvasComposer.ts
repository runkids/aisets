import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { uploadCanvasImages } from "@/api/canvasChat";
import type { TFunction } from "i18next";
import { fileName } from "@/ui";
import {
  createCanvasCardId,
  type AssetCanvasCard,
  type CanvasCard,
  type PendingAttachment,
} from "./aiCanvasState";
import { imageMeta } from "./canvasUtils";
import type { WorkingState } from "./aiCanvasTypes";

interface UseCanvasComposerOpts {
  cards: CanvasCard[];
  selectedCardIds: string[];
  selectedAssets: AssetCanvasCard[];
  setSelectedCardIds: Dispatch<SetStateAction<string[]>>;
  setWorking: Dispatch<SetStateAction<WorkingState>>;
  setError: Dispatch<SetStateAction<string>>;
  t: TFunction;
}

export function useCanvasComposer(opts: UseCanvasComposerOpts) {
  const {
    cards,
    selectedCardIds,
    selectedAssets,
    setSelectedCardIds,
    setWorking,
    setError,
    t,
  } = opts;

  const [prompt, setPrompt] = useState("");
  const [preparedSkillIds, setPreparedSkillIds] = useState<string[]>([]);
  const [mentionedCardIds, setMentionedCardIds] = useState<string[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingAttachment[]
  >([]);
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
  const [composerCollapsed, setComposerCollapsed] = useState(() => {
    try {
      return sessionStorage.getItem("aisets.canvas.collapsed") === "true";
    } catch {
      return true;
    }
  });
  const [imageOptimizationAdvice, setImageOptimizationAdvice] = useState(() => {
    try {
      return (
        localStorage.getItem("aisets.canvas.imageOptimizationAdvice") === "true"
      );
    } catch {
      return false;
    }
  });
  const [composerHeight, setComposerHeight] = useState(() => {
    try {
      const saved = Number(
        localStorage.getItem("aisets.canvas.composerHeight"),
      );
      return Number.isFinite(saved) && saved >= 200 ? saved : 320;
    } catch {
      return 320;
    }
  });

  const mentionableImageCards = useMemo(
    () =>
      cards.flatMap((card) => {
        if (card.kind === "asset") {
          return [
            {
              id: card.id,
              name: fileName(card.asset.repoPath),
              meta: imageMeta(card.asset),
              src: card.asset.thumbnailUrl || card.asset.url,
            },
          ];
        }
        if (card.kind === "variant") {
          return [
            {
              id: card.id,
              name: card.sourceName,
              meta: `${card.inputFormat.toUpperCase()} → ${card.outputFormat.toUpperCase()}`,
              src: card.previewUrl,
            },
          ];
        }
        if (card.kind === "upload") {
          return [
            {
              id: card.id,
              name: card.fileName,
              meta: `${card.uploadWidth}×${card.uploadHeight} · upload`,
              src: card.thumbnailDataUrl,
            },
          ];
        }
        return [];
      }),
    [cards],
  );

  const mentionedImageCards = useMemo(
    () =>
      mentionedCardIds
        .map((id) => mentionableImageCards.find((card) => card.id === id))
        .filter((card): card is (typeof mentionableImageCards)[number] =>
          Boolean(card),
        ),
    [mentionableImageCards, mentionedCardIds],
  );

  const extractTextTargetCount = useMemo(() => {
    const targetIds = new Set<string>();
    for (const card of cards) {
      if (card.kind !== "asset" && card.kind !== "upload") continue;
      if (
        selectedCardIds.includes(card.id) ||
        mentionedCardIds.includes(card.id)
      ) {
        targetIds.add(card.id);
      }
    }
    return targetIds.size;
  }, [cards, mentionedCardIds, selectedCardIds]);

  function appendPromptToken(token: string) {
    appendPromptTokens([token]);
  }

  function appendPromptTokens(tokens: string[]) {
    const clean = tokens.filter(Boolean);
    if (clean.length === 0) return;
    setPrompt((current) => {
      const trimmed = current.trimEnd();
      const suffix = clean.join(" ");
      return trimmed ? `${trimmed} ${suffix}` : suffix;
    });
  }

  function mentionImageCard(cardId: string) {
    const target = mentionableImageCards.find((card) => card.id === cardId);
    if (!target) return;
    setMentionedCardIds((current) =>
      current.includes(cardId) ? current : [...current, cardId],
    );
    setSelectedCardIds([cardId]);
    appendPromptToken(`@${target.name}`);
  }

  function mentionAllImageCards() {
    const ids = mentionableImageCards.map((card) => card.id);
    setMentionedCardIds((current) => [
      ...current,
      ...ids.filter((id) => !current.includes(id)),
    ]);
    appendPromptToken("@all");
  }

  function mentionSelectedAsset() {
    const targets = selectedAssets
      .map((asset) =>
        mentionableImageCards.find((card) => card.id === asset.id),
      )
      .filter((card): card is (typeof mentionableImageCards)[number] =>
        Boolean(card),
      );
    if (targets.length > 0) {
      const ids = targets.map((target) => target.id);
      setMentionedCardIds((current) => [
        ...current,
        ...ids.filter((id) => !current.includes(id)),
      ]);
      setSelectedCardIds(ids);
      appendPromptTokens(targets.map((target) => `@${target.name}`));
      return;
    }
    appendPromptToken("@" + t("aiCanvas.selectedMention"));
  }

  async function handleUploadToComposer(files: File[]) {
    setWorking("ai");
    try {
      const results = await uploadCanvasImages(files);
      const attachments: PendingAttachment[] = results.map((r) => ({
        id: createCanvasCardId("attach"),
        token: r.token,
        thumbnailDataUrl: r.thumbnailDataUrl,
        fileName: r.fileName,
        width: r.width,
        height: r.height,
      }));
      setPendingAttachments((prev) => [...prev, ...attachments]);
      setComposerCollapsed(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("aiCanvas.operationError"),
      );
    } finally {
      setWorking("idle");
    }
  }

  function handleAttachImage() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,.svg,.avif,.heic,.heif,.webp";
    input.multiple = true;
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      if (files.length > 0) handleUploadToComposer(files);
    };
    input.click();
  }

  const uploadRef = useRef<(files: File[]) => void>(handleUploadToComposer);
  useEffect(() => {
    uploadRef.current = handleUploadToComposer;
  });
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of items) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (!file) continue;
        if (
          file.type.startsWith("image/") ||
          file.name?.toLowerCase().endsWith(".svg")
        ) {
          files.push(file);
        }
      }
      if (files.length === 0) return;
      e.preventDefault();
      uploadRef.current(files);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  return {
    prompt,
    setPrompt,
    preparedSkillIds,
    setPreparedSkillIds,
    mentionedCardIds,
    setMentionedCardIds,
    pendingAttachments,
    setPendingAttachments,
    mentionMenuOpen,
    setMentionMenuOpen,
    composerCollapsed,
    setComposerCollapsed,
    imageOptimizationAdvice,
    setImageOptimizationAdvice,
    composerHeight,
    setComposerHeight,
    mentionableImageCards,
    mentionedImageCards,
    extractTextTargetCount,
    appendPromptToken,
    appendPromptTokens,
    mentionImageCard,
    mentionAllImageCards,
    mentionSelectedAsset,
    handleUploadToComposer,
    handleAttachImage,
  };
}
