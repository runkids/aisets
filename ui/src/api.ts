import type {
  ActionPreview,
  APIErrorBody,
  Catalog,
  DirectoryListing,
  ExportData,
  Project,
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

export async function scanCatalog() {
  const response = await fetch(`${basePath}/api/scan`, { method: "POST" });
  const text = await response.text();
  if (!response.ok) {
    const body = JSON.parse(text || "{}") as Partial<APIErrorBody>;
    const error = body.error;
    if (error?.code)
      throw new APIError(error.code, error.message, error.params);
    throw new APIError("http_error", `HTTP ${response.status}`, {
      status: response.status,
    });
  }

  let done: { type: string; stats?: Catalog["stats"] } | null = null;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const event = JSON.parse(line) as {
      type: string;
      stats?: Catalog["stats"];
      error?: APIErrorBody["error"];
    };
    if (event.type === "error") {
      const error = event.error;
      if (error?.code)
        throw new APIError(error.code, error.message, error.params);
      throw new APIError("scan_failed", "scan failed");
    }
    if (event.type === "done") done = event;
  }

  return done ?? { type: "done" };
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
