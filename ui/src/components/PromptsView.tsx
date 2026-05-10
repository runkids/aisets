import {
  AlertTriangle,
  ChevronDown,
  Copy,
  MessageSquarePlus,
  Plus,
  RotateCcw,
  Gauge,
  Save,
  ScanText,
  Star,
  Tags,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { cn } from "@/lib/cn";
import { errorMessage } from "../i18n/index";
import { useToast } from "./ToastProvider";
import {
  usePromptPresetsQuery,
  useCreatePromptPresetMutation,
  useUpdatePromptPresetMutation,
  useDeletePromptPresetMutation,
  useSetPromptPresetDefaultMutation,
} from "../queries";
import type {
  PromptPreset,
  PromptPresetContent,
  PromptPresetType,
  PromptVariable,
} from "../types";
import {
  Badge,
  Button,
  Card,
  CopyButton,
  EmptyState,
  Keycap,
  Rail,
  RailItem,
  RailSection,
  Select,
  TextInput,
} from "./ui";
import {
  VariableNode,
  templateToContent,
  contentToTemplate,
  extractVariableNames,
} from "./prompts/VariableExtension";
import { VariablesPanel } from "./prompts/VariablesPanel";
import {
  getBuiltinVariables,
  getDefaultValue,
  getMissingRequired,
} from "./prompts/builtinVariables";

export function PromptsView() {
  const { t } = useTranslation();
  const [selectedType, setSelectedType] = useState<PromptPresetType>("tag");
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);

  const presetsQuery = usePromptPresetsQuery(selectedType);
  const presets = useMemo(
    () => presetsQuery.data?.presets ?? [],
    [presetsQuery.data?.presets],
  );

  const effectiveSelectedId = useMemo(() => {
    if (selectedPresetId && presets.some((p) => p.id === selectedPresetId)) {
      return selectedPresetId;
    }
    return presets.length > 0 ? presets[0].id : null;
  }, [presets, selectedPresetId]);

  const selectedPreset = useMemo(
    () => presets.find((p) => p.id === effectiveSelectedId) ?? null,
    [presets, effectiveSelectedId],
  );

  function handleTypeChange(type: PromptPresetType) {
    setSelectedType(type);
    setSelectedPresetId(null);
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <PresetList
        type={selectedType}
        presets={presets}
        selectedId={effectiveSelectedId}
        onTypeChange={handleTypeChange}
        onSelect={setSelectedPresetId}
      />
      <div className="content-scroll flex-1 overflow-y-auto overflow-x-hidden">
        {selectedPreset ? (
          <PresetEditor key={selectedPreset.id} preset={selectedPreset} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<MessageSquarePlus />}
              title={t("prompts.emptyState")}
              size="sm"
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sidebar — preset list                                             */
/* ------------------------------------------------------------------ */

function PresetList({
  type,
  presets,
  selectedId,
  onTypeChange,
  onSelect,
}: {
  type: PromptPresetType;
  presets: PromptPreset[];
  selectedId: string | null;
  onTypeChange: (type: PromptPresetType) => void;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const createMutation = useCreatePromptPresetMutation();

  function handleAdd() {
    createMutation.mutate(
      {
        type,
        name: t("prompts.newPresetName"),
        content: { template: "", variables: {} },
      },
      {
        onSuccess: (data) => {
          onSelect(data.preset.id);
          toast.success(t("prompts.toastCreated"));
        },
        onError: (err) => {
          toast.error(errorMessage(err), {
            title: t("prompts.toastCreateFailed"),
          });
        },
      },
    );
  }

  return (
    <>
      <Rail
        as="nav"
        variant="settings"
        className="ml-3 px-0"
        aria-label={t("prompts.title")}
      >
        {/* Type tabs */}
        <RailSection>
          <RailItem
            variant="settings"
            active={type === "tag"}
            icon={<Tags size={15} />}
            label={t("prompts.tagPresets")}
            onClick={() => onTypeChange("tag")}
          />
          <RailItem
            variant="settings"
            active={type === "ocr"}
            icon={<ScanText size={15} />}
            label={t("prompts.ocrPresets")}
            onClick={() => onTypeChange("ocr")}
          />
          <RailItem
            variant="settings"
            active={type === "optimize"}
            icon={<Gauge size={15} />}
            label={t("prompts.optimizePresets")}
            onClick={() => onTypeChange("optimize")}
          />
        </RailSection>

        {/* Preset list */}
        <RailSection heading={t("prompts.title")}>
          {presets.map((preset) => (
            <RailItem
              key={preset.id}
              variant="settings"
              active={selectedId === preset.id}
              icon={
                preset.isDefault ? (
                  <Star size={14} className="fill-current text-g-amber" />
                ) : undefined
              }
              label={preset.name}
              onClick={() => onSelect(preset.id)}
            />
          ))}
        </RailSection>

        {/* Add button */}
        <div className="px-1">
          <Button
            variant="secondary"
            className="w-full justify-center gap-1.5 text-g-ui"
            onClick={handleAdd}
            disabled={createMutation.isPending}
          >
            <Plus size={14} />
            {t("prompts.addPreset")}
          </Button>
        </div>
      </Rail>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Editor — preset editing surface                                   */
/* ------------------------------------------------------------------ */

function PresetEditor({ preset }: { preset: PromptPreset }) {
  const { t } = useTranslation();
  const toast = useToast();
  const updateMutation = useUpdatePromptPresetMutation();
  const deleteMutation = useDeletePromptPresetMutation();
  const setDefaultMutation = useSetPromptPresetDefaultMutation();
  const createMutation = useCreatePromptPresetMutation();

  const [name, setName] = useState(preset.name);
  const [variables, setVariables] = useState<Record<string, PromptVariable>>(
    () => {
      const stored = preset.content.variables ?? {};
      const names = extractVariableNames(preset.content.template);
      const merged: Record<string, PromptVariable> = {};
      for (const n of names) {
        if (stored[n] && stored[n].values.length > 0) {
          merged[n] = stored[n];
        } else {
          const builtin = getDefaultValue(preset.type, n);
          merged[n] = builtin ?? stored[n] ?? { type: "tags", values: [] };
        }
      }
      return merged;
    },
  );
  const [template, setTemplate] = useState(preset.content.template);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [newVarName, setNewVarName] = useState("");
  const [variablesOpen, setVariablesOpen] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(true);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        bold: false,
        italic: false,
        strike: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        horizontalRule: false,
      }),
      VariableNode,
      Placeholder.configure({
        placeholder: t("prompts.templatePlaceholder"),
      }),
    ],
    content: templateToContent(preset.content.template),
    onUpdate: ({ editor: ed }) => {
      const newTemplate = contentToTemplate(ed);
      setTemplate(newTemplate);
      syncVariables(newTemplate);
    },
  });

  const syncVariables = useCallback(
    (tmpl: string) => {
      const names = extractVariableNames(tmpl);
      setVariables((prev) => {
        const next: Record<string, PromptVariable> = {};
        for (const n of names) {
          if (prev[n]) {
            next[n] = prev[n];
          } else {
            const builtin = getDefaultValue(preset.type, n);
            next[n] = builtin ?? { type: "tags", values: [] };
          }
        }
        return next;
      });
    },
    [preset.type],
  );

  const preview = useMemo(() => {
    return formatPrompt(template, variables);
  }, [template, variables]);

  const serializedVars = useMemo(() => JSON.stringify(variables), [variables]);
  const serializedOriginalVars = useMemo(
    () => JSON.stringify(preset.content.variables),
    [preset.content.variables],
  );
  const isDirty =
    name !== preset.name ||
    template !== preset.content.template ||
    serializedVars !== serializedOriginalVars;

  function handleSave() {
    const content: PromptPresetContent = { template, variables };
    updateMutation.mutate(
      { id: preset.id, name, content },
      {
        onSuccess: () => toast.success(t("prompts.toastSaved")),
        onError: (err) =>
          toast.error(errorMessage(err), {
            title: t("prompts.toastSaveFailed"),
          }),
      },
    );
  }

  const handleSaveRef = useRef(handleSave);
  useEffect(() => {
    handleSaveRef.current = handleSave;
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "s") {
        e.preventDefault();
        if (isDirty) handleSaveRef.current();
      }
      if (e.key === "c" && !window.getSelection()?.toString()) {
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        if (preview) navigator.clipboard.writeText(preview);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDirty, preview]);

  function handleDelete() {
    if (preset.isDefault) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    deleteMutation.mutate(preset.id, {
      onSuccess: () => toast.success(t("prompts.toastDeleted")),
      onError: (err) =>
        toast.error(errorMessage(err), {
          title: t("prompts.toastDeleteFailed"),
        }),
    });
    setConfirmingDelete(false);
  }

  function handleDuplicate() {
    createMutation.mutate(
      {
        type: preset.type,
        name: `${name} (copy)`,
        content: { template, variables },
      },
      {
        onSuccess: () => toast.success(t("prompts.toastDuplicated")),
        onError: (err) =>
          toast.error(errorMessage(err), {
            title: t("prompts.toastCreateFailed"),
          }),
      },
    );
  }

  function handleSetDefault() {
    setDefaultMutation.mutate(preset.id, {
      onSuccess: () => toast.success(t("prompts.toastDefaultSet")),
      onError: (err) =>
        toast.error(errorMessage(err), {
          title: t("prompts.toastDefaultSetFailed"),
        }),
    });
  }

  const builtinVars = useMemo(
    () => getBuiltinVariables(preset.type),
    [preset.type],
  );

  const missingRequired = useMemo(
    () => getMissingRequired(preset.type, template),
    [preset.type, template],
  );

  function insertVariableByName(varName: string) {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .insertContent({
        type: "variable",
        attrs: { name: varName },
      })
      .run();
  }

  function handleCustomVarSubmit() {
    if (!newVarName.trim()) {
      setShowCustomInput(false);
      return;
    }
    const cleanName = newVarName.trim().replace(/\s+/g, "_");
    insertVariableByName(cleanName);
  }

  function handleResetToDefault() {
    const templates: Record<string, string> = {
      tag: `Analyze this image and respond with a JSON object containing:\n- "category": one of {{categories}}\n- "tags": {{tags}}\n- "description": {{description}}\n- "languages": {{languages}}\n\nRespond ONLY with valid JSON, no markdown or explanation.`,
      ocr: `Analyze this image and respond with a JSON object:\n- "text": {{text}}\n- "languages": {{languages}}\n\nRespond ONLY with valid JSON, no markdown or explanation.`,
      optimize: `Analyze this image and provide compression advice.\n\n{{fileMetadata}}\n\n{{lintFindings}}\n\n{{optimizationFindings}}\n\nBased on the image content AND the analysis above, respond as JSON:\n{\n  "contentType": one of {{contentTypes}},\n  "recommendedFormat": one of {{formats}},\n  "recommendedQuality": <number 1-100 or null for lossless>,\n  "lossless": <true|false>,\n  "rationale": "<2-3 sentences: explain your recommendation considering the lint findings and file characteristics>"\n}\n\n{{rules}}\n\nImportant:\n- If lint findings identify structural issues (embedded bitmaps, oversized raster), address them in your rationale\n- Your recommendation should complement, not contradict, the lint findings\n- Be specific about expected savings when possible\n- Always name the concrete target format in the rationale (e.g. "extract the embedded bitmap and convert to WebP at quality 80")\n- For files with mixed content (e.g. SVG containing embedded raster), recommend a specific format for the extracted raster portion, not just the container format\n\nRespond ONLY with the JSON object, no other text.`,
    };
    const defaultTemplate = templates[preset.type] ?? "";
    setTemplate(defaultTemplate);
    const names = extractVariableNames(defaultTemplate);
    const defaults: Record<string, PromptVariable> = {};
    for (const n of names) {
      const builtin = getDefaultValue(preset.type, n);
      defaults[n] = builtin ?? { type: "tags", values: [] };
    }
    setVariables(defaults);
    editor?.commands.setContent(templateToContent(defaultTemplate));
    toast.info(t("prompts.toastReset"));
  }

  const varCount = Object.keys(variables).length;

  return (
    <div className="flex min-h-full flex-col">
      {/* Editor content */}
      <div className="flex-1 px-5 py-4 pt-3">
        <Card padding="none" className="mx-auto max-w-[1040px] p-5">
          <div className="flex flex-col gap-6">
            {/* ── Name ── */}
            <TextInput
              label={t("prompts.nameLabel")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            {/* ── Template ── */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-g-ui font-[510] text-g-ink-2">
                  {t("prompts.templateLabel")}
                </label>
                <div className="flex items-center gap-2">
                  <div className="w-[200px]">
                    <Select
                      size="sm"
                      value=""
                      options={[
                        { value: "", label: t("prompts.insertVariable") },
                        ...builtinVars.map((bv) => ({
                          value: bv.name,
                          label: `{{${bv.name}}}${bv.required ? " ★" : ""}`,
                          description: t(bv.descriptionKey),
                        })),
                        {
                          value: "__custom__",
                          label: t("prompts.customVariable"),
                        },
                      ]}
                      onChange={(value) => {
                        if (value === "__custom__") {
                          setShowCustomInput(true);
                        } else if (value) {
                          insertVariableByName(value);
                        }
                      }}
                      aria-label={t("prompts.insertVariable")}
                    />
                  </div>
                  {showCustomInput && (
                    <div className="flex items-center gap-1">
                      <TextInput
                        size="sm"
                        placeholder="variable_name"
                        value={newVarName}
                        onChange={(e) => setNewVarName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleCustomVarSubmit();
                          if (e.key === "Escape") {
                            setShowCustomInput(false);
                            setNewVarName("");
                          }
                        }}
                        autoFocus
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleCustomVarSubmit}
                      >
                        {t("common.ok")}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              <div className="prompt-editor rounded-g-md border border-g-line bg-g-surface p-3">
                <EditorContent editor={editor} />
              </div>
              {missingRequired.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-g-md border border-g-amber/30 bg-g-amber/5 px-3 py-2 text-g-ui text-g-amber">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>{t("prompts.missingRequired")}:</span>
                  {missingRequired.map((mv) => (
                    <button
                      key={mv.name}
                      type="button"
                      className="rounded-g-sm bg-g-amber/10 px-1.5 py-0.5 font-g-mono text-g-caption text-g-amber hover:bg-g-amber/20"
                      onClick={() => insertVariableByName(mv.name)}
                    >
                      {mv.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── Variables — collapsible ── */}
            {varCount > 0 && (
              <div>
                <button
                  type="button"
                  className="mb-1.5 flex w-full items-center gap-1.5 text-left"
                  onClick={() => setVariablesOpen(!variablesOpen)}
                  aria-expanded={variablesOpen}
                >
                  <ChevronDown
                    size={12}
                    className={cn(
                      "text-g-ink-4 transition-transform duration-150 ease-g",
                      !variablesOpen && "-rotate-90",
                    )}
                  />
                  <span className="text-g-ui font-[510] text-g-ink-2">
                    {t("prompts.variablesLabel")}
                  </span>
                  <Badge tone="default">{varCount}</Badge>
                </button>
                <div
                  className={cn(
                    "grid transition-[grid-template-rows] duration-200 ease-g motion-reduce:transition-none",
                    variablesOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                  )}
                >
                  <div className="overflow-hidden">
                    <VariablesPanel
                      variables={variables}
                      onChange={setVariables}
                      presetType={preset.type}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ── Preview — collapsible ── */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <button
                  type="button"
                  className="flex items-center gap-1.5"
                  onClick={() => setPreviewOpen(!previewOpen)}
                  aria-expanded={previewOpen}
                >
                  <ChevronDown
                    size={12}
                    className={cn(
                      "text-g-ink-4 transition-transform duration-150 ease-g",
                      !previewOpen && "-rotate-90",
                    )}
                  />
                  <span className="text-g-ui font-[510] text-g-ink-2">
                    {t("prompts.preview")}
                  </span>
                </button>
                {previewOpen && preview && (
                  <CopyButton value={preview} label="Copy preview" size="sm" />
                )}
              </div>
              <div
                className={cn(
                  "grid transition-[grid-template-rows] duration-200 ease-g motion-reduce:transition-none",
                  previewOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                )}
              >
                <div className="overflow-hidden">
                  <pre className="prompt-preview whitespace-pre-wrap rounded-g-md border border-g-line bg-g-surface p-3 shadow-g-sm font-g-mono text-g-caption leading-[1.65] tracking-g-mono text-g-ink">
                    {preview || (
                      <span className="text-g-ui text-g-ink-4">...</span>
                    )}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Sticky action bar */}
      <div className="sticky bottom-0 z-[5] border-t border-g-line bg-g-surface shadow-g-sm">
        <div className="mx-auto flex max-w-[1040px] flex-wrap items-center gap-2 px-5 py-2.5">
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!isDirty || updateMutation.isPending}
          >
            <Save size={14} />
            {t("prompts.save")}
            <Keycap size="sm" className="ml-1">
              ⌘S
            </Keycap>
          </Button>
          <Button variant="secondary" onClick={handleDuplicate}>
            <Copy size={14} />
            {t("prompts.duplicate")}
            <Keycap size="sm" className="ml-1">
              ⌘C
            </Keycap>
          </Button>
          <Button variant="secondary" onClick={handleResetToDefault}>
            <RotateCcw size={14} />
            {t("prompts.resetToDefault")}
          </Button>
          {!preset.isDefault && (
            <Button variant="secondary" onClick={handleSetDefault}>
              <Star size={14} />
              {t("prompts.setDefault")}
            </Button>
          )}
          {preset.isDefault && (
            <span className="text-g-caption text-g-ink-3">
              {t("prompts.isDefault")}
            </span>
          )}
          <div className="flex-1" />
          {confirmingDelete ? (
            <div className="flex items-center gap-1.5">
              <span className="text-g-ui text-g-red">
                {t("prompts.confirmDelete")}
              </span>
              <Button
                variant="danger"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                {t("prompts.confirmYes")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setConfirmingDelete(false)}
              >
                {t("prompts.confirmNo")}
              </Button>
            </div>
          ) : (
            <Button
              variant="danger"
              onClick={handleDelete}
              disabled={preset.isDefault || deleteMutation.isPending}
              title={
                preset.isDefault ? t("prompts.cannotDeleteDefault") : undefined
              }
            >
              <Trash2 size={14} />
              {t("prompts.delete")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function formatPrompt(
  template: string,
  variables: Record<string, PromptVariable>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const variable = variables[name];
    if (!variable || variable.values.length === 0) return `{{${name}}}`;
    if (variable.type === "tags") return variable.values.join(", ");
    return variable.values[0] ?? `{{${name}}}`;
  });
}
