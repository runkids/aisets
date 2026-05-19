import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { CanvasCardLayoutMetrics } from "@/api/canvasChat";
import { renderImageToolPreview, renderUploadPreview } from "@/api/imageTools";
import { previewImageUrl } from "@/api";
import type { AssetItem } from "@/types";
import { fileName } from "@/ui";
import type { TFunction } from "i18next";
import {
  CARD_WIDTH,
  DEFAULT_IMAGE_TOOL_SETTINGS,
  adjacentCardPosition,
  commentIds,
  compactImageAspectRatio,
  nextCardPosition,
  nowISO,
  selectedAssetIds,
} from "./canvasUtils";
import {
  buildAssistantBullets,
  cardIdsForBulkDeletion,
  cardIdsForDeletion,
  commentsForAssets,
  createCanvasCardId,
  selectedAssetCards,
  type AssetCanvasCard,
  type CanvasCard,
  type GroupCanvasCard,
  type GroupChildCanvasCard,
  type TextCanvasCard,
  type UploadCanvasCard,
  type VariantCanvasCard,
} from "./aiCanvasState";
import type { WorkingState } from "./aiCanvasTypes";

interface UseCanvasCardsOpts {
  cards: CanvasCard[];
  setCards: Dispatch<SetStateAction<CanvasCard[]>>;
  selectedCardIds: string[];
  setSelectedCardIds: Dispatch<SetStateAction<string[]>>;
  cardWidths: Record<string, number>;
  setCardWidths: Dispatch<SetStateAction<Record<string, number>>>;
  viewport: { x: number; y: number; scale: number };
  cardLayoutMetrics: CanvasCardLayoutMetrics;
  rootRef: MutableRefObject<HTMLDivElement | null>;
  aiEnabled: boolean;
  t: TFunction;
  setWorking: Dispatch<SetStateAction<WorkingState>>;
  setError: Dispatch<SetStateAction<string>>;
}

export function useCanvasCards(opts: UseCanvasCardsOpts) {
  const {
    cards,
    setCards,
    selectedCardIds,
    setSelectedCardIds,
    cardWidths,
    setCardWidths,
    viewport,
    cardLayoutMetrics,
    rootRef,
    aiEnabled,
    t,
    setWorking,
    setError,
  } = opts;

  const deleteCard = useCallback(
    (target: CanvasCard) => {
      const removedIds = cardIdsForDeletion(cards, target.id);
      setCards((current) => current.filter((card) => !removedIds.has(card.id)));
      setSelectedCardIds((current) =>
        current.filter((id) => !removedIds.has(id)),
      );
    },
    [cards, setCards, setSelectedCardIds],
  );

  const deleteSelectedCards = useCallback(
    (ids: string[]) => {
      const removedIds = cardIdsForBulkDeletion(cards, ids);
      setCards((current) => current.filter((c) => !removedIds.has(c.id)));
      setSelectedCardIds([]);
    },
    [cards, setCards, setSelectedCardIds],
  );

  const groupSelectedCards = useCallback(() => {
    const selected = new Set(selectedCardIds);
    const groupableCards = cards.filter(
      (card): card is GroupChildCanvasCard =>
        selected.has(card.id) &&
        (card.kind === "asset" ||
          card.kind === "upload" ||
          card.kind === "variant"),
    );
    if (groupableCards.length < 2 || groupableCards.length !== selected.size) {
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const childWidths: Record<string, number> = {};
    for (const card of groupableCards) {
      const metrics = cardLayoutMetrics[card.id];
      const width = metrics?.width ?? cardWidths[card.id] ?? CARD_WIDTH;
      const height = metrics?.height ?? width / compactImageAspectRatio(card);
      childWidths[card.id] = width;
      minX = Math.min(minX, card.x);
      minY = Math.min(minY, card.y);
      maxX = Math.max(maxX, card.x + width);
      maxY = Math.max(maxY, card.y + height);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;

    const groupId = createCanvasCardId("group");
    const group: GroupCanvasCard = {
      id: groupId,
      kind: "group",
      x: minX,
      y: minY,
      createdAt: nowISO(),
      cards: groupableCards.map((card) => ({
        ...card,
        x: card.x - minX,
        y: card.y - minY,
      })),
      cardWidths: childWidths,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    };

    setCards((current) => [
      ...current.filter((card) => !selected.has(card.id)),
      group,
    ]);
    setCardWidths((current) => {
      const next = { ...current, [groupId]: group.width };
      for (const id of selected) delete next[id];
      return next;
    });
    setSelectedCardIds([groupId]);
  }, [
    cardLayoutMetrics,
    cardWidths,
    cards,
    selectedCardIds,
    setCards,
    setCardWidths,
    setSelectedCardIds,
  ]);

  const ungroupCard = useCallback(
    (target: GroupCanvasCard) => {
      const renderedWidth = cardWidths[target.id] ?? target.width;
      const scale = target.width > 0 ? renderedWidth / target.width : 1;
      const childWidths = target.cardWidths ?? {};
      const restoredCards = target.cards.map((card) => ({
        ...card,
        x: target.x + card.x * scale,
        y: target.y + card.y * scale,
      }));

      setCards((current) =>
        current.flatMap((card) =>
          card.id === target.id ? restoredCards : [card],
        ),
      );
      setCardWidths((current) => {
        const next = { ...current };
        delete next[target.id];
        for (const card of target.cards) {
          const width = childWidths[card.id];
          if (width) next[card.id] = width * scale;
        }
        return next;
      });
      setSelectedCardIds(target.cards.map((card) => card.id));
    },
    [cardWidths, setCards, setCardWidths, setSelectedCardIds],
  );

  const duplicateCard = useCallback(
    (target: CanvasCard) => {
      if (
        target.kind !== "asset" &&
        target.kind !== "upload" &&
        target.kind !== "variant" &&
        target.kind !== "text"
      ) {
        return;
      }
      const cloneId = createCanvasCardId("copy");
      const clone = {
        ...target,
        id: cloneId,
        x: target.x + 42,
        y: target.y + 42,
        createdAt: nowISO(),
      } as
        | AssetCanvasCard
        | UploadCanvasCard
        | VariantCanvasCard
        | TextCanvasCard;
      setCards((current) => [...current, clone]);
      setSelectedCardIds([cloneId]);
      const width = cardWidths[target.id];
      if (width) {
        setCardWidths((current) => ({ ...current, [cloneId]: width }));
      }
    },
    [cardWidths, setCards, setCardWidths, setSelectedCardIds],
  );

  function addAsset(asset: AssetItem, options?: { select?: boolean }) {
    const id = createCanvasCardId("asset");
    const rect = rootRef.current?.getBoundingClientRect();
    const containerSize = rect
      ? { width: rect.width, height: rect.height }
      : undefined;
    const position = nextCardPosition(cards.length, viewport, containerSize);
    const card: AssetCanvasCard = {
      id,
      kind: "asset",
      x: position.x,
      y: position.y,
      createdAt: nowISO(),
      asset,
    };
    setCards((current) => [...current, card]);
    if (options?.select !== false) {
      setSelectedCardIds([id]);
    }
  }

  function addAssistantCard(promptText: string, message?: string) {
    const assetCards = selectedAssetCards(cards, selectedCardIds);
    const commentCards = commentsForAssets(
      cards,
      assetCards.map((card) => card.id),
    );
    const rect = rootRef.current?.getBoundingClientRect();
    const containerSize = rect
      ? { width: rect.width, height: rect.height }
      : undefined;
    const position = assetCards[0]
      ? adjacentCardPosition(assetCards[0], cardLayoutMetrics)
      : nextCardPosition(cards.length, viewport, containerSize);
    const card: CanvasCard = {
      id: createCanvasCardId("ai"),
      kind: "assistant",
      x: position.x,
      y: position.y,
      createdAt: nowISO(),
      prompt: promptText,
      message:
        message ??
        (aiEnabled ? t("aiCanvas.aiResponse") : t("aiCanvas.aiContextOnly")),
      bullets: buildAssistantBullets(promptText, cards, selectedCardIds),
      assetIds: selectedAssetIds(assetCards),
      commentIds: commentIds(commentCards),
    };
    setCards((current) => [...current, card]);
    setSelectedCardIds([card.id]);
  }

  async function createImagePreview(
    assetCard: AssetCanvasCard,
    promptText: string,
    outputFormat = DEFAULT_IMAGE_TOOL_SETTINGS.outputFormat,
  ) {
    setWorking("imagePreview");
    setError("");
    try {
      const preview = await renderImageToolPreview({
        assetId: assetCard.asset.id,
        outputFormat,
        quality: DEFAULT_IMAGE_TOOL_SETTINGS.quality,
        maxDimensionPx: DEFAULT_IMAGE_TOOL_SETTINGS.maxDimensionPx,
      });
      const card: VariantCanvasCard = {
        id: createCanvasCardId("variant"),
        kind: "variant",
        ...adjacentCardPosition(assetCard, cardLayoutMetrics),
        createdAt: nowISO(),
        sourceAssetId: assetCard.asset.id,
        sourceName: fileName(assetCard.asset.repoPath),
        previewUrl: previewImageUrl(preview.token),
        token: preview.token,
        inputBytes: preview.inputBytes,
        outputBytes: preview.outputBytes,
        inputFormat: preview.inputFormat,
        outputFormat: preview.outputFormat,
      };
      setCards((current) => [...current, card]);
      setSelectedCardIds([card.id]);
      if (promptText) {
        addAssistantCard(promptText, t("aiCanvas.previewGenerated"));
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("aiCanvas.operationError"),
      );
    } finally {
      setWorking("idle");
    }
  }

  async function mirrorImage(
    sourceCard: CanvasCard,
    flip: "horizontal" | "vertical" | "both",
  ) {
    if (
      sourceCard.kind !== "asset" &&
      sourceCard.kind !== "upload" &&
      sourceCard.kind !== "variant"
    )
      return;
    setWorking("imagePreview");
    setError("");
    try {
      const preview =
        sourceCard.kind === "upload"
          ? await renderUploadPreview({
              token: sourceCard.token,
              operation: "mirror_image",
              flip,
            })
          : await renderImageToolPreview({
              assetId:
                sourceCard.kind === "asset"
                  ? sourceCard.asset.id
                  : sourceCard.sourceAssetId,
              operation: "mirror_image",
              outputFormat: "",
              quality: DEFAULT_IMAGE_TOOL_SETTINGS.quality,
              maxDimensionPx: DEFAULT_IMAGE_TOOL_SETTINGS.maxDimensionPx,
              flip,
            });
      const sourceName =
        sourceCard.kind === "asset"
          ? fileName(sourceCard.asset.repoPath)
          : sourceCard.kind === "upload"
            ? sourceCard.fileName
            : sourceCard.sourceName;
      const sourceAssetId =
        sourceCard.kind === "asset"
          ? sourceCard.asset.id
          : sourceCard.kind === "variant"
            ? sourceCard.sourceAssetId
            : sourceCard.id;
      const card: VariantCanvasCard = {
        id: createCanvasCardId("variant"),
        kind: "variant",
        ...adjacentCardPosition(sourceCard, cardLayoutMetrics),
        createdAt: nowISO(),
        sourceAssetId,
        sourceName,
        previewUrl: previewImageUrl(preview.token),
        token: preview.token,
        inputBytes: preview.inputBytes,
        outputBytes: preview.outputBytes,
        inputFormat: preview.inputFormat,
        outputFormat: preview.outputFormat,
        width: preview.width,
        height: preview.height,
        alpha: preview.alpha,
      };
      setCards((current) => [...current, card]);
      setSelectedCardIds([card.id]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("aiCanvas.operationError"),
      );
    } finally {
      setWorking("idle");
    }
  }

  async function rotateImage(sourceCard: CanvasCard, degrees: number) {
    if (
      sourceCard.kind !== "asset" &&
      sourceCard.kind !== "upload" &&
      sourceCard.kind !== "variant"
    )
      return;
    setWorking("imagePreview");
    setError("");
    try {
      const preview =
        sourceCard.kind === "upload"
          ? await renderUploadPreview({
              token: sourceCard.token,
              operation: "rotate_image",
              rotateDegrees: degrees,
            })
          : await renderImageToolPreview({
              assetId:
                sourceCard.kind === "asset"
                  ? sourceCard.asset.id
                  : sourceCard.sourceAssetId,
              operation: "rotate_image",
              outputFormat: "",
              quality: DEFAULT_IMAGE_TOOL_SETTINGS.quality,
              maxDimensionPx: DEFAULT_IMAGE_TOOL_SETTINGS.maxDimensionPx,
              rotateDegrees: degrees,
            });
      const sourceName =
        sourceCard.kind === "asset"
          ? fileName(sourceCard.asset.repoPath)
          : sourceCard.kind === "upload"
            ? sourceCard.fileName
            : sourceCard.sourceName;
      const sourceAssetId =
        sourceCard.kind === "asset"
          ? sourceCard.asset.id
          : sourceCard.kind === "variant"
            ? sourceCard.sourceAssetId
            : sourceCard.id;
      const card: VariantCanvasCard = {
        id: createCanvasCardId("variant"),
        kind: "variant",
        ...adjacentCardPosition(sourceCard, cardLayoutMetrics),
        createdAt: nowISO(),
        sourceAssetId,
        sourceName,
        previewUrl: previewImageUrl(preview.token),
        token: preview.token,
        inputBytes: preview.inputBytes,
        outputBytes: preview.outputBytes,
        inputFormat: preview.inputFormat,
        outputFormat: preview.outputFormat,
        width: preview.width,
        height: preview.height,
        alpha: preview.alpha,
      };
      setCards((current) => [...current, card]);
      setSelectedCardIds([card.id]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("aiCanvas.operationError"),
      );
    } finally {
      setWorking("idle");
    }
  }

  return {
    deleteCard,
    deleteSelectedCards,
    groupSelectedCards,
    ungroupCard,
    duplicateCard,
    addAsset,
    addAssistantCard,
    createImagePreview,
    mirrorImage,
    rotateImage,
  };
}
