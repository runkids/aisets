import { CheckSquare, Copy, Square, Terminal, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { AssetItem } from "../types";
import { fileName, formatBytes } from "../ui";
import { AssetThumbnail, Badge, Button, EmptyState, IconButton } from "./ui";

type Props = {
  items: AssetItem[];
  onOpenAsset?: (id: string) => void;
  onDelete?: (items: AssetItem[]) => void;
};

const ROW_HEIGHT = 60;

export function UnusedView({ items, onOpenAsset, onDelete }: Props) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const totalBytes = useMemo(
    () => items.reduce((sum, i) => sum + i.bytes, 0),
    [items],
  );
  const selectedBytes = useMemo(
    () =>
      items
        .filter((i) => selected.has(i.id))
        .reduce((sum, i) => sum + i.bytes, 0),
    [items, selected],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) =>
      prev.size === items.length ? new Set() : new Set(items.map((i) => i.id)),
    );
  }
  function copyPaths() {
    const paths = items
      .filter((i) => selected.has(i.id))
      .map((i) => i.repoPath);
    navigator.clipboard?.writeText(paths.join("\n"));
  }
  function copyAsRm() {
    const cmds = items
      .filter((i) => selected.has(i.id))
      .map((i) => `git rm "${i.repoPath}"`);
    navigator.clipboard?.writeText(cmds.join("\n"));
  }

  return (
    <div className="mx-auto flex h-full max-w-[1600px] flex-col px-8 pb-6 pt-6 max-[768px]:px-4 max-[768px]:py-5">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="m-0 font-g-display text-[44px] font-bold leading-[1.05] tracking-[-0.035em] text-g-ink max-[768px]:text-[30px]">
            {t("unused.title")}{" "}
            <em className="ml-2.5 align-[0.6em] font-g text-[0.32em] font-medium not-italic uppercase tracking-[0.06em] text-g-ink-3">
              {t("asset.assets", { count: items.length })}
            </em>
          </h1>
          <p className="mt-2.5 max-w-[540px] text-sm text-g-ink-3">
            {t("unused.description")}
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={
            selected.size === items.length ? (
              <CheckSquare size={14} />
            ) : (
              <Square size={14} />
            )
          }
          onClick={toggleAll}
        >
          {selected.size === items.length
            ? t("action.deselectAll")
            : t("action.selectAll")}
        </Button>
        {selected.size > 0 && (
          <>
            <span className="font-g-mono text-g-caption text-g-ink-3">
              {t("selection.summary", {
                count: selected.size,
                size: formatBytes(selectedBytes),
              })}
            </span>
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Copy size={12} />}
              onClick={copyPaths}
            >
              {t("action.copyPaths")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Terminal size={12} />}
              onClick={copyAsRm}
            >
              {t("action.copyGitRm")}
            </Button>
            {onDelete && (
              <Button
                size="sm"
                variant="danger"
                leadingIcon={<Trash2 size={12} />}
                onClick={() =>
                  onDelete(items.filter((i) => selected.has(i.id)))
                }
              >
                {t("action.deleteSelected")}
              </Button>
            )}
          </>
        )}
        <span className="ml-auto text-g-caption text-g-ink-4">
          {t("unused.total", { size: formatBytes(totalBytes) })}
        </span>
      </div>

      {items.length === 0 ? (
        <EmptyState title={t("unused.empty")} />
      ) : (
        <div
          ref={scrollRef}
          className="scroll-thin min-h-0 flex-1 overflow-auto"
        >
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: "relative",
              width: "100%",
            }}
          >
            {virtualizer.getVirtualItems().map((row) => {
              const item = items[row.index];
              const isSelected = selected.has(item.id);
              return (
                <div
                  key={item.id}
                  className="absolute left-0 right-0 top-0 flex cursor-pointer items-center gap-2.5 rounded-g-md border border-g-line bg-g-surface px-3.5 py-2.5 transition-[border-color,box-shadow] duration-[120ms] ease-g hover:border-g-line-strong hover:shadow-g-md"
                  style={{
                    transform: `translateY(${row.start}px)`,
                    height: ROW_HEIGHT - 4,
                  }}
                  onClick={() => onOpenAsset?.(item.id)}
                >
                  <IconButton
                    size="sm"
                    active={isSelected}
                    aria-label={
                      isSelected ? t("action.deselect") : t("action.select")
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(item.id);
                    }}
                  >
                    {isSelected ? (
                      <CheckSquare size={16} />
                    ) : (
                      <Square size={16} />
                    )}
                  </IconButton>
                  <AssetThumbnail
                    src={item.thumbnailUrl || item.url}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-g-mono text-g-caption font-[510] text-g-ink">
                      {fileName(item.repoPath)}
                    </div>
                    <div className="truncate text-g-chip text-g-ink-4">
                      {item.repoPath}
                    </div>
                  </div>
                  <Badge tone="line" className="text-[10px]">
                    {item.ext}
                  </Badge>
                  <span className="whitespace-nowrap font-g-mono text-g-caption text-g-ink-3">
                    {formatBytes(item.bytes)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
