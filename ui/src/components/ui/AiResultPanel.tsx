import { type ReactNode, useCallback, useState } from "react";
import { ChevronDown, RefreshCw, Sparkles, Timer, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { CopyButton } from "./CopyButton";

/* ─── Skeleton (loading placeholder) ──────────────── */

function AiResultSkeleton({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "rounded-g-md border border-g-purple/15 bg-g-purple/[0.03] p-3",
        className,
      )}
    >
      <div className="mb-3 flex items-center gap-1.5">
        <Sparkles size={13} className="animate-pulse text-g-purple/50" />
        <span className="text-[10px] font-[590] uppercase tracking-[0.08em] text-g-purple/50">
          {t("ai.thinking")}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <div className="h-3 w-full animate-[ai-skeleton_1.8s_ease-in-out_infinite] rounded-g-sm bg-g-purple/8" />
        <div className="h-3 w-4/5 animate-[ai-skeleton_1.8s_ease-in-out_infinite_200ms] rounded-g-sm bg-g-purple/8" />
        <div className="mt-1 h-3 w-2/5 animate-[ai-skeleton_1.8s_ease-in-out_infinite_400ms] rounded-g-sm bg-g-purple/6" />
        <div className="h-3 w-3/5 animate-[ai-skeleton_1.8s_ease-in-out_infinite_600ms] rounded-g-sm bg-g-purple/6" />
      </div>
    </div>
  );
}

/* ─── Collapsible Section ─────────────────────────── */

function Section({
  label,
  children,
  defaultOpen = false,
}: {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-g-purple/10 pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-1 text-g-caption font-[590] text-g-ink-3 transition-colors duration-[120ms] ease-g hover:text-g-ink-2"
      >
        <ChevronDown
          size={12}
          className={cn(
            "shrink-0 transition-transform duration-[150ms] ease-g",
            !open && "-rotate-90",
          )}
        />
        {label}
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-[200ms] ease-g motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <p className="pt-1.5 text-g-body leading-[1.6] text-g-ink-2">
            {children}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── Result Panel ────────────────────────────────── */

type AiResultPanelProps = {
  summary: ReactNode;
  sections?: { label: string; content: ReactNode; defaultOpen?: boolean }[];
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  onRegenerate?: () => void;
  regenerating?: boolean;
  copyText?: string;
  className?: string;
};

function AiResultPanel({
  summary,
  sections,
  durationMs,
  inputTokens,
  outputTokens,
  onRegenerate,
  regenerating,
  copyText,
  className,
}: AiResultPanelProps) {
  const { t } = useTranslation();

  const buildCopyText = useCallback(() => {
    if (copyText) return copyText;
    const parts: string[] = [];
    if (typeof summary === "string") parts.push(summary);
    sections?.forEach((s) => {
      parts.push(`\n${s.label}:`);
      if (typeof s.content === "string") parts.push(s.content);
    });
    return parts.join("\n");
  }, [copyText, summary, sections]);

  return (
    <div
      className={cn(
        "animate-[slideUp2_250ms_var(--g-ease-out)] rounded-g-md border border-g-purple/15 bg-g-purple/[0.03] p-3",
        className,
      )}
    >
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Sparkles size={13} className="text-g-purple" />
          <span className="text-[10px] font-[590] uppercase tracking-[0.08em] text-g-purple">
            {t("ai.resultTitle")}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <CopyButton value={buildCopyText()} label={t("ai.copyResult")} />
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              disabled={regenerating}
              className="grid size-6 cursor-pointer place-items-center rounded-g-sm text-g-ink-3 transition-[background,color] duration-[120ms] ease-g hover:bg-g-surface-3 hover:text-g-ink disabled:cursor-not-allowed disabled:opacity-[0.38]"
              aria-label={t("ai.regenerate")}
            >
              <RefreshCw
                size={12}
                className={cn(
                  regenerating && "animate-[icon-spin_900ms_linear_infinite]",
                )}
              />
            </button>
          )}
        </div>
      </div>

      {/* Summary (always visible) */}
      <p className="text-g-body font-[510] leading-[1.6] text-g-ink">
        {summary}
      </p>

      {/* Collapsible sections */}
      {sections && sections.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-2">
          {sections.map((s) => (
            <Section key={s.label} label={s.label} defaultOpen={s.defaultOpen}>
              {s.content}
            </Section>
          ))}
        </div>
      )}

      {/* Metadata footer */}
      {(durationMs != null || inputTokens != null) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-g-purple/10 pt-2 font-g-mono text-[10px] text-g-ink-4">
          {durationMs != null && (
            <span className="inline-flex items-center gap-1">
              <Timer size={10} />
              {(durationMs / 1000).toFixed(1)}s
            </span>
          )}
          {inputTokens != null && outputTokens != null && (
            <span className="inline-flex items-center gap-1">
              <Zap size={10} />
              {t("ai.tokenUsage", {
                input: inputTokens,
                output: outputTokens,
              })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export { AiResultPanel, AiResultSkeleton };
export type { AiResultPanelProps };
