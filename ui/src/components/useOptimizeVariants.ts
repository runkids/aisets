import { useCallback, useEffect, useState } from "react";
import { getCatalogItems } from "../api";
import type { AssetItem } from "../types";
import { fileName } from "../ui";

const OP_EXT: Record<string, string> = {
  "convert-avif": ".avif",
  "convert-webp": ".webp",
};

export type VariantInfo = {
  repoPath: string;
  name: string;
  ext: string;
  item?: AssetItem;
  savings: number;
  variantBytes: number;
};

export function useOptimizeVariants(asset: AssetItem, scanId?: number) {
  const recs = asset.optimizationRecommendations;

  const variantPaths = recs
    .filter((r) => r.hasExistingVariant && OP_EXT[r.operation ?? ""])
    .map((r) => {
      const ext = OP_EXT[r.operation ?? ""] ?? "";
      return ext ? asset.repoPath.replace(/\.[^.]+$/, ext) : "";
    })
    .filter(Boolean);
  const uniqueVariantPaths = [...new Set(variantPaths)];

  const [variants, setVariants] = useState<VariantInfo[]>([]);

  const loadVariants = useCallback(async () => {
    if (uniqueVariantPaths.length === 0) {
      setVariants([]);
      return;
    }
    const loaded: VariantInfo[] = [];
    for (const vPath of uniqueVariantPaths) {
      const vName = fileName(vPath);
      const vExt = vPath.match(/\.[^.]+$/)?.[0] ?? "";
      const rec = recs.find(
        (r) => r.hasExistingVariant && OP_EXT[r.operation ?? ""] === vExt,
      );
      const vBytes = rec?.variantBytes ?? 0;
      const info: VariantInfo = {
        repoPath: vPath,
        name: vName,
        ext: vExt,
        savings: vBytes > 0 ? asset.bytes - vBytes : 0,
        variantBytes: vBytes,
      };
      try {
        const result = await getCatalogItems({
          scanId,
          projectId: asset.projectId,
          q: vName,
          limit: 10,
        });
        const match = result.items.find(
          (i) => i.repoPath === vPath && i.projectId === asset.projectId,
        );
        if (match) info.item = match;
      } catch {
        // variant may not be in catalog
      }
      loaded.push(info);
    }
    setVariants(loaded);
  }, [scanId, asset.projectId, asset.bytes, asset.repoPath, recs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void loadVariants(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [loadVariants]);

  return variants;
}
