import {
  FolderPlus,
  ImageDown,
  RefreshCw,
  ScanText,
  Search,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ScanEvent } from "../types";
import {
  canDismissOptimizeActivity,
  isOptimizeActivityBusy,
  isOptimizeActivityVisible,
  optimizeActivityProgressPercent,
  type OptimizeActivityState,
} from "../optimizeActivity";
import {
  canDismissOCRActivity,
  isOCRActivityBusy,
  isOCRActivityVisible,
  ocrActivityProgressPercent,
  type OCRActivityState,
} from "../ocrActivity";
import { ActivityDropdown } from "./ActivityDropdown";
import { Keycap, ScanProgressContent, TextInputButton, Tooltip } from "./ui";
import { IconButton } from "./ui/Button";

type Props = {
  working: boolean;
  catalogActionsDisabled?: boolean;
  scanProgress?: ScanEvent | null;
  ocrActivity: OCRActivityState;
  optimizeActivity: OptimizeActivityState;
  onAddProject: () => void;
  onRefresh: () => void;
  onOpenCmdK?: () => void;
  onStopOCR: () => void;
  onDismissOCR: () => void;
  onOpenOCRSettings: () => void;
  onStopOptimize: () => void;
  onDismissOptimize: () => void;
  onOpenOptimize: () => void;
};

export function AppTopbar({
  working,
  catalogActionsDisabled = working,
  scanProgress,
  ocrActivity,
  optimizeActivity,
  onAddProject,
  onRefresh,
  onOpenCmdK,
  onStopOCR,
  onDismissOCR,
  onOpenOCRSettings,
  onStopOptimize,
  onDismissOptimize,
  onOpenOptimize,
}: Props) {
  const { t } = useTranslation();
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
  const catalogActionTooltip = ocrBusy
    ? t("activity.ocrLockedTooltip")
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
            <div className="mt-[3px] truncate text-[9.5px] font-[510] uppercase tracking-[0.08em] text-g-ink-4">
              {t("nav.brandTag")}
            </div>
          </div>
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
            showIndeterminate
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
