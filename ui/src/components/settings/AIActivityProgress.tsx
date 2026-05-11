import { Check, ChevronDown, Copy, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AITagActivityState } from "../../aiTagActivity";
import { isAITagActivityBusy } from "../../aiTagActivity";
import type { VLMOcrActivityState } from "../../vlmOcrActivity";
import { isVLMOcrActivityBusy } from "../../vlmOcrActivity";
import type { EmbedActivityState } from "../../embedActivity";
import { isEmbedActivityBusy } from "../../embedActivity";
import type {
  AITagRunCounts,
  EmbedRunCounts,
  VLMOcrRunCounts,
} from "../../types";
import { Badge, Tooltip } from "../ui";
import {
  formatElapsed,
  formatTokenCount,
  middleTruncatePath,
} from "./aiSectionUtils";

// ── Progress label helpers ─────────────────────────────────────────

function aiTagProgressLabel(
  activity: AITagActivityState,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  const counts = activity.counts;
  switch (activity.phase) {
    case "saving":
      return t("settings.aiTagSaving");
    case "running":
    case "stopping":
      return counts
        ? t("activity.aiTagCounts", {
            processed: counts.processed,
            ready: counts.ready,
            failed: counts.failed,
            skipped: counts.skipped,
            cacheHit: counts.cacheHit,
          })
        : t("settings.aiTagSaving");
    case "done":
      return t("settings.aiTagDone", {
        ready: counts?.ready ?? 0,
        skipped: counts?.skipped ?? 0,
        cacheHit: counts?.cacheHit ?? 0,
      });
    case "stopped":
      return t("settings.aiTagStopped");
    case "error":
      return activity.errorMessage ?? t("settings.aiTagFailed");
    default:
      return "";
  }
}

function vlmOcrProgressLabel(
  activity: VLMOcrActivityState,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  const counts = activity.counts;
  switch (activity.phase) {
    case "saving":
      return t("settings.aiOcrSaving");
    case "running":
    case "stopping":
      return counts
        ? t("activity.aiOcrCounts", {
            processed: counts.processed,
            ready: counts.ready,
            failed: counts.failed,
            skipped: counts.skipped,
            cacheHit: counts.cacheHit,
          })
        : t("settings.aiOcrSaving");
    case "done":
      return t("settings.aiOcrDone", {
        ready: counts?.ready ?? 0,
        skipped: counts?.skipped ?? 0,
        cacheHit: counts?.cacheHit ?? 0,
      });
    case "stopped":
      return t("settings.aiOcrStopped");
    case "error":
      return activity.errorMessage ?? t("settings.aiOcrFailed");
    default:
      return "";
  }
}

function embedProgressLabel(
  activity: EmbedActivityState,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  const counts = activity.counts;
  switch (activity.phase) {
    case "running":
    case "stopping":
      return counts
        ? t("activity.embedCounts", {
            processed: counts.processed,
            ready: counts.ready,
            failed: counts.failed,
            skipped: counts.skipped,
          })
        : t("settings.embedRun");
    case "done":
      return counts
        ? t("activity.embedCounts", {
            processed: counts.processed,
            ready: counts.ready,
            failed: counts.failed,
            skipped: counts.skipped,
          })
        : "";
    case "stopped":
      return t("settings.embedStopped");
    case "error":
      return activity.errorMessage ?? t("settings.embedFailed");
    default:
      return "";
  }
}

// ── Shared UI components ───────────────────────────────────────────

export function TokenBadge({
  inputTokens,
  outputTokens,
}: {
  inputTokens: number;
  outputTokens: number;
}) {
  const { t } = useTranslation();
  if (inputTokens <= 0 && outputTokens <= 0) return null;
  return (
    <Tooltip
      label={t("settings.aiTokenTooltip", {
        input: inputTokens.toLocaleString(),
        output: outputTokens.toLocaleString(),
      })}
    >
      <span className="font-g-mono text-[10px] tracking-g-mono text-g-ink-4 cursor-default">
        ↑{formatTokenCount(inputTokens)} ↓{formatTokenCount(outputTokens)}
      </span>
    </Tooltip>
  );
}

export function LastRunText({
  counts,
  timestamp,
  scopeLabel,
  elapsedMs,
  providerName,
  modelName,
  errors,
}: {
  counts: AITagRunCounts | VLMOcrRunCounts | EmbedRunCounts;
  timestamp: number;
  scopeLabel?: string;
  elapsedMs?: number;
  providerName?: string;
  modelName?: string;
  errors?: { repoPath: string; message: string }[];
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || undefined;
  const date = new Date(timestamp);
  const timeStr = date.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const dateStr =
    date.toDateString() === new Date().toDateString()
      ? timeStr
      : date.toLocaleDateString(locale, { month: "short", day: "numeric" }) +
        " " +
        timeStr;

  const sep = (
    <span className="text-g-ink-5 select-none" aria-hidden>
      ·
    </span>
  );

  const providerModel =
    providerName && modelName
      ? `${providerName} / ${modelName}`
      : providerName || modelName;

  return (
    <div className="flex flex-col gap-1 items-end">
      <p className="font-g-mono text-g-chip tracking-g-mono text-g-ink-3 flex items-center gap-1.5">
        <span>{t("settings.aiLastRun", { time: dateStr })}</span>
        {elapsedMs != null && (
          <>
            {sep}
            <span>{formatElapsed(elapsedMs)}</span>
          </>
        )}
      </p>
      {"ready" in counts && (
        <div className="flex items-center gap-1 flex-wrap justify-end">
          <Badge tone={counts.ready > 0 ? "green" : "default"}>
            {t("settings.aiStatReady", { count: counts.ready })}
          </Badge>
          {counts.skipped > 0 && (
            <Badge>
              {t("settings.aiStatSkipped", { count: counts.skipped })}
            </Badge>
          )}
          {counts.cacheHit > 0 && (
            <Badge>
              {t("settings.aiStatCached", { count: counts.cacheHit })}
            </Badge>
          )}
          {counts.failed > 0 && (
            <Badge tone="red">
              {t("settings.aiStatFailed", { count: counts.failed })}
            </Badge>
          )}
        </div>
      )}
      <span className="font-g-mono text-[10px] tracking-g-mono text-g-ink-4 flex items-center gap-1.5 flex-wrap justify-end">
        {scopeLabel && <span>{scopeLabel}</span>}
        {providerModel && (
          <>
            {scopeLabel && sep}
            <span>{providerModel}</span>
          </>
        )}
        {"inputTokens" in counts &&
          (counts.inputTokens ?? 0) + (counts.outputTokens ?? 0) > 0 && (
            <>
              {(scopeLabel || providerModel) && sep}
              <TokenBadge
                inputTokens={counts.inputTokens ?? 0}
                outputTokens={counts.outputTokens ?? 0}
              />
            </>
          )}
      </span>
      {errors && errors.length > 0 && <ActivityErrorPanel errors={errors} />}
    </div>
  );
}

export function ActivityErrorPanel({
  errors,
}: {
  errors: { repoPath: string; message: string }[];
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  if (errors.length === 0) return null;
  return (
    <div className="mt-1 w-full rounded-g-md border border-g-line bg-g-surface text-g-caption leading-[1.45]">
      <div className="flex items-center">
        <button
          type="button"
          className="flex flex-1 items-center gap-1 px-2 py-1.5 text-left text-g-red hover:bg-g-surface-2"
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown
            size={12}
            className={`shrink-0 transition-transform duration-100 ${expanded ? "" : "-rotate-90"}`}
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
              ? t("activity.errorsCopied", { defaultValue: "Copied" })
              : t("activity.copyErrors", { defaultValue: "Copy errors" })
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
      {expanded && (
        <ul className="max-h-[160px] overflow-y-auto border-t border-g-line">
          {errors.map((err, i) => (
            <li
              key={i}
              className="border-b border-g-line px-2 py-1 last:border-b-0"
            >
              <span className="block truncate font-g-mono text-g-chip text-g-ink-2">
                {err.repoPath}
              </span>
              <span className="block truncate text-g-red">{err.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Feature-specific progress text ─────────────────────────────────

export function AITagProgressText({
  activity,
  startedAt,
}: {
  activity: AITagActivityState;
  startedAt?: number;
}) {
  const { t } = useTranslation();
  const busy = isAITagActivityBusy(activity);
  const label = aiTagProgressLabel(activity, t);
  const counts = activity.counts;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!busy || !startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [busy, startedAt]);
  const elapsedMs = busy && startedAt ? now - startedAt : undefined;

  return (
    <div className="flex flex-col gap-0.5 items-end">
      <p className="font-g-mono text-g-chip tracking-g-mono text-g-ink-3 flex items-center gap-1.5">
        {busy && <LoaderCircle size={12} className="animate-spin shrink-0" />}
        {label}
        {elapsedMs != null && (
          <>
            <span className="text-g-ink-5 select-none" aria-hidden>
              ·
            </span>
            <span className="text-g-ink-4">{formatElapsed(elapsedMs)}</span>
          </>
        )}
      </p>
      {busy && activity.currentFile && (
        <p className="font-g-mono text-[10px] tracking-g-mono text-g-ink-4">
          {middleTruncatePath(activity.currentFile)}
        </p>
      )}
      {activity.providerName && (
        <span className="font-g-mono text-[10px] tracking-g-mono text-g-ink-4">
          {activity.providerName}
          {activity.modelName ? ` / ${activity.modelName}` : ""}
        </span>
      )}
      {counts && (counts.inputTokens ?? 0) + (counts.outputTokens ?? 0) > 0 && (
        <TokenBadge
          inputTokens={counts.inputTokens ?? 0}
          outputTokens={counts.outputTokens ?? 0}
        />
      )}
      {activity.errors.length > 0 && (
        <ActivityErrorPanel errors={activity.errors} />
      )}
    </div>
  );
}

export function VLMOcrProgressText({
  activity,
  startedAt,
}: {
  activity: VLMOcrActivityState;
  startedAt?: number;
}) {
  const { t } = useTranslation();
  const busy = isVLMOcrActivityBusy(activity);
  const label = vlmOcrProgressLabel(activity, t);
  const counts = activity.counts;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!busy || !startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [busy, startedAt]);
  const elapsedMs = busy && startedAt ? now - startedAt : undefined;

  return (
    <div className="flex flex-col gap-0.5 items-end">
      <p className="font-g-mono text-g-chip tracking-g-mono text-g-ink-3 flex items-center gap-1.5">
        {busy && <LoaderCircle size={12} className="animate-spin shrink-0" />}
        {label}
        {elapsedMs != null && (
          <>
            <span className="text-g-ink-5 select-none" aria-hidden>
              ·
            </span>
            <span className="text-g-ink-4">{formatElapsed(elapsedMs)}</span>
          </>
        )}
      </p>
      {busy && activity.currentFile && (
        <p className="font-g-mono text-[10px] tracking-g-mono text-g-ink-4">
          {middleTruncatePath(activity.currentFile)}
        </p>
      )}
      {activity.providerName && (
        <span className="font-g-mono text-[10px] tracking-g-mono text-g-ink-4">
          {activity.providerName}
          {activity.modelName ? ` / ${activity.modelName}` : ""}
        </span>
      )}
      {counts && (counts.inputTokens ?? 0) + (counts.outputTokens ?? 0) > 0 && (
        <TokenBadge
          inputTokens={counts.inputTokens ?? 0}
          outputTokens={counts.outputTokens ?? 0}
        />
      )}
      {activity.errors.length > 0 && (
        <ActivityErrorPanel errors={activity.errors} />
      )}
    </div>
  );
}

export function EmbedProgressText({
  activity,
  startedAt,
}: {
  activity: EmbedActivityState;
  startedAt?: number;
}) {
  const { t } = useTranslation();
  const busy = isEmbedActivityBusy(activity);
  const label = embedProgressLabel(activity, t);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!busy || !startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [busy, startedAt]);
  const elapsedMs = busy && startedAt ? now - startedAt : undefined;

  return (
    <div className="flex flex-col gap-0.5 items-end">
      <p className="font-g-mono text-g-chip tracking-g-mono text-g-ink-3 flex items-center gap-1.5">
        {busy && <LoaderCircle size={12} className="animate-spin shrink-0" />}
        {label}
        {elapsedMs != null && (
          <>
            <span className="text-g-ink-5 select-none" aria-hidden>
              ·
            </span>
            <span className="text-g-ink-4">{formatElapsed(elapsedMs)}</span>
          </>
        )}
      </p>
      {busy && activity.currentFile && (
        <p className="font-g-mono text-[10px] tracking-g-mono text-g-ink-4">
          {middleTruncatePath(activity.currentFile)}
        </p>
      )}
      {activity.providerName && (
        <span className="font-g-mono text-[10px] tracking-g-mono text-g-ink-4">
          {activity.providerName}
          {activity.modelName ? ` / ${activity.modelName}` : ""}
        </span>
      )}
      {activity.errors.length > 0 && (
        <ActivityErrorPanel errors={activity.errors} />
      )}
    </div>
  );
}
