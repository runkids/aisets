import {
  ExternalLink,
  Pencil,
  Trash2,
  AlertCircle,
  Copy as CopyIcon,
  Eye,
  Zap,
  ScanText,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AssetItem } from "../types";
import { fileName, formatBytes } from "../ui";
import { Badge, CopyButton, IconButton, Tooltip, ZoomableImage } from "./ui";

type DrawerTab = "overview" | "usage" | "similar" | "optimize" | "ocr";

type Props = {
  asset: AssetItem;
  onTabChange: (tab: DrawerTab) => void;
  onRename?: (item: AssetItem) => void;
  onDelete?: (item: AssetItem) => void;
};

export function AssetDrawerOverview({
  asset,
  onTabChange,
  onRename,
  onDelete,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-5">
      <ZoomableImage
        key={asset.url}
        src={asset.url}
        alt={fileName(asset.repoPath)}
        className="aspect-square w-full"
      />

      <div className="flex items-center gap-1.5">
        <span
          className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-g-mono text-g-ui font-medium text-g-ink"
          title={asset.repoPath}
        >
          {fileName(asset.repoPath)}
        </span>
        <Tooltip label={t("action.openFile")}>
          <a
            href={asset.url}
            target="_blank"
            rel="noopener"
            className="inline-flex size-7 items-center justify-center rounded-g-md text-g-ink-3 hover:bg-g-surface-2 hover:text-g-ink"
          >
            <ExternalLink size={14} />
          </a>
        </Tooltip>
        {onRename && (
          <Tooltip label={t("action.rename")}>
            <IconButton
              onClick={() => onRename(asset)}
              aria-label={t("action.rename")}
            >
              <Pencil size={14} />
            </IconButton>
          </Tooltip>
        )}
        {onDelete && asset.usedBy.length === 0 && (
          <Tooltip label={t("action.delete")}>
            <IconButton
              onClick={() => onDelete(asset)}
              aria-label={t("action.delete")}
            >
              <Trash2 size={14} />
            </IconButton>
          </Tooltip>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {asset.references.length === 0 && (
          <button
            type="button"
            onClick={() => onTabChange("usage")}
            className="cursor-pointer"
          >
            <Badge tone="red">
              <AlertCircle size={10} />
              {t("assetDrawer.chipUnused")}
            </Badge>
          </button>
        )}
        {asset.duplicates.length > 0 && (
          <button
            type="button"
            onClick={() => onTabChange("similar")}
            className="cursor-pointer"
          >
            <Badge tone="amber">
              <CopyIcon size={10} />
              {t("assetDrawer.chipDuplicate")}
            </Badge>
          </button>
        )}
        {asset.similar.length > 0 && (
          <button
            type="button"
            onClick={() => onTabChange("similar")}
            className="cursor-pointer"
          >
            <Badge tone="purple">
              <Eye size={10} />
              {t("assetDrawer.chipSimilar")}
            </Badge>
          </button>
        )}
        {asset.optimizationRecommendations.length > 0 && (
          <button
            type="button"
            onClick={() => onTabChange("optimize")}
            className="cursor-pointer"
          >
            <Badge tone="blue">
              <Zap size={10} />
              {t("assetDrawer.chipOptimizable")}
            </Badge>
          </button>
        )}
        {asset.ocr && (
          <button
            type="button"
            onClick={() => onTabChange("ocr")}
            className="cursor-pointer"
          >
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
            >
              <ScanText size={10} />
              {t("assetDrawer.chipOCR")}
            </Badge>
          </button>
        )}
      </div>

      <div>
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-g-ink-4">
          {t("assetDrawer.metadata")}
        </div>
        <table className="w-full border-collapse text-g-caption">
          <tbody>
            <MetaRow
              label={t("assetDrawer.path")}
              value={asset.repoPath}
              mono
              copyable
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
              copyable
              copyValue={asset.contentHash}
            />
            {asset.dHash && (
              <MetaRow
                label="dHash"
                value={asset.dHash.slice(0, 16)}
                mono
                copyable
                copyValue={asset.dHash}
              />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetaRow({
  label,
  value,
  mono,
  copyable,
  copyValue,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copyable?: boolean;
  copyValue?: string;
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
        <span className="inline-flex items-center gap-1">
          {value}
          {copyable && (
            <CopyButton value={copyValue ?? value} label={`Copy ${label}`} />
          )}
        </span>
      </td>
    </tr>
  );
}
