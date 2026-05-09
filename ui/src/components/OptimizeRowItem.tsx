import { Check, ChevronDown, Wand2 } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { useTranslation } from "react-i18next";
import { fileName, formatBytes } from "../ui";
import type { AssetItem } from "../types";
import type { Operation, OptimizationOperation } from "./optimizeTypes";
import { formatBadgeBg, operationLabels } from "./optimizeTypes";
import { cn } from "@/lib/cn";
import { AssetThumbnail, Badge, Checkbox, Tooltip } from "./ui";

const availableOutputFormats: Record<string, string[]> = {
  png: ["avif", "webp", "jpeg", "png"],
  jpg: ["avif", "webp", "jpeg"],
  jpeg: ["avif", "webp", "jpeg"],
  gif: ["webp", "gif"],
  svg: ["svg"],
  webp: ["avif", "webp"],
};

type Props = {
  item: AssetItem;
  op: Operation;
  sev: "critical" | "warning" | "info" | "";
  planned?: OptimizationOperation;
  isSelected: boolean;
  bulkMode: boolean;
  selectionLocked: boolean;
  formatOverride: string | undefined;
  onToggle: (id: string) => void;
  onOpenAsset: (id: string) => void;
  onFormatChange: (itemId: string, format: string | null) => void;
};

export function OptimizeRowItem({
  item,
  op,
  sev,
  planned,
  isSelected,
  bulkMode,
  selectionLocked,
  formatOverride,
  onToggle,
  onOpenAsset,
  onFormatChange,
}: Props) {
  const { t } = useTranslation();
  const rec = item.optimizationRecommendations[0];
  const recSavings = rec?.savingsBytes ?? 0;
  const estimated = planned?.estimatedBytes ?? 0;
  const savings = planned?.savingsBytes ?? 0;
  const hasEstimate = planned != null && estimated > 0;
  const rowBlocked = planned?.canApply === false;
  const rowBlockedLabel = planned
    ? t(`optimize.blockedReason.${planned.reasonCode}`, {
        defaultValue: planned.blockedReason || t("optimize.blocked"),
        tool: planned.tool,
      })
    : "";
  const operationLabel = (id: string) =>
    t(`optimize.operationLabel.${id}`, {
      defaultValue: operationLabels[id] ?? id,
    });

  return (
    <div
      className={cn(
        "grid min-h-[84px] items-center gap-2 border-b border-g-line border-l-[3px] pl-4 pr-3 py-2.5 transition-[background,border-color] duration-[120ms] ease-g last:border-b-0 hover:bg-g-surface-2",
        isSelected && !rowBlocked
          ? "border-l-g-active-bg"
          : sev === "critical"
            ? "border-l-g-red"
            : sev === "warning"
              ? "border-l-g-amber"
              : sev === "info"
                ? "border-l-g-blue"
                : "border-l-transparent",
        bulkMode
          ? "grid-cols-[40px_minmax(0,1fr)] min-[980px]:grid-cols-[40px_minmax(0,1.2fr)_minmax(140px,1fr)_200px_150px]"
          : "grid-cols-[minmax(0,1fr)] min-[980px]:grid-cols-[minmax(0,1.2fr)_minmax(140px,1fr)_200px_150px]",
        isSelected && !rowBlocked && "bg-g-surface-2",
        rowBlocked && "bg-g-surface-2 opacity-[0.72] hover:bg-g-surface-2",
        bulkMode && rowBlocked && "cursor-not-allowed",
      )}
      onClick={() => {
        if (bulkMode && !rowBlocked) onToggle(item.id);
      }}
    >
      {bulkMode && (
        <div
          className="grid place-items-center"
          onClick={(event) => event.stopPropagation()}
        >
          <Tooltip
            label={rowBlockedLabel}
            placement="top"
            contentClassName="max-w-[320px] whitespace-normal break-words"
            disabled={!rowBlocked}
          >
            <span className="inline-grid">
              <Checkbox
                checked={isSelected && !rowBlocked}
                size="md"
                disabled={selectionLocked || rowBlocked}
                onCheckedChange={() => onToggle(item.id)}
                aria-label={
                  rowBlocked
                    ? rowBlockedLabel
                    : isSelected
                      ? t("action.deselect")
                      : t("action.select")
                }
              />
            </span>
          </Tooltip>
        </div>
      )}

      {/* File column */}
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          className="relative shrink-0 rounded-g-md focus-visible:outline-none focus-visible:shadow-g-focus"
          onClick={(event) => {
            event.stopPropagation();
            onOpenAsset(item.id);
          }}
          aria-label={t("asset.openDetails", {
            name: fileName(item.repoPath),
          })}
        >
          <AssetThumbnail
            src={item.thumbnailUrl || item.url}
            size="md"
            className="size-14 rounded-g-md"
          />
          <span
            className={cn(
              "absolute bottom-0.5 left-0.5 rounded-[3px] px-1 py-px text-[9px] font-[600] uppercase leading-[1.2] text-white",
              formatBadgeBg[item.ext.replace(".", "").toLowerCase()] ??
                "bg-g-ink-4",
            )}
          >
            {item.ext.replace(".", "").toUpperCase()}
          </span>
        </button>
        <div className="min-w-0">
          <Tooltip
            label={item.repoPath}
            placement="top"
            contentClassName="max-w-[360px] whitespace-normal break-words"
          >
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  sev === "critical"
                    ? "bg-g-red"
                    : sev === "warning"
                      ? "bg-g-amber"
                      : "bg-g-blue",
                )}
              />
              <span className="truncate font-g-mono text-g-body font-medium text-g-ink">
                {fileName(item.repoPath)}
              </span>
            </span>
          </Tooltip>
          <Tooltip
            label={`${item.projectName} / ${item.repoPath}`}
            placement="top"
            contentClassName="max-w-[420px] whitespace-normal break-words"
          >
            <span className="block truncate pl-[12px] font-g-mono text-g-chip text-g-ink-4">
              {item.projectName} ·{" "}
              {item.repoPath.split("/").slice(0, -1).join("/")}
            </span>
          </Tooltip>
          <div className="mt-1 flex flex-wrap gap-1 pl-[12px] min-[980px]:hidden">
            <Badge tone="line">{operationLabel(op)}</Badge>
            <Badge tone="line">
              {hasEstimate
                ? `${formatBytes(item.bytes)} → ${formatBytes(estimated)}`
                : recSavings > 0
                  ? `≈ −${formatBytes(recSavings)}`
                  : t("optimize.pendingEstimate")}
            </Badge>
          </div>
        </div>
      </div>

      {/* Operation column */}
      <div
        className="hidden min-w-0 min-[980px]:block"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-1">
          <Badge
            tone={
              sev === "critical" ? "red" : sev === "warning" ? "amber" : "line"
            }
          >
            {operationLabel(op)}
          </Badge>
          <FormatDropdown
            itemId={item.id}
            srcExt={item.ext.replace(".", "").toLowerCase()}
            op={op}
            planned={planned}
            override={formatOverride ?? "auto"}
            onFormatChange={onFormatChange}
          />
        </div>
        {planned && !planned.canApply ? (
          <Tooltip
            label={rowBlockedLabel}
            placement="top"
            contentClassName="max-w-[420px] whitespace-normal break-words"
          >
            <div className="mt-1 truncate text-g-caption text-g-amber">
              {rowBlockedLabel}
            </div>
          </Tooltip>
        ) : rec ? (
          <Tooltip
            label={t(`optimization.suggestion.${rec.suggestionCode}`, {
              defaultValue: rec.suggestion,
            })}
            placement="top"
            contentClassName="max-w-[420px] whitespace-normal break-words"
          >
            <div className="mt-1 truncate text-g-caption text-g-ink-4">
              {t(`optimization.suggestion.${rec.suggestionCode}`, {
                defaultValue: rec.suggestion,
              })}
            </div>
          </Tooltip>
        ) : (
          <div className="mt-1 text-g-caption text-g-ink-4" />
        )}
      </div>

      {/* Source → Target column */}
      <div className="hidden min-w-0 min-[980px]:block">
        <div className="font-g-mono text-g-ui text-g-ink">
          {rowBlocked ? (
            formatBytes(item.bytes)
          ) : hasEstimate ? (
            <>
              {formatBytes(item.bytes)} →{" "}
              <span className="font-[590]">{formatBytes(estimated)}</span>
            </>
          ) : recSavings > 0 ? (
            `${formatBytes(item.bytes)} ≈ −${formatBytes(recSavings)}`
          ) : (
            t("optimize.pendingEstimate")
          )}
        </div>
        {hasEstimate && !rowBlocked && item.bytes > 0 && (
          <div className="mt-1.5 flex h-[5px] overflow-hidden rounded-g-pill bg-g-surface-3">
            <div
              className="rounded-g-pill bg-g-green transition-[width] duration-300 ease-g"
              style={{
                width: `${Math.max(2, Math.round((estimated / item.bytes) * 100))}%`,
              }}
            />
            {savings > 0 && (
              <div
                className="ml-px rounded-g-pill bg-g-red/30 transition-[width] duration-300 ease-g"
                style={{
                  width: `${Math.round((savings / item.bytes) * 100)}%`,
                }}
              />
            )}
          </div>
        )}
        <div className="mt-1 truncate text-g-chip text-g-ink-4">
          {(() => {
            const srcFmt = item.ext.replace(".", "").toUpperCase();
            const tgtFmt =
              formatOverride && formatOverride !== "auto"
                ? formatOverride.toUpperCase()
                : (planned?.outputFormat ?? srcFmt.toLowerCase()).toUpperCase();
            return tgtFmt !== srcFmt
              ? `${srcFmt} → ${tgtFmt} · ${item.image.width}×${item.image.height}`
              : `${srcFmt} · ${item.image.width}×${item.image.height}`;
          })()}
        </div>
      </div>

      {/* Savings column */}
      <div className="hidden text-right min-[980px]:block">
        {(planned && savings > 0) || (!planned && recSavings > 0) ? (
          <>
            <div className="font-g-mono text-g-body font-[590] text-g-green">
              −{formatBytes(planned ? savings : recSavings)}
            </div>
            {item.bytes > 0 && (
              <div className="font-g-mono text-g-chip text-g-green">
                −
                {Math.round(
                  ((planned ? savings : recSavings) / item.bytes) * 100,
                )}
                %
              </div>
            )}
          </>
        ) : (
          <Badge tone="line" className="whitespace-nowrap">
            {planned
              ? t("optimize.noEffectiveSavings")
              : t("optimize.pendingEstimate")}
          </Badge>
        )}
      </div>
    </div>
  );
}

function FormatDropdown({
  itemId,
  srcExt,
  op,
  planned,
  override,
  onFormatChange,
}: {
  itemId: string;
  srcExt: string;
  op: Operation;
  planned?: OptimizationOperation;
  override: string;
  onFormatChange: (itemId: string, format: string | null) => void;
}) {
  const { t } = useTranslation();
  const formats = availableOutputFormats[srcExt] ?? [];
  if (formats.length <= 1) return null;

  const isAuto = override === "auto";
  const opFmt = op.startsWith("convert-") ? op.slice(8) : "";
  const resolvedFmt = (planned?.outputFormat || opFmt || srcExt).toUpperCase();

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 rounded-g-sm border px-2 py-1 font-g-mono text-g-chip font-[510] transition-colors duration-100",
            isAuto
              ? "border-g-line bg-g-surface text-g-ink-2 hover:bg-g-surface-2 hover:text-g-ink"
              : "border-g-accent/30 bg-g-accent/8 text-g-accent hover:bg-g-accent/12",
          )}
        >
          {isAuto && <Wand2 size={10} className="text-g-ink-4" />}
          <span>→ {isAuto ? resolvedFmt : override.toUpperCase()}</span>
          <ChevronDown
            size={10}
            className={isAuto ? "text-g-ink-4" : "text-g-accent/60"}
          />
        </button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="start"
          sideOffset={4}
          className="z-[60] min-w-[200px] rounded-g-md border border-g-line-strong bg-g-surface p-1.5 shadow-g-pop animate-[modalIn_120ms_var(--g-ease-out)]"
        >
          <div className="px-2.5 pb-1 pt-1.5 font-g-mono text-[10px] uppercase tracking-[0.08em] text-g-ink-4">
            {t("optimize.convertHeader", {
              ext: srcExt.toUpperCase(),
              defaultValue: "Convert {{ext}} →",
            })}
          </div>
          <DropdownMenuPrimitive.Item
            className="flex min-h-8 w-full cursor-pointer items-center justify-between gap-3 rounded-g-sm px-2.5 py-1.5 text-left outline-none data-[highlighted]:bg-g-surface-3"
            onSelect={() => onFormatChange(itemId, null)}
          >
            <span className="flex items-center gap-1.5">
              <Wand2 size={12} className="text-g-ink-3" />
              <span className="font-g text-g-body font-[510] text-g-ink">
                Auto
              </span>
              <span className="font-g-mono text-g-chip text-g-ink-4">
                · {resolvedFmt}
              </span>
            </span>
            {isAuto && <Check size={14} className="shrink-0 text-g-ink" />}
          </DropdownMenuPrimitive.Item>
          <div className="my-1 h-px bg-g-line" />
          {formats.map((fmt) => (
            <DropdownMenuPrimitive.Item
              key={fmt}
              className="flex min-h-8 w-full cursor-pointer items-center justify-between rounded-g-sm px-2.5 py-1.5 text-left font-g-mono text-g-body font-[510] text-g-ink-2 outline-none data-[highlighted]:bg-g-surface-3 data-[highlighted]:text-g-ink"
              onSelect={() => onFormatChange(itemId, fmt)}
            >
              <span>{fmt.toUpperCase()}</span>
              {override === fmt && (
                <Check size={14} className="shrink-0 text-g-ink" />
              )}
            </DropdownMenuPrimitive.Item>
          ))}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
