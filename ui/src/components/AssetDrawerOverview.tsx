import { useTranslation } from "react-i18next";
import type { AssetItem } from "../types";
import { fileName, formatBytes } from "../ui";
import { CopyButton, ZoomableImage } from "./ui";

type Props = {
  asset: AssetItem;
};

export function AssetDrawerOverview({ asset }: Props) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-g-md border border-g-line bg-g-surface p-4">
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
      </section>

      <ZoomableImage
        key={asset.url}
        src={asset.url}
        alt={fileName(asset.repoPath)}
        className="aspect-square w-full"
      />
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
