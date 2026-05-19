import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import {
  Check,
  FileText,
  Globe,
  Loader2,
  MapPin,
  ScanText,
  Tags,
  Timer,
  User,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import type { AssetItem } from "@/types";
import { getCatalogItemDetail, runAITagging, runVLMOcr } from "@/api";
import { catalogQueryKey } from "@/queries";
import {
  useAssetDescriptionMutation,
  useAssetOcrTextMutation,
} from "@/tagsQueries";
import { errorMessage } from "@/i18n";
import { AiChipIcon } from "@/components/ui/AiChipIcon";
import { Badge, Button, CopyButton, Textarea, Tooltip } from "@/components/ui";
import { useToast } from "@/components/shared/ToastProvider";

type Props = {
  asset: AssetItem;
  scanId?: number;
  aiTag?: AssetItem["aiTag"];
  ocr?: AssetItem["ocr"];
  llmEnabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
};

export function AssetDrawerAI({
  asset,
  scanId,
  aiTag: aiTagProp,
  ocr: ocrProp,
  llmEnabled,
  onBusyChange,
}: Props) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tagging, setTagging] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [localAiTag, setLocalAiTag] = useState<AssetItem["aiTag"]>();
  const [localOcr, setLocalOcr] = useState<AssetItem["ocr"]>();
  const [editingDesc, setEditingDesc] = useState(false);
  const [editingOcr, setEditingOcr] = useState(false);

  const descMutation = useAssetDescriptionMutation();
  const ocrMutation = useAssetOcrTextMutation();

  const busy = tagging || ocrRunning;
  const editing = editingDesc || editingOcr;
  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);

  const aiTag = localAiTag ?? aiTagProp;
  const ocr = localOcr ?? ocrProp;
  const hasAiTag = aiTag && aiTag.status === "ready";
  const hasVlmOcr = ocr && ocr.status === "ready" && ocr.engineName === "vlm";

  const localeDesc = aiTag?.descriptionI18n?.[i18n.language];
  const displayDesc = localeDesc || aiTag?.description || "";
  const displayOcrText = ocr?.text ?? "";

  async function refreshItem() {
    try {
      const detail = await getCatalogItemDetail(scanId, asset.id);
      if (detail.item.aiTag) setLocalAiTag(detail.item.aiTag);
      if (detail.item.ocr) setLocalOcr(detail.item.ocr);
    } catch {
      // detail fetch failed — fall through to invalidate
    }
    queryClient.invalidateQueries({
      queryKey: catalogQueryKey,
      refetchType: "active",
    });
  }

  async function handleTag() {
    setTagging(true);
    try {
      await runAITagging({ assetIds: [asset.id] });
      await refreshItem();
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
      await refreshItem();
      toast.success(t("drawer.aiAction.ocrSuccess"));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setOcrRunning(false);
    }
  }

  async function handleSaveDescription(next: string) {
    try {
      await descMutation.mutateAsync({
        projectId: asset.projectId,
        repoPath: asset.repoPath,
        contentHash: asset.contentHash,
        hashAlgorithm: asset.hashAlgorithm,
        description: next,
      });
      setLocalAiTag((prev) => {
        const base = prev ?? aiTagProp;
        return {
          ...(base ?? {}),
          description: next,
          descriptionI18n: undefined,
          updatedAt: new Date().toISOString(),
          providerName: base?.providerName ?? "manual",
          modelName: base?.modelName ?? "user",
          status: "ready",
        } as AssetItem["aiTag"];
      });
      toast.success(t("drawer.aiEdit.descriptionSaved"));
      setEditingDesc(false);
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  }

  async function handleSaveOcr(next: string) {
    try {
      await ocrMutation.mutateAsync({
        projectId: asset.projectId,
        repoPath: asset.repoPath,
        contentHash: asset.contentHash,
        hashAlgorithm: asset.hashAlgorithm,
        text: next,
      });
      setLocalOcr((prev) => {
        const base = prev ?? ocrProp;
        return {
          ...(base ?? {}),
          text: next,
          emptyText: next.length === 0,
          engineName: base?.engineName ?? "vlm",
          status: "ready",
          updatedAt: new Date().toISOString(),
        } as AssetItem["ocr"];
      });
      toast.success(t("drawer.aiEdit.ocrSaved"));
      setEditingOcr(false);
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  }

  const runBtnCls =
    "inline-flex items-center gap-1.5 rounded-g-md px-2.5 py-1.5 font-g text-g-caption font-[590] text-g-purple transition-[background,color] duration-[120ms] ease-g hover:bg-g-purple/[0.08] disabled:opacity-[0.38] disabled:cursor-not-allowed";

  return (
    <div className="flex flex-col gap-5" key={asset.id}>
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
              <Tooltip
                label={editing ? t("drawer.aiEdit.busyTooltip") : ""}
                placement="top"
              >
                <button
                  type="button"
                  disabled={busy || editing}
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
              </Tooltip>
            )}
          </div>

          <EditableTextField
            value={displayDesc}
            placeholder={t("drawer.aiEdit.descriptionPlaceholder")}
            disabled={busy}
            saving={descMutation.isPending}
            editing={editingDesc}
            onEditStart={() => setEditingDesc(true)}
            onEditCancel={() => setEditingDesc(false)}
            onSave={handleSaveDescription}
            ariaLabel={t("drawer.aiSection.tag")}
            saveLabel={t("drawer.aiEdit.save")}
            cancelLabel={t("drawer.aiEdit.cancel")}
            saveHint={t("drawer.aiEdit.saveHint")}
            displayClassName="rounded-g-md bg-g-surface-2 px-3 py-2.5 font-g text-g-body leading-[1.6] text-g-ink-2 cursor-text border border-transparent hover:border-g-line"
            placeholderClassName="rounded-g-md bg-g-surface-2 px-3 py-2.5 font-g text-g-caption text-g-ink-4 cursor-text border border-transparent hover:border-g-line"
          />

          {hasAiTag && (
            <>
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
                providerName={aiTag.providerName}
                modelName={aiTag.modelName}
                durationMs={aiTag.durationMs}
                updatedAt={aiTag.updatedAt}
              />
            </>
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
              <Tooltip
                label={editing ? t("drawer.aiEdit.busyTooltip") : ""}
                placement="top"
              >
                <button
                  type="button"
                  disabled={busy || editing}
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
              </Tooltip>
            )}
          </div>

          <EditableTextField
            value={displayOcrText}
            placeholder={t("drawer.aiEdit.ocrPlaceholder")}
            disabled={busy}
            saving={ocrMutation.isPending}
            editing={editingOcr}
            onEditStart={() => setEditingOcr(true)}
            onEditCancel={() => setEditingOcr(false)}
            onSave={handleSaveOcr}
            ariaLabel={t("drawer.aiSection.ocr")}
            saveLabel={t("drawer.aiEdit.save")}
            cancelLabel={t("drawer.aiEdit.cancel")}
            saveHint={t("drawer.aiEdit.saveHint")}
            displayHeader={
              hasVlmOcr && ocr && ocr.text ? (
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <FileText size={11} className="text-g-ink-4" />
                    <span className="font-g text-[10px] font-[590] uppercase tracking-[0.08em] text-g-ink-4">
                      {t("ocr.badge.shortAI")}
                    </span>
                  </div>
                  <CopyButton value={ocr.text} label="Copy OCR text" />
                </div>
              ) : null
            }
            displayClassName="rounded-g-md border border-g-line bg-g-surface-2 p-3 font-g-mono text-g-ui leading-[1.6] text-g-ink cursor-text hover:border-g-line-strong"
            placeholderClassName="rounded-g-md border border-g-line bg-g-surface-2 p-3 font-g text-g-caption text-g-ink-4 cursor-text hover:border-g-line-strong"
            multilineMonospace
          />

          {hasVlmOcr && ocr && (
            <>
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
                providerName={ocr.providerName}
                modelName={ocr.modelName}
                durationMs={ocr.durationMs}
                updatedAt={ocr.updatedAt}
              />
            </>
          )}
        </section>
      )}
    </div>
  );
}

type EditableTextFieldProps = {
  value: string;
  placeholder: string;
  disabled?: boolean;
  saving?: boolean;
  editing: boolean;
  onEditStart: () => void;
  onEditCancel: () => void;
  onSave: (next: string) => Promise<void>;
  ariaLabel: string;
  saveLabel: string;
  cancelLabel: string;
  saveHint: string;
  displayHeader?: ReactNode;
  displayClassName: string;
  placeholderClassName: string;
  multilineMonospace?: boolean;
};

function EditableTextField({
  value,
  placeholder,
  disabled,
  saving,
  editing,
  onEditStart,
  onEditCancel,
  onSave,
  ariaLabel,
  saveLabel,
  cancelLabel,
  saveHint,
  displayHeader,
  displayClassName,
  placeholderClassName,
  multilineMonospace,
}: EditableTextFieldProps) {
  const [draft, setDraft] = useState(value);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function handleEditStart() {
    setDraft(value);
    onEditStart();
  }

  useEffect(() => {
    if (!editing) return;
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.select();
      }
    });
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    function handlePointerDown(e: PointerEvent) {
      const node = containerRef.current;
      if (node && e.target instanceof Node && !node.contains(e.target)) {
        onEditCancel();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [editing, onEditCancel]);

  function handleClickDisplay(e: MouseEvent) {
    if (disabled) return;
    if (
      e.target instanceof HTMLElement &&
      e.target.closest("[data-editable-skip]")
    ) {
      return;
    }
    handleEditStart();
  }

  async function commit() {
    if (saving) return;
    try {
      await onSave(draft);
    } catch {
      // parent handles toast; keep edit mode
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      onEditCancel();
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void commit();
    }
  }

  if (editing) {
    return (
      <div ref={containerRef} className="flex flex-col gap-2">
        <Textarea
          ref={textareaRef}
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label={ariaLabel}
          rows={4}
          className={
            multilineMonospace
              ? "font-g-mono text-g-ui leading-[1.6]"
              : "font-g text-g-body leading-[1.6]"
          }
        />
        <div className="flex items-center justify-between gap-2">
          <span className="font-g text-[11px] text-g-ink-4">{saveHint}</span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              disabled={saving}
              onClick={onEditCancel}
              leadingIcon={<X />}
            >
              {cancelLabel}
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="button"
              disabled={saving}
              onClick={() => void commit()}
              leadingIcon={
                saving ? <Loader2 className="animate-spin" /> : <Check />
              }
            >
              {saveLabel}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!value) {
    return (
      <div
        ref={containerRef}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        onClick={handleClickDisplay}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleEditStart();
          }
        }}
        className={`${placeholderClassName} ${disabled ? "opacity-[0.38] cursor-not-allowed" : ""}`}
      >
        {placeholder}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      onClick={handleClickDisplay}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEditStart();
        }
      }}
      className={`${displayClassName} ${disabled ? "opacity-[0.38] cursor-not-allowed" : ""}`}
    >
      {displayHeader ? <div data-editable-skip>{displayHeader}</div> : null}
      <p className={multilineMonospace ? "whitespace-pre-wrap" : ""}>{value}</p>
    </div>
  );
}

function AIMeta({
  providerName,
  modelName,
  durationMs,
  updatedAt,
}: {
  providerName?: string;
  modelName?: string;
  durationMs?: number;
  updatedAt?: string;
}) {
  const { t } = useTranslation();
  const hasMeta = providerName || modelName || durationMs != null || updatedAt;
  if (!hasMeta) return null;

  const providerModel =
    providerName && modelName
      ? `${providerName} / ${modelName}`
      : providerName || modelName;

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
      {providerModel && (
        <span className="truncate font-g-mono text-[10px]">
          {providerModel}
        </span>
      )}
      {updatedAt && <span>{new Date(updatedAt).toLocaleString()}</span>}
    </div>
  );
}
