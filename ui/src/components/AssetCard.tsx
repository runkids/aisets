import { Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AssetItem } from "../types";
import { fileName, formatBytes, primarySeverity } from "../ui";
import { Badge, Button } from "./ui";

type Props = {
  item: AssetItem;
  onRename: (item: AssetItem) => void;
  onDelete: (item: AssetItem) => void;
};

export function AssetCard({ item, onRename, onDelete }: Props) {
  const { t } = useTranslation();
  const severity = primarySeverity(item);
  return (
    <article className="relative flex flex-col overflow-hidden rounded-g-md border border-g-line bg-g-surface text-left transition-[border-color,box-shadow,transform,background] duration-[160ms] ease-[var(--g-ease)] hover:z-[1] hover:translate-y-[-2px] hover:border-g-line-strong hover:shadow-g-md focus-visible:z-[2] focus-visible:border-g-accent focus-visible:shadow-g-focus">
      <div className="relative grid aspect-[4/3] place-items-center overflow-hidden border-b border-g-line bg-g-surface-2">
        <img src={item.thumbnailUrl || item.url} alt="" loading="lazy" />
      </div>
      <div className="flex flex-col gap-1 px-3 py-2.5 transition-[background] duration-[160ms] ease-[var(--g-ease)]">
        <div>
          <div
            className="block w-full truncate text-left font-g-mono text-[12px] font-[510] text-g-ink"
            title={item.repoPath}
          >
            {fileName(item.repoPath)}
          </div>
          <div
            className="block w-full truncate text-left font-g-mono text-[10px] text-g-ink-4"
            title={item.repoPath}
          >
            {item.repoPath}
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge tone="line">{item.projectName}</Badge>
          <Badge tone="line">{item.ext}</Badge>
          <Badge tone="line">{formatBytes(item.bytes)}</Badge>
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
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Pencil size={14} />}
            onClick={() => onRename(item)}
          >
            {t("action.rename")}
          </Button>
          {item.usedBy.length === 0 && (
            <Button
              size="sm"
              variant="danger"
              leadingIcon={<Trash2 size={14} />}
              onClick={() => onDelete(item)}
            >
              {t("action.delete")}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
