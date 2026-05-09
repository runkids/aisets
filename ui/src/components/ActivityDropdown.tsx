import { CheckCircle2, Loader2, Square, X, XCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui";
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
  progressPercent: number;
  showIndeterminate?: boolean;
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
  progressPercent,
  showIndeterminate = false,
  primaryAction,
  stopButton,
  onDismiss,
}: ActivityDropdownProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

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
        className={`pointer-events-none absolute right-0 top-[calc(100%+8px)] z-[60] w-[320px] rounded-g-lg border border-g-line bg-g-surface-2 p-3 text-g-ui text-g-ink-2 shadow-g-pop transition-[opacity,transform] duration-[120ms] ease-g group-hover:translate-y-0 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100 group-focus-within:pointer-events-auto ${dropdownState}`}
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
        {errorMessage && (
          <p className="mt-2 rounded-g-md border border-g-line bg-g-surface px-2 py-1.5 text-g-caption leading-[1.45] text-g-red">
            {errorMessage}
          </p>
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
          <Button size="sm" variant="secondary" onClick={primaryAction.onClick}>
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
    </span>
  );
}
