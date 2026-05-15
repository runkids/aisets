import type {
  APIErrorBody,
  CanvasSessionFull,
  CanvasSessionMeta,
} from "@/types";
import { APIError, basePath, request } from "./client";

export function listCanvasSessions(workspaceId?: string) {
  const params = workspaceId ? `?workspaceId=${workspaceId}` : "";
  return request<{ sessions: CanvasSessionMeta[] }>(
    `/api/canvas/sessions${params}`,
  );
}

export function getCanvasSession(id: string) {
  return request<{ session: CanvasSessionFull }>(`/api/canvas/sessions/${id}`);
}

export function isCanvasSessionNotFound(error: unknown) {
  return (
    error instanceof APIError &&
    (error.code === "canvas_session_not_found" || error.params?.status === 404)
  );
}

export function canvasSessionThumbnailUrl(id: string) {
  return `${basePath}/api/canvas/sessions/${id}/thumbnail`;
}

export async function createCanvasSession(data: {
  name: string;
  stateJson: string;
  thumbnail?: Blob;
  cardCount: number;
  workspaceId?: string;
}): Promise<{ session: CanvasSessionMeta }> {
  const form = new FormData();
  form.append("name", data.name);
  form.append("stateJson", data.stateJson);
  form.append("cardCount", String(data.cardCount));
  if (data.workspaceId) form.append("workspaceId", data.workspaceId);
  if (data.thumbnail) form.append("thumbnail", data.thumbnail, "thumb.png");

  const res = await fetch(`${basePath}/api/canvas/sessions`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new APIError(
      "canvas_session_create_failed",
      `Create failed: HTTP ${res.status}`,
    );
  }
  return (await res.json()) as { session: CanvasSessionMeta };
}

export async function updateCanvasSession(
  id: string,
  data: {
    name?: string;
    stateJson: string;
    thumbnail?: Blob;
    cardCount: number;
  },
): Promise<{ session: CanvasSessionMeta }> {
  const form = new FormData();
  if (data.name) form.append("name", data.name);
  form.append("stateJson", data.stateJson);
  form.append("cardCount", String(data.cardCount));
  if (data.thumbnail) form.append("thumbnail", data.thumbnail, "thumb.png");

  const res = await fetch(`${basePath}/api/canvas/sessions/${id}`, {
    method: "PATCH",
    body: form,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Partial<APIErrorBody>;
    const error = body.error;
    if (error?.code) {
      throw new APIError(error.code, error.message, {
        ...(error.params ?? {}),
        status: res.status,
      });
    }
    throw new APIError(
      "canvas_session_update_failed",
      `Update failed: HTTP ${res.status}`,
      { status: res.status },
    );
  }
  return (await res.json()) as { session: CanvasSessionMeta };
}

export function renameCanvasSession(id: string, name: string) {
  return request<{ ok: boolean }>(`/api/canvas/sessions/${id}/name`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export function deleteCanvasSession(id: string) {
  return request<{ ok: boolean }>(`/api/canvas/sessions/${id}`, {
    method: "DELETE",
  });
}
