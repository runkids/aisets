import {
  Filter,
  Info,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import {
  customAssetFilterUsesOCR,
  customAssetFilterUsesAI,
} from "@/customAssetFilters";
import { errorMessage } from "@/i18n";
import type { SettingsDraft } from "./types";
import type {
  CustomAssetFilter,
  CustomAssetFilterClause,
  CustomAssetFilterField,
  CustomAssetFilterOperator,
} from "@/types";
import { customFilterFields, customFilterOperatorsByField } from "./constants";
import {
  defaultClause,
  defaultClauseValue,
  defaultGroup,
  createCustomFilter,
  clauseValueOptions,
  operatorDescription,
} from "./helpers";
import { sectionIcon } from "./helpers";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DropdownMenu,
  EmptyState,
  IconButton,
  Modal,
  Notice,
  Select,
  Switch,
  TextInput,
} from "@/components/ui";

type CustomFiltersSectionProps = {
  draft: SettingsDraft;
  working: boolean;
  updateError: Error | null;
  settingActions: ReactNode;
  onUpdateDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void;
};

type CustomFilterDeleteTarget =
  | { type: "filter"; filterId: string }
  | { type: "group"; filterId: string; groupIndex: number }
  | {
      type: "clause";
      filterId: string;
      groupIndex: number;
      clauseIndex: number;
    };

export function CustomFiltersSection({
  draft,
  working,
  updateError,
  settingActions,
  onUpdateDraft,
}: CustomFiltersSectionProps) {
  const { t } = useTranslation();
  const [customFiltersHelpOpen, setCustomFiltersHelpOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] =
    useState<CustomFilterDeleteTarget | null>(null);

  function updateCustomFilters(
    updater: (filters: CustomAssetFilter[]) => CustomAssetFilter[],
  ) {
    onUpdateDraft((prev) => ({
      ...prev,
      customAssetFilters: updater(prev.customAssetFilters),
    }));
  }

  function updateCustomFilter(
    filterId: string,
    updater: (filter: CustomAssetFilter) => CustomAssetFilter,
  ) {
    updateCustomFilters((filters) =>
      filters.map((filter) =>
        filter.id === filterId ? updater(filter) : filter,
      ),
    );
  }

  function updateCustomFilterClause(
    filterId: string,
    groupIndex: number,
    clauseIndex: number,
    updater: (clause: CustomAssetFilterClause) => CustomAssetFilterClause,
  ) {
    updateCustomFilter(filterId, (filter) => ({
      ...filter,
      groups: filter.groups.map((group, currentGroupIndex) =>
        currentGroupIndex === groupIndex
          ? {
              clauses: group.clauses.map((clause, currentClauseIndex) =>
                currentClauseIndex === clauseIndex ? updater(clause) : clause,
              ),
            }
          : group,
      ),
    }));
  }

  function onAddCustomFilter() {
    updateCustomFilters((filters) => [
      ...filters,
      createCustomFilter(t("settings.customFilterNewName")),
    ]);
  }

  function onDeleteCustomFilter(filterId: string) {
    updateCustomFilters((filters) =>
      filters.filter((filter) => filter.id !== filterId),
    );
  }

  function onAddCustomFilterGroup(filterId: string) {
    updateCustomFilter(filterId, (filter) => ({
      ...filter,
      groups: [...filter.groups, defaultGroup()],
    }));
  }

  function onDeleteCustomFilterGroup(filterId: string, groupIndex: number) {
    updateCustomFilter(filterId, (filter) => ({
      ...filter,
      groups: filter.groups.filter((_, index) => index !== groupIndex),
    }));
  }

  function onAddCustomFilterClause(filterId: string, groupIndex: number) {
    updateCustomFilter(filterId, (filter) => ({
      ...filter,
      groups: filter.groups.map((group, index) =>
        index === groupIndex
          ? { clauses: [...group.clauses, defaultClause()] }
          : group,
      ),
    }));
  }

  function onDeleteCustomFilterClause(
    filterId: string,
    groupIndex: number,
    clauseIndex: number,
  ) {
    updateCustomFilter(filterId, (filter) => ({
      ...filter,
      groups: filter.groups.map((group, index) =>
        index === groupIndex
          ? {
              clauses: group.clauses.filter(
                (_, currentIndex) => currentIndex !== clauseIndex,
              ),
            }
          : group,
      ),
    }));
  }

  function onConfirmDeleteCustomFilterTarget() {
    if (!deleteTarget) return;
    if (deleteTarget.type === "filter") {
      onDeleteCustomFilter(deleteTarget.filterId);
    } else if (deleteTarget.type === "group") {
      onDeleteCustomFilterGroup(deleteTarget.filterId, deleteTarget.groupIndex);
    } else {
      onDeleteCustomFilterClause(
        deleteTarget.filterId,
        deleteTarget.groupIndex,
        deleteTarget.clauseIndex,
      );
    }
    setDeleteTarget(null);
  }

  function onCustomFilterFieldChange(
    filterId: string,
    groupIndex: number,
    clauseIndex: number,
    field: CustomAssetFilterField,
  ) {
    const operator = customFilterOperatorsByField[field][0];
    updateCustomFilterClause(filterId, groupIndex, clauseIndex, () => ({
      field,
      operator,
      value: defaultClauseValue(field, operator),
    }));
  }

  function onCustomFilterOperatorChange(
    filterId: string,
    groupIndex: number,
    clauseIndex: number,
    operator: CustomAssetFilterOperator,
  ) {
    updateCustomFilterClause(filterId, groupIndex, clauseIndex, (clause) => ({
      ...clause,
      operator,
      value: defaultClauseValue(clause.field, operator),
    }));
  }

  return (
    <>
      <Card
        className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm hover:border-g-line hover:shadow-g-sm"
        padding="none"
      >
        <div className="flex items-center gap-2.5 border-b border-g-line px-6 py-3 md:px-8">
          <span className="shrink-0 text-g-ink-3">
            {sectionIcon("customFilters")}
          </span>
          <span className="flex-1 font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
            {t("settings.section.customFilters")}
          </span>
          <IconButton
            size="sm"
            aria-label={t("settings.customFiltersHelp")}
            onClick={() => setCustomFiltersHelpOpen(true)}
          >
            <Info size={15} />
          </IconButton>
        </div>
        <div className="px-6 py-5 md:px-8">
          {draft.customAssetFilters.length > 0 && (
            <div className="mb-4 flex items-center justify-end">
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Plus size={13} />}
                disabled={working}
                onClick={onAddCustomFilter}
              >
                {t("settings.addCustomFilter")}
              </Button>
            </div>
          )}

          {draft.customAssetFilters.length === 0 ? (
            <EmptyState
              size="sm"
              icon={<Filter />}
              title={t("settings.noCustomFilters")}
              description={t("settings.customFiltersDesc")}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  leadingIcon={<Plus size={13} />}
                  disabled={working}
                  onClick={onAddCustomFilter}
                >
                  {t("settings.addCustomFilter")}
                </Button>
              }
              className="mt-5 rounded-g-md border border-g-line bg-g-surface-2"
            />
          ) : (
            <div className="mt-5 grid gap-3">
              {draft.customAssetFilters.map((filter) => {
                const ocrUnavailable =
                  customAssetFilterUsesOCR(filter) && !draft.ocrEnabled;
                const aiUnavailable =
                  customAssetFilterUsesAI(filter) && !draft.llmEnabled;
                return (
                  <section
                    key={filter.id}
                    className="rounded-g-md border border-g-line bg-g-surface-2 shadow-g-sm"
                  >
                    {/* Filter header */}
                    <div className="flex items-center gap-2 border-b border-g-line px-3 py-2">
                      <TextInput
                        value={filter.name}
                        disabled={working}
                        size="md"
                        icon={<Pencil size={13} />}
                        inputClassName="font-g text-g-body font-[590] tracking-g-ui"
                        aria-label={t("settings.customFilterName")}
                        onChange={(event) =>
                          updateCustomFilter(filter.id, (current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                      />
                      {ocrUnavailable && (
                        <Badge tone="amber" className="shrink-0">
                          {t("settings.customFilterOCRDisabled")}
                        </Badge>
                      )}
                      {aiUnavailable && (
                        <Badge tone="amber" className="shrink-0">
                          {t("settings.customFilterAIDisabled")}
                        </Badge>
                      )}
                      <Switch
                        checked={filter.enabled}
                        disabled={working}
                        onCheckedChange={(enabled) =>
                          updateCustomFilter(filter.id, (current) => ({
                            ...current,
                            enabled,
                          }))
                        }
                        aria-label={t("settings.customFilterEnabled")}
                      />
                      <DropdownMenu
                        trigger={
                          <button
                            type="button"
                            className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-g-md text-g-ink-3 transition-[background,color] duration-[120ms] ease-g hover:bg-g-surface-3 hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus"
                            aria-label={t("action.more")}
                          >
                            <MoreHorizontal size={15} />
                          </button>
                        }
                        items={[
                          {
                            label: t("action.delete"),
                            icon: <Trash2 size={15} />,
                            variant: "danger" as const,
                            disabled: working,
                            onClick: () =>
                              setDeleteTarget({
                                type: "filter",
                                filterId: filter.id,
                              }),
                          },
                        ]}
                      />
                    </div>

                    {/* Groups & clauses */}
                    <div className="px-3 py-3">
                      {filter.groups.map((group, groupIndex) => (
                        <Fragment key={`${filter.id}-${groupIndex}`}>
                          {/* OR divider between groups */}
                          {groupIndex > 0 && (
                            <div className="my-3 flex items-center gap-2">
                              <div className="flex-1 border-t border-dashed border-g-line" />
                              <span className="shrink-0 rounded-g-pill bg-g-surface px-2.5 py-0.5 font-g-mono text-g-chip font-[590] uppercase tracking-g-mono text-g-ink-3">
                                OR
                              </span>
                              <div className="flex-1 border-t border-dashed border-g-line" />
                              <button
                                type="button"
                                className={cn(
                                  "grid size-6 shrink-0 cursor-pointer place-items-center rounded-g-md transition-[background,color] duration-[120ms] ease-g hover:bg-g-red-soft focus-visible:outline-none focus-visible:shadow-g-focus",
                                  "text-g-ink-3 hover:text-g-red",
                                )}
                                disabled={working || filter.groups.length <= 1}
                                aria-label={t(
                                  "settings.deleteCustomFilterGroup",
                                )}
                                onClick={() =>
                                  setDeleteTarget({
                                    type: "group",
                                    filterId: filter.id,
                                    groupIndex,
                                  })
                                }
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          )}

                          {/* Clause rows */}
                          <div className="grid gap-1.5">
                            {group.clauses.map((clause, clauseIndex) => {
                              const valueOptions = clauseValueOptions(
                                clause.field,
                              );
                              const singleOperator =
                                customFilterOperatorsByField[clause.field]
                                  .length === 1;
                              return (
                                <Fragment
                                  key={`${filter.id}-${groupIndex}-${clauseIndex}`}
                                >
                                  {clauseIndex > 0 && (
                                    <div className="flex items-center gap-2">
                                      <div className="flex-1 border-t border-g-line/40" />
                                      <span className="shrink-0 font-g-mono text-[10px] font-[510] uppercase tracking-[0.08em] text-g-ink-4/50">
                                        AND
                                      </span>
                                      <div className="flex-1 border-t border-g-line/40" />
                                      <div className="size-6 shrink-0" />
                                    </div>
                                  )}
                                  <div
                                    className={cn(
                                      "grid items-center gap-2",
                                      singleOperator
                                        ? "sm:grid-cols-[minmax(140px,1fr)_minmax(140px,1fr)_auto]"
                                        : "sm:grid-cols-[minmax(120px,1fr)_minmax(120px,1fr)_minmax(140px,1.5fr)_auto]",
                                    )}
                                  >
                                    <Select
                                      size="md"
                                      value={clause.field}
                                      className="min-w-0"
                                      aria-label={t(
                                        "settings.customFilterFieldLabel",
                                      )}
                                      options={customFilterFields.map(
                                        (field) => ({
                                          value: field,
                                          label: t(
                                            `settings.customFilterField.${field}`,
                                          ),
                                          description: t(
                                            `settings.customFilterFieldDesc.${field}`,
                                          ),
                                        }),
                                      )}
                                      onChange={(field) =>
                                        onCustomFilterFieldChange(
                                          filter.id,
                                          groupIndex,
                                          clauseIndex,
                                          field as CustomAssetFilterField,
                                        )
                                      }
                                    />
                                    {!singleOperator && (
                                      <Select
                                        size="md"
                                        value={clause.operator}
                                        className="min-w-0"
                                        aria-label={t(
                                          "settings.customFilterOperatorLabel",
                                        )}
                                        options={customFilterOperatorsByField[
                                          clause.field
                                        ].map((operator) => ({
                                          value: operator,
                                          label: t(
                                            `settings.customFilterOperator.${operator}`,
                                          ),
                                          description: operatorDescription(
                                            clause.field,
                                            operator,
                                            t,
                                          ),
                                        }))}
                                        onChange={(operator) =>
                                          onCustomFilterOperatorChange(
                                            filter.id,
                                            groupIndex,
                                            clauseIndex,
                                            operator as CustomAssetFilterOperator,
                                          )
                                        }
                                      />
                                    )}
                                    {valueOptions ? (
                                      <Select
                                        size="md"
                                        value={clause.value}
                                        className="min-w-0"
                                        aria-label={t(
                                          "settings.customFilterValueLabel",
                                        )}
                                        options={valueOptions.map((value) => ({
                                          value,
                                          label: t(
                                            `settings.customFilterValue.${value}`,
                                          ),
                                        }))}
                                        onChange={(value) =>
                                          updateCustomFilterClause(
                                            filter.id,
                                            groupIndex,
                                            clauseIndex,
                                            (current) => ({
                                              ...current,
                                              value,
                                            }),
                                          )
                                        }
                                      />
                                    ) : (
                                      <TextInput
                                        size="md"
                                        value={clause.value}
                                        disabled={working}
                                        inputClassName="font-g-mono text-g-caption tracking-g-mono"
                                        aria-label={t(
                                          "settings.customFilterValueLabel",
                                        )}
                                        placeholder={t(
                                          `settings.customFilterValuePlaceholder.${clause.field}`,
                                        )}
                                        onChange={(event) =>
                                          updateCustomFilterClause(
                                            filter.id,
                                            groupIndex,
                                            clauseIndex,
                                            (current) => ({
                                              ...current,
                                              value: event.target.value,
                                            }),
                                          )
                                        }
                                      />
                                    )}
                                    <button
                                      type="button"
                                      className={cn(
                                        "grid size-7 shrink-0 cursor-pointer place-items-center rounded-g-md transition-[background,color] duration-[120ms] ease-g focus-visible:outline-none focus-visible:shadow-g-focus",
                                        "text-g-ink-3 hover:bg-g-red-soft hover:text-g-red",
                                        "disabled:cursor-not-allowed disabled:opacity-[0.38]",
                                      )}
                                      disabled={
                                        working || group.clauses.length <= 1
                                      }
                                      aria-label={t("action.delete")}
                                      onClick={() =>
                                        setDeleteTarget({
                                          type: "clause",
                                          filterId: filter.id,
                                          groupIndex,
                                          clauseIndex,
                                        })
                                      }
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </div>
                                </Fragment>
                              );
                            })}
                          </div>

                          {/* Add rule */}
                          <div className="mt-2 flex justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              leadingIcon={<Plus size={13} />}
                              disabled={working}
                              onClick={() =>
                                onAddCustomFilterClause(filter.id, groupIndex)
                              }
                            >
                              {t("settings.addCustomFilterClause")}
                            </Button>
                          </div>
                        </Fragment>
                      ))}

                      {/* Add OR group */}
                      <div className="mt-3 border-t border-g-line pt-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          leadingIcon={<Plus size={13} />}
                          disabled={working}
                          className="w-full"
                          onClick={() => onAddCustomFilterGroup(filter.id)}
                        >
                          {t("settings.addCustomFilterGroup")}
                        </Button>
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          )}
          {updateError && (
            <Notice tone="danger" className="mt-4">
              {errorMessage(updateError)}
            </Notice>
          )}
          {settingActions}
        </div>
      </Card>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        variant="danger"
        title={
          deleteTarget?.type === "filter"
            ? t("settings.deleteCustomFilterTitle")
            : deleteTarget?.type === "group"
              ? t("settings.deleteCustomFilterGroupTitle")
              : t("settings.deleteCustomFilterClauseTitle")
        }
        message={
          deleteTarget?.type === "filter"
            ? t("settings.deleteCustomFilterDesc")
            : deleteTarget?.type === "group"
              ? t("settings.deleteCustomFilterGroupDesc")
              : t("settings.deleteCustomFilterClauseDesc")
        }
        confirmText={t("action.delete")}
        cancelText={t("common.cancel")}
        loading={working}
        onConfirm={onConfirmDeleteCustomFilterTarget}
        onCancel={() => setDeleteTarget(null)}
      />
      {customFiltersHelpOpen && (
        <Modal
          title={t("settings.customFiltersHelpTitle")}
          description={t("settings.customFiltersHelpDesc")}
          size="md"
          onClose={() => setCustomFiltersHelpOpen(false)}
          bodyClassName="space-y-5"
        >
          <section className="space-y-2">
            <h3 className="font-g-display text-g-body font-[590] tracking-g-ui text-g-ink">
              {t("settings.customFiltersHelpLogicTitle")}
            </h3>
            <p className="font-g text-g-ui leading-[1.6] tracking-g-ui text-g-ink-3">
              {t("settings.customFiltersHelpLogic")}
            </p>
          </section>
          <section className="space-y-2">
            <h3 className="font-g-display text-g-body font-[590] tracking-g-ui text-g-ink">
              {t("settings.customFiltersHelpStepsTitle")}
            </h3>
            <ol className="list-decimal space-y-1 pl-5 font-g text-g-ui leading-[1.6] tracking-g-ui text-g-ink-3">
              <li>{t("settings.customFiltersHelpStep1")}</li>
              <li>{t("settings.customFiltersHelpStep2")}</li>
              <li>{t("settings.customFiltersHelpStep3")}</li>
            </ol>
          </section>
          <section className="space-y-3">
            <h3 className="font-g-display text-g-body font-[590] tracking-g-ui text-g-ink">
              {t("settings.customFiltersHelpExamplesTitle")}
            </h3>
            {[
              {
                title: t("settings.customFiltersHelpIconAssetsTitle"),
                rows: [
                  [
                    t("settings.customFilterField.extension"),
                    t("settings.customFilterOperator.oneOf"),
                    ".svg,.ico",
                  ],
                ],
              },
              {
                title: t("settings.customFiltersHelpFolderSuffixTitle"),
                rows: [
                  [
                    t("settings.customFilterField.folder"),
                    t("settings.customFilterOperator.suffix"),
                    "icons",
                  ],
                ],
              },
              {
                title: t("settings.customFiltersHelpLargeUnusedTitle"),
                rows: [
                  [
                    t("settings.customFilterField.extension"),
                    t("settings.customFilterOperator.oneOf"),
                    ".png,.jpg,.webp",
                  ],
                  [
                    t("settings.customFilterField.bytes"),
                    t("settings.customFilterOperator.gte"),
                    "102400",
                  ],
                  [
                    t("settings.customFilterField.status"),
                    t("settings.customFilterValue.unused"),
                  ],
                ],
              },
              {
                title: t("settings.customFiltersHelpCleanupTitle"),
                rows: [
                  [
                    t("settings.customFilterField.nearDuplicate"),
                    t("settings.customFilterValue.true"),
                  ],
                  [
                    t("settings.customFilterField.optimizable"),
                    t("settings.customFilterValue.true"),
                  ],
                ],
              },
              {
                title: t("settings.customFiltersHelpUnprocessedTitle"),
                rows: [
                  [
                    t("settings.customFilterField.aiStatus"),
                    t("settings.customFilterValue.none"),
                  ],
                ],
              },
              {
                title: t("settings.customFiltersHelpLargePhotosTitle"),
                rows: [
                  [
                    t("settings.customFilterField.aiCategory"),
                    t("settings.customFilterOperator.equals"),
                    "photo",
                  ],
                  [
                    t("settings.customFilterField.bytes"),
                    t("settings.customFilterOperator.gte"),
                    "204800",
                  ],
                ],
              },
              {
                title: t("settings.customFiltersHelpTextImagesTitle"),
                rows: [
                  [
                    t("settings.customFilterField.ocrStatus"),
                    t("settings.customFilterValue.ready"),
                  ],
                  [
                    t("settings.customFilterField.ocrConfidence"),
                    t("settings.customFilterOperator.gte"),
                    "0.5",
                  ],
                ],
              },
            ].map((example) => (
              <div
                key={example.title}
                className="rounded-g-md border border-g-line bg-g-surface p-3"
              >
                <h4 className="font-g text-g-ui font-[590] tracking-g-ui text-g-ink">
                  {example.title}
                </h4>
                <div className="mt-2 grid gap-1">
                  {example.rows.map((row) => (
                    <div
                      key={row.join("-")}
                      className={cn(
                        "grid gap-2 rounded-g-md bg-g-surface-2 px-2 py-1.5 font-g-mono text-g-chip tracking-g-mono text-g-ink-2",
                        row.length === 2
                          ? "grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]"
                          : "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)]",
                      )}
                    >
                      {row.map((cell, i) => (
                        <span key={i} className="truncate">
                          {cell}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        </Modal>
      )}
    </>
  );
}
