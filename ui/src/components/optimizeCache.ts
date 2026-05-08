import type { AssetItem } from "../types";
import type {
  OptimizationEstimate,
  OptimizationOperation,
  PreviewBatch,
  PreviewResponse,
} from "./optimizeTypes";
import { optimizationBlockers, optimizationOperations } from "./optimizeTypes";

export const estimateCache = new Map<string, OptimizationEstimate>();
export const estimateOperationCache = new Map<string, OptimizationOperation>();

export function estimateCacheKey(
  assetIds: string[],
  replaceOriginal: boolean,
  updateReferences: boolean,
  itemsById?: Map<string, AssetItem>,
  quality = 80,
) {
  return JSON.stringify({
    ids: [...assetIds].sort().map((assetId) => {
      const item = itemsById?.get(assetId);
      return item
        ? `${assetId}:${item.hashAlgorithm}:${item.contentHash}:${item.bytes}`
        : assetId;
    }),
    outputMode: replaceOriginal ? "replace" : "safeVariants",
    updateReferences: replaceOriginal && updateReferences,
    quality,
  });
}

export function estimateOperationCacheKey(
  item: AssetItem,
  replaceOriginal: boolean,
  updateReferences: boolean,
  quality = 80,
) {
  return JSON.stringify({
    assetId: item.id,
    hashAlgorithm: item.hashAlgorithm,
    contentHash: item.contentHash,
    bytes: item.bytes,
    outputMode: replaceOriginal ? "replace" : "safeVariants",
    updateReferences: replaceOriginal && updateReferences,
    quality,
    maxDimensionPx: 1200,
  });
}

export function ensureEstimateOperationCacheLoaded() {
  // in-memory only — no localStorage persistence
}

export function persistEstimateOperationCache() {
  // in-memory only — no localStorage persistence
}

export function buildEstimateFromOperations(
  assetIds: string[],
  itemsById: Map<string, AssetItem>,
  operations: OptimizationOperation[],
): OptimizationEstimate {
  const operationsByAsset = new Map(
    operations.map((operation) => [operation.assetId, operation]),
  );
  const orderedOperations = assetIds
    .map((assetId) => operationsByAsset.get(assetId))
    .filter((operation): operation is OptimizationOperation =>
      Boolean(operation),
    );
  const toolMap = new Map<
    string,
    { name: string; required: boolean; available: boolean }
  >();
  for (const operation of orderedOperations) {
    if (!operation.tool) continue;
    const existing = toolMap.get(operation.tool);
    toolMap.set(operation.tool, {
      name: operation.tool,
      required: true,
      available: (existing?.available ?? true) && operation.available,
    });
  }
  return {
    itemCount: orderedOperations.length,
    totalBytes: assetIds.reduce(
      (sum, assetId) => sum + (itemsById.get(assetId)?.bytes ?? 0),
      0,
    ),
    savingsBytes: orderedOperations.reduce(
      (sum, operation) => sum + operation.savingsBytes,
      0,
    ),
    operations: orderedOperations,
    tools: [...toolMap.values()],
  };
}

export function combinePreviews(previews: PreviewResponse[]): PreviewBatch {
  const first = previews[0]?.preview;
  const operations = previews.flatMap((item) =>
    optimizationOperations(item.preview),
  );
  const blockers = previews.flatMap((item) => item.preview.blockers ?? []);
  const changes = previews.flatMap((item) => item.preview.changes ?? []);
  const deletes = previews.flatMap((item) => item.preview.deletes ?? []);
  const optimizationPayloadBlockers = previews.flatMap((item) =>
    optimizationBlockers(item.preview),
  );
  const tokens = previews
    .filter((item) => item.preview.canApply)
    .map((item) => item.token);
  return {
    tokens,
    preview: {
      ...(first ?? {
        id: "optimization-empty",
        type: "optimization",
        projectId: "",
        changes: [],
        deletes: [],
        blockers: [],
        canApply: false,
        createdAt: new Date().toISOString(),
      }),
      id: previews.map((item) => item.preview.id).join("+"),
      projectId: "",
      changes,
      deletes,
      blockers,
      canApply: tokens.length > 0,
      payload: {
        optimization: {
          operations,
          blockers: optimizationPayloadBlockers,
        },
      },
    },
  };
}
