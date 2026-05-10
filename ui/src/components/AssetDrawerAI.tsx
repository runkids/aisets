import { FileText, Globe, ScanText, Tags, Timer } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AssetItem } from "../types";
import { AiChipIcon } from "./ui/AiChipIcon";
import { Badge, CopyButton, Tooltip } from "./ui";

type Props = {
  aiTag?: AssetItem["aiTag"];
  ocr?: AssetItem["ocr"];
};

export function AssetDrawerAI({ aiTag, ocr }: Props) {
  const { t } = useTranslation();
  const hasAiTag = aiTag && aiTag.status === "ready";
  const hasVlmOcr = ocr && ocr.status === "ready" && ocr.engineName === "vlm";

  return (
    <div className="flex flex-col gap-5 p-4">
      {hasAiTag && (
        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <AiChipIcon size={14} className="text-g-purple" />
            <h3 className="font-g text-g-ui font-[590] text-g-ink">
              {t("drawer.aiSection.tag")}
            </h3>
          </div>

          <div className="rounded-g-md border border-g-line bg-g-surface-2 p-3">
            <div className="flex flex-col gap-3">
              {aiTag.category && (
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0 font-g text-g-caption font-[510] text-g-ink-3">
                    {t("drawer.aiCategory")}
                  </span>
                  <Badge tone="purple">{aiTag.category}</Badge>
                </div>
              )}
              {aiTag.tags && aiTag.tags.length > 0 && (
                <div className="flex items-start gap-3">
                  <Tags size={12} className="mt-1 shrink-0 text-g-ink-4" />
                  <div className="flex flex-wrap gap-1">
                    {aiTag.tags.map((tag) => (
                      <Badge key={tag} tone="line" className="text-g-ink-2">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {aiTag.description && (
            <div className="rounded-g-md bg-g-surface-2 px-3 py-2.5">
              <p className="font-g text-g-body leading-[1.6] text-g-ink-2">
                {aiTag.description}
              </p>
            </div>
          )}

          {aiTag.languages && aiTag.languages.length > 0 && (
            <div className="flex items-center gap-2">
              <Globe size={12} className="shrink-0 text-g-ink-4" />
              <div className="flex flex-wrap gap-1">
                {aiTag.languages.map((lang) => (
                  <Badge key={lang} tone="line">
                    {lang}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <AIMeta
            modelName={aiTag.modelName}
            durationMs={aiTag.durationMs}
            updatedAt={aiTag.updatedAt}
          />
        </section>
      )}

      {hasAiTag && hasVlmOcr && <hr className="border-g-line" />}

      {hasVlmOcr && (
        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <ScanText size={14} className="text-g-purple" />
            <h3 className="font-g text-g-ui font-[590] text-g-ink">
              {t("drawer.aiSection.ocr")}
            </h3>
          </div>

          {ocr.text ? (
            <div className="rounded-g-md border border-g-line bg-g-surface-2 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <FileText size={11} className="text-g-ink-4" />
                  <span className="font-g text-[10px] font-[590] uppercase tracking-[0.08em] text-g-ink-4">
                    {t("ocr.badge.shortAI")}
                  </span>
                </div>
                <CopyButton value={ocr.text} label="Copy OCR text" />
              </div>
              <p className="whitespace-pre-wrap font-g-mono text-g-ui leading-[1.6] text-g-ink">
                {ocr.text}
              </p>
            </div>
          ) : ocr.emptyText ? (
            <p className="font-g text-g-caption text-g-ink-3">
              {t("assetDrawer.ocrEmptyText")}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {(ocr.languages ?? []).map((lang) => (
              <div key={lang} className="flex items-center gap-1">
                <Globe size={11} className="text-g-ink-4" />
                <Badge tone="line">{lang}</Badge>
              </div>
            ))}
            {(ocr.scripts ?? []).map((script) => (
              <Badge key={script} tone="blue">
                {script}
              </Badge>
            ))}
          </div>

          <AIMeta
            modelName={ocr.modelName}
            durationMs={ocr.durationMs}
            updatedAt={ocr.updatedAt}
          />
        </section>
      )}
    </div>
  );
}

function AIMeta({
  modelName,
  durationMs,
  updatedAt,
}: {
  modelName?: string;
  durationMs?: number;
  updatedAt?: string;
}) {
  const { t } = useTranslation();
  const hasMeta = modelName || durationMs != null || updatedAt;
  if (!hasMeta) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-g text-[11px] text-g-ink-4">
      {durationMs != null && (
        <Tooltip label={t("drawer.aiDuration")} placement="top">
          <span className="inline-flex items-center gap-1">
            <Timer size={11} />
            {(durationMs / 1000).toFixed(1)}s
          </span>
        </Tooltip>
      )}
      {modelName && (
        <span className="truncate font-g-mono text-[10px]">{modelName}</span>
      )}
      {updatedAt && <span>{new Date(updatedAt).toLocaleString()}</span>}
    </div>
  );
}
