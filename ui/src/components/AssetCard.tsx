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
    <article className="acard">
      <div className="acard-thumb">
        <img src={item.thumbnailUrl || item.url} alt="" loading="lazy" />
      </div>
      <div className="acard-meta">
        <div>
          <div className="acard-name" title={item.repoPath}>
            {fileName(item.repoPath)}
          </div>
          <div className="acard-path" title={item.repoPath}>
            {item.repoPath}
          </div>
        </div>
        <div className="acard-row">
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
        <div className="acard-actions">
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
