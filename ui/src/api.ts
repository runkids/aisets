import type {
  ActionPreview,
  APIErrorBody,
  Catalog,
  DirectoryListing,
  ExportData,
  Project,
  ScanEvent,
  SettingsInfo,
  SettingsUpdate,
} from "./types";

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

export function getCatalog() {
  return request<Catalog>("/api/catalog");
}

function throwAPIError(error: APIErrorBody["error"] | undefined) {
  if (error?.code) throw new APIError(error.code, error.message, error.params);
  throw new APIError("scan_failed", "scan failed");
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

async function parseScanText(
  text: string,
  onEvent?: (event: ScanEvent) => void,
) {
  let done: Extract<ScanEvent, { type: "done" }> | null = null;
  for (const line of text.split("\n")) {
    const event = parseScanLine(line, onEvent);
    if (event?.type === "done") done = event;
  }
  return done ?? ({ type: "done" } as const);
}

export async function scanCatalog(options?: {
  onEvent?: (event: ScanEvent) => void;
}) {
  const response = await fetch(`${basePath}/api/scan`, { method: "POST" });
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

  if (!response.body)
    return parseScanText(await response.text(), options?.onEvent);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: Extract<ScanEvent, { type: "done" }> | null = null;

  for (;;) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value, { stream: !chunk.done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const event = parseScanLine(line, options?.onEvent);
      if (event?.type === "done") done = event;
    }
    if (chunk.done) break;
  }

  const finalEvent = parseScanLine(buffer, options?.onEvent);
  if (finalEvent?.type === "done") done = finalEvent;
  return done ?? ({ type: "done" } as const);
}

export function addProject(path: string) {
  return request<{ projects: Project[] }>("/api/projects/add", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export function removeProject(id: string) {
  return request<{ projects: Project[] }>("/api/projects/remove", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export function addWorkspace(name: string) {
  return request<{ settings: SettingsInfo }>("/api/workspaces/add", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function switchWorkspace(id: string) {
  return request<{ settings: SettingsInfo }>("/api/workspaces/switch", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export function renameWorkspace(id: string, name: string) {
  return request<{ settings: SettingsInfo }>("/api/workspaces/rename", {
    method: "POST",
    body: JSON.stringify({ id, name }),
  });
}

export function removeWorkspace(id: string) {
  return request<{ settings: SettingsInfo }>("/api/workspaces/remove", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export function renameProject(id: string, name: string) {
  return request<{ projects: Project[] }>("/api/projects/rename", {
    method: "POST",
    body: JSON.stringify({ id, name }),
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
