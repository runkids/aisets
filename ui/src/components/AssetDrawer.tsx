import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsQuery } from "../queries";
import type { AssetItem } from "../types";
import { fileName } from "../ui";
import { AssetDrawerOCR } from "./AssetDrawerOCR";
import { AssetDrawerOptimize } from "./AssetDrawerOptimize";
import { AssetDrawerOverview } from "./AssetDrawerOverview";
import { AssetDrawerSimilar } from "./AssetDrawerSimilar";
import { AssetDrawerUsage } from "./AssetDrawerUsage";
import { Badge, IconButton, Tabs, type TabItem } from "./ui";

type DrawerTab = "overview" | "usage" | "similar" | "optimize" | "ocr";

type Props = {
  asset: AssetItem;
  onClose: () => void;
  onRename?: (item: AssetItem) => void;
  onDelete?: (item: AssetItem) => void;
};

export function AssetDrawer({ asset, onClose, onRename, onDelete }: Props) {
  const { t } = useTranslation();
  const [rawTab, setRawTab] = useState<DrawerTab>("overview");
  const settingsQuery = useSettingsQuery();
  const preferredEditor =
    settingsQuery.data?.settings.preferredEditor ?? "vscode";

  const tabs = useMemo(() => {
    const items: TabItem<DrawerTab>[] = [
      { value: "overview", label: t("assetDrawer.tabOverview") },
      {
        value: "usage",
        label: t("assetDrawer.tabUsage"),
        badge: (
          <Badge tone="line" className="text-[10px]">
            {asset.references.length}
          </Badge>
        ),
      },
    ];
    if (asset.duplicates.length > 0 || asset.similar.length > 0) {
      items.push({
        value: "similar",
        label: t("assetDrawer.tabSimilar"),
        badge: (
          <Badge tone="line" className="text-[10px]">
            {asset.duplicates.length + asset.similar.length}
          </Badge>
        ),
      });
    }
    if (asset.optimizationRecommendations.length > 0) {
      items.push({
        value: "optimize",
        label: t("assetDrawer.tabOptimize"),
        badge: (
          <Badge tone="amber" className="text-[10px]">
            {asset.optimizationRecommendations.length}
          </Badge>
        ),
      });
    }
    if (asset.ocr) {
      items.push({ value: "ocr", label: t("assetDrawer.tabOCR") });
    }
    return items;
  }, [asset, t]);

  const tabValues = useMemo(() => tabs.map((t) => t.value), [tabs]);
  const tab = tabValues.includes(rawTab) ? rawTab : "overview";

  const handleTabChange = useCallback(
    (value: DrawerTab) => {
      if (tabValues.includes(value)) setRawTab(value);
    },
    [tabValues],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const idx = tabValues.indexOf(tab);
        if (idx === -1) return;
        const next =
          e.key === "ArrowLeft"
            ? tabValues[Math.max(0, idx - 1)]
            : tabValues[Math.min(tabValues.length - 1, idx + 1)];
        setRawTab(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, tab, tabValues]);

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-[rgba(20,20,46,0.32)] backdrop-blur-[8px] animate-[fadeIn_180ms_var(--g-ease)] [[data-theme='dark']_&]:bg-[rgba(0,0,0,0.5)]"
        onClick={onClose}
      />
      <aside className="fixed inset-y-0 right-0 z-[51] flex w-[600px] max-w-[95vw] flex-col overflow-hidden border-l border-g-line bg-g-surface shadow-g-pop animate-[slideInR_240ms_var(--g-ease-out)]">
        <div className="flex items-center gap-2.5 border-b border-g-line px-4 py-3">
          <span
            className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-g-mono text-g-ui font-medium"
            title={asset.repoPath}
          >
            {fileName(asset.repoPath)}
          </span>
          <IconButton onClick={onClose} aria-label={t("common.close")}>
            <X size={16} />
          </IconButton>
        </div>

        <div className="sticky top-0 z-10 border-b border-g-line bg-g-surface px-4 py-1.5">
          <Tabs
            value={tab}
            items={tabs}
            onChange={handleTabChange}
            ariaLabel="Asset detail tabs"
            size="sm"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === "overview" && (
            <AssetDrawerOverview
              asset={asset}
              onTabChange={handleTabChange}
              onRename={onRename}
              onDelete={onDelete}
            />
          )}
          {tab === "usage" && (
            <AssetDrawerUsage
              references={asset.references}
              preferredEditor={preferredEditor}
            />
          )}
          {tab === "similar" && <AssetDrawerSimilar asset={asset} />}
          {tab === "optimize" && (
            <AssetDrawerOptimize
              recommendations={asset.optimizationRecommendations}
            />
          )}
          {tab === "ocr" && asset.ocr && <AssetDrawerOCR ocr={asset.ocr} />}
        </div>
      </aside>
    </>
  );
}
