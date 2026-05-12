import { useTranslation } from "react-i18next";
import type { AssetItem } from "@/types";
import { Badge, CopyButton } from "@/components/ui";

type Props = {
  ocr: NonNullable<AssetItem["ocr"]>;
};

export function AssetDrawerOCR({ ocr }: Props) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          tone={
            ocr.status === "ready"
              ? "green"
              : ocr.status === "failed"
                ? "red"
                : ocr.status === "skipped"
                  ? "amber"
                  : "line"
          }
        >
          {t(`ocr.status.${ocr.status}`)}
        </Badge>
        {ocr.durationMs != null && (
          <Badge tone="line">{ocr.durationMs}ms</Badge>
        )}
        {ocr.mode && <Badge tone="line">{ocr.mode}</Badge>}
        {ocr.attempts != null && ocr.attempts > 1 && (
          <Badge tone="amber">
            {t("assetDrawer.ocrAttempts", { count: ocr.attempts })}
          </Badge>
        )}
      </div>

      {ocr.status === "ready" && ocr.text ? (
        <div className="rounded-g-md border border-g-line bg-g-surface-2 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-g-ink-4">
              {t("assetDrawer.ocr")}
            </span>
            <CopyButton value={ocr.text} label="Copy OCR text" />
          </div>
          <p className="whitespace-pre-wrap font-g-mono text-g-ui leading-[1.5] text-g-ink">
            {ocr.text}
          </p>
        </div>
      ) : ocr.status === "ready" && ocr.emptyText ? (
        <p className="text-g-caption text-g-ink-3">
          {t("assetDrawer.ocrEmptyText")}
        </p>
      ) : (
        <p className="text-g-caption text-g-ink-3">
          {ocr.errorMessage || t("assetDrawer.ocrNoText")}
        </p>
      )}

      {((ocr.languages ?? []).length > 0 || (ocr.scripts ?? []).length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {(ocr.languages ?? []).map((language) => (
            <Badge key={language} tone="line">
              {language}
            </Badge>
          ))}
          {(ocr.scripts ?? []).map((script) => (
            <Badge key={script} tone="blue">
              {script}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
