import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AssetItem } from "../types";
import { fileName } from "../ui";
import { CopyButton, ZoomableImage } from "./ui";

const unsupportedBrowserExts = new Set([".heic", ".heif", ".tiff", ".tif"]);
function browserUnsupportedExt(ext: string) {
  return unsupportedBrowserExts.has(ext.toLowerCase());
}

type Props = {
  asset: AssetItem;
};

export function AssetDrawerOverview({ asset }: Props) {
  const { t } = useTranslation();

  const modified = useMemo(() => {
    if (asset.modifiedUnix <= 0) return null;
    return new Date(asset.modifiedUnix * 1000).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }, [asset.modifiedUnix]);

  return (
    <div className="flex flex-col gap-4">
      <ZoomableImage
        key={asset.url}
        src={
          browserUnsupportedExt(asset.ext)
            ? asset.thumbnailUrl || asset.url
            : asset.url
        }
        alt={fileName(asset.repoPath)}
        className="max-h-[420px] w-full"
      />

      <section className="rounded-g-md border border-g-line bg-g-surface px-4 pb-3.5 pt-3">
        <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-g-ink-4">
          {t("assetDrawer.metadata")}
        </div>
        <div className="flex flex-col gap-0.5">
          <MetaRow label={t("assetDrawer.project")} value={asset.projectName} />
          <MetaRow
            label={t("assetDrawer.path")}
            value={asset.repoPath}
            mono
            copyable
          />
          {modified && (
            <MetaRow label={t("assetDrawer.modified")} value={modified} />
          )}
          {asset.image.animated && (
            <MetaRow
              label={t("assetDrawer.animated")}
              value={t("common.yes")}
            />
          )}
          {asset.image.alpha && (
            <MetaRow
              label={t("assetDrawer.alphaChannel")}
              value={t("common.yes")}
            />
          )}
          {asset.image.pages > 1 && (
            <MetaRow
              label={t("assetDrawer.imagePages")}
              value={asset.image.pages.toString()}
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
        </div>
      </section>

      {asset.exif?.hasExif && (
        <section className="rounded-g-md border border-g-line bg-g-surface px-4 pb-3.5 pt-3">
          <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-g-ink-4">
            {t("drawer.exif.title")}
          </div>
          <div className="flex flex-col gap-0.5">
            {asset.exif.gpsLatitude != null &&
              asset.exif.gpsLongitude != null && (
                <div className="flex min-h-7 items-baseline gap-3 py-px">
                  <span className="w-[72px] shrink-0 text-g-caption text-g-ink-4">
                    {t("drawer.exif.gps")}
                  </span>
                  <a
                    href={`https://maps.google.com/?q=${asset.exif.gpsLatitude},${asset.exif.gpsLongitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 break-all text-g-caption text-g-link hover:underline"
                  >
                    {asset.exif.gpsLatitude.toFixed(4)},{" "}
                    {asset.exif.gpsLongitude.toFixed(4)}
                  </a>
                </div>
              )}
            {(asset.exif.cameraMake || asset.exif.cameraModel) && (
              <MetaRow
                label={t("drawer.exif.camera")}
                value={[asset.exif.cameraMake, asset.exif.cameraModel]
                  .filter(Boolean)
                  .join(" ")}
              />
            )}
            {asset.exif.dateTimeOriginal && (
              <MetaRow
                label={t("drawer.exif.date")}
                value={asset.exif.dateTimeOriginal}
              />
            )}
            {asset.exif.dpiX != null && asset.exif.dpiX > 0 && (
              <MetaRow
                label={t("drawer.exif.dpi")}
                value={`${asset.exif.dpiX} × ${asset.exif.dpiY}`}
              />
            )}
          </div>
        </section>
      )}
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
    <div className="flex min-h-7 items-baseline gap-3 py-px">
      <span className="w-[72px] shrink-0 text-g-caption text-g-ink-4">
        {label}
      </span>
      <span
        className={`min-w-0 flex-1 break-all text-g-caption text-g-ink ${mono ? "font-g-mono" : ""}`}
      >
        <span className="inline-flex items-center gap-1">
          {value}
          {copyable && (
            <CopyButton value={copyValue ?? value} label={`Copy ${label}`} />
          )}
        </span>
      </span>
    </div>
  );
}
