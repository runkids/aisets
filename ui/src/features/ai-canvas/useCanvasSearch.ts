import { useEffect, useRef, useState } from "react";
import { embeddingStats, getCatalogItems, semanticSearch } from "@/api";
import type { AssetItem } from "@/types";
import type { TFunction } from "i18next";

export function useCanvasSearch(opts: {
  scanId: number | undefined;
  aiEnabled: boolean;
  t: TFunction;
}) {
  const { scanId, aiEnabled, t } = opts;

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AssetItem[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchOpen, setSearchOpen] = useState(true);
  const [searchError, setSearchError] = useState("");
  const [searchMode, setSearchMode] = useState<"catalog" | "semantic">(
    "catalog",
  );
  const [searchActiveIndex, setSearchActiveIndex] = useState(-1);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchSelectedIds, setSearchSelectedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [semanticAvailable, setSemanticAvailable] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const focusSearchAfterOpenRef = useRef(false);
  const searchOpenRef = useRef(searchOpen);

  useEffect(() => {
    if (!aiEnabled) return;
    let cancelled = false;
    embeddingStats()
      .then((stats) => {
        if (!cancelled) {
          setSemanticAvailable(
            (stats.textCount ?? 0) > 0 || (stats.imageCount ?? 0) > 0,
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [aiEnabled]);

  useEffect(() => {
    searchOpenRef.current = searchOpen;
    if (!searchOpen || !focusSearchAfterOpenRef.current) return;
    focusSearchAfterOpenRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [searchOpen]);

  useEffect(() => {
    function onCanvasSearchShortcut(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "p") return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const nextOpen = !searchOpenRef.current;
      searchOpenRef.current = nextOpen;
      focusSearchAfterOpenRef.current = nextOpen;
      setSearchOpen(nextOpen);
    }

    window.addEventListener("keydown", onCanvasSearchShortcut, {
      capture: true,
    });
    return () => {
      window.removeEventListener("keydown", onCanvasSearchShortcut, {
        capture: true,
      });
    };
  }, []);

  async function runSearch() {
    const q = query.trim();
    if (!q) return;
    if (searchMode === "catalog" && !scanId) {
      setSearchError(t("aiCanvas.missingScan"));
      return;
    }
    setSearchBusy(true);
    setSearchError("");
    setSearchActiveIndex(-1);
    setSearchSelectedIds(new Set());
    try {
      if (searchMode === "semantic") {
        const result = await semanticSearch({
          q,
          includeItems: true,
          limit: 200,
        });
        const items = result.results
          .map((r) => r.item)
          .filter((item): item is AssetItem => item != null);
        setSearchResults(items);
        setSearchTotal(result.results.length);
      } else {
        const page = await getCatalogItems({ scanId: scanId!, q, limit: 200 });
        setSearchResults(page.items);
        setSearchTotal(page.total);
      }
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : t("aiCanvas.searchError"),
      );
    } finally {
      setSearchBusy(false);
    }
  }

  return {
    query,
    setQuery,
    searchResults,
    setSearchResults,
    searchTotal,
    setSearchTotal,
    searchOpen,
    setSearchOpen,
    searchError,
    searchMode,
    setSearchMode,
    searchActiveIndex,
    setSearchActiveIndex,
    searchBusy,
    searchSelectedIds,
    setSearchSelectedIds,
    semanticAvailable,
    searchInputRef,
    focusSearchAfterOpenRef,
    runSearch,
  };
}
