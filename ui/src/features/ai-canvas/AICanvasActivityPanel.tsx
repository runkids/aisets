import type { TFunction } from "i18next";
import {
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  Cpu,
  Gauge,
  Hash,
  Image as ImageIcon,
  ListChecks,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { ChatActivityEntry, ChatRunUsage } from "./aiCanvasState";

type AICanvasActivityPanelProps = {
  t: TFunction;
  activity?: ChatActivityEntry[];
  usage?: ChatRunUsage;
  elapsedMs?: number;
  live?: boolean;
  defaultOpen?: boolean;
  className?: string;
};

export function formatCanvasRunDuration(ms: number | null | undefined) {
  const safeMs = Number.isFinite(ms) && ms && ms > 0 ? ms : 0;
  if (safeMs < 60_000) return `${(safeMs / 1000).toFixed(2)}s`;
  const minutes = Math.floor(safeMs / 60_000);
  const seconds = ((safeMs % 60_000) / 1000).toFixed(2).padStart(5, "0");
  return `${minutes}:${seconds}`;
}

function formatTokenCount(value: number | undefined) {
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat("en-US").format(Math.round(value ?? 0));
}

export function AICanvasRunUsageChips({
  t,
  usage,
  className,
}: {
  t: TFunction;
  usage?: ChatRunUsage;
  className?: string;
}) {
  const provider = [usage?.providerName, usage?.modelName]
    .filter(Boolean)
    .join(" · ");
  const totalTokens =
    usage?.totalTokens ??
    ((usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0) || undefined);
  const toolCount = usage?.toolCallCount ?? 0;
  const loopCount = usage?.loopCount ?? 0;
  const hasUsage =
    Boolean(provider) ||
    Number.isFinite(usage?.durationMs) ||
    Number.isFinite(totalTokens) ||
    Number.isFinite(usage?.tokensPerSecond) ||
    toolCount > 0 ||
    loopCount > 0;

  if (!hasUsage) return null;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] leading-none text-white/48",
        className,
      )}
    >
      {provider && (
        <span className="inline-flex h-6 max-w-full items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.04] px-2">
          <Cpu size={11} />
          <span className="min-w-0 truncate">{provider}</span>
        </span>
      )}
      {Number.isFinite(usage?.durationMs) && (
        <span className="inline-flex h-6 items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.04] px-2">
          <Clock3 size={11} />
          {t("aiCanvas.activityDuration", {
            time: formatCanvasRunDuration(usage?.durationMs),
          })}
        </span>
      )}
      {Number.isFinite(totalTokens) && (
        <span className="inline-flex h-6 items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.04] px-2">
          <Hash size={11} />
          {t("aiCanvas.activityTokens", {
            count: formatTokenCount(totalTokens),
          })}
        </span>
      )}
      {Number.isFinite(usage?.tokensPerSecond) && (
        <span className="inline-flex h-6 items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.04] px-2">
          <Gauge size={11} />
          {t("aiCanvas.activityTokensPerSecond", {
            rate: usage?.tokensPerSecond?.toFixed(2),
          })}
        </span>
      )}
      {(toolCount > 0 || loopCount > 0) && (
        <span className="inline-flex h-6 items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.04] px-2">
          <ListChecks size={11} />
          {t("aiCanvas.activityLoopsAndTools", {
            loops: loopCount,
            tools: toolCount,
          })}
        </span>
      )}
    </div>
  );
}

function iconForActivity(kind: ChatActivityEntry["kind"]) {
  if (kind === "tool") return <Wrench size={12} aria-hidden="true" />;
  if (kind === "proposal") return <ListChecks size={12} aria-hidden="true" />;
  if (kind === "image") return <ImageIcon size={12} aria-hidden="true" />;
  if (kind === "done") return <CheckCircle2 size={12} aria-hidden="true" />;
  return <CircleDot size={12} aria-hidden="true" />;
}

export function AICanvasActivityPanel({
  t,
  activity = [],
  usage,
  elapsedMs,
  live = false,
  defaultOpen = false,
  className,
}: AICanvasActivityPanelProps) {
  const durationMs = usage?.durationMs ?? elapsedMs;
  const duration = formatCanvasRunDuration(durationMs);
  const title = live
    ? t("aiCanvas.activityLiveTitle", { time: duration })
    : t("aiCanvas.activityTitle", { time: duration });

  return (
    <details
      open={defaultOpen}
      className={cn(
        "group/activity rounded-g-md border border-white/[0.07] bg-black/[0.16] text-g-caption text-white/64",
        className,
      )}
    >
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 px-2.5 py-2 outline-none transition-colors duration-[120ms] ease-g hover:bg-white/[0.04] focus-visible:shadow-g-focus [&::-webkit-details-marker]:hidden">
        {live ? (
          <CircleDot size={13} className="shrink-0 text-white/52" />
        ) : (
          <Clock3 size={13} className="shrink-0 text-white/52" />
        )}
        <span className="min-w-0 flex-1 truncate font-[560] text-white/72">
          {title}
        </span>
        <ChevronDown
          size={14}
          className="shrink-0 text-white/38 transition-transform duration-[140ms] ease-g group-open/activity:rotate-180"
          aria-hidden="true"
        />
      </summary>

      <div className="space-y-2 border-t border-white/[0.06] px-2.5 py-2">
        {activity.length > 0 && (
          <ol className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
            {activity.map((entry) => (
              <li
                key={entry.id}
                className="grid grid-cols-[54px_minmax(0,1fr)] gap-2"
              >
                <span className="font-g-mono text-[10px] leading-5 tracking-g-mono text-white/32">
                  {formatCanvasRunDuration(entry.atMs)}
                </span>
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 text-white/42">
                      {iconForActivity(entry.kind)}
                    </span>
                    <span className="min-w-0 truncate font-[540] text-white/74">
                      {entry.label}
                    </span>
                  </span>
                  {entry.detail && (
                    <span className="mt-0.5 block whitespace-pre-wrap break-words text-white/46">
                      {entry.detail}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}

        {activity.length === 0 && (
          <div className="text-white/42">
            {t("aiCanvas.statusProcessingDetail")}
          </div>
        )}
      </div>
    </details>
  );
}
