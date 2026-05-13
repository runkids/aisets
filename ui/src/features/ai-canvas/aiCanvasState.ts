import type { ActionPreview, AssetItem } from "@/types";
import { fileName, formatBytes } from "@/ui";

export const AI_CANVAS_STORAGE_KEY = "aisets.aiCanvas.v1";

export type CanvasViewport = {
  x: number;
  y: number;
  scale: number;
};

export type CanvasRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CanvasCardBase = {
  id: string;
  x: number;
  y: number;
  createdAt: string;
};

export type AssetCanvasCard = CanvasCardBase & {
  kind: "asset";
  asset: AssetItem;
};

export type CommentCanvasCard = CanvasCardBase & {
  kind: "comment";
  anchorId: string;
  text: string;
  region: CanvasRegion;
};

export type AssistantCanvasCard = CanvasCardBase & {
  kind: "assistant";
  prompt: string;
  message: string;
  bullets: string[];
  assetIds: string[];
  commentIds: string[];
};

export type VariantCanvasCard = CanvasCardBase & {
  kind: "variant";
  sourceAssetId: string;
  sourceName: string;
  previewUrl: string;
  token: string;
  inputBytes: number;
  outputBytes: number;
  inputFormat: string;
  outputFormat: string;
};

export type OperationCanvasCard = CanvasCardBase & {
  kind: "operation";
  prompt: string;
  token: string;
  preview: ActionPreview;
  assetIds: string[];
};

export type ProposalStatus =
  | "pending"
  | "executing"
  | "completed"
  | "rejected"
  | "failed";

export type ProposalCanvasCard = CanvasCardBase & {
  kind: "proposal";
  proposalId: string;
  tool: string;
  params: Record<string, unknown>;
  description: string;
  impact: string;
  status: ProposalStatus;
  result?: unknown;
  error?: string;
  sourceAssetId?: string;
};

export type CanvasCard =
  | AssetCanvasCard
  | CommentCanvasCard
  | AssistantCanvasCard
  | VariantCanvasCard
  | OperationCanvasCard
  | ProposalCanvasCard;

export type ChatHistoryEntry = { role: string; content: string };

export type AICanvasSession = {
  version: 1;
  cards: CanvasCard[];
  selectedCardId?: string;
  viewport: CanvasViewport;
  chatHistory?: ChatHistoryEntry[];
};

export type AICanvasPromptIntent =
  | "comment"
  | "operationPreview"
  | "imagePreview"
  | "imageEdit"
  | "describe";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const DEFAULT_CANVAS_VIEWPORT: CanvasViewport = {
  x: 0,
  y: 0,
  scale: 1,
};

export function emptyAICanvasSession(): AICanvasSession {
  return {
    version: 1,
    cards: [],
    viewport: DEFAULT_CANVAS_VIEWPORT,
  };
}

export function createCanvasCardId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

const MIN_CANVAS_SCALE = 0.01;
const MAX_CANVAS_SCALE = 256;

export function clampCanvasScale(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAssetLike(value: unknown): value is AssetItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.repoPath === "string" &&
    isRecord(value.image)
  );
}

function isActionPreviewLike(value: unknown): value is ActionPreview {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    Array.isArray(value.changes) &&
    Array.isArray(value.blockers) &&
    Array.isArray(value.deletes)
  );
}

function normalizeCard(value: unknown): CanvasCard | null {
  if (!isRecord(value)) return null;
  const kind = value.kind;
  const id = typeof value.id === "string" ? value.id : "";
  const x = Number(value.x);
  const y = Number(value.y);
  const createdAt =
    typeof value.createdAt === "string"
      ? value.createdAt
      : new Date().toISOString();

  if (!id || !Number.isFinite(x) || !Number.isFinite(y)) return null;

  if (kind === "asset" && isAssetLike(value.asset)) {
    return { id, kind, x, y, createdAt, asset: value.asset };
  }

  if (kind === "comment" && typeof value.anchorId === "string") {
    const region = isRecord(value.region) ? value.region : {};
    return {
      id,
      kind,
      x,
      y,
      createdAt,
      anchorId: value.anchorId,
      text: typeof value.text === "string" ? value.text : "",
      region: {
        x: Number(region.x) || 0.32,
        y: Number(region.y) || 0.28,
        width: Number(region.width) || 0.34,
        height: Number(region.height) || 0.24,
      },
    };
  }

  if (kind === "assistant") {
    return {
      id,
      kind,
      x,
      y,
      createdAt,
      prompt: typeof value.prompt === "string" ? value.prompt : "",
      message: typeof value.message === "string" ? value.message : "",
      bullets: Array.isArray(value.bullets)
        ? value.bullets.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      assetIds: Array.isArray(value.assetIds)
        ? value.assetIds.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      commentIds: Array.isArray(value.commentIds)
        ? value.commentIds.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
    };
  }

  if (
    kind === "variant" &&
    typeof value.sourceAssetId === "string" &&
    typeof value.previewUrl === "string" &&
    typeof value.token === "string"
  ) {
    return {
      id,
      kind,
      x,
      y,
      createdAt,
      sourceAssetId: value.sourceAssetId,
      sourceName:
        typeof value.sourceName === "string" ? value.sourceName : "image",
      previewUrl: value.previewUrl,
      token: value.token,
      inputBytes: Number(value.inputBytes) || 0,
      outputBytes: Number(value.outputBytes) || 0,
      inputFormat:
        typeof value.inputFormat === "string" ? value.inputFormat : "input",
      outputFormat:
        typeof value.outputFormat === "string" ? value.outputFormat : "output",
    };
  }

  if (
    kind === "operation" &&
    typeof value.token === "string" &&
    isActionPreviewLike(value.preview)
  ) {
    return {
      id,
      kind,
      x,
      y,
      createdAt,
      prompt: typeof value.prompt === "string" ? value.prompt : "",
      token: value.token,
      preview: value.preview,
      assetIds: Array.isArray(value.assetIds)
        ? value.assetIds.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
    };
  }

  if (kind === "proposal" && typeof value.tool === "string") {
    return {
      id,
      kind,
      x,
      y,
      createdAt,
      proposalId: typeof value.proposalId === "string" ? value.proposalId : id,
      tool: value.tool,
      params: isRecord(value.params)
        ? (value.params as Record<string, unknown>)
        : {},
      description:
        typeof value.description === "string" ? value.description : "",
      impact: typeof value.impact === "string" ? value.impact : "",
      status:
        typeof value.status === "string"
          ? (value.status as ProposalStatus)
          : "pending",
      result: value.result,
      error: typeof value.error === "string" ? value.error : undefined,
      sourceAssetId:
        typeof value.sourceAssetId === "string"
          ? value.sourceAssetId
          : undefined,
    };
  }

  return null;
}

export function normalizeAICanvasSession(value: unknown): AICanvasSession {
  if (!isRecord(value)) return emptyAICanvasSession();
  const cards = Array.isArray(value.cards)
    ? value.cards
        .map(normalizeCard)
        .filter((card): card is CanvasCard => !!card)
    : [];
  const viewport = isRecord(value.viewport) ? value.viewport : {};
  const selectedCardId =
    typeof value.selectedCardId === "string" &&
    cards.some((card) => card.id === value.selectedCardId)
      ? value.selectedCardId
      : undefined;

  const chatHistory = Array.isArray(value.chatHistory)
    ? (value.chatHistory as unknown[])
        .filter(
          (e): e is ChatHistoryEntry =>
            isRecord(e) &&
            typeof e.role === "string" &&
            typeof e.content === "string",
        )
        .slice(-10)
    : [];

  return {
    version: 1,
    cards,
    selectedCardId,
    viewport: {
      x: Number(viewport.x) || 0,
      y: Number(viewport.y) || 0,
      scale: clampCanvasScale(Number(viewport.scale) || 1),
    },
    chatHistory,
  };
}

export function readAICanvasSession(storage: StorageLike): AICanvasSession {
  try {
    const raw = storage.getItem(AI_CANVAS_STORAGE_KEY);
    return raw
      ? normalizeAICanvasSession(JSON.parse(raw))
      : emptyAICanvasSession();
  } catch {
    return emptyAICanvasSession();
  }
}

export function writeAICanvasSession(
  storage: StorageLike,
  session: AICanvasSession,
) {
  storage.setItem(AI_CANVAS_STORAGE_KEY, JSON.stringify(session));
}

export function selectedAssetCards(
  cards: CanvasCard[],
  selectedCardId: string | undefined,
) {
  if (!selectedCardId) return [];
  const selected = cards.find((card) => card.id === selectedCardId);
  if (!selected) return [];
  if (selected.kind === "asset") return [selected];
  if (selected.kind !== "comment") return [];
  return cards.filter(
    (card): card is AssetCanvasCard =>
      card.kind === "asset" && card.id === selected.anchorId,
  );
}

export function commentsForAssets(cards: CanvasCard[], assetCardIds: string[]) {
  const ids = new Set(assetCardIds);
  return cards.filter(
    (card): card is CommentCanvasCard =>
      card.kind === "comment" && ids.has(card.anchorId),
  );
}

export function cardIdsForDeletion(cards: CanvasCard[], targetId: string) {
  const target = cards.find((card) => card.id === targetId);
  const ids = new Set<string>(target ? [target.id] : []);
  if (target?.kind === "asset") {
    cards.forEach((card) => {
      if (card.kind === "comment" && card.anchorId === target.id) {
        ids.add(card.id);
      }
    });
  }
  return ids;
}

export function cardDisplayName(card: CanvasCard) {
  if (card.kind === "asset") return fileName(card.asset.repoPath);
  if (card.kind === "comment") return card.text || "Comment";
  if (card.kind === "assistant") return card.prompt || "AI";
  if (card.kind === "variant") return card.sourceName;
  if (card.kind === "proposal") return card.description || card.tool;
  return card.prompt || "Preview";
}

export function inferPromptIntent(prompt: string): AICanvasPromptIntent {
  const lower = prompt.toLowerCase();
  if (/comment|annotate|標記|註解|備註/.test(lower)) return "comment";
  if (
    /safe|variant|variants|batch|apply|convert|compress|webp|avif|壓縮|轉檔|變體|批次/.test(
      lower,
    )
  ) {
    return "operationPreview";
  }
  if (/preview|render|generate|image|預覽|生圖|生成|改圖|圖片/.test(lower)) {
    return "imagePreview";
  }
  if (
    /edit|recolor|colour|remove|replace|改色|換色|改顏色|顏色|紅|藍|綠|移除|替換|去背|編輯|改成/.test(
      lower,
    ) ||
    /\b(color|red|blue|green)\b/.test(lower)
  ) {
    return "imageEdit";
  }
  return "describe";
}

export function buildAssistantBullets(
  prompt: string,
  cards: CanvasCard[],
  selectedCardId: string | undefined,
) {
  const selectedAssets = selectedAssetCards(cards, selectedCardId);
  const comments = commentsForAssets(
    cards,
    selectedAssets.map((card) => card.id),
  );
  if (selectedAssets.length === 0) {
    return ["No asset card is selected.", `Prompt: ${prompt}`];
  }

  return selectedAssets.flatMap((card) => {
    const asset = card.asset;
    const assetComments = comments.filter(
      (comment) => comment.anchorId === card.id,
    );
    const tags = asset.aiTag?.tags?.slice(0, 4).join(", ");
    const facts = [
      `${fileName(asset.repoPath)} · ${asset.image.width}x${asset.image.height} · ${formatBytes(asset.bytes)}`,
      `Path: ${asset.repoPath}`,
    ];
    if (tags) facts.push(`AI tags: ${tags}`);
    if (asset.aiTag?.description)
      facts.push(`AI description: ${asset.aiTag.description}`);
    if (asset.ocr?.text) facts.push(`OCR: ${asset.ocr.text.slice(0, 180)}`);
    if (assetComments.length > 0) {
      facts.push(
        `Canvas comments: ${assetComments.map((comment) => comment.text).join(" / ")}`,
      );
    }
    return facts;
  });
}
