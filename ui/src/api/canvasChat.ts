import type {
  CanvasCard,
  CanvasViewport,
  ChatHistoryEntry,
} from "@/features/ai-canvas/aiCanvasState";
import { APIError, basePath, streamNDJSON } from "./client";

export type CanvasChatEvent =
  | { type: "focus"; cardId: string | null; label?: string }
  | { type: "thinking" }
  | { type: "status"; phase?: string; content: string }
  | { type: "text"; content: string }
  | {
      type: "action_result";
      tool: string;
      result: unknown;
      error?: string;
    }
  | {
      type: "generated_image";
      token: string;
      thumbnailDataUrl: string;
      fileName: string;
      width: number;
      height: number;
    }
  | {
      type: "proposal";
      id: string;
      tool: string;
      params: Record<string, unknown>;
      description: string;
      impact: string;
      targetAssetId?: string;
      targetAssetIds?: string[];
    }
  | {
      type: "done";
      providerName: string;
      modelName: string;
      durationMs: number;
      inputTokens?: number;
      outputTokens?: number;
      loopStats?: CanvasChatLoopStat[];
    }
  | { type: "error"; error: { code: string; message: string } };

type CanvasChatDone = Extract<CanvasChatEvent, { type: "done" }>;

export type CanvasChatLoopStat = {
  loop: number;
  promptKind: string;
  reason?: string;
  nextReason?: string;
  repairLoop?: boolean;
  systemPromptBytes?: number;
  userPromptBytes?: number;
  toolSchemaBytes?: number;
  selectedSkillIds?: string[];
  selectedToolCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  toolCallCount: number;
  toolUseSource?: "native_tool_call" | "fallback_parse" | "native_empty";
  nativeToolCallCount?: number;
  fallbackActionCount?: number;
  actionCount?: number;
  invalidActionCount?: number;
  executedActionCount?: number;
  safeActionCount?: number;
  proposalCount?: number;
  blockedProposalCount?: number;
  blockedCommentCount?: number;
};

export type CanvasCardLayoutMetrics = Record<
  string,
  { width?: number; height?: number; layerIndex?: number }
>;

type CanvasSnapshotPayload = {
  viewport: CanvasViewport;
  selectedCardIds: string[];
  cards: Array<Record<string, unknown>>;
};

type CanvasChatOptions = {
  imageOptimizationAdvice?: boolean;
};

function baseName(path: string) {
  return path.split("/").pop() || path;
}

export function serializeCanvasSnapshot(
  cards: CanvasCard[],
  selectedCardId: string | string[] | undefined,
  viewport: CanvasViewport,
  extraSelectedCardIds: string[] = [],
  layoutMetrics: CanvasCardLayoutMetrics = {},
): CanvasSnapshotPayload {
  const baseSelectedCardIds = Array.isArray(selectedCardId)
    ? selectedCardId
    : selectedCardId
      ? [selectedCardId]
      : [];
  const selectedCardIds = [
    ...new Set([...baseSelectedCardIds, ...extraSelectedCardIds]),
  ];
  const selectedSet = new Set(selectedCardIds);

  return {
    viewport,
    selectedCardIds,
    cards: cards.map((card) => {
      const metrics = layoutMetrics[card.id];
      const base: Record<string, unknown> = {
        id: card.id,
        kind: card.kind,
        x: card.x,
        y: card.y,
        ...(metrics?.width ? { width: Math.round(metrics.width) } : {}),
        ...(metrics?.height ? { height: Math.round(metrics.height) } : {}),
        ...(typeof metrics?.layerIndex === "number"
          ? { layerIndex: metrics.layerIndex }
          : {}),
      };
      if (card.kind === "asset") {
        const a = card.asset;
        const isSelected = selectedSet.has(card.id);
        base.asset = {
          id: a.id,
          fileName: baseName(a.repoPath),
          repoPath: a.repoPath,
          projectName: a.projectName,
          ext: a.ext,
          width: a.image.width,
          height: a.image.height,
          imageFormat: a.image.format,
          animated: a.image.animated,
          alpha: a.image.alpha,
          pages: a.image.pages,
          bytes: a.bytes,
          url: a.url,
          thumbnailUrl: a.thumbnailUrl,
          usedByCount: a.usedBy?.length ?? 0,
          searchCategory: a.aiTag?.category,
          searchTags: a.aiTag?.tags,
          searchDescription: a.aiTag?.description,
          searchCategoryI18n: a.aiTag?.categoryI18n,
          searchTagsI18n: a.aiTag?.tagsI18n,
          searchDescriptionI18n: a.aiTag?.descriptionI18n,
          searchLanguages: a.aiTag?.languages,
          ...(isSelected && {
            tags: a.aiTag?.tags,
            description: a.aiTag?.description,
            ocrText: a.ocr?.text,
          }),
        };
      }
      if (card.kind === "comment") {
        base.anchorId = card.anchorId;
        base.text = card.text;
        base.region = card.region;
      }
      if (card.kind === "variant") {
        base.sourceAssetId = card.sourceAssetId;
        base.sourceName = card.sourceName;
        base.inputBytes = card.inputBytes;
        base.outputBytes = card.outputBytes;
        base.inputFormat = card.inputFormat;
        base.outputFormat = card.outputFormat;
      }
      if (card.kind === "proposal") {
        base.tool = card.tool;
        base.status = card.status;
        base.description = card.description;
        base.sourceAssetId = card.sourceAssetId;
        base.sourceAssetIds = card.sourceAssetIds;
      }
      if (card.kind === "upload") {
        base.uploadToken = card.token;
        base.uploadFileName = card.fileName;
        base.uploadWidth = card.uploadWidth;
        base.uploadHeight = card.uploadHeight;
      }
      return base;
    }),
  };
}

export async function canvasChat(options: {
  messages: ChatHistoryEntry[];
  canvas: CanvasSnapshotPayload;
  locale: string;
  options?: CanvasChatOptions;
  selectedSkillIds?: string[];
  canvasImage?: string;
  attachmentTokens?: string[];
  onEvent?: (event: CanvasChatEvent) => void;
  signal?: AbortSignal;
}): Promise<CanvasChatDone | null> {
  const body = JSON.stringify({
    messages: options.messages,
    canvas: options.canvas,
    locale: options.locale,
    options: options.options,
    selectedSkillIds: options.selectedSkillIds,
    canvasImage: options.canvasImage,
    attachmentTokens: options.attachmentTokens,
  });

  const response = await fetch(`${basePath}/api/ai/canvas/chat`, {
    method: "POST",
    signal: options.signal,
    body,
    headers: { "content-type": "application/json" },
  });

  if (!response.ok) {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as {
        error?: { code?: string; message?: string };
      };
      if (parsed.error?.code) {
        throw new APIError(
          parsed.error.code,
          parsed.error.message ?? "Canvas chat failed",
        );
      }
    } catch (e) {
      if (e instanceof APIError) throw e;
    }
    throw new APIError("http_error", `HTTP ${response.status}`);
  }

  return streamNDJSON<CanvasChatEvent, CanvasChatDone>({
    response,
    parseLine: (line) => {
      if (!line.trim()) return null;
      try {
        const event = JSON.parse(line) as CanvasChatEvent;
        options.onEvent?.(event);
        if (event.type === "error") {
          throw new APIError(event.error.code, event.error.message);
        }
        return event;
      } catch (e) {
        if (e instanceof APIError) throw e;
        return null;
      }
    },
    isDone: (event): event is CanvasChatDone => event.type === "done",
    fallbackDone: null,
  });
}

export type CanvasUploadResult = {
  token: string;
  thumbnailDataUrl: string;
  fileName: string;
  width: number;
  height: number;
};

export async function uploadCanvasImages(
  files: File[],
): Promise<CanvasUploadResult[]> {
  const form = new FormData();
  for (const f of files) form.append("files", f, f.name);
  const res = await fetch(`${basePath}/api/ai/canvas/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new APIError(
      "canvas_upload_failed",
      `Upload failed: HTTP ${res.status}`,
    );
  }
  const body = (await res.json()) as { results: CanvasUploadResult[] };
  return body.results ?? [];
}
