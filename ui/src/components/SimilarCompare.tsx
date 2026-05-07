import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs } from "@/components/ui";
import {
  ComparePanel,
  useCompareTabs,
  type CompareAsset,
  type CompareMode,
} from "./ComparePanel";

type Props = {
  currentAsset: CompareAsset;
  similarAsset: CompareAsset;
  similarity: number;
  mirrored: boolean;
};

export function SimilarCompare({
  currentAsset,
  similarAsset,
  similarity,
  mirrored,
}: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<CompareMode>("side");
  const tabItems = useCompareTabs();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Tabs
          value={mode}
          items={tabItems}
          onChange={setMode}
          ariaLabel="Comparison mode"
          size="sm"
        />
        <div className="flex items-center gap-2 text-g-caption text-g-ink-2">
          <span>{t("assetDrawer.similarScore", { score: similarity })}</span>
          {mirrored && (
            <span className="rounded-g-md bg-g-surface-2 border border-g-line px-1.5 py-0.5 text-g-chip">
              {t("assetDrawer.similarMirrored")}
            </span>
          )}
        </div>
      </div>

      <ComparePanel
        left={currentAsset}
        right={similarAsset}
        mode={mode}
        compact
      />
    </div>
  );
}
