import { CheckCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AssetItem } from "../types";
import { formatBytes } from "../ui";
import type { VariantInfo } from "./useOptimizeVariants";
import { AssetThumbnail, Badge, Tooltip } from "./ui";

type Props = {
  asset: AssetItem;
  variants: VariantInfo[];
  onOpenAsset?: (id: string) => void;
};

export function AssetDrawerOptimize({ asset, variants, onOpenAsset }: Props) {
  const { t } = useTranslation();
  const recs = asset.optimizationRecommendations;
  const allDone = recs.length > 0 && recs.every((r) => r.hasExistingVariant);

  return (
    <div className="grid gap-3">
      {allDone && (
        <div className="flex items-center gap-2 rounded-g-md border border-g-green/20 bg-g-green/5 px-3 py-2.5">
          <CheckCircle size={15} className="shrink-0 text-g-green" />
          <span className="text-g-body font-[510] text-g-green">
            {t("optimize.drawerVariantsDone")}
          </span>
        </div>
      )}

      {variants.length > 0 && (
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-g-ink-4">
            {t("optimize.drawerViewVariant")}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
            {variants.map((v) => (
              <Tooltip
                key={v.repoPath}
                label={t("optimize.drawerViewVariant")}
                placement="top"
              >
                <button
                  type="button"
                  onClick={() => v.item && onOpenAsset?.(v.item.id)}
                  disabled={!v.item}
                  className="cursor-pointer overflow-hidden rounded-g-md border border-g-green/30 bg-g-surface text-left transition-[border-color] duration-[120ms] ease-g hover:border-g-green focus-visible:outline-none focus-visible:shadow-g-focus disabled:cursor-default disabled:opacity-60"
                >
                  {v.item ? (
                    <AssetThumbnail
                      src={v.item.thumbnailUrl || v.item.url}
                      alt={v.name}
                      size="fill"
                      className="rounded-none border-0 p-2"
                    />
                  ) : (
                    <div className="flex aspect-square items-center justify-center bg-g-surface-2">
                      <CheckCircle size={24} className="text-g-green/40" />
                    </div>
                  )}
                  <div className="px-2.5 py-2">
                    <div className="truncate font-g-mono text-g-caption text-g-ink">
                      {v.name}
                    </div>
                    {v.variantBytes > 0 && (
                      <div className="mt-0.5 font-g-mono text-g-chip text-g-green">
                        {formatBytes(v.variantBytes)}
                        {v.savings > 0 &&
                          ` (−${Math.round((v.savings / asset.bytes) * 100)}%)`}
                      </div>
                    )}
                  </div>
                </button>
              </Tooltip>
            ))}
          </div>
        </div>
      )}

      {recs.map((rec, i) => (
        <div
          key={i}
          className="rounded-g-md border border-g-line bg-g-surface-2 p-3"
        >
          <div className="mb-1.5 flex items-center gap-1.5">
            <Badge
              tone={
                rec.hasExistingVariant
                  ? "green"
                  : rec.severity === "critical"
                    ? "red"
                    : rec.severity === "warning"
                      ? "amber"
                      : "blue"
              }
              className="text-[10px]"
            >
              {rec.hasExistingVariant
                ? t("optimize.variantExists")
                : t(`severity.${rec.severity}`)}
            </Badge>
            <Badge tone="line" className="text-[10px]">
              {rec.category}
            </Badge>
            {rec.hasExistingVariant &&
              rec.variantBytes != null &&
              rec.variantBytes > 0 && (
                <span className="font-g-mono text-g-chip text-g-green">
                  {formatBytes(asset.bytes)} → {formatBytes(rec.variantBytes)}
                </span>
              )}
          </div>
          <p className="text-g-caption text-g-ink">
            {t(`optimization.reason.${rec.reasonCode}`)}
          </p>
          <p className="mt-1 text-g-caption text-g-ink-3">
            → {t(`optimization.suggestion.${rec.suggestionCode}`)}
          </p>
        </div>
      ))}
    </div>
  );
}
