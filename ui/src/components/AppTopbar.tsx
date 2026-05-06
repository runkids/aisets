import {
  CheckCircle2,
  FileWarning,
  FolderKanban,
  FolderOpen,
  FolderPlus,
  Loader2,
  Recycle,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ScanEvent } from "../types";
import type { Mode } from "../ui";
import { titleForMode } from "../ui";
import { Keycap, TextInputButton, Tooltip } from "./ui";
import { IconButton } from "./ui/Button";

const MODE_ICON: Record<Mode, typeof FolderKanban> = {
  projects: FolderKanban,
  browse: FolderOpen,
  duplicates: Recycle,
  unused: Trash2,
  optimize: Sparkles,
  lint: FileWarning,
  precheck: ShieldCheck,
  settings: Settings,
};

type Props = {
  mode: Mode;
  totalLabel: string;
  working: boolean;
  scanProgress?: ScanEvent | null;
  onAddProject: () => void;
  onRefresh: () => void;
  onOpenCmdK?: () => void;
};

export function AppTopbar({
  mode,
  totalLabel,
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
    <header className="relative z-10 flex h-[60px] min-w-0 shrink-0 items-center gap-2.5 border-b border-g-line bg-[color-mix(in_srgb,var(--g-canvas)_85%,transparent)] px-5 backdrop-blur-[12px] backdrop-saturate-[160%]">
      <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
        <span
          className="inline-flex size-[26px] shrink-0 items-center justify-center rounded-g-md bg-g-surface-2 text-g-ink-2"
          aria-hidden="true"
        >
          {(() => {
            const Icon = MODE_ICON[mode];
            return <Icon size={16} />;
          })()}
        </span>
        <strong className="overflow-hidden text-ellipsis font-g-display text-[14px] font-[590] leading-[1.2] tracking-[-0.013em] text-g-ink">
          {titleForMode(mode)}
        </strong>
        {totalLabel && (
          <>
            <span
              className="shrink-0 select-none text-[14px] leading-none text-[var(--g-ink-5)] max-[600px]:hidden"
              aria-hidden="true"
            >
              ·
            </span>
            <span className="overflow-hidden text-ellipsis font-g-mono text-g-caption font-normal tracking-[-0.015em] text-g-ink-3 tabular-nums max-[600px]:hidden">
              {totalLabel}
            </span>
          </>
        )}
      </div>

      <div className="flex-1" />

      <TextInputButton
        className="w-[320px] max-w-[40vw] shrink-0"
        icon={<Search size={14} aria-hidden="true" />}
        suffix={<Keycap>⌘ P</Keycap>}
        value={t("search.placeholderShort")}
        onClick={onOpenCmdK}
        aria-label={t("search.ariaLabel")}
      />

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
    </header>
  );
}
