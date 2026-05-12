import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRight,
  Hash,
  Languages,
  Layers,
  LoaderCircle,
  Merge,
  Pencil,
  Tags as TagsIcon,
  Trash2,
} from "lucide-react";
import {
  useCategoryClearMutation,
  useCategoryListQuery,
  useCategoryMergeMutation,
  useCategoryRenameMutation,
  useTagsQuery,
  useTagCategoriesQuery,
  useTagRenameMutation,
  useTagMergeMutation,
  useTagDeleteMutation,
  type TagListParams,
} from "../../tagsQueries";
import { useDebouncedValue } from "../../useDebouncedValue";
import { errorMessage } from "../../i18n";
import {
  isTranslateActivityBusy,
  type TranslateActivityState,
} from "../../activity/translateActivity";
import { batchActionButtonClassName } from "../optimize/optimizeTypes";
import {
  Button,
  ConfirmDialog,
  Modal,
  SegmentedControl,
  Select,
  StatCard,
  TextInput,
  TextInputClearButton,
  Tooltip,
  type SegmentedControlItem,
} from "../ui";
import { TagsGrid } from "./TagsGrid";
import { CategoriesGrid } from "./CategoriesGrid";
import { useToast } from "../shared/ToastProvider";
import { BulkSelectButton } from "../shared/BulkSelectButton";

type TaxonomyMode = "tags" | "categories";

const SORT_ITEMS: SegmentedControlItem<"count" | "alpha">[] = [
  { value: "count", label: "#" },
  { value: "alpha", label: "A-Z" },
];

const MODE_ITEMS: SegmentedControlItem<TaxonomyMode>[] = [
  { value: "tags", label: "Tags" },
  { value: "categories", label: "Categories" },
];

const TAG_LOCALE_OPTIONS = [
  { value: "en", label: "EN" },
  { value: "zh-TW", label: "繁中" },
  { value: "zh-CN", label: "简中" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
];

const TAG_LOCALE_LABELS = new Map(
  TAG_LOCALE_OPTIONS.map((option) => [option.value, option.label]),
);

function normalizeDisplayLocale(locale: string | undefined) {
  if (!locale) return "en";
  if (locale === "en" || locale.startsWith("en-")) return "en";
  return TAG_LOCALE_LABELS.has(locale) ? locale : "en";
}

export function tagViewLocaleOptions(translationLocales?: string[]) {
  const seen = new Set<string>();
  const locales =
    translationLocales && translationLocales.length > 0
      ? translationLocales
      : ["en"];
  return locales
    .map(normalizeDisplayLocale)
    .filter((locale) => {
      if (seen.has(locale)) return false;
      seen.add(locale);
      return TAG_LOCALE_LABELS.has(locale);
    })
    .map((locale) => ({
      value: locale,
      label: TAG_LOCALE_LABELS.get(locale) ?? locale,
    }));
}

export function defaultTagViewLocale(
  appLocale: string | undefined,
  translationLocales?: string[],
) {
  const normalizedAppLocale = normalizeDisplayLocale(appLocale);
  const options = tagViewLocaleOptions(translationLocales);
  if (
    normalizedAppLocale !== "en" &&
    options.some((option) => option.value === normalizedAppLocale)
  ) {
    return normalizedAppLocale;
  }
  return "en";
}

type TagsViewProps = {
  translateActivity: TranslateActivityState;
  translationLocales?: string[];
  onStartTranslate: () => void;
  onStopTranslate: () => void;
};

export function TagsView({
  translateActivity,
  translationLocales,
  onStartTranslate,
  onStopTranslate,
}: TagsViewProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();

  const [mode, setMode] = useState<TaxonomyMode>("tags");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"count" | "alpha">("count");
  const [category, setCategory] = useState("");
  const [viewLocale, setViewLocale] = useState(() =>
    defaultTagViewLocale(i18n.language, translationLocales),
  );
  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const translating = isTranslateActivityBusy(translateActivity);

  // Dialogs
  const [renameTag, setRenameTag] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const debouncedSearch = useDebouncedValue(search, 250);
  const localeOptions = useMemo(
    () => tagViewLocaleOptions(translationLocales),
    [translationLocales],
  );
  const appLocale = normalizeDisplayLocale(i18n.language);
  const showLocaleSelect = appLocale !== "en" && localeOptions.length > 1;
  const preferredLocale = defaultTagViewLocale(
    i18n.language,
    translationLocales,
  );

  useEffect(() => {
    setViewLocale((current) => {
      if (!showLocaleSelect) return "en";
      if (current === "en" && preferredLocale !== "en") {
        return preferredLocale;
      }
      if (localeOptions.some((option) => option.value === current)) {
        return current;
      }
      return preferredLocale;
    });
  }, [localeOptions, preferredLocale, showLocaleSelect]);

  const params: TagListParams = {
    q: debouncedSearch,
    sort,
    category,
    locale: viewLocale,
    limit: 500,
    offset: 0,
  };
  const categoryParams = {
    q: debouncedSearch,
    sort,
    locale: viewLocale,
    limit: 500,
    offset: 0,
  };

  const { data, isLoading } = useTagsQuery(params, mode === "tags");
  const { data: categoryData, isLoading: categoryLoading } =
    useCategoryListQuery(categoryParams, mode === "categories");
  const { data: catData } = useTagCategoriesQuery();
  const renameMutation = useTagRenameMutation();
  const mergeMutation = useTagMergeMutation();
  const deleteMutation = useTagDeleteMutation();
  const categoryRenameMutation = useCategoryRenameMutation();
  const categoryMergeMutation = useCategoryMergeMutation();
  const categoryClearMutation = useCategoryClearMutation();

  const totalTags = data?.total ?? 0;
  const taggedAssets = data?.totalTaggedAssets ?? 0;
  const topCategory = data?.topCategory ?? "—";
  const totalCategories = categoryData?.total ?? 0;
  const categorizedAssets = categoryData?.totalCategorizedAssets ?? 0;
  const dataTags = data?.tags;
  const tags = useMemo(() => dataTags ?? [], [dataTags]);
  const categories = useMemo(
    () => categoryData?.categories ?? [],
    [categoryData?.categories],
  );
  const maxCount = useMemo(
    () =>
      dataTags && dataTags.length > 0
        ? Math.max(...dataTags.map((t) => t.count))
        : 1,
    [dataTags],
  );
  const maxCategoryCount = useMemo(
    () =>
      categories.length > 0
        ? Math.max(...categories.map((c) => c.assetCount))
        : 1,
    [categories],
  );

  function handleTagClick(tag: string) {
    navigate(`/browse?q=${encodeURIComponent(tag)}`);
  }

  function handleCategoryClick(cat: string) {
    navigate(`/browse?aiCategory=${encodeURIComponent(cat)}`);
  }

  function handleTranslate() {
    onStartTranslate();
  }

  function handleModeChange(next: TaxonomyMode) {
    setMode(next);
    setSelected(new Set());
    setBulkMode(false);
    setSearch("");
    setCategory("");
  }

  const toggleSelect = useCallback((tag: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }, []);

  const allSelected = useMemo(
    () =>
      bulkMode &&
      (mode === "tags"
        ? tags.length > 0 &&
          selected.size >= tags.length &&
          tags.every((tag) => selected.has(tag.tag))
        : categories.length > 0 &&
          selected.size >= categories.length &&
          categories.every((cat) => selected.has(cat.category))),
    [bulkMode, mode, tags, categories, selected],
  );

  const toggleBulkMode = useCallback(() => {
    if (!bulkMode) {
      setBulkMode(true);
    } else if (allSelected) {
      setBulkMode(false);
      setSelected(new Set());
    } else {
      setSelected(
        mode === "tags"
          ? new Set(tags.map((tag) => tag.tag))
          : new Set(categories.map((cat) => cat.category)),
      );
    }
  }, [bulkMode, allSelected, mode, tags, categories]);

  const cancelBulk = useCallback(() => {
    setBulkMode(false);
    setSelected(new Set());
  }, []);

  // Rename
  function openRename(tag: string) {
    setRenameTag(tag);
    setRenameValue(tag);
  }

  function submitRename() {
    if (!renameTag || !renameValue.trim() || renameValue === renameTag) return;
    const mutation = mode === "tags" ? renameMutation : categoryRenameMutation;
    mutation.mutate(
      { from: renameTag, to: renameValue.trim() },
      {
        onSuccess: (res) => {
          toast.success(
            t(
              mode === "tags"
                ? "tags.renameSuccess"
                : "tags.renameCategorySuccess",
              {
                from: renameTag,
                to: renameValue.trim(),
                count: res.affected,
              },
            ),
          );
          setRenameTag(null);
          setSelected(new Set());
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  }

  // Merge
  function openMerge() {
    setMergeOpen(true);
    setMergeTarget(Array.from(selected)[0] ?? "");
  }

  function submitMerge() {
    const source = Array.from(selected).filter((s) => s !== mergeTarget);
    if (source.length === 0 || !mergeTarget.trim()) return;
    const mutation = mode === "tags" ? mergeMutation : categoryMergeMutation;
    mutation.mutate(
      { source, target: mergeTarget.trim() },
      {
        onSuccess: (res) => {
          toast.success(
            t(
              mode === "tags"
                ? "tags.mergeSuccess"
                : "tags.mergeCategorySuccess",
              {
                count: source.length,
                target: mergeTarget.trim(),
                affected: res.affected,
              },
            ),
          );
          setMergeOpen(false);
          setSelected(new Set());
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  }

  // Delete
  function submitDelete() {
    const values = Array.from(selected);
    if (values.length === 0) return;
    const mutation = mode === "tags" ? deleteMutation : categoryClearMutation;
    mutation.mutate(values, {
      onSuccess: (res) => {
        toast.success(
          t(
            mode === "tags"
              ? "tags.deleteSuccess"
              : "tags.clearCategorySuccess",
            {
              count: values.length,
              affected: res.affected,
            },
          ),
        );
        setDeleteOpen(false);
        setSelected(new Set());
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  }

  const isFiltered =
    debouncedSearch.length > 0 || (mode === "tags" && category.length > 0);

  const displayLabel = useCallback(
    (raw: string, translated?: string) => {
      if (!translated || translated === raw) return raw;
      return viewLocale === "en" ? translated : `${translated} (${raw})`;
    },
    [viewLocale],
  );

  const dbCatTr = data?.categoryTranslations;
  const categoryLabel = useCallback(
    (cat: string) => {
      const dbTr = dbCatTr?.[cat];
      const dbLabel = displayLabel(cat, dbTr);
      if (dbLabel) return dbLabel;
      const staticTr = t(`settings.aiCategory.${cat}`, { defaultValue: cat });
      return displayLabel(cat, staticTr);
    },
    [t, dbCatTr, displayLabel],
  );

  const catCategories = catData?.categories;
  const categorySelectOptions = useMemo(
    () => [
      { value: "", label: t("tags.allCategories") },
      ...(catCategories ?? []).map((c) => ({
        value: c,
        label: categoryLabel(c),
      })),
    ],
    [t, catCategories, categoryLabel],
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="content-scroll flex-1 overflow-y-auto overflow-x-hidden px-4 pb-12 max-[768px]:px-3">
        {/* Stat cards */}
        <div className="grid grid-cols-3 gap-3 mb-4 pt-3 max-[768px]:grid-cols-1">
          <StatCard
            label={
              mode === "tags" ? t("tags.totalTags") : t("tags.totalCategories")
            }
            value={mode === "tags" ? totalTags : totalCategories}
            icon={mode === "tags" ? <Hash size={14} /> : <Layers size={14} />}
          />
          <StatCard
            label={
              mode === "tags"
                ? t("tags.taggedAssets")
                : t("tags.categorizedAssets")
            }
            value={mode === "tags" ? taggedAssets : categorizedAssets}
            icon={<TagsIcon size={14} />}
            tone="accent"
          />
          <StatCard
            label={
              mode === "tags" ? t("tags.topCategory") : t("tags.uniqueTags")
            }
            value={
              mode === "tags"
                ? topCategory !== "—"
                  ? categoryLabel(topCategory)
                  : "—"
                : categories.reduce((sum, cat) => sum + cat.tagCount, 0)
            }
            icon={<Layers size={14} />}
            tone="blue"
          />
        </div>

        {/* Toolbar row 1: search + category + bulk toggle + sort */}
        <div className="sticky top-0 z-[4] -mx-4 mb-1 grid min-w-0 gap-1.5 bg-g-canvas px-4 pt-3 pb-1 max-[768px]:-mx-3 max-[768px]:px-3">
          <div className="flex items-center gap-2.5">
            <SegmentedControl
              value={mode}
              items={MODE_ITEMS.map((item) => ({
                ...item,
                label:
                  item.value === "tags"
                    ? t("tags.modeTags")
                    : t("tags.modeCategories"),
              }))}
              onChange={handleModeChange}
              ariaLabel={t("tags.modeLabel")}
            />
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                mode === "tags"
                  ? t("tags.searchPlaceholder")
                  : t("tags.categorySearchPlaceholder")
              }
              className="min-w-[200px] flex-1"
              suffix={
                search ? (
                  <TextInputClearButton
                    label="Clear"
                    onClick={() => setSearch("")}
                  />
                ) : undefined
              }
            />
            {mode === "tags" && (
              <Select
                value={category}
                options={categorySelectOptions}
                onChange={setCategory}
                aria-label={t("tags.categoryFilter")}
                size="md"
                className="w-44 flex-none"
              />
            )}
            {showLocaleSelect && (
              <Select
                value={viewLocale}
                options={localeOptions}
                onChange={setViewLocale}
                aria-label={t("tags.viewLocale")}
                size="md"
                className="w-24 flex-none"
              />
            )}
            <Tooltip label={t("tags.translateTooltip")} placement="top">
              <Button
                variant="secondary"
                size="md"
                leadingIcon={
                  translating ? (
                    <LoaderCircle size={14} className="animate-spin" />
                  ) : (
                    <Languages size={14} />
                  )
                }
                disabled={translating}
                onClick={handleTranslate}
                className="shrink-0"
              >
                {translating ? t("tags.translating") : t("tags.translateAll")}
              </Button>
            </Tooltip>
            {isFiltered && !isLoading && (
              <span className="text-g-caption text-g-ink-3 tabular-nums shrink-0">
                {t("tags.filterCount", {
                  shown: mode === "tags" ? tags.length : categories.length,
                  total: mode === "tags" ? totalTags : totalCategories,
                })}
              </span>
            )}
            <BulkSelectButton
              bulkMode={bulkMode}
              allSelected={allSelected}
              onToggle={toggleBulkMode}
              onCancel={cancelBulk}
              className="shrink-0"
            />
            <SegmentedControl
              value={sort}
              items={SORT_ITEMS}
              onChange={setSort}
              ariaLabel={t("tags.sortLabel")}
              variant="fixed"
            />
          </div>

          {/* Bulk action bar — same pattern as OptimizeView */}
          {bulkMode && (
            <div className="sticky top-0 z-[5] flex w-full min-h-[44px] items-center gap-0.5 overflow-x-auto rounded-g-md border border-g-line bg-g-surface-2 p-1 shadow-g-inset animate-[slideUp2_200ms_var(--g-ease-out)]">
              <span className="inline-flex min-h-[34px] shrink-0 items-center whitespace-nowrap px-2.5 font-g-mono text-g-body text-g-ink-2">
                {selected.size > 0
                  ? t("tags.selectionCount", { count: selected.size })
                  : t("tags.selectItems", {
                      defaultValue: "Select tags to manage",
                    })}
              </span>
              <span className="flex-1" />
              {selected.size === 1 && (
                <button
                  type="button"
                  className={batchActionButtonClassName}
                  onClick={() => openRename(Array.from(selected)[0])}
                >
                  <Pencil size={14} />
                  {t(mode === "tags" ? "tags.rename" : "tags.renameCategory")}
                </button>
              )}
              {selected.size >= 2 && (
                <button
                  type="button"
                  className={batchActionButtonClassName}
                  onClick={openMerge}
                >
                  <Merge size={14} />
                  {t(mode === "tags" ? "tags.merge" : "tags.mergeCategory")}
                </button>
              )}
              <button
                type="button"
                className={batchActionButtonClassName}
                onClick={() => setDeleteOpen(true)}
                disabled={selected.size === 0}
              >
                <Trash2 size={14} />
                {t(mode === "tags" ? "tags.delete" : "tags.clearCategory")}
              </button>
            </div>
          )}
        </div>

        {mode === "tags" ? (
          <TagsGrid
            tags={tags}
            maxCount={maxCount}
            isLoading={isLoading}
            selected={selected}
            translations={data?.translations}
            categoryTranslations={data?.categoryTranslations}
            displayLocale={viewLocale}
            highlightMissing={viewLocale !== i18n.language}
            onTagClick={handleTagClick}
            onToggleSelect={toggleSelect}
            bulkMode={bulkMode}
          />
        ) : (
          <CategoriesGrid
            categories={categories}
            maxCount={maxCategoryCount}
            isLoading={categoryLoading}
            selected={selected}
            translations={categoryData?.translations}
            topTagTranslations={categoryData?.tagTranslations}
            displayLocale={viewLocale}
            highlightMissing={viewLocale !== i18n.language}
            onCategoryClick={handleCategoryClick}
            onToggleSelect={toggleSelect}
            bulkMode={bulkMode}
          />
        )}

        {/* Browse all hint */}
        {mode === "tags" && tags.length > 0 && !isFiltered && !bulkMode && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-g-ui text-g-ink-3 hover:text-g-accent transition-colors cursor-pointer"
              onClick={() => navigate("/browse")}
            >
              {t("tags.browseAll")}
              <ArrowUpRight size={13} />
            </button>
          </div>
        )}
      </div>

      {/* Rename dialog */}
      {renameTag && (
        <Modal
          title={t(
            mode === "tags" ? "tags.renameTitle" : "tags.renameCategoryTitle",
          )}
          description={t(
            mode === "tags" ? "tags.renameDesc" : "tags.renameCategoryDesc",
            { tag: renameTag, category: renameTag },
          )}
          onClose={() => setRenameTag(null)}
          size="sm"
          footer={
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" onClick={() => setRenameTag(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                onClick={submitRename}
                disabled={
                  (mode === "tags"
                    ? renameMutation.isPending
                    : categoryRenameMutation.isPending) ||
                  !renameValue.trim() ||
                  renameValue === renameTag
                }
              >
                {(
                  mode === "tags"
                    ? renameMutation.isPending
                    : categoryRenameMutation.isPending
                )
                  ? t("common.saving")
                  : t(mode === "tags" ? "tags.rename" : "tags.renameCategory")}
              </Button>
            </div>
          }
        >
          <TextInput
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder={t("tags.renamePlaceholder")}
            className="w-full"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && submitRename()}
          />
        </Modal>
      )}

      {/* Merge dialog */}
      {mergeOpen && (
        <Modal
          title={t(
            mode === "tags" ? "tags.mergeTitle" : "tags.mergeCategoryTitle",
          )}
          description={t(
            mode === "tags" ? "tags.mergeDesc" : "tags.mergeCategoryDesc",
            { count: selected.size },
          )}
          onClose={() => setMergeOpen(false)}
          size="sm"
          footer={
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" onClick={() => setMergeOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                onClick={submitMerge}
                disabled={
                  (mode === "tags"
                    ? mergeMutation.isPending
                    : categoryMergeMutation.isPending) || !mergeTarget.trim()
                }
              >
                {(
                  mode === "tags"
                    ? mergeMutation.isPending
                    : categoryMergeMutation.isPending
                )
                  ? t("common.saving")
                  : t(mode === "tags" ? "tags.merge" : "tags.mergeCategory")}
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {Array.from(selected).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-g-pill bg-g-surface-3 px-2.5 py-1 text-g-ui text-g-ink-2"
                >
                  {tag}
                </span>
              ))}
            </div>
            <TextInput
              value={mergeTarget}
              onChange={(e) => setMergeTarget(e.target.value)}
              placeholder={t("tags.mergeTargetPlaceholder")}
              className="w-full"
              autoFocus
            />
          </div>
        </Modal>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteOpen}
        onConfirm={submitDelete}
        onCancel={() => setDeleteOpen(false)}
        title={t(
          mode === "tags" ? "tags.deleteTitle" : "tags.clearCategoryTitle",
        )}
        message={t(
          mode === "tags" ? "tags.deleteDesc" : "tags.clearCategoryDesc",
          { count: selected.size },
        )}
        confirmText={t(mode === "tags" ? "tags.delete" : "tags.clearCategory")}
        cancelText={t("common.cancel")}
        variant="danger"
        loading={
          mode === "tags"
            ? deleteMutation.isPending
            : categoryClearMutation.isPending
        }
      />
    </div>
  );
}
