import {
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Loader2,
  Square,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ActivityError } from "../aiTagActivity";
import { Button } from "./ui";

function formatElapsed(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
import { IconButton } from "./ui/Button";

type ActivityDropdownProps = {
  icon: ReactNode;
  ariaLabel: string;
  busy: boolean;
  done: boolean;
  failed: boolean;
  stopped: boolean;
  canDismiss: boolean;
  statusLabel: string;
  countsLabel: string;
  errorMessage?: string;
  errors?: ActivityError[];
  progressPercent: number;
  showIndeterminate?: boolean;
  startedAt?: number;
  primaryAction: { label: string; onClick: () => void };
  stopButton?: { label: string; onClick: () => void; disabled?: boolean };
  onDismiss: () => void;
};

export function ActivityDropdown({
  icon,
  ariaLabel,
  busy,
  done,
  failed,
  stopped,
  canDismiss,
  statusLabel,
  countsLabel,
  errorMessage,
  errors,
  progressPercent,
  showIndeterminate = false,
  startedAt,
  primaryAction,
  stopButton,
  onDismiss,
}: ActivityDropdownProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [errorsExpanded, setErrorsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  // eslint-disable-next-line react-hooks/purity -- Date.now() as initial state is standard React
  const [now, setNow] = useState(Date.now());
  const [finalElapsedMs, setFinalElapsedMs] = useState<number | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!busy || !startedAt) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset timer on new activity
    setFinalElapsedMs(undefined);
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(id);
      setFinalElapsedMs(Date.now() - startedAt);
    };
  }, [busy, startedAt]);
  const elapsedMs = startedAt
    ? busy
      ? now - startedAt
      : finalElapsedMs
    : undefined;
  const hasErrors = errors && errors.length > 0;

  const dotTone = failed ? "bg-g-red" : done ? "bg-g-green" : "bg-g-accent";
  const dropdownState = open
    ? "translate-y-0 opacity-100 pointer-events-auto"
    : "translate-y-1 opacity-0";

  const progressBarTone = failed
    ? "bg-g-red"
    : done
      ? "bg-g-green"
      : "bg-g-accent";

  return (
    <span className="group relative inline-flex">
      <IconButton
        aria-label={ariaLabel}
        active={open}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        <span className="absolute right-1 top-1 size-1.5" aria-hidden>
          {busy && (
            <span
              className={`absolute inset-0 rounded-g-pill opacity-75 motion-reduce:animate-none ${dotTone} animate-ping`}
            />
          )}
          <span className={`absolute inset-0 rounded-g-pill ${dotTone}`} />
        </span>
      </IconButton>
      <div
        className={`pointer-events-none absolute right-0 top-full z-[60] pt-2 transition-[opacity,transform] duration-[120ms] ease-g group-hover:translate-y-0 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100 group-focus-within:pointer-events-auto ${dropdownState}`}
        role={failed ? "alert" : "status"}
        aria-live={failed ? "assertive" : "polite"}
      >
        <div className="w-[340px] rounded-g-lg border border-g-line bg-g-surface-2 p-3 text-g-ui text-g-ink-2 shadow-g-pop">
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
            ) : stopped ? (
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
              {statusLabel}
            </span>
          </div>
          <p className="mt-1.5 font-g-mono text-[11px] tracking-g-mono text-g-ink-3 tabular-nums">
            {countsLabel}
          </p>
          {elapsedMs != null && (
            <p className="font-g-mono text-[11px] tracking-g-mono text-g-ink-4 tabular-nums text-right">
              {formatElapsed(elapsedMs)}
            </p>
          )}
          {(errorMessage || hasErrors) && (
            <div className="mt-2 rounded-g-md border border-g-line bg-g-surface text-g-caption leading-[1.45]">
              {hasErrors ? (
                <>
                  <div className="flex items-center">
                    <button
                      type="button"
                      className="flex flex-1 items-center gap-1 px-2 py-1.5 text-left text-g-red hover:bg-g-surface-2"
                      onClick={() => setErrorsExpanded((v) => !v)}
                    >
                      <ChevronDown
                        size={12}
                        className={`shrink-0 transition-transform duration-100 ${errorsExpanded ? "" : "-rotate-90"}`}
                      />
                      <span className="flex-1 truncate">
                        {t("activity.failedCount", {
                          count: errors.length,
                          defaultValue: "{{count}} failed",
                        })}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={
                        copied
                          ? t("activity.errorsCopied", {
                              defaultValue: "Copied",
                            })
                          : t("activity.copyErrors", {
                              defaultValue: "Copy errors",
                            })
                      }
                      className="shrink-0 px-2 py-1.5 text-g-ink-4 hover:text-g-ink transition-colors duration-100"
                      onClick={() => {
                        const text = errors
                          .map((e) => `${e.repoPath}\n${e.message}`)
                          .join("\n\n");
                        navigator.clipboard.writeText(text).then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        });
                      }}
                    >
                      {copied ? (
                        <Check size={12} className="text-g-green" />
                      ) : (
                        <Copy size={12} />
                      )}
                    </button>
                  </div>
                  {errorsExpanded && (
                    <ul className="max-h-[120px] overflow-y-auto border-t border-g-line">
                      {errors.map((err, i) => (
                        <li
                          key={i}
                          className="border-b border-g-line px-2 py-1 last:border-b-0"
                        >
                          <span className="block truncate font-g-mono text-g-chip text-g-ink-2">
                            {err.repoPath}
                          </span>
                          <span className="block truncate text-g-red">
                            {err.message}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="px-2 py-1.5 text-g-red">{errorMessage}</p>
              )}
            </div>
          )}
          <span
            className="relative mt-2 block h-1.5 overflow-hidden rounded-g-pill bg-g-surface-3"
            aria-hidden="true"
          >
            <span
              className={`block h-full rounded-g-pill ${progressBarTone} transition-[width] duration-150 ease-g`}
              style={{ width: `${progressPercent}%` }}
            />
            {showIndeterminate && busy && (
              <span className="absolute inset-y-0 left-0 block w-[28%] rounded-g-pill bg-g-accent opacity-70 motion-reduce:hidden animate-[progress-indeterminate_1.15s_ease-in-out_infinite]" />
            )}
          </span>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={primaryAction.onClick}
            >
              {primaryAction.label}
            </Button>
            {busy && stopButton ? (
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<Square size={13} />}
                onClick={stopButton.onClick}
                disabled={stopButton.disabled}
              >
                {stopButton.label}
              </Button>
            ) : canDismiss ? (
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<X size={13} />}
                onClick={onDismiss}
              >
                {t("activity.dismiss")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </span>
  );
}
