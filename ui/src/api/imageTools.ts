import type { ActionPreview } from "@/types";
import { APIError, basePath, request } from "./client";

export type ImageToolSettings = {
  outputFormat: string;
  quality: number;
  maxDimensionPx: number;
  outputMode: "safeVariants" | "replace";
};

export type ImageToolResult = {
  id: string;
  name: string;
  source: "project" | "upload";
  repoPath?: string;
  outputPath?: string;
  projectName?: string;
  inputFormat: string;
  outputFormat: string;
  currentBytes: number;
  outputBytes: number;
  savingsBytes: number;
  operation: string;
  token?: string;
  downloadName?: string;
  errorCode?: string;
  errorMessage?: string;
};

export function previewImageToolAssets(params: {
  assetIds: string[];
  settings: ImageToolSettings;
}) {
  return request<{ preview: ActionPreview; token: string }>(
    "/api/image-tools/assets/preview",
    {
      method: "POST",
      body: JSON.stringify({ assetIds: params.assetIds, ...params.settings }),
    },
  );
}

export type RenderPreviewResponse = {
  token: string;
  inputBytes: number;
  outputBytes: number;
  inputFormat: string;
  outputFormat: string;
};

export function renderImageToolPreview(params: {
  assetId: string;
  operation?: string;
  outputFormat: string;
  quality: number;
  maxDimensionPx: number;
  flip?: string;
  rotateDegrees?: number;
  degrees?: number;
}) {
  return request<RenderPreviewResponse>(
    "/api/image-tools/assets/render-preview",
    {
      method: "POST",
      body: JSON.stringify(params),
    },
  );
}

export type ImageToolMetadata = {
  hasExif: boolean;
  gpsLatitude?: number;
  gpsLongitude?: number;
  cameraMake?: string;
  cameraModel?: string;
  dateTimeOriginal?: string;
  orientation?: number;
  dpiX?: number;
  dpiY?: number;
};

export function getImageToolMetadata(assetId: string) {
  return request<ImageToolMetadata>(
    `/api/image-tools/metadata/${encodeURIComponent(assetId)}`,
  );
}

export function previewImageUrl(token: string) {
  return `${basePath}/api/image-tools/preview/${encodeURIComponent(token)}`;
}

export function processImageToolAssets(params: {
  assetIds: string[];
  settings: ImageToolSettings;
}) {
  return request<{ results: ImageToolResult[]; applied: unknown }>(
    "/api/image-tools/assets/process",
    {
      method: "POST",
      body: JSON.stringify({ assetIds: params.assetIds, ...params.settings }),
    },
  );
}

export async function processImageToolUploads(
  files: File[],
  settings: ImageToolSettings,
) {
  const form = new FormData();
  files.forEach((file) => form.append("files", file, file.name));
  form.set("outputFormat", settings.outputFormat);
  form.set("quality", String(settings.quality));
  form.set("maxDimensionPx", String(settings.maxDimensionPx || 0));
  const res = await fetch(`${basePath}/api/image-tools/uploads/process`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new APIError(
      body?.error?.code ?? "image_tools_failed",
      body?.error?.message ?? `HTTP ${res.status}`,
      body?.error?.params,
    );
  }
  return (await res.json()) as {
    results: ImageToolResult[];
    zipToken?: string;
  };
}

export async function downloadImageToolResult(
  token: string,
  filename?: string,
) {
  const res = await fetch(
    `${basePath}/api/image-tools/download/${encodeURIComponent(token)}`,
  );
  if (!res.ok) throw new Error("Download failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    filename ||
    res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ||
    "aisets-image";
  a.click();
  URL.revokeObjectURL(url);
}
