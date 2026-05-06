import { Copy, ExternalLink, Pencil, Trash2, X } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { AssetItem } from "../types";
import { fileName, formatBytes } from "../ui";
import { AssetThumbnail, Badge, Button, IconButton } from "./ui";

type Props = {
  asset: AssetItem;
  onClose: () => void;
  onRename?: (item: AssetItem) => void;
  onDelete?: (item: AssetItem) => void;
  onCopyPath?: (path: string) => void;
};

export function AssetDrawer({
  asset,
  onClose,
  onRename,
  onDelete,
  onCopyPath,
}: Props) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-h">
          <span className="drawer-title" title={asset.repoPath}>
            {fileName(asset.repoPath)}
          </span>
          <IconButton onClick={onClose} aria-label={t("common.close")}>
            <X size={16} />
          </IconButton>
        </div>

        <div className="drawer-body">
          <div className="drawer-section">
            <AssetThumbnail src={asset.thumbnailUrl || asset.url} size="fill" />
          </div>

          <div className="drawer-section">
            <div className="drawer-section-h">{t("assetDrawer.metadata")}</div>
            <table className="w-full border-collapse text-g-caption">
              <tbody>
                <MetaRow
                  label={t("assetDrawer.path")}
                  value={asset.repoPath}
                  mono
                />
                <MetaRow
                  label={t("assetDrawer.project")}
                  value={asset.projectName}
                />
                <MetaRow
                  label={t("assetDrawer.format")}
                  value={asset.ext.replace(".", "").toUpperCase()}
                />
                <MetaRow
                  label={t("assetDrawer.size")}
                  value={formatBytes(asset.bytes)}
                />
                {asset.image.width > 0 && (
                  <MetaRow
                    label={t("assetDrawer.dimensions")}
                    value={`${asset.image.width} × ${asset.image.height}`}
                  />
                )}
                <MetaRow
                  label={t("assetDrawer.hash")}
                  value={`${asset.hashAlgorithm}:${asset.contentHash.slice(0, 12)}`}
                  mono
                />
                {asset.dHash && (
                  <MetaRow
                    label="dHash"
                    value={asset.dHash.slice(0, 16)}
                    mono
                  />
                )}
              </tbody>
            </table>
          </div>

          {asset.references.length > 0 && (
            <div className="drawer-section">
              <div className="drawer-section-h">
                {t("assetDrawer.references", {
                  count: asset.references.length,
                })}
              </div>
              <div className="grid gap-1">
                {asset.references.slice(0, 20).map((ref, i) => (
                  <div
                    key={i}
                    className="flex items-baseline gap-1.5 font-g-mono text-g-caption text-g-ink-2"
                  >
                    <span className="text-g-ink">{ref.file}</span>
                    <span className="text-g-ink-4">:{ref.line}</span>
                    <Badge tone="line" className="text-[10px]">
                      {ref.kind}
                    </Badge>
                  </div>
                ))}
                {asset.references.length > 20 && (
                  <div className="text-g-chip text-g-ink-4">
                    {t("assetDrawer.more", {
                      count: asset.references.length - 20,
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {asset.optimizationRecommendations.length > 0 && (
            <div className="drawer-section">
              <div className="drawer-section-h">
                {t("assetDrawer.optimization")}
              </div>
              <div className="grid gap-1.5">
                {asset.optimizationRecommendations.map((rec, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-1.5 text-g-caption"
                  >
                    <Badge
                      tone={
                        rec.severity === "critical"
                          ? "red"
                          : rec.severity === "warning"
                            ? "amber"
                            : "blue"
                      }
                      className="shrink-0 text-[10px]"
                    >
                      {t(`severity.${rec.severity}`)}
                    </Badge>
                    <span className="text-g-ink-2">{rec.suggestion}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {asset.duplicates.length > 0 && (
            <div className="drawer-section">
              <div className="drawer-section-h">
                {t("assetDrawer.duplicates", {
                  count: asset.duplicates.length,
                })}
              </div>
              <div className="grid gap-1">
                {asset.duplicates.map((dup) => (
                  <div
                    key={dup}
                    className="font-g-mono text-g-caption text-g-ink-2"
                  >
                    {dup}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="drawer-section">
            <div className="drawer-section-h">{t("assetDrawer.actions")}</div>
            <div className="flex flex-wrap gap-1.5">
              {onCopyPath && (
                <Button
                  size="sm"
                  variant="secondary"
                  leadingIcon={<Copy size={12} />}
                  onClick={() => onCopyPath(asset.repoPath)}
                >
                  {t("action.copyPath")}
                </Button>
              )}
              {onRename && (
                <Button
                  size="sm"
                  variant="secondary"
                  leadingIcon={<Pencil size={12} />}
                  onClick={() => onRename(asset)}
                >
                  {t("action.rename")}
                </Button>
              )}
              {onDelete && asset.usedBy.length === 0 && (
                <Button
                  size="sm"
                  variant="danger"
                  leadingIcon={<Trash2 size={12} />}
                  onClick={() => onDelete(asset)}
                >
                  {t("action.delete")}
                </Button>
              )}
              <a
                href={asset.url}
                target="_blank"
                rel="noopener"
                className="inline-flex h-g-btn-sm items-center justify-center gap-1.5 rounded-g-md px-2.5 font-g text-g-caption font-[510] tracking-g-ui text-g-ink-2 transition-colors duration-[120ms] ease-g hover:bg-g-surface-2 hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus"
              >
                <ExternalLink size={12} /> {t("action.openFile")}
              </a>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

function MetaRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <tr>
      <td className="whitespace-nowrap py-1 pr-2 align-top text-g-ink-4">
        {label}
      </td>
      <td
        className={
          mono
            ? "break-all py-1 font-g-mono text-g-ink"
            : "break-all py-1 text-g-ink"
        }
      >
        {value}
      </td>
    </tr>
  );
}
