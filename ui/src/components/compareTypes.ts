import type { AssetItem } from "@/types";

export type CompareAsset = {
  thumbnailUrl: string;
  url: string;
  repoPath: string;
  bytes: number;
  width: number;
  height: number;
  ext: string;
};

export type CompareMode = "side" | "blend" | "overlay" | "diff";

export function toCompareAsset(item: AssetItem): CompareAsset {
  return {
    thumbnailUrl: item.thumbnailUrl || item.url,
    url: item.url,
    repoPath: item.repoPath,
    bytes: item.bytes,
    width: item.image.width,
    height: item.image.height,
    ext: item.ext,
  };
}
