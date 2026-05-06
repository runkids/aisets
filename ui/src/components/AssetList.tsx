import { Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AssetItem } from "../types";
import { fileName, formatBytes, primarySeverity } from "../ui";
import { AssetCard } from "./AssetCard";
import { Badge, Button, Card, EmptyState } from "./ui";

type Props = {
  items: AssetItem[];
  view: "grid" | "list";
  onRename: (item: AssetItem) => void;
  onDelete: (item: AssetItem) => void;
};

export function AssetList({ items, view, onRename, onDelete }: Props) {
  const { t } = useTranslation();

  if (items.length === 0) {
    return (
      <EmptyState
        title={t("assetList.empty")}
        description={t("assetList.emptyDesc")}
      />
    );
  }

  if (view === "grid") {
    return (
      <section
        className="relative grid w-full grid-cols-[repeat(auto-fill,minmax(var(--browse-card-min,180px),1fr))] gap-[var(--browse-card-gap,16px)] content-start p-1"
        aria-label={t("assetList.gridAriaLabel")}
      >
        {items.map((item) => (
          <AssetCard
            key={item.id}
            item={item}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
      </section>
    );
  }

  return (
    <section
      className="flex flex-col gap-2"
      aria-label={t("assetList.listAriaLabel")}
    >
      {items.map((item) => {
        const severity = primarySeverity(item);
        return (
          <Card key={item.id} className="flex items-center gap-4 p-3">
            <div className="size-10 shrink-0 overflow-hidden rounded-g-md border border-g-line">
              <img
                src={item.url}
                alt=""
                loading="lazy"
                className="size-full object-contain"
              />
            </div>
            <div className="min-w-0">
              <div className="truncate font-extrabold" title={item.repoPath}>
                {item.repoPath}
              </div>
              <div className="truncate text-xs text-(--g-ink-4)">
                {item.projectName} · {formatBytes(item.bytes)} ·{" "}
                {item.hashAlgorithm}:{item.contentHash.slice(0, 8)}
              </div>
            </div>
            <div className="hidden flex-wrap gap-1 lg:flex">
              <Badge tone={item.usedBy.length > 0 ? "green" : "amber"}>
                {t("asset.refs", { count: item.usedBy.length })}
              </Badge>
              {item.duplicateGroupId && (
                <Badge tone="red">{t("status.duplicate")}</Badge>
              )}
              {severity && (
                <Badge
                  tone={
                    severity === "critical"
                      ? "red"
                      : severity === "warning"
                        ? "amber"
                        : "blue"
                  }
                >
                  {t(`severity.${severity}`)}
                </Badge>
              )}
            </div>
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Pencil size={14} />}
              onClick={() => onRename(item)}
            >
              {t("action.rename")}
            </Button>
            {item.usedBy.length === 0 ? (
              <Button
                size="sm"
                variant="danger"
                leadingIcon={<Trash2 size={14} />}
                onClick={() => onDelete(item)}
              >
                {t("action.delete")}
              </Button>
            ) : (
              <Badge tone="line">{fileName(item.localPath)}</Badge>
            )}
          </Card>
        );
      })}
    </section>
  );
}
