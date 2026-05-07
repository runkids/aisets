import {
  FileWarning,
  Filter,
  FolderKanban,
  FolderOpen,
  Recycle,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { AssetItem, CustomAssetFilter } from "../types";
import { cn } from "@/lib/cn";
import { matchesOCRSearchText } from "../ocrSearch";
import { fileName, type Mode } from "../ui";
import { Keycap, TextInput } from "./ui";
import { DialogOverlay, DialogSurface, DialogViewport } from "./ui/DialogShell";

type Props = {
  open: boolean;
  assets: AssetItem[];
  customFilters: CustomAssetFilter[];
  ocrEnabled: boolean;
  ocrFuzzySearch: boolean;
  onClose: () => void;
  onNavigate: (mode: Mode) => void;
  onOpenAsset: (id: string) => void;
  onOpenCustomFilter: (id: string) => void;
};

type ModeItem = { id: Mode; labelKey: string; icon: ReactNode };
type AssetResult = { asset: AssetItem; matchedOCR: boolean };

const MODE_ITEMS: ModeItem[] = [
  {
    id: "projects",
    labelKey: "nav.projects",
    icon: <FolderKanban size={14} />,
  },
  { id: "browse", labelKey: "nav.browse", icon: <FolderOpen size={14} /> },
  { id: "duplicates", labelKey: "nav.duplicates", icon: <Recycle size={14} /> },
  { id: "unused", labelKey: "nav.unused", icon: <Trash2 size={14} /> },
  { id: "optimize", labelKey: "nav.optimize", icon: <Sparkles size={14} /> },
  { id: "lint", labelKey: "nav.lint", icon: <FileWarning size={14} /> },
  { id: "precheck", labelKey: "nav.precheck", icon: <ShieldCheck size={14} /> },
  { id: "settings", labelKey: "nav.settings", icon: <Settings size={14} /> },
];

export function CommandPalette({
  open,
  assets,
  customFilters,
  ocrEnabled,
  ocrFuzzySearch,
  onClose,
  onNavigate,
  onOpenAsset,
  onOpenCustomFilter,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const id = window.setTimeout(() => {
      setQuery("");
      setActiveIndex(0);
      inputRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(id);
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const modesWithLabels = MODE_ITEMS.map((mode) => ({
      ...mode,
      label: t(mode.labelKey),
    }));
    if (!q)
      return { modes: modesWithLabels.slice(0, 5), filters: [], assets: [] };

    const modes = modesWithLabels.filter((mode) =>
      mode.label.toLowerCase().includes(q),
    );
    const filters = customFilters
      .filter(
        (filter) =>
          filter.enabled &&
          (filter.name.toLowerCase().includes(q) ||
            filter.id.toLowerCase().includes(q)),
      )
      .slice(0, 6);
    const matched: AssetResult[] = assets
      .flatMap((asset) => {
        const pathMatch =
          fileName(asset.repoPath).toLowerCase().includes(q) ||
          asset.repoPath.toLowerCase().includes(q);
        const ocrMatch =
          ocrEnabled &&
          asset.ocr?.status === "ready" &&
          matchesOCRSearchText(
            asset.ocr.normalizedText ?? asset.ocr.text ?? "",
            q,
            { fuzzy: ocrFuzzySearch },
          );
        if (!pathMatch && !ocrMatch) return [];
        return [{ asset, matchedOCR: !pathMatch && ocrMatch }];
      })
      .slice(0, 8);
    return { modes, filters, assets: matched };
  }, [query, assets, customFilters, ocrEnabled, ocrFuzzySearch, t]);

  const totalItems =
    results.modes.length + results.filters.length + results.assets.length;
  const activeItemIndex =
    totalItems === 0 ? 0 : Math.min(activeIndex, totalItems - 1);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (totalItems > 0)
        setActiveIndex((index) => Math.min(index + 1, totalItems - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (totalItems > 0) setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (totalItems > 0) selectItem(activeItemIndex);
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  function selectItem(index: number) {
    if (index < 0 || index >= totalItems) return;

    if (index < results.modes.length) {
      onNavigate(results.modes[index].id);
    } else if (index < results.modes.length + results.filters.length) {
      const filter = results.filters[index - results.modes.length];
      if (filter) onOpenCustomFilter(filter.id);
    } else {
      const asset =
        results.assets[index - results.modes.length - results.filters.length];
      if (asset) onOpenAsset(asset.asset.id);
    }
    onClose();
  }

  if (!open) return null;

  const itemCls = cn(
    "flex items-center gap-2.5 w-full min-h-9 px-2.5 py-2 rounded-g-md text-g-ink-2 text-[13px] font-[510] tracking-[-0.012em] text-left",
    "transition-[background,color] duration-[120ms] ease-g active:scale-[0.99] active:transition-transform active:duration-[100ms] active:ease-g-spring",
    "hover:bg-g-surface-2 hover:text-g-ink",
    "data-[active=true]:bg-g-surface-2 data-[active=true]:text-g-ink data-[active=true]:font-[590] [[data-theme=dark]_&]:data-[active=true]:bg-g-surface-3",
    "focus-visible:outline-none focus-visible:shadow-g-focus",
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay asChild>
          <DialogOverlay layer="command" />
        </DialogPrimitive.Overlay>
        <DialogViewport layer="command" placement="top">
          <DialogPrimitive.Content
            asChild
            aria-label={t("commandPalette.ariaLabel")}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              inputRef.current?.focus();
            }}
          >
            <DialogSurface size="command" height="auto" motion="command">
              <DialogPrimitive.Title className="sr-only">
                {t("commandPalette.ariaLabel")}
              </DialogPrimitive.Title>
              <div className="flex items-center gap-3 px-4 py-3.5 bg-g-surface border-b border-g-line">
                <TextInput
                  ref={inputRef}
                  variant="command"
                  type="text"
                  icon={<Search size={16} aria-hidden="true" />}
                  suffix={<Keycap>Esc</Keycap>}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActiveIndex(0);
                  }}
                  onKeyDown={handleKey}
                  placeholder={t("commandPalette.placeholder")}
                  aria-label={t("commandPalette.searchAriaLabel")}
                  inputClassName="font-g text-[15px] tracking-g-ui text-g-ink placeholder:text-g-ink-4"
                />
              </div>

              <div className="max-h-[400px] overflow-y-auto p-2">
                {results.modes.length > 0 && (
                  <div className="px-3 pt-2.5 pb-1 text-g-ink-4 text-[10px] font-[510] leading-[1.4] tracking-[0.06em] uppercase">
                    {t("commandPalette.pages")}
                  </div>
                )}
                {results.modes.map((mode, index) => (
                  <button
                    key={mode.id}
                    type="button"
                    className={itemCls}
                    data-active={activeItemIndex === index || undefined}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectItem(index)}
                  >
                    <span
                      className="inline-flex text-current opacity-[0.82] shrink-0"
                      aria-hidden="true"
                    >
                      {mode.icon}
                    </span>
                    <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                      {mode.label}
                    </span>
                  </button>
                ))}

                {results.filters.length > 0 && (
                  <>
                    <div className="px-3 pt-2.5 pb-1 text-g-ink-4 text-[10px] font-[510] leading-[1.4] tracking-[0.06em] uppercase">
                      {t("commandPalette.customFilters")}
                    </div>
                    {results.filters.map((filter, index) => {
                      const resultIndex = results.modes.length + index;
                      return (
                        <button
                          key={filter.id}
                          type="button"
                          className={itemCls}
                          data-active={
                            activeItemIndex === resultIndex || undefined
                          }
                          onMouseEnter={() => setActiveIndex(resultIndex)}
                          onClick={() => selectItem(resultIndex)}
                        >
                          <span
                            className="inline-flex text-current opacity-[0.82] shrink-0"
                            aria-hidden="true"
                          >
                            <Filter size={14} />
                          </span>
                          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                            {filter.name}
                          </span>
                        </button>
                      );
                    })}
                  </>
                )}

                {results.assets.length > 0 && (
                  <div className="px-3 pt-2.5 pb-1 text-g-ink-4 text-[10px] font-[510] leading-[1.4] tracking-[0.06em] uppercase">
                    {t("commandPalette.assets")}
                  </div>
                )}
                {results.assets.map((result, index) => {
                  const { asset } = result;
                  const resultIndex =
                    results.modes.length + results.filters.length + index;
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      className={itemCls}
                      data-active={activeItemIndex === resultIndex || undefined}
                      onMouseEnter={() => setActiveIndex(resultIndex)}
                      onClick={() => selectItem(resultIndex)}
                    >
                      <span
                        className="grid place-items-center w-[34px] h-[34px] shrink-0 overflow-hidden border border-g-line rounded-g-md bg-g-surface"
                        aria-hidden="true"
                        style={{
                          backgroundImage:
                            "linear-gradient(45deg, var(--g-surface-3) 25%, transparent 25%), linear-gradient(-45deg, var(--g-surface-3) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--g-surface-3) 75%), linear-gradient(-45deg, transparent 75%, var(--g-surface-3) 75%)",
                          backgroundPosition: "0 0, 0 6px, 6px -6px, 6px 0",
                          backgroundSize: "12px 12px",
                        }}
                      >
                        <img
                          src={asset.thumbnailUrl || asset.url}
                          alt=""
                          loading="lazy"
                          className="max-w-[90%] max-h-[90%] object-contain"
                        />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-current font-g-mono text-xs font-[510]">
                          {fileName(asset.repoPath)}
                        </span>
                        <span className="overflow-hidden text-current opacity-[0.62] font-g-mono text-[11px] tracking-[-0.015em] text-ellipsis whitespace-nowrap">
                          {result.matchedOCR
                            ? t("commandPalette.ocrMatch")
                            : asset.repoPath}
                        </span>
                      </span>
                      <span className="ml-auto text-current opacity-60 font-g-mono text-[11px] font-[510] tracking-[-0.015em] whitespace-nowrap">
                        {asset.projectName}
                      </span>
                    </button>
                  );
                })}

                {totalItems === 0 && (
                  <div className="px-4 py-5 text-g-ink-4 text-[13px] text-center">
                    {t("common.noResults")}
                  </div>
                )}
              </div>
            </DialogSurface>
          </DialogPrimitive.Content>
        </DialogViewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
