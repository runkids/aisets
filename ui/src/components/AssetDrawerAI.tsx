import { useState } from "react";
import {
  FileText,
  Globe,
  Loader2,
  MapPin,
  ScanText,
  Tags,
  Timer,
  User,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import type { AssetItem } from "../types";
import { runAITagging, runVLMOcr } from "../api";
import { catalogQueryKey } from "../queries";
import { errorMessage } from "../i18n";
import { AiChipIcon } from "./ui/AiChipIcon";
import { Badge, CopyButton, Tooltip } from "./ui";
import { useToast } from "./ToastProvider";

type Props = {
  asset: AssetItem;
  aiTag?: AssetItem["aiTag"];
  ocr?: AssetItem["ocr"];
  llmEnabled?: boolean;
};

export function AssetDrawerAI({ asset, aiTag, ocr, llmEnabled }: Props) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tagging, setTagging] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const hasAiTag = aiTag && aiTag.status === "ready";
  const hasVlmOcr = ocr && ocr.status === "ready" && ocr.engineName === "vlm";

  async function handleTag() {
    setTagging(true);
    try {
      await runAITagging({ assetIds: [asset.id] });
      await queryClient.invalidateQueries({ queryKey: catalogQueryKey });
      toast.success(t("drawer.aiAction.tagSuccess"));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setTagging(false);
    }
  }

  async function handleOcr() {
    setOcrRunning(true);
    try {
      await runVLMOcr({ assetIds: [asset.id] });
      await queryClient.invalidateQueries({ queryKey: catalogQueryKey });
      toast.success(t("drawer.aiAction.ocrSuccess"));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setOcrRunning(false);
    }
  }

  const runBtnCls =
    "inline-flex items-center gap-1 rounded-g-sm px-2 py-1 font-g text-[10px] font-[590] text-g-purple transition-[background,color] duration-[120ms] ease-g hover:bg-g-purple/[0.08] disabled:opacity-[0.38] disabled:cursor-not-allowed";

  return (
    <div className="flex flex-col gap-5 p-4">
      {(hasAiTag || llmEnabled) && (
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AiChipIcon size={14} className="text-g-purple" />
              <h3 className="font-g text-g-ui font-[590] text-g-ink">
                {t("drawer.aiSection.tag")}
              </h3>
            </div>
            {llmEnabled && (
              <button
                type="button"
                disabled={tagging}
                onClick={handleTag}
                className={runBtnCls}
                aria-label={t("drawer.aiAction.tag")}
              >
                {tagging ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Tags size={11} />
                )}
                <span>
                  {hasAiTag
                    ? t("drawer.aiAction.rerun")
                    : t("drawer.aiAction.tag")}
                </span>
              </button>
            )}
          </div>

          {hasAiTag ? (
            <>
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
                  {(() => {
                    const localeTags = aiTag.tagsI18n?.[i18n.language];
                    const displayTags =
                      localeTags && localeTags.length > 0
                        ? localeTags
                        : aiTag.tags;
                    return displayTags && displayTags.length > 0 ? (
                      <div className="flex items-start gap-3">
                        <Tags
                          size={12}
                          className="mt-1 shrink-0 text-g-ink-4"
                        />
                        <div className="flex flex-wrap gap-1">
                          {displayTags.map((tag, idx) => (
                            <Badge
                              key={`${tag}-${idx}`}
                              tone="line"
                              className="text-g-ink-2"
                            >
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : null;
                  })()}
                </div>
              </div>

              {(() => {
                const localeDesc = aiTag.descriptionI18n?.[i18n.language];
                const displayDesc = localeDesc || aiTag.description;
                return displayDesc ? (
                  <div className="rounded-g-md bg-g-surface-2 px-3 py-2.5">
                    <p className="font-g text-g-body leading-[1.6] text-g-ink-2">
                      {displayDesc}
                    </p>
                  </div>
                ) : null;
              })()}

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

              {(aiTag.containsFace != null ||
                aiTag.sceneType ||
                aiTag.estimatedLocation) && (
                <div className="flex flex-col gap-2">
                  {aiTag.containsFace != null && (
                    <div className="flex items-center gap-2">
                      <User size={12} className="shrink-0 text-g-ink-4" />
                      <Badge tone={aiTag.containsFace ? "blue" : "line"}>
                        {t(
                          aiTag.containsFace
                            ? "drawer.aiEnrich.faceDetected"
                            : "drawer.aiEnrich.noFace",
                        )}
                      </Badge>
                    </div>
                  )}
                  {aiTag.sceneType && (
                    <div className="flex items-center gap-2">
                      <MapPin size={12} className="shrink-0 text-g-ink-4" />
                      <Badge tone="line">{aiTag.sceneType}</Badge>
                    </div>
                  )}
                  {aiTag.estimatedLocation && (
                    <div className="flex items-center gap-2">
                      <MapPin size={12} className="shrink-0 text-g-ink-4" />
                      <span className="font-g text-g-caption text-g-ink-2">
                        {aiTag.estimatedLocation}
                      </span>
                      {aiTag.locationConfidence &&
                        aiTag.locationConfidence !== "none" && (
                          <Badge tone="line" className="text-g-ink-3">
                            {aiTag.locationConfidence}
                          </Badge>
                        )}
                    </div>
                  )}
                </div>
              )}

              <AIMeta
                modelName={aiTag.modelName}
                durationMs={aiTag.durationMs}
                updatedAt={aiTag.updatedAt}
              />
            </>
          ) : (
            <p className="font-g text-g-caption text-g-ink-4">
              {t("drawer.aiAction.tagHint")}
            </p>
          )}
        </section>
      )}

      {(hasAiTag || llmEnabled) && (hasVlmOcr || llmEnabled) && (
        <hr className="border-g-line" />
      )}

      {(hasVlmOcr || llmEnabled) && (
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ScanText size={14} className="text-g-purple" />
              <h3 className="font-g text-g-ui font-[590] text-g-ink">
                {t("drawer.aiSection.ocr")}
              </h3>
            </div>
            {llmEnabled && (
              <button
                type="button"
                disabled={ocrRunning}
                onClick={handleOcr}
                className={runBtnCls}
                aria-label={t("drawer.aiAction.ocr")}
              >
                {ocrRunning ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <ScanText size={11} />
                )}
                <span>
                  {hasVlmOcr
                    ? t("drawer.aiAction.rerun")
                    : t("drawer.aiAction.ocr")}
                </span>
              </button>
            )}
          </div>

          {hasVlmOcr && ocr ? (
            <>
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
            </>
          ) : (
            <p className="font-g text-g-caption text-g-ink-4">
              {t("drawer.aiAction.ocrHint")}
            </p>
          )}
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
