import type {
  AITagRunEvent,
  APIErrorBody,
  EmbeddingCalibrationAnalysis,
  EmbeddingCalibrationLabel,
  EmbedRepairResponse,
  EmbedRunEvent,
  EmbedStats,
  OCRRunEvent,
  SemanticSearchResponse,
  SettingsInfo,
  VLMOcrRunEvent,
} from "@/types";
import i18n from "@/i18n";
import type { CatalogItemsParams } from "./catalog";
import {
  APIError,
  basePath,
  request,
  streamNDJSON,
  throwRunError,
} from "./client";

export function clearOCRCache() {
  return request<{ ok: boolean }>("/api/ocr/clear", { method: "POST" });
}

export function clearAITagCache() {
  return request<{ ok: boolean }>("/api/ai/tag/clear", { method: "POST" });
}

export type OptimizeAIAdvice = {
  contentType: string;
  recommendedFormat: string;
  recommendedQuality: number | null;
  lossless: boolean;
  rationale: string;
  providerName: string;
  modelName: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
};

export function getOptimizeAIAdvice(assetId: string) {
  const qp = new URLSearchParams({ assetId });
  if (i18n.language) qp.set("lang", i18n.language);
  return request<OptimizeAIAdvice>(`/api/ai/optimize-advice?${qp}`, {
    method: "POST",
  });
}

export type DuplicateExplanation = {
  summary: string;
  differences: string;
  keepFilename?: string;
  recommendation: string;
  rationale: string;
  providerName: string;
  modelName: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
};

export function getDuplicateExplanation(
  leftId: string,
  rightId: string,
  distance?: number,
) {
  const params = new URLSearchParams({ leftId, rightId });
  if (distance != null) params.set("distance", String(distance));
  if (i18n.language) params.set("lang", i18n.language);
  return request<DuplicateExplanation>(
    `/api/ai/duplicate-explain?${params.toString()}`,
    { method: "POST" },
  );
}

function parseOCRLine(
  line: string,
  onEvent?: (event: OCRRunEvent) => void,
): OCRRunEvent | null {
  if (!line.trim()) return null;
  const event = JSON.parse(line) as OCRRunEvent;
  onEvent?.(event);
  if (event.type === "error")
    throwRunError(event.error, "ocr_failed", "OCR failed");
  return event;
}

export async function runOCR(options?: {
  onEvent?: (event: OCRRunEvent) => void;
  signal?: AbortSignal;
}) {
  const response = await fetch(`${basePath}/api/ocr/run`, {
    method: "POST",
    signal: options?.signal,
  });
  if (!response.ok) {
    const text = await response.text();
    const body = JSON.parse(text || "{}") as Partial<APIErrorBody>;
    const error = body.error;
    if (error?.code)
      throw new APIError(error.code, error.message, error.params);
    throw new APIError("http_error", `HTTP ${response.status}`, {
      status: response.status,
    });
  }
  return streamNDJSON<OCRRunEvent, Extract<OCRRunEvent, { type: "done" }>>({
    response,
    parseLine: (line) => parseOCRLine(line, options?.onEvent),
    isDone: isOCRDone,
    fallbackDone: null,
  });
}

function isOCRDone(
  event: OCRRunEvent,
): event is Extract<OCRRunEvent, { type: "done" }> {
  return event.type === "done";
}

function parseAITagLine(
  line: string,
  onEvent?: (event: AITagRunEvent) => void,
): AITagRunEvent | null {
  if (!line.trim()) return null;
  const event = JSON.parse(line) as AITagRunEvent;
  onEvent?.(event);
  if (event.type === "error")
    throwRunError(event.error, "aitag_failed", "AI tagging failed");
  return event;
}

function isAITagDone(
  event: AITagRunEvent,
): event is Extract<AITagRunEvent, { type: "done" }> {
  return event.type === "done";
}

export async function runAITagging(options?: {
  onEvent?: (event: AITagRunEvent) => void;
  signal?: AbortSignal;
  presetId?: string;
  projectIds?: string[];
  assetIds?: string[];
}) {
  const qp = new URLSearchParams();
  if (options?.presetId) qp.set("presetId", options.presetId);
  if (options?.projectIds?.length)
    qp.set("projectIds", options.projectIds.join(","));
  if (i18n.language) qp.set("lang", i18n.language);
  const params = qp.toString() ? `?${qp}` : "";
  const fetchBody = options?.assetIds?.length
    ? JSON.stringify({ assetIds: options.assetIds })
    : undefined;
  const response = await fetch(`${basePath}/api/ai/tag/run${params}`, {
    method: "POST",
    signal: options?.signal,
    body: fetchBody,
    headers: fetchBody ? { "content-type": "application/json" } : undefined,
  });
  if (!response.ok) {
    const text = await response.text();
    const body = JSON.parse(text || "{}") as Partial<APIErrorBody>;
    const error = body.error;
    if (error?.code)
      throw new APIError(error.code, error.message, error.params);
    throw new APIError("http_error", `HTTP ${response.status}`, {
      status: response.status,
    });
  }
  return streamNDJSON<AITagRunEvent, Extract<AITagRunEvent, { type: "done" }>>({
    response,
    parseLine: (line) => parseAITagLine(line, options?.onEvent),
    isDone: isAITagDone,
    fallbackDone: null,
  });
}

function parseVLMOcrLine(
  line: string,
  onEvent?: (event: VLMOcrRunEvent) => void,
): VLMOcrRunEvent | null {
  if (!line.trim()) return null;
  const event = JSON.parse(line) as VLMOcrRunEvent;
  onEvent?.(event);
  if (event.type === "error")
    throwRunError(event.error, "vlm_ocr_failed", "VLM OCR failed");
  return event;
}

function isVLMOcrDone(
  event: VLMOcrRunEvent,
): event is Extract<VLMOcrRunEvent, { type: "done" }> {
  return event.type === "done";
}

export async function runVLMOcr(options?: {
  onEvent?: (event: VLMOcrRunEvent) => void;
  signal?: AbortSignal;
  presetId?: string;
  projectIds?: string[];
  assetIds?: string[];
}) {
  const qp = new URLSearchParams();
  if (options?.presetId) qp.set("presetId", options.presetId);
  if (options?.projectIds?.length)
    qp.set("projectIds", options.projectIds.join(","));
  if (i18n.language) qp.set("lang", i18n.language);
  const params = qp.toString() ? `?${qp}` : "";
  const fetchBody = options?.assetIds?.length
    ? JSON.stringify({ assetIds: options.assetIds })
    : undefined;
  const response = await fetch(`${basePath}/api/ai/ocr/run${params}`, {
    method: "POST",
    signal: options?.signal,
    body: fetchBody,
    headers: fetchBody ? { "content-type": "application/json" } : undefined,
  });
  if (!response.ok) {
    const text = await response.text();
    const body = JSON.parse(text || "{}") as Partial<APIErrorBody>;
    const error = body.error;
    if (error?.code)
      throw new APIError(error.code, error.message, error.params);
    throw new APIError("http_error", `HTTP ${response.status}`, {
      status: response.status,
    });
  }
  return streamNDJSON<
    VLMOcrRunEvent,
    Extract<VLMOcrRunEvent, { type: "done" }>
  >({
    response,
    parseLine: (line) => parseVLMOcrLine(line, options?.onEvent),
    isDone: isVLMOcrDone,
    fallbackDone: null,
  });
}

// --- Embedding ---

function parseEmbedLine(
  line: string,
  onEvent?: (event: EmbedRunEvent) => void,
): EmbedRunEvent | null {
  if (!line.trim()) return null;
  const event = JSON.parse(line) as EmbedRunEvent;
  onEvent?.(event);
  if (event.type === "error")
    throwRunError(event.error, "embed_failed", "Embedding failed");
  return event;
}

function isEmbedDone(
  event: EmbedRunEvent,
): event is Extract<EmbedRunEvent, { type: "done" }> {
  return event.type === "done";
}

export async function runEmbedding(options?: {
  onEvent?: (event: EmbedRunEvent) => void;
  signal?: AbortSignal;
  projectIds?: string[];
  assetIds?: string[];
  types?: ("text" | "image")[];
  force?: boolean;
}) {
  const qp = new URLSearchParams();
  if (options?.projectIds?.length)
    qp.set("projectIds", options.projectIds.join(","));
  if (i18n.language) qp.set("lang", i18n.language);
  const params = qp.toString() ? `?${qp}` : "";
  const bodyObj: Record<string, unknown> = {};
  if (options?.assetIds?.length) bodyObj.assetIds = options.assetIds;
  if (options?.types?.length) bodyObj.types = options.types;
  if (options?.force) bodyObj.force = true;
  const fetchBody = Object.keys(bodyObj).length
    ? JSON.stringify(bodyObj)
    : undefined;
  const response = await fetch(`${basePath}/api/ai/embed/run${params}`, {
    method: "POST",
    signal: options?.signal,
    body: fetchBody,
    headers: fetchBody ? { "content-type": "application/json" } : undefined,
  });
  if (!response.ok) {
    const text = await response.text();
    const body = JSON.parse(text || "{}") as Partial<APIErrorBody>;
    const error = body.error;
    if (error?.code)
      throw new APIError(error.code, error.message, error.params);
    throw new APIError("http_error", `HTTP ${response.status}`, {
      status: response.status,
    });
  }
  return streamNDJSON<EmbedRunEvent, Extract<EmbedRunEvent, { type: "done" }>>({
    response,
    parseLine: (line) => parseEmbedLine(line, options?.onEvent),
    isDone: isEmbedDone,
    fallbackDone: null,
  });
}

export async function runAITagTranslate(options?: {
  signal?: AbortSignal;
  onEvent?: (event: {
    type: string;
    locale?: string;
    translated?: number;
    total?: number;
    skipped?: number;
    warning?: string;
    warnings?: string[];
    locales?: string[];
  }) => void;
}) {
  const qp = new URLSearchParams();
  if (i18n.language) qp.set("lang", i18n.language);
  const params = qp.toString() ? `?${qp}` : "";
  const response = await fetch(`${basePath}/api/ai/tag/translate${params}`, {
    method: "POST",
    signal: options?.signal,
  });
  if (!response.ok) {
    const text = await response.text();
    const body = JSON.parse(text || "{}") as Partial<APIErrorBody>;
    const error = body.error;
    if (error?.code)
      throw new APIError(error.code, error.message, error.params);
    throw new APIError("http_error", `HTTP ${response.status}`, {
      status: response.status,
    });
  }
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        options?.onEvent?.(event);
      } catch {
        /* skip malformed */
      }
    }
  }
}

export function clearEmbeddings() {
  return request<{ ok: boolean }>("/api/ai/embed/clear", { method: "POST" });
}

export function repairEmbeddings(apply: boolean) {
  return request<EmbedRepairResponse>("/api/ai/embed/repair", {
    method: "POST",
    body: JSON.stringify({ apply }),
  });
}

export function semanticSearch(options: {
  q: string;
  type?: "text" | "image" | "hybrid";
  limit?: number;
  threshold?: number;
  textThreshold?: number;
  imageThreshold?: number;
  imageDynamicEnabled?: boolean;
  imageDynamicMargin?: number;
  includeItems?: boolean;
  filters?: Partial<CatalogItemsParams>;
}) {
  const qp = new URLSearchParams({ q: options.q });
  if (options.type) qp.set("type", options.type);
  if (options.limit) qp.set("limit", String(options.limit));
  if (options.threshold != null) qp.set("threshold", String(options.threshold));
  if (options.textThreshold != null)
    qp.set("textThreshold", String(options.textThreshold));
  if (options.imageThreshold != null)
    qp.set("imageThreshold", String(options.imageThreshold));
  if (options.imageDynamicEnabled != null)
    qp.set("imageDynamicEnabled", String(options.imageDynamicEnabled));
  if (options.imageDynamicMargin != null)
    qp.set("imageDynamicMargin", String(options.imageDynamicMargin));
  if (options.includeItems) qp.set("includeItems", "true");
  const filters = options.filters;
  if (filters) {
    if (filters.scanId != null) qp.set("scanId", String(filters.scanId));
    if (filters.projectId) qp.set("projectId", filters.projectId);
    if (filters.projectName) qp.set("projectName", filters.projectName);
    if (filters.ext) qp.set("ext", filters.ext);
    if (filters.folder) qp.set("folder", filters.folder);
    if (filters.q) qp.set("catalogQ", filters.q);
    if (filters.status) qp.set("status", filters.status);
    if (filters.customFilter) qp.set("customFilter", filters.customFilter);
    if (filters.optimizationCategory)
      qp.set("optimizationCategory", filters.optimizationCategory);
    if (filters.optimizationSeverity)
      qp.set("optimizationSeverity", filters.optimizationSeverity);
    if (filters.operation) qp.set("operation", filters.operation);
    if (filters.aiCategory) qp.set("aiCategory", filters.aiCategory);
    if (filters.aiOcrStatus) qp.set("aiOcrStatus", filters.aiOcrStatus);
    if (filters.hasGPS) qp.set("hasGPS", filters.hasGPS);
  }
  return request<SemanticSearchResponse>(`/api/ai/embed/search?${qp}`);
}

export function findSimilar(
  assetId: string,
  options?: { type?: "text" | "image"; limit?: number },
) {
  const qp = new URLSearchParams();
  if (options?.type) qp.set("type", options.type);
  if (options?.limit) qp.set("limit", String(options.limit));
  const params = qp.toString() ? `?${qp}` : "";
  return request<SemanticSearchResponse>(
    `/api/ai/embed/similar/${assetId}${params}`,
  );
}

export function embeddingStats() {
  return request<EmbedStats>("/api/ai/embed/stats");
}

export function embeddingCalibrationLabels(options?: {
  q?: string;
  type?: "text" | "image" | "hybrid";
}) {
  const qp = new URLSearchParams();
  if (options?.q) qp.set("q", options.q);
  if (options?.type) qp.set("type", options.type);
  const params = qp.toString() ? `?${qp}` : "";
  return request<{ labels: EmbeddingCalibrationLabel[] }>(
    `/api/ai/embed/calibration/labels${params}`,
  );
}

export function saveEmbeddingCalibrationLabel(
  label: Omit<EmbeddingCalibrationLabel, "id" | "createdAt" | "updatedAt">,
) {
  return request<{ label: EmbeddingCalibrationLabel }>(
    "/api/ai/embed/calibration/labels",
    {
      method: "POST",
      body: JSON.stringify(label),
    },
  );
}

export function deleteEmbeddingCalibrationLabel(id: number) {
  return request<{ ok: boolean }>(`/api/ai/embed/calibration/labels/${id}`, {
    method: "DELETE",
  });
}

export function analyzeEmbeddingCalibration() {
  return request<EmbeddingCalibrationAnalysis>(
    "/api/ai/embed/calibration/analyze",
    { method: "POST" },
  );
}

export function installOCR(languages: string[]) {
  return request<{ settings?: SettingsInfo }>("/api/ocr/install", {
    method: "POST",
    body: JSON.stringify({ languages }),
  });
}

export function removeOCR(languages: string[] = []) {
  return request<{ settings?: SettingsInfo }>("/api/ocr/remove", {
    method: "POST",
    body: JSON.stringify({ languages }),
  });
}
