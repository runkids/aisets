import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ScanEvent } from "../../types";
import { cn } from "../../lib/cn";

type ScanProgressContentProps = {
  scanProgress: ScanEvent;
  className?: string;
  truncatePath?: boolean;
};

function ScanProgressContent({
  scanProgress,
  className,
}: ScanProgressContentProps) {
  const { t } = useTranslation();

  const progress = scanProgress.type === "progress" ? scanProgress : null;
  const done = scanProgress.type === "done";
  const failed = scanProgress.type === "error";

  const total = progress?.total ?? 0;
  const current = progress?.current ?? 0;
  const percent =
    done || failed
      ? 100
      : progress && total > 0
        ? Math.min(100, Math.max(0, (current / total) * 100))
        : 0;

  const label = done
    ? t("scanProgress.complete")
    : failed
      ? t("error.scan")
      : progress
        ? t(`scanProgress.phase.${progress.phase}`)
        : t("scanProgress.starting");

  const reasonLabel = progress?.reason
    ? t(`scanProgress.reason.${progress.reason}`, { defaultValue: "" })
    : "";

  const countWidth = total > 0 ? String(total).length * 2 + 1 : 0;

  return (
    <div className={cn("w-full min-w-0 text-g-ui text-g-ink-2", className)}>
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
        <span className="shrink-0 font-[590] text-g-ink">{label}</span>
        <span className="min-w-0 flex-1" />
        {progress && total > 0 && (
          <span
            className="shrink-0 text-right font-g-mono text-[11px] tracking-[-0.015em] text-g-ink-3 tabular-nums"
            style={{ minWidth: `${countWidth}ch` }}
          >
            {current}/{total}
          </span>
        )}
      </div>

      {progress?.message && (
        <div
          className="mt-1.5 h-4 min-w-0 overflow-hidden"
          title={progress.message}
        >
          <ProgressPath value={progress.message} />
        </div>
      )}

      {reasonLabel && (
        <p className="mt-1.5 text-g-caption leading-snug text-g-ink-3">
          {reasonLabel}
        </p>
      )}

      {(done || failed || (progress && total > 0)) && (
        <span
          className="mt-2 block h-1.5 overflow-hidden rounded-g-pill bg-g-surface-3"
          aria-hidden="true"
        >
          <span
            className={cn(
              "block h-full rounded-g-pill transition-[width] duration-150 ease-g",
              done ? "bg-g-green" : failed ? "bg-g-red" : "bg-g-accent",
            )}
            style={{ width: `${percent}%` }}
          />
        </span>
      )}
    </div>
  );
}

function ProgressPath({ value }: { value: string }) {
  const { directory, fileName } = splitProgressPath(value);

  return (
    <code className="flex h-4 w-full min-w-0 items-center justify-end overflow-hidden whitespace-nowrap bg-transparent p-0 text-right font-g-mono text-[11px] leading-4 tracking-g-mono text-g-ink-4">
      {directory && (
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          {directory}
        </span>
      )}
      <span className="min-w-0 max-w-full shrink-0 overflow-hidden text-ellipsis whitespace-nowrap">
        {fileName}
      </span>
    </code>
  );
}

function splitProgressPath(value: string) {
  const slashIndex = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  if (slashIndex < 0 || slashIndex === value.length - 1) {
    return { directory: "", fileName: value };
  }
  return {
    directory: value.slice(0, slashIndex + 1),
    fileName: value.slice(slashIndex + 1),
  };
}

export { ScanProgressContent };
