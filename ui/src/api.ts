import type {
  ActionPreview,
  APIErrorBody,
  AnalysisState,
  BatchResult,
  CatalogDuplicatesPage,
  CatalogFoldersPage,
  CatalogItemDetail,
  CatalogItemsPage,
  CatalogLintPage,
  CatalogSummary,
  DirectoryListing,
  ExportData,
  LLMModel,
  LLMRuntime,
  AITagRunEvent,
  OCRRunEvent,
  VLMOcrRunEvent,
  Project,
  ProjectScanIntent,
  ProjectScanIntentDetection,
  PromptPreset,
  PromptPresetContent,
  PromptPresetType,
  ScanAnalyses,
  ScanDiff,
  ScanEvent,
  ScanSummary,
  ScanProgressPhase,
  ScanProfile,
  SettingsInfo,
  SettingsUpdate,
  TagListResponse,
  UpdateAppResult,
  VersionCheck,
} from "./types";
import i18n from "./i18n";

declare global {
  interface Window {
    __BASE_PATH__?: string;
  }
}

const basePath =
  typeof window === "undefined" ? "" : (window.__BASE_PATH__ ?? "");

export class APIError extends Error {
  code: string;
  params?: Record<string, unknown>;

  constructor(code: string, message: string, params?: Record<string, unknown>) {
    super(message || code);
    this.name = "APIError";
    this.code = code;
    this.params = params;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${basePath}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => ({}))) as Partial<APIErrorBody>;
    const error = body.error;
    if (error?.code) {
      throw new APIError(error.code, error.message, error.params);
    }
    throw new APIError("http_error", `HTTP ${response.status}`, {
      status: response.status,
    });
  }
  return response.json() as Promise<T>;
}

export function getCatalog(options?: { signal?: AbortSignal }) {
  return request<CatalogSummary>("/api/catalog", { signal: options?.signal });
}

export function getScans(options?: { signal?: AbortSignal }) {
  return request<{ scans: ScanSummary[] }>("/api/scans", {
    signal: options?.signal,
  });
}

export function getScanDiff(
  base: number,
  target: number,
  options?: { signal?: AbortSignal },
) {
  return request<ScanDiff>(`/api/scans/diff${queryString({ base, target })}`, {
    signal: options?.signal,
  });
}

export function clearScanHistory() {
  return request<{ ok: boolean }>("/api/scans/clear", {
    method: "POST",
    body: JSON.stringify({ confirm: "CLEAR_SCAN_HISTORY" }),
  });
}

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
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
};

export function getOptimizeAIAdvice(assetId: string) {
  return request<OptimizeAIAdvice>(
    `/api/ai/optimize-advice?assetId=${encodeURIComponent(assetId)}`,
    {
      method: "POST",
    },
  );
}

export type DuplicateExplanation = {
  summary: string;
  differences: string;
  recommendation: string;
  rationale: string;
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
  return request<DuplicateExplanation>(
    `/api/ai/duplicate-explain?${params.toString()}`,
    { method: "POST" },
  );
}

export type CatalogItemsParams = {
  scanId?: number;
  assetId?: string;
  projectId?: string;
  projectName?: string;
  ext?: string;
  folder?: string;
  q?: string;
  status?: string;
  sort?: string;
  customFilter?: string;
  optimizationCategory?: string;
  optimizationSeverity?: string;
  operation?: string;
  aiCategory?: string;
  aiOcrStatus?: string;
  hasGPS?: string;
  limit?: number;
  cursor?: string | null;
};

export type CatalogDuplicatesParams = {
  scanId?: number;
  kind?: "exact" | "near";
  projectName?: string;
  ext?: string;
  limit?: number;
  cursor?: string | null;
};

export type CatalogLintParams = {
  scanId?: number;
  projectId?: string;
  projectName?: string;
  severity?: string;
  ruleId?: string;
  q?: string;
  limit?: number;
  cursor?: string | null;
};

function queryString(
  params: Record<string, string | number | undefined | null>,
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    search.set(key, String(value));
  }
  const raw = search.toString();
  return raw ? `?${raw}` : "";
}

export function getCatalogItems(
  params: CatalogItemsParams,
  options?: { signal?: AbortSignal },
) {
  return request<CatalogItemsPage>(
    `/api/catalog/items${queryString({
      scanId: params.scanId,
      assetId: params.assetId,
      projectId: params.projectId,
      projectName: params.projectName,
      ext: params.ext,
      folder: params.folder,
      q: params.q,
      status: params.status,
      sort: params.sort,
      customFilter: params.customFilter,
      optimizationCategory: params.optimizationCategory,
      optimizationSeverity: params.optimizationSeverity,
      operation: params.operation,
      aiCategory: params.aiCategory,
      aiOcrStatus: params.aiOcrStatus,
      hasGPS: params.hasGPS,
      limit: params.limit,
      cursor: params.cursor,
    })}`,
    { signal: options?.signal },
  );
}

export function getCatalogDuplicates(
  params: CatalogDuplicatesParams,
  options?: { signal?: AbortSignal },
) {
  return request<CatalogDuplicatesPage>(
    `/api/catalog/duplicates${queryString({
      scanId: params.scanId,
      kind: params.kind,
      projectName: params.projectName,
      ext: params.ext,
      limit: params.limit,
      cursor: params.cursor,
    })}`,
    { signal: options?.signal },
  );
}

export function getCatalogLint(
  params: CatalogLintParams,
  options?: { signal?: AbortSignal },
) {
  return request<CatalogLintPage>(
    `/api/catalog/lint${queryString({
      scanId: params.scanId,
      projectId: params.projectId,
      projectName: params.projectName,
      severity: params.severity,
      ruleId: params.ruleId,
      q: params.q,
      limit: params.limit,
      cursor: params.cursor,
    })}`,
    { signal: options?.signal },
  );
}

export type CatalogFoldersParams = {
  scanId?: number;
  projectId?: string;
  projectName?: string;
  ext?: string;
  folder?: string;
  q?: string;
  status?: string;
  customFilter?: string;
};

export function getCatalogFolders(
  params: CatalogFoldersParams,
  options?: { signal?: AbortSignal },
) {
  return request<CatalogFoldersPage>(
    `/api/catalog/folders${queryString({
      scanId: params.scanId,
      projectId: params.projectId,
      projectName: params.projectName,
      ext: params.ext,
      folder: params.folder,
      q: params.q,
      status: params.status,
      customFilter: params.customFilter,
    })}`,
    { signal: options?.signal },
  );
}

export function getCatalogItemDetail(
  scanId: number | undefined,
  assetId: string,
  options?: { signal?: AbortSignal },
) {
  return request<CatalogItemDetail>(
    `/api/catalog/items/${assetId}${queryString({ scanId })}`,
    { signal: options?.signal },
  );
}

function throwAPIError(error: APIErrorBody["error"] | undefined) {
  if (error?.code) throw new APIError(error.code, error.message, error.params);
  throw new APIError("scan_failed", "scan failed");
}

function throwRunError(
  error: APIErrorBody["error"] | undefined,
  fallbackCode: string,
  fallbackMessage: string,
) {
  if (error?.code) throw new APIError(error.code, error.message, error.params);
  throw new APIError(fallbackCode, fallbackMessage);
}

function parseScanLine(
  line: string,
  onEvent?: (event: ScanEvent) => void,
): ScanEvent | null {
  if (!line.trim()) return null;
  const event = JSON.parse(line) as ScanEvent;
  onEvent?.(event);
  if (event.type === "error") throwAPIError(event.error);
  return event;
}

async function streamNDJSON<TEvent, TDone extends TEvent>({
  response,
  parseLine,
  isDone,
  fallbackDone,
}: {
  response: Response;
  parseLine: (line: string) => TEvent | null;
  isDone: (event: TEvent) => event is TDone;
  fallbackDone: TDone | null;
}): Promise<TDone | null> {
  let done: TDone | null = null;

  if (!response.body) {
    const text = await response.text();
    for (const line of text.split("\n")) {
      const event = parseLine(line);
      if (event && isDone(event)) done = event;
    }
    return done ?? fallbackDone;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value, { stream: !chunk.done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const event = parseLine(line);
      if (event && isDone(event)) done = event;
    }
    if (chunk.done) break;
  }

  const finalEvent = parseLine(buffer);
  if (finalEvent && isDone(finalEvent)) done = finalEvent;
  return done ?? fallbackDone;
}

function isScanDone(
  event: ScanEvent,
): event is Extract<ScanEvent, { type: "done" }> {
  return event.type === "done";
}

function isOCRDone(
  event: OCRRunEvent,
): event is Extract<OCRRunEvent, { type: "done" }> {
  return event.type === "done";
}

function scanDoneFallback(): Extract<ScanEvent, { type: "done" }> {
  return { type: "done" };
}

export type ScanStatus = {
  running: boolean;
  phase: ScanProgressPhase;
  current: number;
  total: number;
  message?: string;
  state?: AnalysisState;
  reason?: "" | "skippedByUser" | "skippedByThreshold" | "notApplicable";
  scanId?: number;
};

export async function fetchScanStatus(): Promise<ScanStatus> {
  return request<ScanStatus>("/api/scan/status");
}

export async function scanCatalog(options?: {
  onEvent?: (event: ScanEvent) => void;
  profile?: ScanProfile;
  analyses?: Partial<ScanAnalyses>;
}) {
  const body =
    options?.profile || options?.analyses
      ? JSON.stringify({
          profile: options.profile,
          analyses: options.analyses,
        })
      : undefined;
  const response = await fetch(`${basePath}/api/scan`, {
    method: "POST",
    body,
    headers: body ? { "content-type": "application/json" } : undefined,
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

  return streamNDJSON<ScanEvent, Extract<ScanEvent, { type: "done" }>>({
    response,
    parseLine: (line) => parseScanLine(line, options?.onEvent),
    isDone: isScanDone,
    fallbackDone: scanDoneFallback(),
  });
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

export type AddProjectResult = {
  status: "added" | "existing" | "restored";
  project: Project;
};

export function addProject(
  path: string,
  scanIntent: ProjectScanIntent = "code",
) {
  return request<{ projects: Project[]; result?: AddProjectResult }>(
    "/api/projects/add",
    {
      method: "POST",
      body: JSON.stringify({ path, scanIntent }),
    },
  );
}

export function detectProjectScanIntent(path: string) {
  return request<{ detection: ProjectScanIntentDetection }>(
    "/api/projects/detect-scan-intent",
    {
      method: "POST",
      body: JSON.stringify({ path }),
    },
  );
}

export function removeProject(id: string) {
  return request<{ projects: Project[] }>("/api/projects/remove", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export function addWorkspace(name: string, iconImage = "") {
  return request<{ settings: SettingsInfo }>("/api/workspaces/add", {
    method: "POST",
    body: JSON.stringify({ name, iconImage }),
  });
}

export function switchWorkspace(id: string) {
  return request<{ settings: SettingsInfo }>("/api/workspaces/switch", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export function renameWorkspace(id: string, name: string, iconImage = "") {
  return request<{ settings: SettingsInfo }>("/api/workspaces/rename", {
    method: "POST",
    body: JSON.stringify({ id, name, iconImage }),
  });
}

export function removeWorkspace(id: string) {
  return request<{ settings: SettingsInfo }>("/api/workspaces/remove", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export function renameProject(
  id: string,
  name: string,
  iconImage = "",
  scanIntent: ProjectScanIntent = "code",
) {
  return request<{ projects: Project[] }>("/api/projects/rename", {
    method: "POST",
    body: JSON.stringify({ id, name, iconImage, scanIntent }),
  });
}

export function listDirectories(path: string) {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  const query = params.toString();
  return request<DirectoryListing>(
    `/api/fs/directories${query ? `?${query}` : ""}`,
  );
}

export function getSettings() {
  return request<{ settings: SettingsInfo }>("/api/settings");
}

export function updateSettings(data: SettingsUpdate) {
  return request<{ settings: SettingsInfo }>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function detectAgentCLIs() {
  return request<{ settings: SettingsInfo }>("/api/agent/detect", {
    method: "POST",
  });
}

export function getVersionCheck() {
  return request<VersionCheck>("/api/version");
}

export function updateApp() {
  return request<{ ok: boolean; update: UpdateAppResult }>("/api/update", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function exportSettings() {
  return request<ExportData>("/api/settings/export");
}

export function importSettings(data: ExportData) {
  return request<{ projects: Project[] }>("/api/settings/import", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function resetDatabase() {
  return request<{ ok: boolean }>("/api/settings/reset-database", {
    method: "POST",
    body: JSON.stringify({ confirm: "RESET" }),
  });
}

export function renamePreview(assetId: string, targetPath: string) {
  return request<{ preview: ActionPreview; token: string }>(
    "/api/actions/rename/preview",
    {
      method: "POST",
      body: JSON.stringify({ assetId, targetPath }),
    },
  );
}

export function deleteUnusedPreview(assetId: string) {
  return request<{ preview: ActionPreview; token: string }>(
    "/api/actions/delete-unused/preview",
    {
      method: "POST",
      body: JSON.stringify({ assetId }),
    },
  );
}

export function applyPreview(endpoint: string, token: string) {
  return request<{ result: unknown }>(endpoint, {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function batchDelete(assetIds: string[]) {
  return request<BatchResult>("/api/actions/batch/delete", {
    method: "POST",
    body: JSON.stringify({ assetIds }),
  });
}

export type BatchPreviewResponse = {
  preview: {
    id: string;
    type: string;
    moves: Array<{ from: string; to: string }>;
    changes: Array<{
      file: string;
      line: number;
      oldSpecifier: string;
      newSpecifier: string;
    }>;
    blockers: Array<{
      file: string;
      line: number;
      code: string;
      reason: string;
    }>;
    canApply: boolean;
  };
  token: string;
};

export function batchMovePreview(assetIds: string[], targetDir: string) {
  return request<BatchPreviewResponse>("/api/actions/batch/move/preview", {
    method: "POST",
    body: JSON.stringify({ assetIds, targetDir }),
  });
}

export function fetchLLMModels(params?: {
  provider: string;
  endpoint: string;
  apiKey?: string;
}) {
  const parts: string[] = [];
  if (params) {
    parts.push(`provider=${encodeURIComponent(params.provider)}`);
    parts.push(`endpoint=${encodeURIComponent(params.endpoint)}`);
    if (params.apiKey)
      parts.push(`apiKey=${encodeURIComponent(params.apiKey)}`);
  }
  const qs = parts.length ? `?${parts.join("&")}` : "";
  return request<{ models: LLMModel[]; error?: string }>(
    `/api/llm/models${qs}`,
  );
}

export function checkLLMHealth(params?: {
  provider: string;
  endpoint: string;
  apiKey?: string;
}) {
  return request<LLMRuntime>("/api/llm/health", {
    method: "POST",
    body: params ? JSON.stringify(params) : undefined,
  });
}

export function batchRenamePreview(
  assetIds: string[],
  rules: import("./types").RenameRules,
) {
  return request<BatchPreviewResponse>("/api/actions/batch/rename/preview", {
    method: "POST",
    body: JSON.stringify({ assetIds, rules }),
  });
}

export function batchMergePreview(
  assetIds: string[],
  preferredPaths: Record<string, string>,
) {
  return request<BatchPreviewResponse>(
    "/api/actions/batch/merge-duplicates/preview",
    {
      method: "POST",
      body: JSON.stringify({ assetIds, preferredPaths }),
    },
  );
}

export function batchApply(endpoint: string, token: string) {
  return request<{ result: unknown }>(endpoint, {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function batchCopy(assetIds: string[], targetDir: string) {
  return request<{
    succeeded: string[];
    failed: Array<{ id: string; error: string }>;
    skipped: string[];
    appliedAt: string;
  }>("/api/actions/batch/copy", {
    method: "POST",
    body: JSON.stringify({ assetIds, targetDir }),
  });
}

export async function batchExport(assetIds: string[]) {
  const res = await fetch("/api/actions/batch/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assetIds }),
  });
  if (!res.ok) throw new Error("Export failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ??
    "assets-export.zip";
  a.click();
  URL.revokeObjectURL(url);
}

export function listPromptPresets(type?: PromptPresetType) {
  const params = type ? `?type=${type}` : "";
  return request<{ presets: PromptPreset[] }>(`/api/prompt-presets${params}`);
}

export function createPromptPreset(data: {
  type: PromptPresetType;
  name: string;
  content: PromptPresetContent;
  isDefault?: boolean;
}) {
  return request<{ preset: PromptPreset }>("/api/prompt-presets", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updatePromptPreset(
  id: string,
  data: {
    name?: string;
    content?: PromptPresetContent;
    isDefault?: boolean;
  },
) {
  return request<{ preset: PromptPreset }>(`/api/prompt-presets/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deletePromptPreset(id: string) {
  return request<{ ok: boolean }>(`/api/prompt-presets/${id}`, {
    method: "DELETE",
  });
}

export function setPromptPresetDefault(id: string) {
  return request<{ preset: PromptPreset }>(
    `/api/prompt-presets/${id}/default`,
    { method: "POST" },
  );
}

// --- Tag Management ---

export function getTagList(params: {
  q?: string;
  sort?: string;
  project?: string;
  category?: string;
  locale?: string;
  limit?: number;
  offset?: number;
}) {
  return request<TagListResponse>(
    `/api/tags${queryString({
      q: params.q,
      sort: params.sort,
      project: params.project,
      category: params.category,
      locale: params.locale,
      limit: params.limit,
      offset: params.offset,
    })}`,
  );
}

export function renameTag(from: string, to: string) {
  return request<{ ok: boolean; affected: number }>("/api/tags/rename", {
    method: "POST",
    body: JSON.stringify({ from, to }),
  });
}

export function mergeTags(source: string[], target: string) {
  return request<{ ok: boolean; affected: number }>("/api/tags/merge", {
    method: "POST",
    body: JSON.stringify({ source, target }),
  });
}

export function deleteTags(tags: string[]) {
  return request<{ ok: boolean; affected: number }>("/api/tags/delete", {
    method: "POST",
    body: JSON.stringify({ tags }),
  });
}

export function setAssetTags(params: {
  projectId: string;
  repoPath: string;
  contentHash: string;
  hashAlgorithm: string;
  tags: string[];
}) {
  return request<{ ok: boolean; tags: string[] }>("/api/assets/tags", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export function getTagCategories() {
  return request<{ categories: string[] }>("/api/tags/categories");
}

export function getTagSuggestions(q: string, limit = 10) {
  const searchParams = new URLSearchParams();
  if (q) searchParams.set("q", q);
  searchParams.set("limit", String(limit));
  return request<{ suggestions: string[] }>(
    `/api/tags/suggest?${searchParams.toString()}`,
  );
}

// ---------------------------------------------------------------------------
// Pre-check AI
// ---------------------------------------------------------------------------

export type PreCheckAIEvent =
  | {
      type: "result";
      ai: {
        name: string;
        status: string;
        category?: string;
        tags?: string[];
        description?: string;
        quality?: { score: number; issues: string[]; assessment: string };
        suggestion?: {
          recommendedFilename: string;
          formatRecommendation: string;
          suitability: "good" | "acceptable" | "poor";
          suitabilityReason: string;
        };
      };
    }
  | { type: "error"; error?: { message?: string } };

function parsePreCheckAILine(
  line: string,
  onEvent?: (event: PreCheckAIEvent) => void,
): PreCheckAIEvent | null {
  if (!line.trim()) return null;
  try {
    const event = JSON.parse(line) as PreCheckAIEvent;
    onEvent?.(event);
    return event;
  } catch {
    return null;
  }
}

function isPreCheckAIDone(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  event: PreCheckAIEvent,
): event is PreCheckAIEvent & { type: never } {
  return false;
}

export async function runPreCheckAI(
  files: File[],
  lang: string,
  options?: { onEvent?: (event: PreCheckAIEvent) => void },
): Promise<void> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f, f.name));
  const response = await fetch(
    `${basePath}/api/pre-check/ai?lang=${encodeURIComponent(lang)}`,
    { method: "POST", body: form },
  );
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => ({}))) as Partial<APIErrorBody>;
    const error = body.error;
    if (error?.code)
      throw new APIError(error.code, error.message, error.params);
    throw new APIError("precheck_ai_failed", `HTTP ${response.status}`);
  }
  await streamNDJSON<PreCheckAIEvent, PreCheckAIEvent & { type: never }>({
    response,
    parseLine: (line) => parsePreCheckAILine(line, options?.onEvent),
    isDone: isPreCheckAIDone,
    fallbackDone: null,
  });
}
