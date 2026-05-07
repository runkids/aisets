import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCatalogQuery } from "../queries";
import type { AssetItem } from "../types";
import { SimilarCompare } from "./SimilarCompare";
import { AssetThumbnail, CopyButton, EmptyState } from "./ui";

type EnrichedSimilar = {
  id: string;
  item: AssetItem;
  similarity: number;
  mirrored: boolean;
};

type Props = {
  asset: AssetItem;
};

export function AssetDrawerSimilar({ asset }: Props) {
  const { t } = useTranslation();
  const catalogQuery = useCatalogQuery();
  const [selectedIdx, setSelectedIdx] = useState(0);

  const enriched = useMemo(() => {
    const catalog = catalogQuery.data;
    if (!catalog) return [];
    const itemMap = new Map(catalog.items.map((i) => [i.id, i]));
    return asset.similar
      .map((id) => {
        const item = itemMap.get(id);
        if (!item) return null;
        const nd = catalog.nearDuplicates.find(
          (n) =>
            (n.leftId === asset.id && n.rightId === id) ||
            (n.rightId === asset.id && n.leftId === id),
        );
        const maxDistance = 64;
        const similarity = nd
          ? Math.round(((maxDistance - nd.distance) / maxDistance) * 100)
          : 0;
        return { id, item, similarity, mirrored: nd?.flipped ?? false };
      })
      .filter((x): x is EnrichedSimilar => x !== null);
  }, [asset.id, asset.similar, catalogQuery.data]);

  const selected = enriched[selectedIdx] ?? enriched[0];

  return (
    <div className="flex flex-col gap-5">
      {asset.duplicates.length > 0 && (
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-g-ink-4">
            {t("assetDrawer.exactDuplicates")}
          </div>
          <div className="grid gap-1">
            {asset.duplicates.map((dup) => (
              <div
                key={dup}
                className="flex items-center gap-1.5 font-g-mono text-g-caption text-g-ink-2"
              >
                <span className="min-w-0 flex-1 truncate">{dup}</span>
                <CopyButton value={dup} label="Copy path" />
              </div>
            ))}
          </div>
        </div>
      )}

      {enriched.length > 0 && selected ? (
        <div className="flex flex-col gap-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-g-ink-4">
            {t("assetDrawer.visualSimilar")}
          </div>

          <SimilarCompare
            currentAsset={{
              thumbnailUrl: asset.thumbnailUrl || asset.url,
              url: asset.url,
              repoPath: asset.repoPath,
              bytes: asset.bytes,
              width: asset.image.width,
              height: asset.image.height,
              ext: asset.ext,
            }}
            similarAsset={{
              thumbnailUrl: selected.item.thumbnailUrl || selected.item.url,
              url: selected.item.url,
              repoPath: selected.item.repoPath,
              bytes: selected.item.bytes,
              width: selected.item.image.width,
              height: selected.item.image.height,
              ext: selected.item.ext,
            }}
            similarity={selected.similarity}
            mirrored={selected.mirrored}
          />

          {enriched.length >= 2 && (
            <div className="flex items-center gap-1.5 overflow-x-auto py-1">
              {enriched.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedIdx(i)}
                  className={`shrink-0 cursor-pointer rounded-g-sm border-2 transition-colors duration-[120ms] ease-g ${
                    i === selectedIdx
                      ? "border-g-active-text"
                      : "border-transparent hover:border-g-line"
                  }`}
                  aria-label={s.item.repoPath}
                >
                  <AssetThumbnail
                    src={s.item.thumbnailUrl || s.item.url}
                    size="sm"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : asset.duplicates.length === 0 ? (
        <EmptyState title={t("assetDrawer.noSimilar")} />
      ) : null}
    </div>
  );
}
