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
      <div
        className="fixed inset-0 z-50 bg-[rgba(20,20,46,0.32)] backdrop-blur-[8px] animate-[fadeIn_180ms_var(--g-ease)] [[data-theme='dark']_&]:bg-[rgba(0,0,0,0.5)]"
        onClick={onClose}
      />
      <aside className="fixed inset-y-0 right-0 z-[51] flex w-[480px] max-w-[95vw] flex-col overflow-hidden border-l border-g-line bg-g-surface shadow-g-pop animate-[slideInR_240ms_var(--g-ease-out)]">
        <div className="flex items-center gap-2.5 border-b border-g-line px-5 py-[18px]">
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

        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-5">
            <AssetThumbnail src={asset.thumbnailUrl || asset.url} size="fill" />
          </div>

          <div className="mb-5">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-g-ink-4">
              {t("assetDrawer.metadata")}
            </div>
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

          {asset.ocr && (
            <div className="mb-5">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-g-ink-4">
                  {t("assetDrawer.ocr")}
                </span>
                <Badge
                  tone={
                    asset.ocr.status === "ready"
                      ? "green"
                      : asset.ocr.status === "failed"
                        ? "red"
                        : asset.ocr.status === "skipped"
                          ? "amber"
                          : "line"
                  }
                  className="text-[10px]"
                >
                  {t(`ocr.status.${asset.ocr.status}`)}
                </Badge>
              </div>
              {asset.ocr.status === "ready" && asset.ocr.text ? (
                <div className="rounded-g-md border border-g-line bg-g-surface-2 p-3">
                  <p className="whitespace-pre-wrap font-g text-g-ui leading-[1.5] text-g-ink">
                    {asset.ocr.text}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(asset.ocr.languages ?? []).map((language) => (
                      <Badge key={language} tone="line">
                        {language}
                      </Badge>
                    ))}
                    {(asset.ocr.scripts ?? []).map((script) => (
                      <Badge key={script} tone="blue">
                        {script}
                      </Badge>
                    ))}
                    {asset.ocr.durationMs != null && (
                      <Badge tone="line">{asset.ocr.durationMs}ms</Badge>
                    )}
                    {asset.ocr.mode && (
                      <Badge tone="line">{asset.ocr.mode}</Badge>
                    )}
                    {asset.ocr.attempts != null && asset.ocr.attempts > 1 && (
                      <Badge tone="amber">
                        {t("assetDrawer.ocrAttempts", {
                          count: asset.ocr.attempts,
                        })}
                      </Badge>
                    )}
                  </div>
                </div>
              ) : asset.ocr.status === "ready" && asset.ocr.emptyText ? (
                <p className="font-g text-g-caption text-g-ink-3">
                  {t("assetDrawer.ocrEmptyText")}
                </p>
              ) : (
                <p className="font-g text-g-caption text-g-ink-3">
                  {asset.ocr.errorMessage || t("assetDrawer.ocrNoText")}
                </p>
              )}
            </div>
          )}

          {asset.references.length > 0 && (
            <div className="mb-5">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-g-ink-4">
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
            <div className="mb-5">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-g-ink-4">
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
            <div className="mb-5">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-g-ink-4">
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

          <div className="mb-5">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-g-ink-4">
              {t("assetDrawer.actions")}
            </div>
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
