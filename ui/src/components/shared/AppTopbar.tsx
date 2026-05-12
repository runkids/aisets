import {
  FolderPlus,
  ImageDown,
  Languages,
  RefreshCw,
  ScanText,
  Search,
  Settings,
  Waypoints,
} from "lucide-react";
import { AiChipIcon } from "../ui/AiChipIcon";
import { useTranslation } from "react-i18next";
import type { ScanEvent } from "../../types";
import {
  aiTagActivityProgressPercent,
  canDismissAITagActivity,
  isAITagActivityBusy,
  isAITagActivityVisible,
  type AITagActivityPhase,
  type AITagActivityState,
} from "../../activity/aiTagActivity";
import {
  canDismissOptimizeActivity,
  isOptimizeActivityBusy,
  isOptimizeActivityVisible,
  optimizeActivityProgressPercent,
  type OptimizeActivityState,
} from "../../activity/optimizeActivity";
import {
  canDismissOCRActivity,
  isOCRActivityBusy,
  isOCRActivityVisible,
  ocrActivityProgressPercent,
  type OCRActivityState,
} from "../../activity/ocrActivity";
import {
  canDismissVLMOcrActivity,
  isVLMOcrActivityBusy,
  isVLMOcrActivityVisible,
  vlmOcrActivityProgressPercent,
  type VLMOcrActivityPhase,
  type VLMOcrActivityState,
} from "../../activity/vlmOcrActivity";
import {
  canDismissEmbedActivity,
  isEmbedActivityBusy,
  isEmbedActivityVisible,
  embedActivityProgressPercent,
  type EmbedActivityPhase,
  type EmbedActivityState,
} from "../../activity/embedActivity";
import {
  canDismissTranslateActivity,
  isTranslateActivityBusy,
  isTranslateActivityVisible,
  translateActivityProgressPercent,
  type TranslateActivityState,
} from "../../activity/translateActivity";
import { ActivityDropdown } from "./ActivityDropdown";
import { Keycap, ScanProgressContent, TextInputButton, Tooltip } from "../ui";
import { IconButton } from "../ui/Button";
import { useVersionQuery } from "../../queries";

function embedStageLabel(
  activity: EmbedActivityState,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  switch (activity.stage) {
    case "loading":
      return t("activity.embedPhaseLoading");
    case "filtering":
      return activity.stageTotal
        ? t("activity.embedPhaseFiltering", { total: activity.stageTotal })
        : t("activity.embedPhaseFilteringSimple");
    case "translating":
      if (activity.translating) {
        return t("activity.embedPhaseTranslating", {
          translated: activity.translating.translated,
          total: activity.translating.total,
        });
      }
      return t("activity.embedPhaseTranslatingSimple");
    default:
      return t("activity.embedPhasePreparing");
  }
}

type Props = {
  working: boolean;
  catalogActionsDisabled?: boolean;
  scanProgress?: ScanEvent | null;
  ocrActivity: OCRActivityState;
  aiTagActivity: AITagActivityState;
  vlmOcrActivity: VLMOcrActivityState;
  embedActivity: EmbedActivityState;
  translateActivity: TranslateActivityState;
  optimizeActivity: OptimizeActivityState;
  onAddProject: () => void;
  onRefresh: () => void;
  onOpenCmdK?: () => void;
  onStopOCR: () => void;
  onDismissOCR: () => void;
  onOpenOCRSettings: () => void;
  onStopAITag: () => void;
  onDismissAITag: () => void;
  onStopVLMOcr: () => void;
  onDismissVLMOcr: () => void;
  onStopEmbed: () => void;
  onDismissEmbed: () => void;
  onStopTranslate: () => void;
  onDismissTranslate: () => void;
  onOpenAISettings: () => void;
  onStopOptimize: () => void;
  onDismissOptimize: () => void;
  onOpenOptimize: () => void;
  onOpenSettings: () => void;
};

export function AppTopbar({
  working,
  catalogActionsDisabled = working,
  scanProgress,
  ocrActivity,
  aiTagActivity,
  vlmOcrActivity,
  embedActivity,
  translateActivity,
  optimizeActivity,
  onAddProject,
  onRefresh,
  onOpenCmdK,
  onStopOCR,
  onDismissOCR,
  onOpenOCRSettings,
  onStopAITag,
  onDismissAITag,
  onStopVLMOcr,
  onDismissVLMOcr,
  onStopEmbed,
  onDismissEmbed,
  onStopTranslate,
  onDismissTranslate,
  onOpenAISettings,
  onStopOptimize,
  onDismissOptimize,
  onOpenOptimize,
  onOpenSettings,
}: Props) {
  const { t } = useTranslation();
  const versionQuery = useVersionQuery();
  const version = versionQuery.data?.currentVersion;
  const failed = scanProgress?.type === "error";
  const ocrVisible = isOCRActivityVisible(ocrActivity);
  const ocrBusy = isOCRActivityBusy(ocrActivity);
  const ocrStatusLabels: Record<string, string> = {
    saving: t("activity.ocrSaving"),
    running: t("activity.ocrRunning", { batch: ocrActivity.batch }),
    stopping: t("activity.ocrStopping"),
    done: t("activity.ocrDone"),
    stopped: t("activity.ocrStopped"),
    error: t("activity.ocrError"),
  };
  const ocrStatusLabel =
    ocrStatusLabels[ocrActivity.phase] ?? t("activity.ocrTitle");
  const ocrCounts = ocrActivity.counts
    ? t("activity.ocrCounts", {
        processed: ocrActivity.counts.processed,
        ready: ocrActivity.counts.ready,
        failed: ocrActivity.counts.failed,
        skipped: ocrActivity.counts.skipped,
        cacheHit: ocrActivity.counts.cacheHit,
        dedup: ocrActivity.counts.dedup,
      })
    : t("activity.ocrPreparing");
  const optimizeVisible = isOptimizeActivityVisible(optimizeActivity);
  const optimizeBusy = isOptimizeActivityBusy(optimizeActivity);
  const optimizeStatusLabels: Record<string, string> = {
    running:
      optimizeActivity.stage === "previewing"
        ? t("activity.optimizePreviewing")
        : t("activity.optimizeRunning"),
    stopping: t("activity.optimizeStopping"),
    done: t("activity.optimizeDone"),
    stopped: t("activity.optimizeStopped"),
    error: t("activity.optimizeError"),
  };
  const optimizeStatusLabel =
    optimizeStatusLabels[optimizeActivity.phase] ?? t("activity.optimizeTitle");
  const optimizeCounts = optimizeActivity.counts
    ? t("activity.optimizeCounts", {
        processed: optimizeActivity.counts.processed,
        total: optimizeActivity.counts.total,
        applicable: optimizeActivity.counts.applicable,
        blocked: optimizeActivity.counts.blocked,
      })
    : t("activity.optimizePreparing");
  const aiTagVisible = isAITagActivityVisible(aiTagActivity);
  const aiTagBusy = isAITagActivityBusy(aiTagActivity);
  const aiTagStatusLabels: Partial<Record<AITagActivityPhase, string>> = {
    saving: t("activity.aiTagSaving"),
    running: t("activity.aiTagRunning"),
    stopping: t("activity.aiTagStopping"),
    done: t("activity.aiTagDone"),
    stopped: t("activity.aiTagStopped"),
    error: t("activity.aiTagError"),
  };
  const aiTagStatusLabel =
    aiTagStatusLabels[aiTagActivity.phase] ?? t("activity.aiTagTitle");
  const aiTagCounts = aiTagActivity.counts
    ? t("activity.aiTagCounts", {
        processed: aiTagActivity.counts.processed,
        ready: aiTagActivity.counts.ready,
        failed: aiTagActivity.counts.failed,
        skipped: aiTagActivity.counts.skipped,
        cacheHit: aiTagActivity.counts.cacheHit,
        dedup: aiTagActivity.counts.dedup,
      })
    : t("activity.aiTagPreparing");
  const vlmOcrVisible = isVLMOcrActivityVisible(vlmOcrActivity);
  const vlmOcrBusy = isVLMOcrActivityBusy(vlmOcrActivity);
  const vlmOcrStatusLabels: Partial<Record<VLMOcrActivityPhase, string>> = {
    saving: t("activity.aiOcrSaving"),
    running: t("activity.aiOcrRunning"),
    stopping: t("activity.aiOcrStopping"),
    done: t("activity.aiOcrDone"),
    stopped: t("activity.aiOcrStopped"),
    error: t("activity.aiOcrError"),
  };
  const vlmOcrStatusLabel =
    vlmOcrStatusLabels[vlmOcrActivity.phase] ?? t("activity.aiOcrTitle");
  const vlmOcrCounts = vlmOcrActivity.counts
    ? t("activity.aiOcrCounts", {
        processed: vlmOcrActivity.counts.processed,
        ready: vlmOcrActivity.counts.ready,
        failed: vlmOcrActivity.counts.failed,
        skipped: vlmOcrActivity.counts.skipped,
        cacheHit: vlmOcrActivity.counts.cacheHit,
        dedup: vlmOcrActivity.counts.dedup,
      })
    : t("activity.aiOcrPreparing");
  const embedVisible = isEmbedActivityVisible(embedActivity);
  const embedBusy = isEmbedActivityBusy(embedActivity);
  const embedStatusLabels: Partial<Record<EmbedActivityPhase, string>> = {
    running: t("activity.embedRunning"),
    stopping: t("activity.embedStopping"),
    done: t("activity.embedDone"),
    stopped: t("activity.embedStopped"),
    error: t("activity.embedError"),
  };
  const embedStatusLabel =
    embedStatusLabels[embedActivity.phase] ?? t("activity.embedTitle");
  const embedCounts = embedActivity.counts
    ? t("activity.embedCounts", {
        processed: embedActivity.counts.processed,
        ready: embedActivity.counts.ready,
        failed: embedActivity.counts.failed,
        skipped: embedActivity.counts.skipped,
      })
    : embedStageLabel(embedActivity, t);
  const translateVisible = isTranslateActivityVisible(translateActivity);
  const translateBusy = isTranslateActivityBusy(translateActivity);
  const translateStatusLabel = translateBusy
    ? translateActivity.locale
      ? t("activity.translateRunningLocale", { locale: translateActivity.locale })
      : t("activity.translateRunning")
    : translateActivity.phase === "done"
      ? translateActivity.skipped > 0 || translateActivity.warnings.length > 0
        ? t("activity.translateDoneWithWarnings")
        : t("activity.translateDone")
      : translateActivity.phase === "error"
        ? t("activity.translateError")
        : translateActivity.phase === "stopped"
          ? t("activity.translateStopped")
          : t("activity.translateTitle");
  const translateCounts =
    translateActivity.total > 0
      ? translateBusy
        ? t("activity.translateLocaleCounts", {
            locale: translateActivity.locale ?? "",
            translated: translateActivity.translated,
            total: translateActivity.total,
          })
        : translateActivity.skipped > 0
          ? t("activity.translateCountsWithSkipped", {
              translated: translateActivity.translated,
              total: translateActivity.total,
              skipped: translateActivity.skipped,
            })
          : t("activity.translateCounts", {
              translated: translateActivity.translated,
              total: translateActivity.total,
            })
      : "";
  const translateLocaleList =
    translateActivity.locales.length > 0
      ? translateActivity.locales.join("、")
      : translateActivity.locale;
  const translateDetail =
    translateBusy && translateLocaleList
      ? t("activity.translateLocalesLabel", {
          locales: translateLocaleList,
        })
      : undefined;
  const translateWarnings = translateActivity.warnings.map((warning) => ({
    repoPath: "",
    message: warning,
  }));
  const catalogActionTooltip = ocrBusy
    ? t("activity.ocrLockedTooltip")
    : aiTagBusy
      ? t("activity.aiTagLockedTooltip")
      : embedBusy
        ? t("activity.embedLockedTooltip")
        : optimizeBusy
          ? t("activity.optimizeLockedTooltip")
          : undefined;

  function onScanClick() {
    onRefresh();
  }

  return (
    <header className="relative z-10 flex h-[60px] min-w-0 shrink-0 items-center justify-between gap-2.5 bg-transparent px-5 max-[480px]:px-3">
      <div className="relative z-10 flex min-w-0 flex-1 basis-0 items-center pr-4">
        <div className="flex w-[220px] shrink-0 items-center gap-3 max-[960px]:w-[52px] max-[960px]:justify-center max-[960px]:gap-0">
          <a
            href="https://github.com/runkids/aisets"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-g-sm transition-opacity duration-[120ms] ease-g hover:opacity-70 focus-visible:outline-none focus-visible:shadow-g-focus"
            aria-label="Aisets on GitHub"
          >
            <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-black shadow-g-sm">
              <img
                className="block size-full"
                src="../../public/brand/aisets-app-icon.avif"
                alt=""
              />
            </div>
            <div className="min-w-0 max-[960px]:hidden">
              <div className="truncate font-g-display text-[17px] font-[620] leading-[1.1] tracking-[-0.02em] text-g-ink">
                Aisets
              </div>
              {version && (
                <div className="mt-[3px] truncate font-g-mono text-[10px] text-g-ink-4">
                  v{version}
                </div>
              )}
            </div>
          </a>
        </div>
      </div>

      <div className="pointer-events-none absolute top-1/2 left-1/2 z-20 w-[min(520px,42vw)] -translate-x-1/2 -translate-y-1/2 max-[1180px]:static max-[1180px]:z-10 max-[1180px]:w-[min(360px,36vw)] max-[1180px]:translate-x-0 max-[1180px]:translate-y-0 max-[680px]:min-w-0 max-[680px]:flex-1 max-[680px]:basis-0">
        <TextInputButton
          className="pointer-events-auto w-full shadow-g-sm"
          icon={<Search size={14} aria-hidden="true" />}
          suffix={
            <span className="max-[680px]:hidden">
              <Keycap>⌘ P</Keycap>
            </span>
          }
          value={t("search.placeholderShort")}
          onClick={onOpenCmdK}
          aria-label={t("search.ariaLabel")}
        />
      </div>

      <div className="relative z-10 flex flex-1 basis-0 items-center justify-end gap-1 pl-4">
        <Tooltip label={t("nav.settings")} placement="bottom">
          <span className="inline-flex">
            <IconButton aria-label={t("nav.settings")} onClick={onOpenSettings}>
              <Settings size={16} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip
          label={catalogActionTooltip ?? t("action.addProject")}
          placement="bottom"
        >
          <span className="inline-flex">
            <IconButton
              aria-label={t("action.addProject")}
              onClick={onAddProject}
              disabled={catalogActionsDisabled}
            >
              <FolderPlus size={16} />
            </IconButton>
          </span>
        </Tooltip>
        {scanProgress ? (
          <span className="group relative inline-flex">
            <IconButton
              aria-label={t("action.rescan")}
              data-loading={working || undefined}
              onClick={onScanClick}
              disabled={catalogActionsDisabled}
            >
              <RefreshCw size={16} />
            </IconButton>
            <div
              className="pointer-events-none absolute right-0 top-[calc(100%+8px)] z-[60] w-[280px] translate-y-1 rounded-g-lg border border-g-line bg-g-surface-2 p-3 opacity-0 shadow-g-pop transition-[opacity,transform] duration-[120ms] ease-g group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100"
              role={failed ? "alert" : "status"}
              aria-live={failed ? "assertive" : "polite"}
            >
              <ScanProgressContent scanProgress={scanProgress} truncatePath />
            </div>
          </span>
        ) : (
          <Tooltip
            label={catalogActionTooltip ?? t("action.rescan")}
            placement="bottom"
          >
            <span className="inline-flex">
              <IconButton
                aria-label={t("action.rescan")}
                data-loading={working || undefined}
                onClick={onScanClick}
                disabled={catalogActionsDisabled}
              >
                <RefreshCw size={16} />
              </IconButton>
            </span>
          </Tooltip>
        )}
        {optimizeVisible && (
          <ActivityDropdown
            icon={<ImageDown size={16} />}
            ariaLabel={t("activity.optimizeTitle")}
            busy={optimizeBusy}
            done={optimizeActivity.phase === "done"}
            failed={optimizeActivity.phase === "error"}
            stopped={optimizeActivity.phase === "stopped"}
            canDismiss={canDismissOptimizeActivity(optimizeActivity)}
            statusLabel={optimizeStatusLabel}
            countsLabel={optimizeCounts}
            errorMessage={optimizeActivity.errorMessage}
            progressPercent={optimizeActivityProgressPercent(optimizeActivity)}
            startedAt={optimizeActivity.startedAt}
            primaryAction={{
              label: t("activity.viewOptimize"),
              onClick: onOpenOptimize,
            }}
            stopButton={
              optimizeBusy
                ? {
                    label:
                      optimizeActivity.phase === "stopping"
                        ? t("activity.optimizeStopping")
                        : t("activity.stopOptimize"),
                    onClick: onStopOptimize,
                    disabled: optimizeActivity.phase === "stopping",
                  }
                : undefined
            }
            onDismiss={onDismissOptimize}
          />
        )}
        {aiTagVisible && (
          <ActivityDropdown
            icon={<AiChipIcon size={16} />}
            ariaLabel={t("activity.aiTagTitle")}
            busy={aiTagBusy}
            done={aiTagActivity.phase === "done"}
            failed={aiTagActivity.phase === "error"}
            stopped={aiTagActivity.phase === "stopped"}
            canDismiss={canDismissAITagActivity(aiTagActivity)}
            statusLabel={aiTagStatusLabel}
            countsLabel={aiTagCounts}
            errorMessage={aiTagActivity.errorMessage}
            errors={aiTagActivity.errors}
            progressPercent={aiTagActivityProgressPercent(aiTagActivity)}
            startedAt={aiTagActivity.startedAt}
            primaryAction={{
              label: t("activity.viewAISettings"),
              onClick: onOpenAISettings,
            }}
            stopButton={
              aiTagBusy
                ? {
                    label:
                      aiTagActivity.phase === "stopping"
                        ? t("settings.aiTagStopping")
                        : t("settings.aiTagStop"),
                    onClick: onStopAITag,
                    disabled:
                      aiTagActivity.phase === "saving" ||
                      aiTagActivity.phase === "stopping",
                  }
                : undefined
            }
            onDismiss={onDismissAITag}
          />
        )}
        {vlmOcrVisible && (
          <ActivityDropdown
            icon={<ScanText size={16} />}
            ariaLabel={t("settings.aiOcrGroup")}
            busy={vlmOcrBusy}
            done={vlmOcrActivity.phase === "done"}
            failed={vlmOcrActivity.phase === "error"}
            stopped={vlmOcrActivity.phase === "stopped"}
            canDismiss={canDismissVLMOcrActivity(vlmOcrActivity)}
            statusLabel={vlmOcrStatusLabel}
            countsLabel={vlmOcrCounts}
            errorMessage={vlmOcrActivity.errorMessage}
            errors={vlmOcrActivity.errors}
            progressPercent={vlmOcrActivityProgressPercent(vlmOcrActivity)}
            startedAt={vlmOcrActivity.startedAt}
            primaryAction={{
              label: t("activity.viewAISettings"),
              onClick: onOpenAISettings,
            }}
            stopButton={
              vlmOcrBusy
                ? {
                    label:
                      vlmOcrActivity.phase === "stopping"
                        ? t("settings.aiOcrStopping")
                        : t("settings.aiOcrStop"),
                    onClick: onStopVLMOcr,
                    disabled:
                      vlmOcrActivity.phase === "saving" ||
                      vlmOcrActivity.phase === "stopping",
                  }
                : undefined
            }
            onDismiss={onDismissVLMOcr}
          />
        )}
        {embedVisible && (
          <ActivityDropdown
            icon={<Waypoints size={16} />}
            ariaLabel={t("activity.embedTitle")}
            busy={embedBusy}
            done={embedActivity.phase === "done"}
            failed={embedActivity.phase === "error"}
            stopped={embedActivity.phase === "stopped"}
            canDismiss={canDismissEmbedActivity(embedActivity)}
            statusLabel={embedStatusLabel}
            countsLabel={embedCounts}
            errorMessage={embedActivity.errorMessage}
            errors={embedActivity.errors}
            progressPercent={embedActivityProgressPercent(embedActivity)}
            startedAt={embedActivity.startedAt}
            primaryAction={{
              label: t("activity.viewAISettings"),
              onClick: onOpenAISettings,
            }}
            stopButton={
              embedBusy
                ? {
                    label:
                      embedActivity.phase === "stopping"
                        ? t("activity.embedStopping")
                        : t("settings.embedStop"),
                    onClick: onStopEmbed,
                    disabled: embedActivity.phase === "stopping",
                  }
                : undefined
            }
            onDismiss={onDismissEmbed}
          />
        )}
        {translateVisible && (
          <ActivityDropdown
            icon={<Languages size={16} />}
            ariaLabel={t("activity.translateTitle")}
            busy={translateBusy}
            done={translateActivity.phase === "done"}
            failed={translateActivity.phase === "error"}
            warning={
              translateActivity.phase === "done" &&
              (translateActivity.skipped > 0 ||
                translateActivity.warnings.length > 0)
            }
            stopped={translateActivity.phase === "stopped"}
            canDismiss={canDismissTranslateActivity(translateActivity)}
            statusLabel={translateStatusLabel}
            countsLabel={translateCounts}
            detailLabel={translateDetail}
            errorMessage={translateActivity.errorMessage}
            errors={translateWarnings.length > 0 ? translateWarnings : undefined}
            errorsLabel={
              translateWarnings.length > 0
                ? t("activity.warningCount", {
                    count: translateWarnings.length,
                  })
                : undefined
            }
            progressPercent={translateActivityProgressPercent(translateActivity)}
            startedAt={translateActivity.startedAt}
            primaryAction={{
              label: t("activity.viewAISettings"),
              onClick: onOpenAISettings,
            }}
            stopButton={
              translateBusy
                ? {
                    label:
                      translateActivity.phase === "stopping"
                        ? t("activity.translateStopping")
                        : t("activity.translateStop"),
                    onClick: onStopTranslate,
                    disabled: translateActivity.phase === "stopping",
                  }
                : undefined
            }
            onDismiss={onDismissTranslate}
          />
        )}
        {ocrVisible && (
          <ActivityDropdown
            icon={<ScanText size={16} />}
            ariaLabel={t("activity.ocrTitle")}
            busy={ocrBusy}
            done={ocrActivity.phase === "done"}
            failed={ocrActivity.phase === "error"}
            stopped={ocrActivity.phase === "stopped"}
            canDismiss={canDismissOCRActivity(ocrActivity)}
            statusLabel={ocrStatusLabel}
            countsLabel={ocrCounts}
            errorMessage={ocrActivity.errorMessage}
            progressPercent={ocrActivityProgressPercent(ocrActivity)}
            startedAt={ocrActivity.startedAt}
            primaryAction={{
              label: t("activity.viewOCRSettings"),
              onClick: onOpenOCRSettings,
            }}
            stopButton={
              ocrBusy
                ? {
                    label:
                      ocrActivity.phase === "stopping"
                        ? t("settings.ocrStopping")
                        : t("settings.ocrStop"),
                    onClick: onStopOCR,
                    disabled:
                      ocrActivity.phase === "saving" ||
                      ocrActivity.phase === "stopping",
                  }
                : undefined
            }
            onDismiss={onDismissOCR}
          />
        )}
      </div>
    </header>
  );
}
