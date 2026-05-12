import { Fragment, useRef, useState, type ReactNode } from "react";
import { Download, ListChecks, Plus, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type {
  BuiltinLintRuleSetting,
  CustomLintRuleClause,
  CustomLintRuleField,
  CustomLintRuleOperator,
  CustomLintRuleSetting,
  LintRuleSettings,
  LintRuleSeverity,
} from "@/types";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Notice,
  Select,
  Switch,
  Textarea,
  TextInput,
} from "@/components/ui";
import { errorMessage } from "@/i18n";
import type { SettingsDraft } from "./types";
import {
  customLintRuleFields,
  customLintRuleOperatorsByField,
  lintRulePresets,
  lintSeverities,
} from "./constants";
import {
  createCustomLintRule,
  createCustomLintRuleFromPreset,
  defaultLintRuleClause,
  defaultLintRuleClauseValue,
  defaultLintRuleGroup,
  lintRulesExportPayload,
  parseLintRulesImportPayload,
  sectionIcon,
} from "./helpers";

type LintRulesSectionProps = {
  draft: SettingsDraft;
  working: boolean;
  updateError: Error | null;
  settingActions: ReactNode;
  onUpdateDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void;
};

type DeleteTarget =
  | { type: "rule"; ruleId: string }
  | { type: "group"; ruleId: string; groupIndex: number }
  | { type: "clause"; ruleId: string; groupIndex: number; clauseIndex: number };

export function LintRulesSection({
  draft,
  working,
  updateError,
  settingActions,
  onUpdateDraft,
}: LintRulesSectionProps) {
  const { t } = useTranslation();
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [importNotice, setImportNotice] = useState<{
    tone: "success" | "danger";
    message: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function updateBuiltinRule(
    ruleId: string,
    updater: (rule: BuiltinLintRuleSetting) => BuiltinLintRuleSetting,
  ) {
    onUpdateDraft((current) => ({
      ...current,
      lintRules: {
        ...current.lintRules,
        builtinRules: current.lintRules.builtinRules.map((rule) =>
          rule.id === ruleId ? updater(rule) : rule,
        ),
      },
    }));
  }

  function updateCustomRules(
    updater: (rules: CustomLintRuleSetting[]) => CustomLintRuleSetting[],
  ) {
    onUpdateDraft((current) => ({
      ...current,
      lintRules: {
        ...current.lintRules,
        customRules: updater(current.lintRules.customRules),
      },
    }));
  }

  function updateCustomRule(
    ruleId: string,
    updater: (rule: CustomLintRuleSetting) => CustomLintRuleSetting,
  ) {
    updateCustomRules((rules) =>
      rules.map((rule) => (rule.id === ruleId ? updater(rule) : rule)),
    );
  }

  function updateClause(
    ruleId: string,
    groupIndex: number,
    clauseIndex: number,
    updater: (clause: CustomLintRuleClause) => CustomLintRuleClause,
  ) {
    updateCustomRule(ruleId, (rule) => ({
      ...rule,
      groups: rule.groups.map((group, currentGroupIndex) =>
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

  function confirmDelete() {
    if (!deleteTarget) return;
    if (deleteTarget.type === "rule") {
      updateCustomRules((rules) =>
        rules.filter((rule) => rule.id !== deleteTarget.ruleId),
      );
    } else if (deleteTarget.type === "group") {
      updateCustomRule(deleteTarget.ruleId, (rule) => ({
        ...rule,
        groups: rule.groups.filter(
          (_, index) => index !== deleteTarget.groupIndex,
        ),
      }));
    } else {
      updateCustomRule(deleteTarget.ruleId, (rule) => ({
        ...rule,
        groups: rule.groups.map((group, groupIndex) =>
          groupIndex === deleteTarget.groupIndex
            ? {
                clauses: group.clauses.filter(
                  (_, clauseIndex) => clauseIndex !== deleteTarget.clauseIndex,
                ),
              }
            : group,
        ),
      }));
    }
    setDeleteTarget(null);
  }

  function applyImportedLintRules(lintRules: LintRuleSettings) {
    onUpdateDraft((current) => ({
      ...current,
      lintRules,
    }));
  }

  function exportLintRules() {
    const blob = new Blob(
      [JSON.stringify(lintRulesExportPayload(draft.lintRules), null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `aisets-lint-rules-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importLintRules(file: File) {
    try {
      const parsed = parseLintRulesImportPayload(JSON.parse(await file.text()));
      applyImportedLintRules(parsed);
      setImportNotice({
        tone: "success",
        message: t("settings.lintRulesImportReady"),
      });
    } catch {
      setImportNotice({
        tone: "danger",
        message: t("settings.lintRulesImportInvalid"),
      });
    }
  }

  return (
    <>
      <Card
        className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm hover:border-g-line hover:shadow-g-sm"
        padding="none"
      >
        <div className="flex items-center gap-2.5 border-b border-g-line px-6 py-3 md:px-8">
          <span className="shrink-0 text-g-ink-3">
            {sectionIcon("lintRules")}
          </span>
          <span className="flex-1 font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
            {t("settings.section.lintRules")}
          </span>
        </div>

        <div className="px-6 py-5 md:px-8">
          <section className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-g-display text-g-body font-[590] tracking-g-ui text-g-ink">
                {t("settings.lintBuiltinRules")}
              </h3>
              <Badge tone="default">
                {t("settings.lintBuiltinCount", {
                  count: draft.lintRules.builtinRules.length,
                })}
              </Badge>
            </div>

            <div className="grid gap-2">
              {draft.lintRules.builtinRules.map((rule) => (
                <div
                  key={rule.id}
                  className="grid gap-2 rounded-g-md border border-g-line bg-g-surface-2 p-3 md:grid-cols-[minmax(0,1fr)_150px_120px_auto]"
                >
                  <div className="min-w-0">
                    <div className="font-g text-g-ui font-[590] tracking-g-ui text-g-ink">
                      {t(`lint.rule.${rule.id}.name`, {
                        defaultValue: rule.id,
                      })}
                    </div>
                    <div className="mt-0.5 font-g text-g-caption leading-[1.45] tracking-g-ui text-g-ink-4">
                      {t(`settings.lintRuleHelp.${rule.id}`, {
                        defaultValue: t("settings.lintRuleHelp.default"),
                      })}
                    </div>
                  </div>
                  <LabeledControl label={t("settings.lintSeverity")}>
                    <Select
                      size="md"
                      value={rule.severity}
                      disabled={working}
                      aria-label={t("settings.lintSeverity")}
                      options={severityOptions(t)}
                      onChange={(severity) =>
                        updateBuiltinRule(rule.id, (current) => ({
                          ...current,
                          severity: severity as LintRuleSeverity,
                        }))
                      }
                    />
                  </LabeledControl>
                  {rule.thresholdKB !== undefined ? (
                    <TextInput
                      size="md"
                      type="number"
                      min={1}
                      label={t("settings.lintThresholdKB")}
                      suffix="KB"
                      value={String(rule.thresholdKB)}
                      disabled={working}
                      aria-label={t("settings.lintThresholdKB")}
                      inputClassName="font-g-mono text-g-caption tracking-g-mono"
                      onChange={(event) =>
                        updateBuiltinRule(rule.id, (current) => ({
                          ...current,
                          thresholdKB: Math.max(
                            1,
                            Number(event.target.value) || 1,
                          ),
                        }))
                      }
                    />
                  ) : (
                    <div className="hidden md:block" />
                  )}
                  <LabeledControl label={t("settings.lintRuleEnabled")}>
                    <Switch
                      checked={rule.enabled}
                      disabled={working}
                      aria-label={t("settings.lintRuleEnabled")}
                      onCheckedChange={(enabled) =>
                        updateBuiltinRule(rule.id, (current) => ({
                          ...current,
                          enabled,
                        }))
                      }
                    />
                  </LabeledControl>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-6 grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-g-display text-g-body font-[590] tracking-g-ui text-g-ink">
                  {t("settings.lintCustomRules")}
                </h3>
                <p className="mt-0.5 font-g text-g-caption leading-[1.45] tracking-g-ui text-g-ink-4">
                  {t("settings.lintCustomRulesDesc")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={<Download size={13} />}
                  disabled={working}
                  onClick={exportLintRules}
                >
                  {t("settings.exportLintRules")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={<Upload size={13} />}
                  disabled={working}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {t("settings.importLintRules")}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) void importLintRules(file);
                  }}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  leadingIcon={<Plus size={13} />}
                  disabled={working}
                  onClick={() =>
                    updateCustomRules((rules) => [
                      ...rules,
                      createCustomLintRule(t("settings.lintRuleNewName")),
                    ])
                  }
                >
                  {t("settings.addLintRule")}
                </Button>
              </div>
            </div>

            {importNotice && (
              <Notice tone={importNotice.tone}>{importNotice.message}</Notice>
            )}

            <div className="flex flex-wrap gap-2">
              {lintRulePresets.map((preset) => (
                <Button
                  key={preset.name}
                  variant="ghost"
                  size="sm"
                  disabled={working}
                  leadingIcon={<ListChecks size={13} />}
                  onClick={() =>
                    updateCustomRules((rules) => [
                      ...rules,
                      createCustomLintRuleFromPreset(localizePreset(preset, t)),
                    ])
                  }
                >
                  {t(`settings.lintPreset.${preset.name}`, {
                    defaultValue: preset.name,
                  })}
                </Button>
              ))}
            </div>

            <div className="grid gap-3">
              {draft.lintRules.customRules.map((rule) => (
                <CustomRuleEditor
                  key={rule.id}
                  rule={rule}
                  working={working}
                  onUpdate={(updater) => updateCustomRule(rule.id, updater)}
                  onUpdateClause={(groupIndex, clauseIndex, updater) =>
                    updateClause(rule.id, groupIndex, clauseIndex, updater)
                  }
                  onDelete={(target) =>
                    setDeleteTarget({ ruleId: rule.id, ...target })
                  }
                />
              ))}
            </div>
          </section>

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
        title={t("settings.deleteLintRuleTitle")}
        message={t("settings.deleteLintRuleDesc")}
        confirmText={t("action.delete")}
        cancelText={t("common.cancel")}
        loading={working}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

function CustomRuleEditor({
  rule,
  working,
  onUpdate,
  onUpdateClause,
  onDelete,
}: {
  rule: CustomLintRuleSetting;
  working: boolean;
  onUpdate: (
    updater: (rule: CustomLintRuleSetting) => CustomLintRuleSetting,
  ) => void;
  onUpdateClause: (
    groupIndex: number,
    clauseIndex: number,
    updater: (clause: CustomLintRuleClause) => CustomLintRuleClause,
  ) => void;
  onDelete: (
    target:
      | { type: "rule" }
      | { type: "group"; groupIndex: number }
      | { type: "clause"; groupIndex: number; clauseIndex: number },
  ) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="rounded-g-md border border-g-line bg-g-surface-2 shadow-g-sm">
      <div className="grid gap-2 border-b border-g-line p-3 md:grid-cols-[minmax(0,1fr)_150px_auto_auto]">
        <TextInput
          value={rule.name}
          disabled={working}
          size="md"
          label={t("settings.lintRuleName")}
          aria-label={t("settings.lintRuleName")}
          inputClassName="font-g text-g-body font-[590] tracking-g-ui"
          onChange={(event) =>
            onUpdate((current) => ({ ...current, name: event.target.value }))
          }
        />
        <LabeledControl label={t("settings.lintSeverity")}>
          <Select
            size="md"
            value={rule.severity}
            disabled={working}
            aria-label={t("settings.lintSeverity")}
            options={severityOptions(t)}
            onChange={(severity) =>
              onUpdate((current) => ({
                ...current,
                severity: severity as LintRuleSeverity,
              }))
            }
          />
        </LabeledControl>
        <LabeledControl label={t("settings.lintRuleEnabled")}>
          <Switch
            checked={rule.enabled}
            disabled={working}
            aria-label={t("settings.lintRuleEnabled")}
            onCheckedChange={(enabled) =>
              onUpdate((current) => ({ ...current, enabled }))
            }
          />
        </LabeledControl>
        <button
          type="button"
          className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-g-md text-g-ink-3 transition-[background,color] duration-[120ms] ease-g hover:bg-g-red-soft hover:text-g-red focus-visible:outline-none focus-visible:shadow-g-focus"
          disabled={working}
          aria-label={t("action.delete")}
          onClick={() => onDelete({ type: "rule" })}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="grid gap-3 p-3">
        <div className="grid gap-2 md:grid-cols-2">
          <Textarea
            value={rule.message}
            disabled={working}
            rows={2}
            label={t("settings.lintRuleMessage")}
            aria-label={t("settings.lintRuleMessage")}
            placeholder={t("settings.lintRuleMessage")}
            onChange={(event) =>
              onUpdate((current) => ({
                ...current,
                message: event.target.value,
              }))
            }
          />
          <Textarea
            value={rule.suggestion}
            disabled={working}
            rows={2}
            label={t("settings.lintRuleSuggestion")}
            aria-label={t("settings.lintRuleSuggestion")}
            placeholder={t("settings.lintRuleSuggestion")}
            onChange={(event) =>
              onUpdate((current) => ({
                ...current,
                suggestion: event.target.value,
              }))
            }
          />
        </div>

        {rule.groups.map((group, groupIndex) => (
          <Fragment key={`${rule.id}-${groupIndex}`}>
            {groupIndex > 0 && (
              <div className="flex items-center gap-2">
                <div className="flex-1 border-t border-dashed border-g-line" />
                <span className="rounded-g-pill bg-g-surface px-2 py-0.5 font-g-mono text-g-chip font-[590] text-g-ink-3">
                  OR
                </span>
                <div className="flex-1 border-t border-dashed border-g-line" />
                <button
                  type="button"
                  className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-g-md text-g-ink-3 hover:bg-g-red-soft hover:text-g-red"
                  disabled={working || rule.groups.length <= 1}
                  aria-label={t("settings.deleteLintRuleGroup")}
                  onClick={() => onDelete({ type: "group", groupIndex })}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )}
            <div className="grid gap-1.5">
              {group.clauses.map((clause, clauseIndex) => (
                <Fragment key={`${rule.id}-${groupIndex}-${clauseIndex}`}>
                  {clauseIndex > 0 && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 border-t border-g-line/40" />
                      <span className="font-g-mono text-[10px] font-[510] uppercase tracking-[0.08em] text-g-ink-4/50">
                        AND
                      </span>
                      <div className="flex-1 border-t border-g-line/40" />
                      <div className="size-6 shrink-0" />
                    </div>
                  )}
                  <ClauseEditor
                    clause={clause}
                    working={working}
                    onChange={(updater) =>
                      onUpdateClause(groupIndex, clauseIndex, updater)
                    }
                    onDelete={() =>
                      onDelete({ type: "clause", groupIndex, clauseIndex })
                    }
                    deleteDisabled={group.clauses.length <= 1}
                  />
                </Fragment>
              ))}
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={<Plus size={13} />}
                  disabled={working}
                  onClick={() =>
                    onUpdate((current) => ({
                      ...current,
                      groups: current.groups.map((currentGroup, index) =>
                        index === groupIndex
                          ? {
                              clauses: [
                                ...currentGroup.clauses,
                                defaultLintRuleClause(),
                              ],
                            }
                          : currentGroup,
                      ),
                    }))
                  }
                >
                  {t("settings.addLintRuleClause")}
                </Button>
              </div>
            </div>
          </Fragment>
        ))}
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={<Plus size={13} />}
          disabled={working}
          className="w-full"
          onClick={() =>
            onUpdate((current) => ({
              ...current,
              groups: [...current.groups, defaultLintRuleGroup()],
            }))
          }
        >
          {t("settings.addLintRuleGroup")}
        </Button>
      </div>
    </section>
  );
}

function ClauseEditor({
  clause,
  working,
  deleteDisabled,
  onChange,
  onDelete,
}: {
  clause: CustomLintRuleClause;
  working: boolean;
  deleteDisabled: boolean;
  onChange: (
    updater: (clause: CustomLintRuleClause) => CustomLintRuleClause,
  ) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const operators = customLintRuleOperatorsByField[clause.field];
  const valueOptions = lintClauseValueOptions(clause.field);
  return (
    <div
      className={cn(
        "grid items-center gap-2",
        operators.length === 1
          ? "md:grid-cols-[minmax(130px,1fr)_minmax(140px,1fr)_auto]"
          : "md:grid-cols-[minmax(130px,1fr)_minmax(120px,1fr)_minmax(140px,1.5fr)_auto]",
      )}
    >
      <LabeledControl label={t("settings.lintRuleFieldLabel")}>
        <Select
          size="md"
          value={clause.field}
          disabled={working}
          aria-label={t("settings.lintRuleFieldLabel")}
          options={customLintRuleFields.map((field) => ({
            value: field,
            label: t(`settings.lintRuleField.${field}`),
          }))}
          onChange={(field) => {
            const typedField = field as CustomLintRuleField;
            const operator = customLintRuleOperatorsByField[typedField][0];
            onChange(() => ({
              field: typedField,
              operator,
              value: defaultLintRuleClauseValue(typedField, operator),
            }));
          }}
        />
      </LabeledControl>
      {operators.length > 1 && (
        <LabeledControl label={t("settings.lintRuleOperatorLabel")}>
          <Select
            size="md"
            value={clause.operator}
            disabled={working}
            aria-label={t("settings.lintRuleOperatorLabel")}
            options={operators.map((operator) => ({
              value: operator,
              label: t(`settings.customFilterOperator.${operator}`),
            }))}
            onChange={(operator) => {
              const typedOperator = operator as CustomLintRuleOperator;
              onChange((current) => ({
                ...current,
                operator: typedOperator,
                value: defaultLintRuleClauseValue(current.field, typedOperator),
              }));
            }}
          />
        </LabeledControl>
      )}
      {valueOptions ? (
        <LabeledControl label={t("settings.lintRuleValueLabel")}>
          <Select
            size="md"
            value={clause.value}
            disabled={working}
            aria-label={t("settings.lintRuleValueLabel")}
            options={valueOptions.map((value) => ({
              value,
              label: t(`settings.customFilterValue.${value}`, {
                defaultValue: value,
              }),
            }))}
            onChange={(value) => onChange((current) => ({ ...current, value }))}
          />
        </LabeledControl>
      ) : (
        <TextInput
          size="md"
          value={clause.value}
          disabled={working}
          label={t("settings.lintRuleValueLabel")}
          aria-label={t("settings.lintRuleValueLabel")}
          inputClassName="font-g-mono text-g-caption tracking-g-mono"
          onChange={(event) =>
            onChange((current) => ({ ...current, value: event.target.value }))
          }
        />
      )}
      <button
        type="button"
        className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-g-md text-g-ink-3 transition-[background,color] duration-[120ms] ease-g hover:bg-g-red-soft hover:text-g-red disabled:cursor-not-allowed disabled:opacity-[0.38]"
        disabled={working || deleteDisabled}
        aria-label={t("action.delete")}
        onClick={onDelete}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function LabeledControl({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="font-g text-g-caption font-[510] tracking-[-0.011em] text-g-ink-3">
        {label}
      </span>
      {children}
    </div>
  );
}

function lintClauseValueOptions(field: CustomLintRuleField) {
  if (
    field === "animated" ||
    field === "alpha" ||
    field === "duplicate" ||
    field === "nearDuplicate" ||
    field === "optimizable" ||
    field === "exifGps" ||
    field === "hasLoading" ||
    field === "hasFetchPriority" ||
    field === "hasWidth" ||
    field === "hasHeight" ||
    field === "hasSrcset" ||
    field === "altEmpty"
  ) {
    return ["true", "false"];
  }
  if (field === "referenceKind") return ["string", "css-url", "pattern"];
  return null;
}

function severityOptions(t: ReturnType<typeof useTranslation>["t"]) {
  return lintSeverities.map((severity) => ({
    value: severity,
    label: t(`severity.${severity}`, { defaultValue: severity }),
  }));
}

function localizePreset(
  preset: Omit<CustomLintRuleSetting, "id" | "enabled">,
  t: ReturnType<typeof useTranslation>["t"],
) {
  return {
    ...preset,
    name: t(`settings.lintPreset.${preset.name}`, {
      defaultValue: preset.name,
    }),
    message: t(`settings.lintPresetMessage.${preset.name}`, {
      defaultValue: preset.message,
    }),
    suggestion: t(`settings.lintPresetSuggestion.${preset.name}`, {
      defaultValue: preset.suggestion,
    }),
  };
}
