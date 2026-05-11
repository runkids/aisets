import { useCallback, useMemo, useState } from "react";
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
  useTagsQuery,
  useTagCategoriesQuery,
  useTagRenameMutation,
  useTagMergeMutation,
  useTagDeleteMutation,
  type TagListParams,
} from "../tagsQueries";
import { useDebouncedValue } from "../useDebouncedValue";
import { errorMessage } from "../i18n";
import { runAITagTranslate } from "../api";
import { batchActionButtonClassName } from "./optimizeTypes";
import {
  Button,
  ConfirmDialog,
  Modal,
  SegmentedControl,
  Select,
  StatCard,
  TextInput,
  TextInputClearButton,
  type SegmentedControlItem,
} from "./ui";
import { TagsGrid } from "./TagsGrid";
import { useToast } from "./ToastProvider";
import { BulkSelectButton } from "./BulkSelectButton";

const SORT_ITEMS: SegmentedControlItem<"count" | "alpha">[] = [
  { value: "count", label: "#" },
  { value: "alpha", label: "A-Z" },
];

const LOCALE_OPTIONS = [
  { value: "en", label: "EN" },
  { value: "zh-TW", label: "繁中" },
  { value: "zh-CN", label: "简中" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
];

export function TagsView() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"count" | "alpha">("count");
  const [category, setCategory] = useState("");
  const [viewLocale, setViewLocale] = useState(i18n.language || "en");
  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [translating, setTranslating] = useState(false);

  // Dialogs
  const [renameTag, setRenameTag] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const debouncedSearch = useDebouncedValue(search, 250);

  const params: TagListParams = {
    q: debouncedSearch,
    sort,
    category,
    locale: viewLocale,
    limit: 500,
    offset: 0,
  };

  const { data, isLoading, refetch: refetchTags } = useTagsQuery(params);
  const { data: catData } = useTagCategoriesQuery();
  const renameMutation = useTagRenameMutation();
  const mergeMutation = useTagMergeMutation();
  const deleteMutation = useTagDeleteMutation();

  const totalTags = data?.total ?? 0;
  const taggedAssets = data?.totalTaggedAssets ?? 0;
  const topCategory = data?.topCategory ?? "—";
  const dataTags = data?.tags;
  const tags = useMemo(() => dataTags ?? [], [dataTags]);
  const maxCount = useMemo(
    () =>
      dataTags && dataTags.length > 0
        ? Math.max(...dataTags.map((t) => t.count))
        : 1,
    [dataTags],
  );

  function handleTagClick(tag: string) {
    navigate(`/browse?q=${encodeURIComponent(tag)}`);
  }

  async function handleTranslate() {
    setTranslating(true);
    try {
      await runAITagTranslate({
        onEvent: (event) => {
          if (event.type === "error") {
            toast.error(errorMessage(event));
          }
        },
      });
      toast.success(t("tags.translateDone"));
      void refetchTags();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setTranslating(false);
    }
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
      tags.length > 0 &&
      selected.size >= tags.length &&
      tags.every((tag) => selected.has(tag.tag)),
    [bulkMode, tags, selected],
  );

  const toggleBulkMode = useCallback(() => {
    if (!bulkMode) {
      setBulkMode(true);
    } else if (allSelected) {
      setBulkMode(false);
      setSelected(new Set());
    } else {
      setSelected(new Set(tags.map((tag) => tag.tag)));
    }
  }, [bulkMode, allSelected, tags]);

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
    renameMutation.mutate(
      { from: renameTag, to: renameValue.trim() },
      {
        onSuccess: (res) => {
          toast.success(
            t("tags.renameSuccess", {
              from: renameTag,
              to: renameValue.trim(),
              count: res.affected,
            }),
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
    mergeMutation.mutate(
      { source, target: mergeTarget.trim() },
      {
        onSuccess: (res) => {
          toast.success(
            t("tags.mergeSuccess", {
              count: source.length,
              target: mergeTarget.trim(),
              affected: res.affected,
            }),
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
    const tagsToDelete = Array.from(selected);
    if (tagsToDelete.length === 0) return;
    deleteMutation.mutate(tagsToDelete, {
      onSuccess: (res) => {
        toast.success(
          t("tags.deleteSuccess", {
            count: tagsToDelete.length,
            affected: res.affected,
          }),
        );
        setDeleteOpen(false);
        setSelected(new Set());
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  }

  const isFiltered = debouncedSearch.length > 0 || category.length > 0;

  const dbCatTr = data?.categoryTranslations;
  const categoryLabel = useCallback(
    (cat: string) => {
      const dbTr = dbCatTr?.[cat];
      if (dbTr && dbTr !== cat) return `${dbTr} (${cat})`;
      const staticTr = t(`settings.aiCategory.${cat}`, { defaultValue: cat });
      return staticTr !== cat ? `${staticTr} (${cat})` : cat;
    },
    [t, dbCatTr],
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
            label={t("tags.totalTags")}
            value={totalTags}
            icon={<Hash size={14} />}
          />
          <StatCard
            label={t("tags.taggedAssets")}
            value={taggedAssets}
            icon={<TagsIcon size={14} />}
            tone="accent"
          />
          <StatCard
            label={t("tags.topCategory")}
            value={topCategory !== "—" ? categoryLabel(topCategory) : "—"}
            icon={<Layers size={14} />}
            tone="blue"
          />
        </div>

        {/* Toolbar row 1: search + category + bulk toggle + sort */}
        <div className="sticky top-0 z-[4] -mx-4 mb-1 grid min-w-0 gap-1.5 bg-g-canvas px-4 pt-3 pb-1 max-[768px]:-mx-3 max-[768px]:px-3">
          <div className="flex items-center gap-2.5">
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("tags.searchPlaceholder")}
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
            <Select
              value={category}
              options={categorySelectOptions}
              onChange={setCategory}
              aria-label={t("tags.categoryFilter")}
              size="md"
              className="w-44 flex-none"
            />
            <Select
              value={viewLocale}
              options={LOCALE_OPTIONS}
              onChange={setViewLocale}
              aria-label={t("tags.viewLocale")}
              size="md"
              className="w-24 flex-none"
            />
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
            {isFiltered && !isLoading && (
              <span className="text-g-caption text-g-ink-3 tabular-nums shrink-0">
                {t("tags.filterCount", {
                  shown: tags.length,
                  total: totalTags,
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
                  {t("tags.rename")}
                </button>
              )}
              {selected.size >= 2 && (
                <button
                  type="button"
                  className={batchActionButtonClassName}
                  onClick={openMerge}
                >
                  <Merge size={14} />
                  {t("tags.merge")}
                </button>
              )}
              <button
                type="button"
                className={batchActionButtonClassName}
                onClick={() => setDeleteOpen(true)}
                disabled={selected.size === 0}
              >
                <Trash2 size={14} />
                {t("tags.delete")}
              </button>
            </div>
          )}
        </div>

        {/* Tag grid */}
        <TagsGrid
          tags={tags}
          maxCount={maxCount}
          isLoading={isLoading}
          selected={selected}
          translations={data?.translations}
          categoryTranslations={data?.categoryTranslations}
          highlightMissing={viewLocale !== i18n.language}
          onTagClick={handleTagClick}
          onToggleSelect={toggleSelect}
          bulkMode={bulkMode}
        />

        {/* Browse all hint */}
        {tags.length > 0 && !isFiltered && !bulkMode && (
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
          title={t("tags.renameTitle")}
          description={t("tags.renameDesc", { tag: renameTag })}
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
                  renameMutation.isPending ||
                  !renameValue.trim() ||
                  renameValue === renameTag
                }
              >
                {renameMutation.isPending
                  ? t("common.saving")
                  : t("tags.rename")}
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
          title={t("tags.mergeTitle")}
          description={t("tags.mergeDesc", { count: selected.size })}
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
                disabled={mergeMutation.isPending || !mergeTarget.trim()}
              >
                {mergeMutation.isPending ? t("common.saving") : t("tags.merge")}
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
        title={t("tags.deleteTitle")}
        message={t("tags.deleteDesc", { count: selected.size })}
        confirmText={t("tags.delete")}
        cancelText={t("common.cancel")}
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
