import {
  CheckCircle2,
  FolderPlus,
  Loader2,
  RefreshCw,
  ScanText,
  Search,
  Square,
  X,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ScanEvent } from "../types";
import {
  canDismissOCRActivity,
  isOCRActivityBusy,
  isOCRActivityVisible,
  ocrActivityProgressPercent,
  type OCRActivityState,
} from "../ocrActivity";
import { Button, Keycap, TextInputButton, Tooltip } from "./ui";
import { IconButton } from "./ui/Button";

type Props = {
  working: boolean;
  catalogActionsDisabled?: boolean;
  scanProgress?: ScanEvent | null;
  ocrActivity: OCRActivityState;
  onAddProject: () => void;
  onRefresh: () => void;
  onOpenCmdK?: () => void;
  onStopOCR: () => void;
  onDismissOCR: () => void;
  onOpenOCRSettings: () => void;
};

export function AppTopbar({
  working,
  catalogActionsDisabled = working,
  scanProgress,
  ocrActivity,
  onAddProject,
  onRefresh,
  onOpenCmdK,
  onStopOCR,
  onDismissOCR,
  onOpenOCRSettings,
}: Props) {
  const { t } = useTranslation();
  const [scanStatusOpen, setScanStatusOpen] = useState(false);
  const [ocrStatusOpen, setOCRStatusOpen] = useState(false);
  const progress = scanProgress?.type === "progress" ? scanProgress : null;
  const done = scanProgress?.type === "done";
  const failed = scanProgress?.type === "error";
  const progressTotal = progress?.total ?? 0;
  const progressCurrent = progress?.current ?? 0;
  const progressPercent =
    done || failed
      ? 100
      : progress && progressTotal > 0
        ? Math.min(100, Math.max(0, (progressCurrent / progressTotal) * 100))
        : 0;
  const progressLabel = done
    ? t("scanProgress.complete")
    : failed
      ? t("error.scan")
      : progress
        ? t(`scanProgress.phase.${progress.phase}`)
        : t("scanProgress.starting");
  const scanDropdownState = scanStatusOpen
    ? "translate-y-0 opacity-100"
    : "translate-y-1 opacity-0";
  const ocrVisible = isOCRActivityVisible(ocrActivity);
  const ocrBusy = isOCRActivityBusy(ocrActivity);
  const ocrCanDismiss = canDismissOCRActivity(ocrActivity);
  const ocrFailed = ocrActivity.phase === "error";
  const ocrDone = ocrActivity.phase === "done";
  const ocrStopped = ocrActivity.phase === "stopped";
  const ocrDotTone = ocrFailed
    ? "bg-g-red"
    : ocrDone
      ? "bg-g-green"
      : "bg-g-accent";
  const ocrProgressPercent = ocrActivityProgressPercent(ocrActivity);
  const ocrDropdownState = ocrStatusOpen
    ? "translate-y-0 opacity-100 pointer-events-auto"
    : "translate-y-1 opacity-0";
  const ocrStatusLabel =
    ocrActivity.phase === "saving"
      ? t("activity.ocrSaving")
      : ocrActivity.phase === "running"
        ? t("activity.ocrRunning", { batch: ocrActivity.batch })
        : ocrActivity.phase === "stopping"
          ? t("activity.ocrStopping")
          : ocrDone
            ? t("activity.ocrDone")
            : ocrStopped
              ? t("activity.ocrStopped")
              : ocrFailed
                ? t("activity.ocrError")
                : t("activity.ocrTitle");
  const ocrCounts = ocrActivity.counts
    ? t("activity.ocrCounts", {
        processed: ocrActivity.counts.processed,
        ready: ocrActivity.counts.ready,
        failed: ocrActivity.counts.failed,
        skipped: ocrActivity.counts.skipped,
        cacheHit: ocrActivity.counts.cacheHit,
      })
    : t("activity.ocrPreparing");
  const catalogActionTooltip = ocrBusy
    ? t("activity.ocrLockedTooltip")
    : undefined;

  function onScanClick() {
    setScanStatusOpen(true);
    onRefresh();
  }

  return (
    <header className="relative z-10 flex h-[60px] min-w-0 shrink-0 items-center justify-between gap-2.5 bg-transparent px-5 max-[480px]:px-3">
      <div className="relative z-10 flex min-w-0 flex-1 basis-0 items-center pr-4">
        <div className="flex w-[220px] shrink-0 items-center gap-3 max-[960px]:w-[52px] max-[960px]:justify-center max-[960px]:gap-0">
          <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-g-md bg-g-surface shadow-g-sm">
            <img
              className="block size-full origin-center scale-[1.22]"
              src="/brand/asset-studio-app-icon.png"
              alt=""
            />
          </div>
          <div className="min-w-0 max-[960px]:hidden">
            <div className="truncate font-g-display text-[15px] font-[590] leading-[1.1] tracking-[-0.013em] text-g-ink">
              Asset Studio
            </div>
            <div className="mt-0.5 truncate text-[10px] font-[510] uppercase tracking-[0.06em] text-g-ink-3">
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
          <Tooltip
            label={catalogActionTooltip ?? t("action.rescan")}
            placement="bottom"
            disabled={!catalogActionTooltip}
          >
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
                className={`pointer-events-none absolute right-0 top-[calc(100%+8px)] z-[60] w-[280px] rounded-g-lg border border-g-line bg-g-surface-2 p-3 text-g-ui text-g-ink-2 shadow-g-pop transition-[opacity,transform] duration-[120ms] ease-g group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 ${scanDropdownState}`}
                role={failed ? "alert" : "status"}
                aria-live={failed ? "assertive" : "polite"}
              >
                <div className="flex items-center gap-2">
                  {done ? (
                    <CheckCircle2
                      className="shrink-0 text-g-green"
                      size={16}
                      aria-hidden="true"
                    />
                  ) : failed ? (
                    <XCircle
                      className="shrink-0 text-g-red"
                      size={16}
                      aria-hidden="true"
                    />
                  ) : (
                    <Loader2
                      className="shrink-0 animate-spin text-g-accent"
                      size={16}
                      aria-hidden="true"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate font-[590] text-g-ink">
                    {progressLabel}
                  </span>
                  {progress && progressTotal > 0 && (
                    <span className="font-g-mono text-[11px] tracking-[-0.015em] text-g-ink-3 tabular-nums">
                      {progressCurrent}/{progressTotal}
                    </span>
                  )}
                </div>
                {(done || failed || (progress && progressTotal > 0)) && (
                  <span
                    className="mt-2 block h-1.5 overflow-hidden rounded-g-pill bg-g-surface-3"
                    aria-hidden="true"
                  >
                    <span
                      className={
                        done
                          ? "block h-full rounded-g-pill bg-g-green transition-[width] duration-150 ease-g"
                          : failed
                            ? "block h-full rounded-g-pill bg-g-red transition-[width] duration-150 ease-g"
                            : "block h-full rounded-g-pill bg-g-accent transition-[width] duration-150 ease-g"
                      }
                      style={{ width: `${progressPercent}%` }}
                    />
                  </span>
                )}
              </div>
            </span>
          </Tooltip>
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
        {ocrVisible && (
          <span className="group relative inline-flex">
            <IconButton
              aria-label={t("activity.ocrTitle")}
              active={ocrStatusOpen}
              onClick={() => setOCRStatusOpen((open) => !open)}
            >
              <ScanText size={16} />
              <span className="absolute right-1 top-1 size-1.5" aria-hidden>
                {ocrBusy && (
                  <span
                    className={`absolute inset-0 rounded-g-pill opacity-75 motion-reduce:animate-none ${ocrDotTone} animate-ping`}
                  />
                )}
                <span
                  className={`absolute inset-0 rounded-g-pill ${ocrDotTone}`}
                />
              </span>
            </IconButton>
            <div
              className={`pointer-events-none absolute right-0 top-[calc(100%+8px)] z-[60] w-[320px] rounded-g-lg border border-g-line bg-g-surface-2 p-3 text-g-ui text-g-ink-2 shadow-g-pop transition-[opacity,transform] duration-[120ms] ease-g group-hover:translate-y-0 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100 group-focus-within:pointer-events-auto ${ocrDropdownState}`}
              role={ocrFailed ? "alert" : "status"}
              aria-live={ocrFailed ? "assertive" : "polite"}
            >
              <div className="flex items-center gap-2">
                {ocrDone ? (
                  <CheckCircle2
                    className="shrink-0 text-g-green"
                    size={16}
                    aria-hidden="true"
                  />
                ) : ocrFailed ? (
                  <XCircle
                    className="shrink-0 text-g-red"
                    size={16}
                    aria-hidden="true"
                  />
                ) : ocrStopped ? (
                  <Square
                    className="shrink-0 text-g-ink-3"
                    size={16}
                    aria-hidden="true"
                  />
                ) : (
                  <Loader2
                    className="shrink-0 animate-spin text-g-accent"
                    size={16}
                    aria-hidden="true"
                  />
                )}
                <span className="min-w-0 flex-1 truncate font-[590] text-g-ink">
                  {ocrStatusLabel}
                </span>
              </div>
              <p className="mt-1.5 font-g-mono text-[11px] tracking-g-mono text-g-ink-3 tabular-nums">
                {ocrCounts}
              </p>
              {ocrActivity.errorMessage && (
                <p className="mt-2 rounded-g-md border border-g-line bg-g-surface px-2 py-1.5 text-g-caption leading-[1.45] text-g-red">
                  {ocrActivity.errorMessage}
                </p>
              )}
              <span
                className="mt-2 block h-1.5 overflow-hidden rounded-g-pill bg-g-surface-3"
                aria-hidden="true"
              >
                <span
                  className={
                    ocrFailed
                      ? "block h-full rounded-g-pill bg-g-red transition-[width] duration-150 ease-g"
                      : ocrDone
                        ? "block h-full rounded-g-pill bg-g-green transition-[width] duration-150 ease-g"
                        : "block h-full rounded-g-pill bg-g-accent transition-[width] duration-150 ease-g"
                  }
                  style={{ width: `${ocrProgressPercent}%` }}
                />
              </span>
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={onOpenOCRSettings}
                >
                  {t("activity.viewOCRSettings")}
                </Button>
                {ocrBusy ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    leadingIcon={<Square size={13} />}
                    onClick={onStopOCR}
                    disabled={
                      ocrActivity.phase === "saving" ||
                      ocrActivity.phase === "stopping"
                    }
                  >
                    {ocrActivity.phase === "stopping"
                      ? t("settings.ocrStopping")
                      : t("settings.ocrStop")}
                  </Button>
                ) : ocrCanDismiss ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    leadingIcon={<X size={13} />}
                    onClick={onDismissOCR}
                  >
                    {t("activity.dismiss")}
                  </Button>
                ) : null}
              </div>
            </div>
          </span>
        )}
      </div>
    </header>
  );
}
