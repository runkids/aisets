import {
  CheckCircle2,
  FolderPlus,
  Loader2,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ScanEvent } from "../types";
import { Keycap, TextInputButton, Tooltip } from "./ui";
import { IconButton } from "./ui/Button";

type Props = {
  working: boolean;
  scanProgress?: ScanEvent | null;
  onAddProject: () => void;
  onRefresh: () => void;
  onOpenCmdK?: () => void;
};

export function AppTopbar({
  working,
  scanProgress,
  onAddProject,
  onRefresh,
  onOpenCmdK,
}: Props) {
  const { t } = useTranslation();
  const [scanStatusOpen, setScanStatusOpen] = useState(false);
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

  function onScanClick() {
    setScanStatusOpen(true);
    onRefresh();
  }

  return (
    <header className="relative z-10 flex h-[60px] min-w-0 shrink-0 items-center justify-between gap-2.5 bg-transparent px-5">
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

      <div className="pointer-events-none absolute top-1/2 left-1/2 z-0 w-[min(520px,42vw)] -translate-x-1/2 -translate-y-1/2 max-[1180px]:static max-[1180px]:z-10 max-[1180px]:w-[min(360px,36vw)] max-[1180px]:translate-x-0 max-[1180px]:translate-y-0 max-[680px]:w-auto">
        <TextInputButton
          className="pointer-events-auto w-full shadow-g-sm max-[480px]:h-g-btn-md max-[480px]:w-g-btn-md max-[480px]:justify-center max-[480px]:px-0"
          icon={<Search size={14} aria-hidden="true" />}
          suffix={
            <span className="max-[480px]:hidden">
              <Keycap>⌘ P</Keycap>
            </span>
          }
          value={t("search.placeholderShort")}
          contentClassName="max-[480px]:hidden"
          onClick={onOpenCmdK}
          aria-label={t("search.ariaLabel")}
        />
      </div>

      <div className="relative z-10 flex flex-1 basis-0 items-center justify-end gap-1 pl-4">
        <Tooltip label={t("action.addProject")} placement="bottom">
          <IconButton
            aria-label={t("action.addProject")}
            onClick={onAddProject}
            disabled={working}
          >
            <FolderPlus size={16} />
          </IconButton>
        </Tooltip>
        {scanProgress ? (
          <span className="group relative inline-flex">
            <IconButton
              aria-label={t("action.rescan")}
              data-loading={working || undefined}
              onClick={onScanClick}
              disabled={working}
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
        ) : (
          <Tooltip label={t("action.rescan")} placement="bottom">
            <IconButton
              aria-label={t("action.rescan")}
              data-loading={working || undefined}
              onClick={onScanClick}
              disabled={working}
            >
              <RefreshCw size={16} />
            </IconButton>
          </Tooltip>
        )}
      </div>
    </header>
  );
}
