import type { ActionPreview, AssetItem } from "@/types";
import { fileName, formatBytes } from "@/ui";

export const AI_CANVAS_STORAGE_KEY = "aisets.aiCanvas.v1";
const DEFAULT_GROUP_SIZE = 320;

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
  isAi?: boolean;
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
  width?: number;
  height?: number;
  alpha?: boolean;
};

export type OperationCanvasCard = CanvasCardBase & {
  kind: "operation";
  prompt: string;
  token: string;
  preview: ActionPreview;
  assetIds: string[];
};

export type UploadCanvasCard = CanvasCardBase & {
  kind: "upload";
  token: string;
  thumbnailDataUrl: string;
  fileName: string;
  uploadWidth: number;
  uploadHeight: number;
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
  sourceAssetIds?: string[];
};

export type GroupChildCanvasCard =
  | AssetCanvasCard
  | UploadCanvasCard
  | VariantCanvasCard;

export type GroupCanvasCard = CanvasCardBase & {
  kind: "group";
  name?: string;
  cards: GroupChildCanvasCard[];
  cardWidths?: Record<string, number>;
  width: number;
  height: number;
};

export type CanvasCard =
  | AssetCanvasCard
  | CommentCanvasCard
  | AssistantCanvasCard
  | VariantCanvasCard
  | OperationCanvasCard
  | ProposalCanvasCard
  | UploadCanvasCard
  | GroupCanvasCard;

export type ChatMentionPreview = {
  id: string;
  name: string;
  meta: string;
  src?: string;
  kind?: "searchCandidate";
  asset?: AssetItem;
};

export type ChatAttachment = {
  token: string;
  thumbnailDataUrl: string;
  fileName: string;
  width: number;
  height: number;
};

export type PendingAttachment = ChatAttachment & { id: string };

export type ChatActivityEntry = {
  id: string;
  kind: "thinking" | "status" | "tool" | "proposal" | "image" | "done";
  label: string;
  detail?: string;
  atMs?: number;
  tone?: "neutral" | "success" | "warning" | "danger";
};

export type ChatRunUsage = {
  providerName?: string;
  modelName?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  tokensPerSecond?: number;
  loopCount?: number;
  toolCallCount?: number;
  fallbackActionCount?: number;
  executedActionCount?: number;
  invalidActionCount?: number;
};

export type ChatHistoryEntry = {
  role: string;
  content: string;
  mentions?: ChatMentionPreview[];
  attachments?: ChatAttachment[];
  activity?: ChatActivityEntry[];
  usage?: ChatRunUsage;
};

export type AICanvasSession = {
  version: 1;
  cards: CanvasCard[];
  selectedCardIds?: string[];
  viewport: CanvasViewport;
  chatHistory?: ChatHistoryEntry[];
  cardWidths?: Record<string, number>;
  viewMode?: "normal" | "compact" | "hidden";
};

export type AICanvasPromptIntent =
  | "comment"
  | "operationPreview"
  | "imagePreview"
  | "imageEdit"
  | "describe";

export function shouldScheduleAICanvasAutoSave(opts: {
  isDirty: boolean;
  cardsLength: number;
  isSaving: boolean;
  isDragging: boolean;
}) {
  return (
    opts.isDirty && opts.cardsLength > 0 && !opts.isSaving && !opts.isDragging
  );
}

export function sanitizeCanvasChatContent(content: string) {
  return content
    .replace(
      /(^|\n)\s*call:\s*"[A-Za-z_][A-Za-z0-9_]*"\s*,\s*"params"\s*:\s*\{[^\n]*\}\s*/g,
      "$1",
    )
    .replace(/(^|\n)\s*call:\s*[A-Za-z_][A-Za-z0-9_]*\s*\{[^\n]*\}\s*/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function compactUploadCardForStorage(card: CanvasCard): CanvasCard {
  if (card.kind === "group") {
    return {
      ...card,
      cards: card.cards.map((child) =>
        compactUploadCardForStorage(child),
      ) as GroupChildCanvasCard[],
    };
  }
  if (card.kind !== "upload" || !card.thumbnailDataUrl) return card;
  return { ...card, thumbnailDataUrl: "" };
}

function compactChatHistoryForStorage(
  chatHistory: ChatHistoryEntry[] | undefined,
) {
  return chatHistory?.map((entry) => {
    if (!entry.attachments?.length) return entry;
    return {
      ...entry,
      attachments: entry.attachments.map((attachment) => ({
        ...attachment,
        thumbnailDataUrl: "",
      })),
    };
  });
}

export function compactAICanvasSessionForStorage(
  session: AICanvasSession,
): AICanvasSession {
  return {
    ...session,
    cards: session.cards.map(compactUploadCardForStorage),
    chatHistory: compactChatHistoryForStorage(session.chatHistory),
  };
}

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
      isAi: value.isAi === true ? true : undefined,
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
      width: Number(value.width) > 0 ? Number(value.width) : undefined,
      height: Number(value.height) > 0 ? Number(value.height) : undefined,
      alpha: typeof value.alpha === "boolean" ? value.alpha : undefined,
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

  if (kind === "upload" && typeof value.token === "string") {
    return {
      id,
      kind,
      x,
      y,
      createdAt,
      token: value.token,
      thumbnailDataUrl:
        typeof value.thumbnailDataUrl === "string"
          ? value.thumbnailDataUrl
          : "",
      fileName: typeof value.fileName === "string" ? value.fileName : "image",
      uploadWidth: Number(value.uploadWidth) || 0,
      uploadHeight: Number(value.uploadHeight) || 0,
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

  if (kind === "group" && Array.isArray(value.cards)) {
    const childCards = value.cards
      .map(normalizeCard)
      .filter(
        (card): card is GroupChildCanvasCard =>
          card?.kind === "asset" ||
          card?.kind === "upload" ||
          card?.kind === "variant",
      );
    if (childCards.length === 0) return null;
    const cardWidths = isRecord(value.cardWidths)
      ? Object.fromEntries(
          Object.entries(value.cardWidths)
            .map(([key, width]) => [key, Number(width)] as const)
            .filter((entry): entry is [string, number] => entry[1] > 0),
        )
      : undefined;
    return {
      id,
      kind,
      x,
      y,
      createdAt,
      name:
        typeof value.name === "string" && value.name.trim()
          ? value.name.trim()
          : undefined,
      cards: childCards,
      cardWidths,
      width: Number(value.width) > 0 ? Number(value.width) : DEFAULT_GROUP_SIZE,
      height:
        Number(value.height) > 0 ? Number(value.height) : DEFAULT_GROUP_SIZE,
    };
  }

  return null;
}

function safeChatString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength
    ? `${trimmed.slice(0, maxLength)}…`
    : trimmed;
}

function normalizeChatActivity(
  value: unknown,
): ChatActivityEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value
    .map((item): ChatActivityEntry | null => {
      if (!isRecord(item)) return null;
      const id = safeChatString(item.id, 80);
      const label = safeChatString(item.label, 120);
      if (!id || !label) return null;
      const kind =
        item.kind === "thinking" ||
        item.kind === "status" ||
        item.kind === "tool" ||
        item.kind === "proposal" ||
        item.kind === "image" ||
        item.kind === "done"
          ? item.kind
          : "status";
      const tone =
        item.tone === "success" ||
        item.tone === "warning" ||
        item.tone === "danger" ||
        item.tone === "neutral"
          ? item.tone
          : undefined;
      const atMs = Number(item.atMs);
      return {
        id,
        kind,
        label,
        detail: safeChatString(item.detail, 280),
        atMs: Number.isFinite(atMs) && atMs >= 0 ? Math.round(atMs) : undefined,
        tone,
      };
    })
    .filter((entry): entry is ChatActivityEntry => Boolean(entry))
    .slice(-24);
  return entries.length > 0 ? entries : undefined;
}

function normalizeChatRunUsage(value: unknown): ChatRunUsage | undefined {
  if (!isRecord(value)) return undefined;
  const usage: ChatRunUsage = {};
  type NumberKey = Exclude<keyof ChatRunUsage, "providerName" | "modelName">;
  const setNumber = (key: NumberKey) => {
    const n = Number(value[key]);
    if (Number.isFinite(n) && n >= 0) usage[key] = Math.round(n * 100) / 100;
  };
  const providerName = safeChatString(value.providerName, 80);
  const modelName = safeChatString(value.modelName, 120);
  if (providerName) usage.providerName = providerName;
  if (modelName) usage.modelName = modelName;
  setNumber("durationMs");
  setNumber("inputTokens");
  setNumber("outputTokens");
  setNumber("totalTokens");
  setNumber("tokensPerSecond");
  setNumber("loopCount");
  setNumber("toolCallCount");
  setNumber("fallbackActionCount");
  setNumber("executedActionCount");
  setNumber("invalidActionCount");
  return Object.keys(usage).length > 0 ? usage : undefined;
}

export function normalizeAICanvasSession(value: unknown): AICanvasSession {
  if (!isRecord(value)) return emptyAICanvasSession();
  const cards = Array.isArray(value.cards)
    ? value.cards.map(normalizeCard).filter((card): card is CanvasCard => {
        if (!card) return false;
        return !(
          card.kind === "proposal" &&
          (card.tool === "capture_viewport" ||
            card.tool === "capture_canvas" ||
            card.tool === "capture_selected")
        );
      })
    : [];
  const viewport = isRecord(value.viewport) ? value.viewport : {};
  let rawIds: string[] = [];
  if (Array.isArray(value.selectedCardIds)) {
    rawIds = (value.selectedCardIds as unknown[]).filter(
      (id): id is string => typeof id === "string",
    );
  } else if (typeof value.selectedCardId === "string" && value.selectedCardId) {
    rawIds = [value.selectedCardId];
  }
  const cardIdSet = new Set(cards.map((card) => card.id));
  const selectedCardIds = rawIds.filter((id) => cardIdSet.has(id));

  const chatHistory = Array.isArray(value.chatHistory)
    ? (value.chatHistory as unknown[])
        .filter(
          (e): e is ChatHistoryEntry =>
            isRecord(e) &&
            typeof e.role === "string" &&
            typeof e.content === "string",
        )
        .map((entry) => {
          const activity = normalizeChatActivity(entry.activity);
          const usage = normalizeChatRunUsage(entry.usage);
          return {
            ...entry,
            content:
              entry.role === "assistant"
                ? sanitizeCanvasChatContent(entry.content)
                : entry.content,
            activity,
            usage,
          };
        })
        .filter(
          (entry) =>
            entry.content ||
            entry.mentions?.length ||
            entry.attachments?.length ||
            entry.activity?.length ||
            entry.usage,
        )
        .slice(-10)
    : [];

  const cardWidths: Record<string, number> = {};
  if (isRecord(value.cardWidths)) {
    for (const [k, v] of Object.entries(value.cardWidths)) {
      if (typeof v === "number" && v > 0) cardWidths[k] = v;
    }
  }

  return {
    version: 1,
    cards,
    selectedCardIds: selectedCardIds.length > 0 ? selectedCardIds : undefined,
    viewport: {
      x: Number(viewport.x) || 0,
      y: Number(viewport.y) || 0,
      scale: clampCanvasScale(Number(viewport.scale) || 1),
    },
    chatHistory,
    cardWidths: Object.keys(cardWidths).length > 0 ? cardWidths : undefined,
    viewMode:
      value.viewMode === "compact" || value.viewMode === "hidden"
        ? value.viewMode
        : undefined,
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
  try {
    storage.setItem(
      AI_CANVAS_STORAGE_KEY,
      JSON.stringify(compactAICanvasSessionForStorage(session)),
    );
  } catch {
    try {
      storage.setItem(
        AI_CANVAS_STORAGE_KEY,
        JSON.stringify(
          compactAICanvasSessionForStorage({
            ...session,
            chatHistory: undefined,
          }),
        ),
      );
    } catch {
      // Storage may be full or unavailable; keep the in-memory canvas usable.
    }
  }
}

export function selectedAssetCards(
  cards: CanvasCard[],
  selectedCardIds: string[],
) {
  if (selectedCardIds.length === 0) return [];
  const idSet = new Set(selectedCardIds);
  const result: AssetCanvasCard[] = [];
  const anchorIds = new Set<string>();

  for (const card of cards) {
    if (!idSet.has(card.id)) continue;
    if (card.kind === "asset") result.push(card);
    else if (card.kind === "group") {
      result.push(
        ...card.cards.filter(
          (child): child is AssetCanvasCard => child.kind === "asset",
        ),
      );
    } else if (card.kind === "comment") anchorIds.add(card.anchorId);
  }

  if (anchorIds.size > 0) {
    for (const card of cards) {
      if (
        card.kind === "asset" &&
        anchorIds.has(card.id) &&
        !idSet.has(card.id)
      ) {
        result.push(card);
      }
    }
  }
  return result;
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
  if (
    target?.kind === "asset" ||
    target?.kind === "upload" ||
    target?.kind === "variant"
  ) {
    for (const card of cards) {
      if (card.kind === "comment" && card.anchorId === target.id) {
        ids.add(card.id);
      }
    }
  }
  return ids;
}

export function cardIdsForBulkDeletion(
  cards: CanvasCard[],
  targetIds: string[],
) {
  const all = new Set<string>();
  for (const id of targetIds) {
    for (const rid of cardIdsForDeletion(cards, id)) {
      all.add(rid);
    }
  }
  return all;
}

export function cardDisplayName(card: CanvasCard) {
  if (card.kind === "asset") return fileName(card.asset.repoPath);
  if (card.kind === "comment") {
    const timestamp = Date.parse(card.createdAt);
    if (Number.isFinite(timestamp)) {
      return new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }).format(timestamp);
    }
    return "Comment";
  }
  if (card.kind === "assistant") return card.prompt || "AI";
  if (card.kind === "variant") return card.sourceName;
  if (card.kind === "proposal") return card.tool;
  if (card.kind === "upload") return card.fileName;
  if (card.kind === "group") return card.name || `Group (${card.cards.length})`;
  return card.prompt || "Preview";
}

export function inferPromptIntent(prompt: string): AICanvasPromptIntent {
  const lower = prompt.toLowerCase();
  if (/comment|annotate/.test(lower)) return "comment";
  if (
    /safe|variant|variants|batch|apply|convert|compress|webp|avif/.test(lower)
  ) {
    return "operationPreview";
  }
  if (/preview|render|generate|image/.test(lower)) {
    return "imagePreview";
  }
  if (
    /edit|recolor|colour|remove|replace/.test(lower) ||
    /\b(color|red|blue|green)\b/.test(lower)
  ) {
    return "imageEdit";
  }
  return "describe";
}

export function buildAssistantBullets(
  prompt: string,
  cards: CanvasCard[],
  selectedCardIds: string[],
) {
  const selectedAssets = selectedAssetCards(cards, selectedCardIds);
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
