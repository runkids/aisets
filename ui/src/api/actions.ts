import type { ActionPreview, BatchResult, RenameRules } from "@/types";
import { basePath, request } from "./client";

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

export function batchRenamePreview(assetIds: string[], rules: RenameRules) {
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
  const res = await fetch(`${basePath}/api/actions/batch/export`, {
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
