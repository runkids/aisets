import {
  ArrowLeftRight,
  Check,
  CheckCircle2,
  Code,
  ChevronDown,
  Download,
  Filter,
  FolderKanban,
  Globe2,
  Grid3X3,
  Image,
  Info,
  Keyboard,
  LoaderCircle,
  Monitor,
  Moon,
  MoreHorizontal,
  Paintbrush,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Scan,
  Settings2,
  Sliders,
  Square,
  Sun,
  Trash2,
  Upload,
} from "lucide-react";
import type { ChangeEvent, ReactNode } from "react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { Fragment, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { customAssetFilterUsesOCR } from "../customAssetFilters";
import { exportSettings } from "../api";
import { errorMessage, languageOptionsForLocale } from "../i18n/index";
import {
  useAddWorkspaceMutation,
  useCatalogQuery,
  useDirectoryListingQuery,
  useImportSettingsMutation,
  useInstallOCRMutation,
  useRemoveProjectMutation,
  useRemoveOCRMutation,
  useRemoveWorkspaceMutation,
  useRenameProjectMutation,
  useRenameWorkspaceMutation,
  useResetDatabaseMutation,
  useRunOCRMutation,
  useSettingsQuery,
  useSwitchWorkspaceMutation,
  useUpdateAppMutation,
  useUpdateSettingsMutation,
  useVersionQuery,
} from "../queries";
import type { ImageBackgroundMode } from "../imageBackground";
import type {
  CustomAssetFilter,
  CustomAssetFilterClause,
  CustomAssetFilterField,
  CustomAssetFilterGroup,
  CustomAssetFilterOperator,
  ExportData,
  OCRRunCounts,
  ScanAnalyses,
  ScanProfile,
  SettingsInfo,
  SettingsUpdate,
  Workspace,
} from "../types";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DropdownMenu,
  EmptyState,
  IconButton,
  Keycap,
  Modal,
  Notice,
  Rail,
  RailItem,
  RailSection,
  Select,
  Switch,
  Tabs,
  Textarea,
  TextInput,
} from "./ui";
import { ProjectAvatar } from "./ProjectAvatar";
import { ProjectDialog } from "./ProjectDialog";
import { useToast } from "./ToastProvider";
import { WorkspaceAvatar } from "./WorkspaceAvatar";

type ThemePreference = "light" | "dark" | "system";

type Props = {
  theme: ThemePreference;
  imagePreviewEnabled: boolean;
  imageBackgroundMode: ImageBackgroundMode;
  onThemeChange: (theme: ThemePreference) => void;
  onImagePreviewEnabledChange: (enabled: boolean) => void;
  onImageBackgroundModeChange: (mode: ImageBackgroundMode) => void;
};

type Section =
  | "workspace"
  | "projects"
  | "theme"
  | "scanning"
  | "customFilters"
  | "optimization"
  | "hotkeys"
  | "about";

type SettingsDraft = {
  workspaceName: string;
  defaultProjectRoot: string;
  autoScanOnOpen: boolean;
  scanOnOpen: boolean;
  scanProfile: ScanProfile;
  scanAnalyses: ScanAnalyses;
  ocrEnabled: boolean;
  ocrLanguages: string[];
  ocrMaxPixels: number;
  ocrBatchSize: number;
  ocrConcurrency: number;
  ocrFuzzySearch: boolean;
  excludePatternsText: string;
  optimizationDefaultQuality: number;
  optimizationAutoApply: boolean;
  customAssetFilters: CustomAssetFilter[];
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const sectionMeta: { id: Section; icon: ReactNode }[] = [
  { id: "workspace", icon: <Settings2 size={15} /> },
  { id: "projects", icon: <FolderKanban size={15} /> },
  { id: "theme", icon: <Paintbrush size={15} /> },
  { id: "scanning", icon: <Scan size={15} /> },
  { id: "customFilters", icon: <Filter size={15} /> },
  { id: "optimization", icon: <Sliders size={15} /> },
  { id: "hotkeys", icon: <Keyboard size={15} /> },
  { id: "about", icon: <Info size={15} /> },
];

const defaultSettings: SettingsUpdate = {
  workspaceName: "Asset Studio",
  defaultProjectRoot: "",
  autoScanOnOpen: false,
  scanOnOpen: false,
  scanProfile: "fast",
  scanAnalyses: {
    references: false,
    nearDuplicates: false,
    optimization: false,
  },
  ocrEnabled: false,
  ocrLanguages: ["eng"],
  ocrMaxPixels: 2_000_000,
  ocrBatchSize: 25,
  ocrConcurrency: 1,
  ocrFuzzySearch: true,
  excludePatterns: [],
  optimizationDefaultQuality: 80,
  optimizationAutoApply: false,
  customAssetFilters: [],
};

const scanProfileOptions: Array<{
  value: ScanProfile;
  label: string;
  description: string;
}> = [
  {
    value: "fast",
    label: "Fast",
    description: "Metadata and exact duplicates",
  },
  {
    value: "full",
    label: "Full",
    description: "All catalog analyses",
  },
  {
    value: "custom",
    label: "Custom",
    description: "Choose expensive analyses",
  },
];

const customFilterFields: CustomAssetFilterField[] = [
  "path",
  "folder",
  "extension",
  "project",
  "bytes",
  "status",
  "duplicate",
  "nearDuplicate",
  "optimizable",
  "ocrText",
  "ocrLanguage",
  "ocrScript",
  "ocrConfidence",
  "ocrStatus",
];

const customFilterOperatorsByField: Record<
  CustomAssetFilterField,
  CustomAssetFilterOperator[]
> = {
  path: ["contains", "prefix", "suffix", "equals", "regex"],
  folder: ["contains", "prefix", "suffix", "equals", "regex"],
  extension: ["equals", "oneOf"],
  project: ["equals", "contains", "oneOf"],
  bytes: ["gte", "lte"],
  status: ["is"],
  duplicate: ["is"],
  nearDuplicate: ["is"],
  optimizable: ["is"],
  ocrText: ["contains", "regex"],
  ocrLanguage: ["equals", "oneOf"],
  ocrScript: ["equals", "oneOf"],
  ocrConfidence: ["gte", "lte"],
  ocrStatus: ["is"],
};

const editorOptions = [
  { value: "vscode", label: "VS Code" },
  { value: "cursor", label: "Cursor" },
  { value: "windsurf", label: "Windsurf" },
  { value: "antigravity", label: "Antigravity" },
  { value: "trae", label: "Trae" },
  { value: "webstorm", label: "WebStorm" },
  { value: "idea", label: "IntelliJ IDEA" },
  { value: "goland", label: "GoLand" },
  { value: "pycharm", label: "PyCharm" },
  { value: "rubymine", label: "RubyMine" },
  { value: "phpstorm", label: "PhpStorm" },
  { value: "zed", label: "Zed" },
  { value: "sublime", label: "Sublime Text" },
];

function defaultClauseValue(
  field: CustomAssetFilterField,
  operator: CustomAssetFilterOperator,
) {
  if (field === "path" && operator === "regex") return ".*";
  if (field === "path" && operator === "suffix") return ".png";
  if (field === "path") return "/";
  if (field === "folder" && operator === "suffix") return "icons";
  if (field === "folder" && operator === "regex") return "assets/.+";
  if (field === "folder") return "src";
  if (field === "extension" && operator === "oneOf") return ".png,.jpg,.webp";
  if (field === "extension") return ".png";
  if (field === "project" && operator === "oneOf") return "Project A,Project B";
  if (field === "project") return "Project";
  if (field === "bytes") return "0";
  if (field === "status") return "unused";
  if (field === "ocrText" && operator === "regex") return "SALE|活動";
  if (field === "ocrText") return "SALE";
  if (field === "ocrLanguage" && operator === "oneOf") return "eng,chi_tra";
  if (field === "ocrLanguage") return "eng";
  if (field === "ocrScript" && operator === "oneOf") return "latin,han";
  if (field === "ocrScript") return "han";
  if (field === "ocrConfidence") return "0.6";
  if (field === "ocrStatus") return "ready";
  return "true";
}

function defaultClause(
  field: CustomAssetFilterField = "path",
): CustomAssetFilterClause {
  const operator = customFilterOperatorsByField[field][0];
  return {
    field,
    operator,
    value: defaultClauseValue(field, operator),
  };
}

function defaultGroup(): CustomAssetFilterGroup {
  return { clauses: [defaultClause()] };
}

function createCustomFilter(name: string): CustomAssetFilter {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Date.now().toString(36);
  return {
    id: `custom-${random}`,
    name,
    enabled: false,
    groups: [defaultGroup()],
  };
}

function clauseValueOptions(field: CustomAssetFilterField) {
  if (field === "status") return ["unused", "referenced"];
  if (
    field === "duplicate" ||
    field === "nearDuplicate" ||
    field === "optimizable"
  )
    return ["true", "false"];
  if (field === "ocrStatus") return ["pending", "ready", "failed", "skipped"];
  return null;
}

const workspaceRowActionRevealClass =
  "flex flex-wrap items-center gap-1.5 sm:pointer-events-none sm:absolute sm:right-[calc(100%+6px)] sm:top-1/2 sm:z-10 sm:-translate-y-1/2 sm:flex-nowrap sm:opacity-0 sm:transition-opacity sm:duration-[120ms] sm:ease-g sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100";
const projectRowActionRevealClass =
  "flex flex-wrap items-center gap-1.5 pl-3 sm:pointer-events-none sm:absolute sm:right-2 sm:top-1/2 sm:z-10 sm:-translate-y-1/2 sm:flex-nowrap sm:rounded-g-md sm:bg-g-surface-2 sm:p-1 sm:pl-1 sm:opacity-0 sm:shadow-g-sm sm:transition-opacity sm:duration-[120ms] sm:ease-g sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100";
const ghostDangerClass = "text-g-ink-3 hover:bg-g-red-soft hover:text-g-red";
const smButtonOverrideClass =
  "!h-g-btn-sm !px-2 !font-g !text-g-caption !leading-none !tracking-g-ui";
const rowActionButtonClass = `${smButtonOverrideClass} text-g-ink-3`;
const rowActionDangerButtonClass = `${smButtonOverrideClass} ${ghostDangerClass}`;
const workspaceDialogButtonClass = `${smButtonOverrideClass} [&_svg]:!size-3`;
const workspaceDialogDangerButtonClass = `${workspaceDialogButtonClass} ${ghostDangerClass}`;
const activeWorkspaceBadgeClass =
  "inline-flex items-center justify-center gap-1.5 h-7 px-2.5 rounded-g-pill border border-g-green/20 bg-g-green/[0.08] text-g-ink-2 font-g text-g-caption font-[510] leading-none tracking-g-ui [&_svg]:size-3 [&_svg]:text-g-green";
const switchWorkspaceButtonClass =
  "inline-flex items-center justify-center gap-1.5 h-7 px-2.5 rounded-g-pill border border-g-line bg-g-surface font-g text-g-caption font-[510] leading-none tracking-g-ui text-g-ink-2 [&_svg]:size-3 hover:bg-g-surface-2 hover:border-g-line-strong";
const projectAssetsBadgeClass =
  "shrink-0 border-g-line bg-g-surface-2 text-g-ink-3";
const defaultOCRLanguages = ["eng"];
const fallbackOCRLanguages = [
  "eng",
  "chi_tra",
  "chi_sim",
  "jpn",
  "kor",
  "fra",
  "deu",
  "spa",
  "por",
  "ita",
  "nld",
  "rus",
  "ukr",
  "ara",
  "hin",
  "tha",
  "vie",
  "ind",
  "msa",
];

function isStandaloneApp() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    ("standalone" in navigator &&
      (navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}

function draftFromSettings(settings?: SettingsInfo): SettingsDraft {
  return {
    workspaceName:
      settings?.workspaceName ?? defaultSettings.workspaceName ?? "",
    defaultProjectRoot:
      settings?.defaultProjectRoot ?? defaultSettings.defaultProjectRoot ?? "",
    autoScanOnOpen: settings?.autoScanOnOpen ?? false,
    scanOnOpen: settings?.scanOnOpen ?? false,
    scanProfile: settings?.scanProfile ?? "fast",
    scanAnalyses: settings?.scanAnalyses ?? {
      references: false,
      nearDuplicates: false,
      optimization: false,
    },
    ocrEnabled: settings?.ocrEnabled ?? false,
    ocrLanguages: settings?.ocrLanguages ?? defaultOCRLanguages,
    ocrMaxPixels: settings?.ocrMaxPixels ?? 2_000_000,
    ocrBatchSize: settings?.ocrBatchSize ?? 25,
    ocrConcurrency: settings?.ocrConcurrency ?? 1,
    ocrFuzzySearch: settings?.ocrFuzzySearch ?? true,
    excludePatternsText: (settings?.excludePatterns ?? []).join("\n"),
    optimizationDefaultQuality: settings?.optimizationDefaultQuality ?? 80,
    optimizationAutoApply: settings?.optimizationAutoApply ?? false,
    customAssetFilters: settings?.customAssetFilters ?? [],
  };
}

function updateFromDraft(draft: SettingsDraft): SettingsUpdate {
  return {
    workspaceName: draft.workspaceName,
    defaultProjectRoot: draft.defaultProjectRoot,
    autoScanOnOpen: draft.autoScanOnOpen,
    scanOnOpen: draft.scanOnOpen,
    scanProfile: draft.scanProfile,
    scanAnalyses: draft.scanAnalyses,
    ocrEnabled: draft.ocrEnabled,
    ocrLanguages: draft.ocrLanguages,
    ocrMaxPixels: draft.ocrMaxPixels,
    ocrBatchSize: draft.ocrBatchSize,
    ocrConcurrency: draft.ocrConcurrency,
    ocrFuzzySearch: draft.ocrFuzzySearch,
    excludePatterns: draft.excludePatternsText
      .split(/[\n,]/)
      .map((part) => part.trim())
      .filter(Boolean),
    optimizationDefaultQuality: draft.optimizationDefaultQuality,
    optimizationAutoApply: draft.optimizationAutoApply,
    customAssetFilters: draft.customAssetFilters,
  };
}

function FieldRow({
  label,
  description,
  align = "center",
  children,
}: {
  label: string;
  description?: string;
  icon?: ReactNode;
  align?: "center" | "start";
  children: ReactNode;
}) {
  return (
    <div
      className={
        align === "start"
          ? "grid grid-cols-1 items-start gap-3 py-4 min-[1200px]:grid-cols-[minmax(0,1fr)_auto] min-[1200px]:gap-8"
          : "grid grid-cols-1 items-center gap-3 py-4 min-[1200px]:grid-cols-[minmax(0,1fr)_auto] min-[1200px]:gap-8"
      }
    >
      <div className="min-w-0">
        <span className="block font-g text-g-body font-[510] leading-[1.4] tracking-g-ui text-g-ink">
          {label}
        </span>
        {description && (
          <p className="mt-0.5 max-w-[48ch] font-g text-g-ui font-normal tracking-g-ui text-g-ink-3">
            {description}
          </p>
        )}
      </div>
      <div className="flex min-w-0 justify-start min-[1200px]:min-w-[280px] min-[1200px]:justify-end">
        {children}
      </div>
    </div>
  );
}

type OCRLanguagePack = SettingsInfo["ocrRuntime"]["availableLanguages"][number];

function ocrLanguageLabel(
  language: string,
  t: ReturnType<typeof useTranslation>["t"],
) {
  const key = `settings.ocrLanguageLabels.${language}`;
  const label = t(key);
  return label === key ? language : label;
}

function ocrProgressLabel(
  counts: OCRRunCounts,
  t: ReturnType<typeof useTranslation>["t"],
) {
  const skipReasons = counts.skipReasons ?? {};
  const [topSkipReason, topSkipCount] =
    Object.entries(skipReasons).sort((a, b) => b[1] - a[1])[0] ?? [];
  const skipReasonLabel = topSkipReason
    ? t(`settings.ocrSkipReason.${topSkipReason}`, {
        defaultValue: topSkipReason,
      })
    : "";
  const key = topSkipReason
    ? "settings.ocrProgressWithSkipReason"
    : "settings.ocrProgress";
  return t(key, {
    processed: counts.processed,
    ready: counts.ready,
    failed: counts.failed,
    skipped: counts.skipped,
    cacheHit: counts.cacheHit,
    skipReason: skipReasonLabel,
    skipReasonCount: topSkipCount ?? 0,
  });
}

function OCRLanguageSelect({
  value,
  packs,
  disabled,
  onChange,
}: {
  value: string[];
  packs: OCRLanguagePack[];
  disabled: boolean;
  onChange: (languages: string[]) => void;
}) {
  const { t } = useTranslation();
  const knownPacks =
    packs.length > 0
      ? packs
      : fallbackOCRLanguages.map((language) => ({
          language,
          installed: false,
          sizeBytes: 0,
        }));
  const knownLanguages = new Set(knownPacks.map((pack) => pack.language));
  const options = [
    ...knownPacks,
    ...value
      .filter((language) => !knownLanguages.has(language))
      .map((language) => ({ language, installed: false, sizeBytes: 0 })),
  ];
  const selected = new Set(value);
  const selectedLabels = value.map((language) => ocrLanguageLabel(language, t));
  const label =
    selectedLabels.length > 0
      ? selectedLabels.join(", ")
      : t("settings.ocrLanguagesPlaceholder");

  function toggleLanguage(language: string) {
    if (selected.has(language)) {
      if (value.length <= 1) return;
      onChange(value.filter((item) => item !== language));
      return;
    }
    onChange([...value, language]);
  }

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex h-g-btn-md w-full items-center gap-2 rounded-g-md border border-g-line bg-g-surface px-3 font-g text-g-ui font-[510] tracking-g-ui text-g-ink shadow-g-inset transition-[background,border-color,box-shadow] duration-[120ms] ease-g hover:bg-g-surface-2 focus-visible:outline-none focus-visible:shadow-g-focus disabled:cursor-not-allowed disabled:opacity-[0.38]"
          aria-label={t("settings.ocrLanguages")}
        >
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronDown size={15} className="shrink-0" />
        </button>
      </DropdownMenuPrimitive.Trigger>

      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="end"
          sideOffset={6}
          className="z-[60] min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-auto rounded-g-md border border-g-line-strong bg-g-surface p-1.5 shadow-g-pop animate-[modalIn_120ms_var(--g-ease-out)]"
          style={{ maxHeight: 320 }}
        >
          {options.map((pack) => (
            <DropdownMenuPrimitive.CheckboxItem
              key={pack.language}
              checked={selected.has(pack.language)}
              onCheckedChange={() => toggleLanguage(pack.language)}
              onSelect={(event) => event.preventDefault()}
              className="group flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-g-md px-3 py-2 text-left font-g text-g-body leading-[1.4] font-[510] text-g-ink-2 outline-none transition-[background,color,box-shadow] duration-[120ms] ease-g focus-visible:shadow-g-focus data-[highlighted]:bg-g-surface-3 data-[highlighted]:text-g-ink data-[state=checked]:text-g-ink"
            >
              <span className="grid size-4 shrink-0 place-items-center rounded-g-sm border border-g-line bg-g-surface-2 text-g-active-text transition-[background,border-color,color] duration-[120ms] ease-g group-data-[state=checked]:border-g-active-bg group-data-[state=checked]:bg-g-active-bg group-data-[state=checked]:text-g-active-text">
                <DropdownMenuPrimitive.ItemIndicator>
                  <Check size={12} />
                </DropdownMenuPrimitive.ItemIndicator>
              </span>
              <span className="min-w-0 flex-1 truncate">
                {ocrLanguageLabel(pack.language, t)}
              </span>
              <Badge tone={pack.installed ? "green" : "line"}>
                {pack.installed
                  ? t("settings.installed")
                  : t("settings.notInstalled")}
              </Badge>
            </DropdownMenuPrimitive.CheckboxItem>
          ))}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

function SectionHeading(props: {
  title: string;
  description?: string;
  icon?: ReactNode;
}) {
  void props;
  return null;
}

function sectionIcon(id: Section) {
  return sectionMeta.find((section) => section.id === id)?.icon;
}

const workspaceIconMaxBytes = 512 * 1024;
const workspaceIconAccept = "image/png,image/jpeg,image/gif,image/webp";

function readWorkspaceIcon(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

type WorkspaceDialogProps = {
  open: boolean;
  workspace?: Workspace;
  loading: boolean;
  onConfirm: (value: { name: string; iconImage: string }) => void;
  onCancel: () => void;
};

type WorkspaceDialogContentProps = Omit<WorkspaceDialogProps, "open">;

function WorkspaceDialogContent({
  workspace,
  loading,
  onConfirm,
  onCancel,
}: WorkspaceDialogContentProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const defaultName = workspace?.name ?? "";
  const defaultIconImage = workspace?.iconImage ?? "";
  const [name, setName] = useState(defaultName);
  const [iconImage, setIconImage] = useState(defaultIconImage);
  const [error, setError] = useState("");

  const trimmedName = name.trim();
  const changed = trimmedName !== defaultName || iconImage !== defaultIconImage;
  const canSubmit = trimmedName.length > 0 && (!workspace || changed);

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!workspaceIconAccept.split(",").includes(file.type)) {
      setError(t("settings.workspaceIconTypeError"));
      return;
    }
    if (file.size > workspaceIconMaxBytes) {
      setError(t("settings.workspaceIconSizeError"));
      return;
    }
    try {
      setIconImage(await readWorkspaceIcon(file));
      setError("");
    } catch {
      setError(t("settings.workspaceIconReadError"));
    }
  }

  function submit() {
    if (!canSubmit) return;
    onConfirm({ name: trimmedName, iconImage });
  }

  return (
    <Modal
      title={
        workspace ? t("settings.renameWorkspace") : t("settings.addWorkspace")
      }
      onClose={onCancel}
      size="sm"
      footer={
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={loading || !canSubmit}
          >
            {workspace ? t("action.rename") : t("settings.addWorkspace")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-4">
          <WorkspaceAvatar
            name={trimmedName || defaultName || t("settings.addWorkspace")}
            iconImage={iconImage}
            className="size-16 bg-g-surface-3 text-2xl shadow-g-inset"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={workspaceIconAccept}
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => void onFileChange(event)}
              disabled={loading}
            />
            <div>
              <p className="font-g text-g-ui font-[510] tracking-g-ui text-g-ink">
                {t("settings.workspaceIcon")}
              </p>
              <p className="mt-0.5 font-g text-g-caption tracking-g-ui text-g-ink-3">
                {t("settings.workspaceIconHint")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Upload size={13} />}
                onClick={() => inputRef.current?.click()}
                disabled={loading}
                className={workspaceDialogButtonClass}
              >
                {t("settings.uploadWorkspaceIcon")}
              </Button>
              {iconImage && (
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={<Trash2 size={13} />}
                  onClick={() => {
                    setIconImage("");
                    setError("");
                  }}
                  disabled={loading}
                  className={workspaceDialogDangerButtonClass}
                >
                  {t("settings.removeWorkspaceIcon")}
                </Button>
              )}
            </div>
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-g-caption font-[510] text-g-ink-3">
            {t("settings.workspaceName")}
          </label>
          <TextInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={
              workspace
                ? t("settings.renameWorkspacePrompt")
                : t("settings.addWorkspacePrompt")
            }
            disabled={loading}
            className="w-full"
          />
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Modal>
  );
}

function WorkspaceDialog({ open, workspace, ...props }: WorkspaceDialogProps) {
  if (!open) return null;
  return (
    <WorkspaceDialogContent
      key={workspace?.id ?? "new"}
      workspace={workspace}
      {...props}
    />
  );
}

function SettingsActions({
  disabled,
  onSave,
  onReset,
  saveLabel,
  resetLabel,
}: {
  disabled: boolean;
  onSave: () => void;
  onReset: () => void;
  saveLabel: string;
  resetLabel: string;
}) {
  return (
    <div className="flex gap-2 py-4">
      <Button variant="primary" onClick={onSave} disabled={disabled}>
        {saveLabel}
      </Button>
      <Button variant="ghost" onClick={onReset} disabled={disabled}>
        {resetLabel}
      </Button>
    </div>
  );
}

export function SettingsView({
  theme,
  imagePreviewEnabled,
  imageBackgroundMode,
  onThemeChange,
  onImagePreviewEnabledChange,
  onImageBackgroundModeChange,
}: Props) {
  const { i18n, t } = useTranslation();
  const toast = useToast();
  const [activeSection, setActiveSection] = useState<Section>("workspace");
  const [draftOverride, setDraftOverride] = useState<SettingsDraft | null>(
    null,
  );
  const [addWorkspaceOpen, setAddWorkspaceOpen] = useState(false);
  const [renameWorkspaceId, setRenameWorkspaceId] = useState<string | null>(
    null,
  );
  const [removeWorkspaceId, setRemoveWorkspaceId] = useState<string | null>(
    null,
  );
  const [renameProjectId, setRenameProjectId] = useState<string | null>(null);
  const [removeProjectId, setRemoveProjectId] = useState<string | null>(null);
  const [customFiltersHelpOpen, setCustomFiltersHelpOpen] = useState(false);
  const [ocrLimitsOpen, setOCRLimitsOpen] = useState(false);
  const [runOCRConfirmOpen, setRunOCRConfirmOpen] = useState(false);
  const [removeOCRConfirmOpen, setRemoveOCRConfirmOpen] = useState(false);
  const [resetSettingsOpen, setResetSettingsOpen] = useState(false);
  const [resetDatabaseOpen, setResetDatabaseOpen] = useState(false);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installMessage, setInstallMessage] = useState("");
  const [installedApp, setInstalledApp] = useState(() => isStandaloneApp());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const settingsQuery = useSettingsQuery();
  const defaultDirectoryQuery = useDirectoryListingQuery(
    "",
    activeSection === "workspace",
  );
  const catalogQuery = useCatalogQuery();
  const versionQuery = useVersionQuery();
  const addWorkspaceMutation = useAddWorkspaceMutation();
  const importMutation = useImportSettingsMutation();
  const installOCRMutation = useInstallOCRMutation();
  const removeProjectMutation = useRemoveProjectMutation();
  const removeOCRMutation = useRemoveOCRMutation();
  const removeWorkspaceMutation = useRemoveWorkspaceMutation();
  const renameProjectMutation = useRenameProjectMutation();
  const renameWorkspaceMutation = useRenameWorkspaceMutation();
  const resetMutation = useResetDatabaseMutation();
  const [ocrProgress, setOCRProgress] = useState("");
  const [ocrRunStopping, setOCRRunStopping] = useState(false);
  const [ocrRunActive, setOCRRunActive] = useState(false);
  const ocrRunBatchRef = useRef(0);
  const ocrRunAbortRef = useRef<AbortController | null>(null);
  const runOCRMutation = useRunOCRMutation({
    onEvent: (event) => {
      if ("counts" in event && event.counts) {
        setOCRProgress(
          t("settings.ocrBatchProgress", {
            batch: Math.max(ocrRunBatchRef.current, 1),
            progress: ocrProgressLabel(event.counts, t),
          }),
        );
      }
    },
  });
  const switchWorkspaceMutation = useSwitchWorkspaceMutation();
  const updateAppMutation = useUpdateAppMutation();
  const updateMutation = useUpdateSettingsMutation();

  const settings = settingsQuery.data?.settings;
  const draft = draftOverride ?? draftFromSettings(settings);
  const defaultRootPlaceholder = t("settings.defaultRootPlaceholder");
  const defaultRootCurrentPath = defaultDirectoryQuery.data?.path
    ? t("settings.defaultRootCurrentPath", {
        path: defaultDirectoryQuery.data.path,
      })
    : "";
  const workspaces = settings?.workspaces ?? [];
  const activeWorkspaceId = settings?.activeWorkspaceId ?? "default";
  const projects = catalogQuery.data?.projects ?? [];
  const settingsProjects = settings?.projects ?? projects;
  const workspaceProjects = new Map(
    workspaces.map((workspace) => [
      workspace.id,
      [] as typeof settingsProjects,
    ]),
  );
  for (const project of settingsProjects) {
    const group = workspaceProjects.get(project.workspaceId);
    if (group) {
      group.push(project);
    }
  }
  const workspaceBeingRenamed = workspaces.find(
    (workspace) => workspace.id === renameWorkspaceId,
  );
  const workspaceBeingRemoved = workspaces.find(
    (workspace) => workspace.id === removeWorkspaceId,
  );
  const projectBeingRenamed = settingsProjects.find(
    (project) => project.id === renameProjectId,
  );
  const projectBeingRemoved = settingsProjects.find(
    (project) => project.id === removeProjectId,
  );
  const working =
    addWorkspaceMutation.isPending ||
    importMutation.isPending ||
    installOCRMutation.isPending ||
    removeProjectMutation.isPending ||
    removeOCRMutation.isPending ||
    removeWorkspaceMutation.isPending ||
    renameProjectMutation.isPending ||
    renameWorkspaceMutation.isPending ||
    resetMutation.isPending ||
    switchWorkspaceMutation.isPending ||
    updateAppMutation.isPending ||
    updateMutation.isPending;
  const ocrWorking = ocrRunActive || runOCRMutation.isPending;
  const settingsActionDisabled =
    settingsQuery.isLoading || working || ocrWorking;
  const ocrLanguagePacks = settings?.ocrRuntime.availableLanguages ?? [];
  const installedOCRLanguages = new Set(
    ocrLanguagePacks
      .filter((pack) => pack.installed)
      .map((pack) => pack.language),
  );
  const selectedOCRLanguageList = selectedOCRLanguages();
  const hasSelectedOCRLanguages = selectedOCRLanguageList.length > 0;
  const hasUninstalledSelectedOCRLanguages = selectedOCRLanguageList.some(
    (language) => !installedOCRLanguages.has(language),
  );
  const missingSelectedOCRLanguages = selectedOCRLanguageList.filter(
    (language) => !installedOCRLanguages.has(language),
  );
  const selectedOCRLanguagesInstalled =
    hasSelectedOCRLanguages && missingSelectedOCRLanguages.length === 0;

  useEffect(() => {
    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setInstallMessage("");
    }
    function onAppInstalled() {
      setInstalledApp(true);
      setInstallPrompt(null);
      setInstallMessage(t("settings.installInstalled"));
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, [t]);

  useEffect(() => {
    return () => {
      ocrRunAbortRef.current?.abort();
    };
  }, []);

  const assetCountByProject: Record<string, number> = {};

  function updateDraft(updater: (current: SettingsDraft) => SettingsDraft) {
    setDraftOverride((current) =>
      updater(current ?? draftFromSettings(settingsQuery.data?.settings)),
    );
  }

  function updateCustomFilters(
    updater: (filters: CustomAssetFilter[]) => CustomAssetFilter[],
  ) {
    updateDraft((prev) => ({
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

  async function onSaveSettings() {
    try {
      const result = await updateMutation.mutateAsync(updateFromDraft(draft));
      setDraftOverride(draftFromSettings(result.settings));
      toast.success(t("toast.settingsSaved"));
    } catch (error) {
      toast.error(errorMessage(error), {
        title: t("toast.settingsSaveFailed"),
      });
    }
  }

  function selectedOCRLanguages() {
    return draft.ocrLanguages;
  }

  async function onInstallOCR() {
    try {
      await installOCRMutation.mutateAsync(selectedOCRLanguages());
      toast.success(t("settings.ocrInstallSuccess"));
    } catch (error) {
      toast.error(errorMessage(error), {
        title: t("settings.ocrInstallFailed"),
      });
    }
  }

  async function onRemoveOCR() {
    setRemoveOCRConfirmOpen(false);
    try {
      await removeOCRMutation.mutateAsync(undefined);
      setOCRProgress("");
      toast.success(t("settings.ocrRemoveSuccess"));
    } catch (error) {
      toast.error(errorMessage(error), {
        title: t("settings.ocrRemoveFailed"),
      });
    }
  }

  async function onRunOCRConfirmed() {
    setRunOCRConfirmOpen(false);
    try {
      setOCRRunActive(true);
      setOCRRunStopping(false);
      setOCRProgress("");
      ocrRunBatchRef.current = 0;
      await updateMutation.mutateAsync(updateFromDraft(draft));
      for (;;) {
        const controller = new AbortController();
        ocrRunAbortRef.current = controller;
        ocrRunBatchRef.current += 1;
        const result = await runOCRMutation.mutateAsync(controller.signal);
        if (!result?.hasMore || controller.signal.aborted) {
          break;
        }
      }
      toast.success(t("settings.ocrRunSuccess"));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        toast.info(t("settings.ocrRunStopped"));
        return;
      }
      toast.error(errorMessage(error), {
        title: t("settings.ocrRunFailed"),
      });
    } finally {
      ocrRunAbortRef.current = null;
      setOCRRunActive(false);
      setOCRRunStopping(false);
    }
  }

  function onStopOCR() {
    setOCRRunStopping(true);
    ocrRunAbortRef.current?.abort();
  }

  function onAddWorkspace(value: { name: string; iconImage: string }) {
    addWorkspaceMutation.mutate(value, {
      onSuccess: (result) => {
        setAddWorkspaceOpen(false);
        setDraftOverride(draftFromSettings(result.settings));
      },
    });
  }

  async function onSwitchWorkspace(workspaceId: string) {
    const result = await switchWorkspaceMutation.mutateAsync(workspaceId);
    setDraftOverride(draftFromSettings(result.settings));
  }

  function onRenameWorkspace(value: { name: string; iconImage: string }) {
    if (!workspaceBeingRenamed) return;
    renameWorkspaceMutation.mutate(
      { id: workspaceBeingRenamed.id, ...value },
      {
        onSuccess: (result) => {
          setRenameWorkspaceId(null);
          setDraftOverride(draftFromSettings(result.settings));
          toast.success(
            t("settings.renameWorkspaceSuccess", { name: value.name }),
          );
        },
      },
    );
  }

  function onRemoveWorkspace() {
    if (!workspaceBeingRemoved) return;
    const removedName = workspaceBeingRemoved.name;
    removeWorkspaceMutation.mutate(workspaceBeingRemoved.id, {
      onSuccess: (result) => {
        setRemoveWorkspaceId(null);
        setDraftOverride(draftFromSettings(result.settings));
        toast.success(
          t("settings.removeWorkspaceSuccess", { name: removedName }),
        );
      },
    });
  }

  function onRenameProject(value: { name: string; iconImage: string }) {
    if (!projectBeingRenamed) return;
    renameProjectMutation.mutate(
      {
        id: projectBeingRenamed.id,
        name: value.name,
        iconImage: value.iconImage,
      },
      {
        onSuccess: () => {
          setRenameProjectId(null);
          toast.success(t("projects.renameSuccess", { name: value.name }));
        },
      },
    );
  }

  function onRemoveProject() {
    if (!projectBeingRemoved) return;
    const removedName = projectBeingRemoved.name;
    removeProjectMutation.mutate(projectBeingRemoved.id, {
      onSuccess: () => {
        setRemoveProjectId(null);
        toast.success(t("projects.removeSuccess", { name: removedName }));
      },
    });
  }

  async function onResetSettings() {
    const result = await updateMutation.mutateAsync(defaultSettings);
    setDraftOverride(draftFromSettings(result.settings));
    await removeOCRMutation.mutateAsync(undefined).catch(() => {});
    setOCRProgress("");
    toast.success(t("toast.settingsReset"));
  }

  async function onConfirmResetSettings() {
    try {
      await onResetSettings();
      setResetSettingsOpen(false);
    } catch (error) {
      toast.error(errorMessage(error), {
        title: t("toast.settingsResetFailed"),
      });
    }
  }

  async function onExport() {
    const data = await exportSettings();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `asset-studio-export-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function onImport(file: File) {
    const text = await file.text();
    const data = JSON.parse(text) as ExportData;
    await importMutation.mutateAsync(data);
    setDraftOverride(null);
  }

  async function onInstallApp() {
    if (installedApp) {
      setInstallMessage(t("settings.installInstalled"));
      return;
    }
    if (!installPrompt) {
      setInstallMessage(t("settings.installManualHint"));
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    setInstallMessage(
      choice.outcome === "accepted"
        ? t("settings.installAccepted")
        : t("settings.installDismissed"),
    );
  }

  async function onUpdateApp() {
    try {
      const result = await updateAppMutation.mutateAsync();
      if (result.update.devMode) {
        toast.success(t("settings.updateDevSuccess"));
        return;
      }
      if (result.update.updated) {
        toast.success(
          t("settings.updateSuccess", {
            version: result.update.latestVersion ?? "",
          }),
        );
        return;
      }
      toast.info(t("settings.updateAlreadyCurrent"));
    } catch (error) {
      toast.error(errorMessage(error), {
        title: t("settings.updateFailed"),
      });
    }
  }

  function onReset() {
    resetMutation.mutate(undefined, {
      onSuccess: () => {
        setResetDatabaseOpen(false);
        toast.success(t("toast.databaseReset"));
      },
      onError: (error) => {
        toast.error(errorMessage(error), {
          title: t("toast.databaseResetFailed"),
        });
      },
    });
  }

  const settingActions = (
    <SettingsActions
      disabled={settingsActionDisabled}
      onSave={() => void onSaveSettings()}
      onReset={() => setResetSettingsOpen(true)}
      saveLabel={t("settings.save")}
      resetLabel={t("settings.reset")}
    />
  );

  return (
    <>
      <Rail
        as="nav"
        variant="settings"
        className="ml-3 px-0"
        aria-label={t("mode.settings")}
      >
        <RailSection>
          {sectionMeta.map(({ id, icon }) => (
            <RailItem
              key={id}
              variant="settings"
              active={activeSection === id}
              icon={icon}
              label={t(`settings.section.${id}`)}
              onClick={() => setActiveSection(id)}
            />
          ))}
        </RailSection>
      </Rail>

      <div className="flex-1 overflow-y-auto overflow-x-hidden mt-3 px-3 pb-12 max-[768px]:mt-3 max-[768px]:px-3 max-[768px]:pb-8">
        <div className="flex flex-col gap-6 ml-0 mr-auto max-w-[1040px] w-full">
          {activeSection === "workspace" && (
            <Card
              className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm hover:border-g-line hover:shadow-g-sm"
              padding="none"
            >
              <SectionHeading
                title={t("settings.section.workspace")}
                description={t("settings.workspaceDesc")}
                icon={sectionIcon("workspace")}
              />
              <div className="px-6 pt-5 pb-2 md:px-8">
                <div className="mb-4">
                  <span className="block font-g text-g-body font-[510] leading-[1.4] tracking-g-ui text-g-ink">
                    {t("settings.workspaces")}
                  </span>
                  <p className="mt-0.5 max-w-[60ch] font-g text-g-ui font-normal tracking-g-ui text-g-ink-3">
                    {t("settings.workspacesHint")}
                  </p>
                </div>
                <div className="flex w-full flex-col gap-2.5">
                  <div className="grid gap-2.5" role="list">
                    {workspaces.map((workspace) => {
                      const isActive = workspace.id === activeWorkspaceId;
                      const summary = t("settings.workspaceProjects", {
                        count: workspace.projectCount,
                      });

                      return (
                        <div
                          key={workspace.id}
                          role="listitem"
                          className={cn(
                            "group relative flex flex-col gap-2 rounded-g-lg border px-4 py-3 shadow-g-sm transition-[background,border-color,box-shadow] duration-[120ms] ease-g sm:flex-row sm:items-center",
                            isActive
                              ? "border-g-line-strong bg-g-surface-2"
                              : "border-g-line bg-g-surface hover:bg-g-surface-2 hover:border-g-line-strong focus-within:bg-g-surface-2",
                          )}
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-3.5 text-left">
                            <WorkspaceAvatar
                              name={workspace.name}
                              iconImage={workspace.iconImage}
                              className="text-g-ink-2"
                            />
                            <span className="min-w-0">
                              <span
                                className={cn(
                                  "block truncate font-g-display text-g-body leading-[1.3] tracking-[-0.013em] text-g-ink",
                                  isActive ? "font-[590]" : "font-[510]",
                                )}
                              >
                                {workspace.name}
                              </span>
                              <span className="block font-g-mono text-g-chip tracking-g-mono text-g-ink-3">
                                {summary}
                              </span>
                            </span>
                          </div>
                          <div className="relative flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
                            <div className={workspaceRowActionRevealClass}>
                              <Button
                                variant="ghost"
                                size="sm"
                                leadingIcon={<Pencil size={13} />}
                                disabled={working}
                                className={rowActionButtonClass}
                                onClick={() =>
                                  setRenameWorkspaceId(workspace.id)
                                }
                              >
                                {t("action.rename")}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                leadingIcon={<Trash2 size={13} />}
                                disabled={working || workspaces.length <= 1}
                                className={rowActionDangerButtonClass}
                                onClick={() =>
                                  setRemoveWorkspaceId(workspace.id)
                                }
                              >
                                {t("action.delete")}
                              </Button>
                            </div>
                            {isActive && (
                              <Badge
                                tone="line"
                                className={activeWorkspaceBadgeClass}
                              >
                                <CheckCircle2 aria-hidden="true" />
                                {t("settings.activeWorkspace")}
                              </Badge>
                            )}
                            {!isActive && (
                              <Button
                                variant="secondary"
                                size="sm"
                                leadingIcon={<ArrowLeftRight size={13} />}
                                disabled={working}
                                className={switchWorkspaceButtonClass}
                                onClick={() =>
                                  void onSwitchWorkspace(workspace.id)
                                }
                              >
                                {t("settings.switchWorkspaceAction")}
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    leadingIcon={<Plus size={13} />}
                    disabled={working}
                    className="self-start"
                    onClick={() => setAddWorkspaceOpen(true)}
                  >
                    {t("settings.addWorkspace")}
                  </Button>
                </div>
                <div className="my-5 border-t border-g-line" />
                <FieldRow
                  label={t("settings.defaultRoot")}
                  description={t("settings.defaultRootHint")}
                  icon={<FolderKanban size={15} />}
                  align="start"
                >
                  <div className="flex w-full flex-col gap-1.5 min-[1200px]:w-[560px]">
                    <TextInput
                      type="text"
                      disabled={
                        settingsQuery.isLoading || updateMutation.isPending
                      }
                      value={draft.defaultProjectRoot}
                      onChange={(event) =>
                        updateDraft((prev) => ({
                          ...prev,
                          defaultProjectRoot: event.target.value,
                        }))
                      }
                      placeholder={defaultRootPlaceholder}
                      className="w-full"
                    />
                    {defaultRootCurrentPath && (
                      <p className="break-all text-left font-g-mono text-g-caption tracking-g-mono text-g-ink-3 min-[1200px]:text-right">
                        {defaultRootCurrentPath}
                      </p>
                    )}
                  </div>
                </FieldRow>
                {(updateMutation.error ||
                  addWorkspaceMutation.error ||
                  renameWorkspaceMutation.error ||
                  removeWorkspaceMutation.error ||
                  switchWorkspaceMutation.error) && (
                  <Notice tone="danger">
                    {errorMessage(
                      updateMutation.error ??
                        addWorkspaceMutation.error ??
                        renameWorkspaceMutation.error ??
                        removeWorkspaceMutation.error ??
                        switchWorkspaceMutation.error,
                    )}
                  </Notice>
                )}
                {settingActions}
              </div>
            </Card>
          )}

          {activeSection === "projects" && (
            <Card
              className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm hover:border-g-line hover:shadow-g-sm"
              padding="none"
            >
              <SectionHeading
                title={t("settings.section.projects")}
                description={t("settings.projectsDesc")}
                icon={sectionIcon("projects")}
              />
              <div className="px-6 py-5 md:px-8">
                {settingsProjects.length === 0 ? (
                  <p className="font-g text-g-ui text-g-ink-3">
                    {t("settings.noProjects")}
                  </p>
                ) : (
                  <div className="space-y-5">
                    {workspaces.map((workspace) => {
                      const groupedProjects =
                        workspaceProjects.get(workspace.id) ?? [];
                      const isActive = workspace.id === activeWorkspaceId;

                      return (
                        <section
                          key={workspace.id}
                          className={cn(
                            "overflow-hidden rounded-g-lg border shadow-g-sm",
                            isActive ? "border-g-line-strong" : "border-g-line",
                          )}
                        >
                          <div
                            className={cn(
                              "flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
                              isActive ? "bg-g-surface-2" : "bg-g-surface",
                            )}
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <WorkspaceAvatar
                                name={workspace.name}
                                iconImage={workspace.iconImage}
                                className="text-g-ink-2"
                              />
                              <div className="min-w-0">
                                <h3 className="truncate font-g-display text-g-body font-[590] leading-[1.3] tracking-[-0.013em] text-g-ink">
                                  {workspace.name}
                                </h3>
                                <p className="font-g-mono text-g-chip tracking-g-mono text-g-ink-3">
                                  {t("settings.workspaceProjects", {
                                    count: groupedProjects.length,
                                  })}
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                              {isActive ? (
                                <Badge
                                  tone="line"
                                  className={activeWorkspaceBadgeClass}
                                >
                                  <CheckCircle2 aria-hidden="true" />
                                  {t("settings.activeWorkspace")}
                                </Badge>
                              ) : (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  leadingIcon={<ArrowLeftRight size={13} />}
                                  disabled={working}
                                  className={switchWorkspaceButtonClass}
                                  onClick={() =>
                                    void onSwitchWorkspace(workspace.id)
                                  }
                                >
                                  {t("settings.switchWorkspaceAction")}
                                </Button>
                              )}
                            </div>
                          </div>
                          {groupedProjects.length === 0 ? (
                            <div className="border-t border-g-line px-5 py-3">
                              <p className="font-g text-g-ui text-g-ink-3">
                                {t("settings.noProjectsInWorkspace")}
                              </p>
                            </div>
                          ) : (
                            <div className="divide-y divide-g-line border-t border-g-line">
                              {groupedProjects.map((project) => (
                                <div
                                  key={project.id}
                                  className="group relative flex flex-col gap-2 px-4 py-2.5 transition-[background] duration-[120ms] ease-g hover:bg-g-surface-2 focus-within:bg-g-surface-2 sm:flex-row sm:items-center sm:justify-between"
                                >
                                  <div className="flex min-w-0 items-center gap-3">
                                    <ProjectAvatar
                                      iconImage={project.iconImage}
                                      className="size-9 bg-g-surface-3 [&_svg]:size-4"
                                    />
                                    <div className="min-w-0">
                                      <div className="flex min-w-0 items-center gap-2">
                                        <div className="min-w-0 truncate font-g text-g-body font-[510] leading-[1.4] tracking-g-ui text-g-ink">
                                          {project.name}
                                        </div>
                                        {project.workspaceId ===
                                          activeWorkspaceId && (
                                          <Badge
                                            tone="line"
                                            className={projectAssetsBadgeClass}
                                          >
                                            {t("settings.projectAssets", {
                                              count:
                                                assetCountByProject[
                                                  project.id
                                                ] ?? 0,
                                            })}
                                          </Badge>
                                        )}
                                      </div>
                                      <div className="truncate font-g-mono text-g-chip tracking-g-mono text-g-ink-3">
                                        {project.path}
                                      </div>
                                    </div>
                                  </div>
                                  <div className={projectRowActionRevealClass}>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      leadingIcon={<Pencil size={13} />}
                                      disabled={working}
                                      className={rowActionButtonClass}
                                      onClick={() =>
                                        setRenameProjectId(project.id)
                                      }
                                    >
                                      {t("action.edit")}
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      leadingIcon={<Trash2 size={13} />}
                                      disabled={working}
                                      className={rowActionDangerButtonClass}
                                      onClick={() =>
                                        setRemoveProjectId(project.id)
                                      }
                                    >
                                      {t("action.delete")}
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </section>
                      );
                    })}
                  </div>
                )}
                {(renameProjectMutation.error ||
                  removeProjectMutation.error) && (
                  <Notice tone="danger" className="mt-4">
                    {errorMessage(
                      renameProjectMutation.error ??
                        removeProjectMutation.error,
                    )}
                  </Notice>
                )}
              </div>
            </Card>
          )}

          {activeSection === "theme" && (
            <div className="flex flex-col gap-4">
              <Card
                className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
                padding="none"
              >
                <div className="flex items-center gap-2.5 border-b border-g-line px-6 py-3 md:px-8">
                  <Globe2 size={15} className="shrink-0 text-g-ink-3" />
                  <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
                    {t("settings.displayGroup")}
                  </span>
                </div>
                <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
                  <FieldRow
                    label={t("settings.language")}
                    icon={<Globe2 size={15} />}
                  >
                    <Select
                      value={i18n.language}
                      options={languageOptionsForLocale().map((lang) => ({
                        value: lang.code,
                        label: lang.label,
                      }))}
                      onChange={(value) => i18n.changeLanguage(value)}
                      aria-label={t("settings.language")}
                    />
                  </FieldRow>
                  <FieldRow
                    label={t("settings.theme")}
                    icon={<Paintbrush size={15} />}
                  >
                    <Tabs
                      value={theme}
                      items={[
                        {
                          value: "light",
                          label: t("settings.light"),
                          icon: <Sun size={15} />,
                        },
                        {
                          value: "dark",
                          label: t("settings.dark"),
                          icon: <Moon size={15} />,
                        },
                        {
                          value: "system",
                          label: t("settings.system"),
                          icon: <Monitor size={15} />,
                        },
                      ]}
                      onChange={onThemeChange}
                      ariaLabel={t("settings.theme")}
                      className="w-full min-w-[280px] max-w-full [&_[role=tab]]:min-w-0 [&_[role=tab]]:flex-1"
                    />
                  </FieldRow>
                </div>
              </Card>
              <Card
                className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
                padding="none"
              >
                <div className="flex items-center gap-2.5 border-b border-g-line px-6 py-3 md:px-8">
                  <Image size={15} className="shrink-0 text-g-ink-3" />
                  <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
                    {t("settings.assetViewingGroup")}
                  </span>
                </div>
                <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
                  <FieldRow
                    label={t("settings.imagePreview")}
                    description={t("settings.imagePreviewHint")}
                    icon={<Image size={15} />}
                  >
                    <Switch
                      checked={imagePreviewEnabled}
                      onCheckedChange={onImagePreviewEnabledChange}
                      aria-label={t("settings.imagePreview")}
                    />
                  </FieldRow>
                  <FieldRow
                    label={t("settings.imageBackground")}
                    description={t("settings.imageBackgroundHint")}
                    icon={<Grid3X3 size={15} />}
                  >
                    <Tabs
                      value={imageBackgroundMode}
                      items={[
                        {
                          value: "checker",
                          label: t("toolbar.checkerBg"),
                          icon: <Grid3X3 size={15} />,
                        },
                        {
                          value: "light",
                          label: t("toolbar.lightBg"),
                          icon: <Sun size={15} />,
                        },
                        {
                          value: "dark",
                          label: t("toolbar.darkBg"),
                          icon: <Moon size={15} />,
                        },
                      ]}
                      onChange={onImageBackgroundModeChange}
                      ariaLabel={t("settings.imageBackground")}
                      className="w-full min-w-[280px] max-w-full [&_[role=tab]]:min-w-0 [&_[role=tab]]:flex-1"
                    />
                  </FieldRow>
                  <FieldRow
                    label={t("settings.preferredEditor")}
                    description={t("settings.preferredEditorDesc")}
                    icon={<Code size={15} />}
                  >
                    <Select
                      value={settings?.preferredEditor ?? "vscode"}
                      options={editorOptions}
                      onChange={(value) =>
                        updateMutation.mutate({ preferredEditor: value })
                      }
                      aria-label={t("settings.preferredEditor")}
                    />
                  </FieldRow>
                </div>
              </Card>
            </div>
          )}

          {activeSection === "scanning" && (
            <div className="flex flex-col gap-4">
              <Card
                className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
                padding="none"
              >
                <div className="flex items-center gap-2.5 border-b border-g-line px-6 py-3 md:px-8">
                  <Scan size={15} className="shrink-0 text-g-ink-3" />
                  <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
                    {t("settings.catalogGroup")}
                  </span>
                </div>
                <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
                  <FieldRow
                    label={t("settings.scanOnOpen")}
                    description={t("settings.scanOnOpenHint")}
                    icon={<Scan size={15} />}
                  >
                    <Switch
                      checked={draft.scanOnOpen}
                      onCheckedChange={(next) =>
                        updateDraft((prev) => ({ ...prev, scanOnOpen: next }))
                      }
                      disabled={
                        settingsQuery.isLoading || updateMutation.isPending
                      }
                      aria-label={t("settings.scanOnOpen")}
                    />
                  </FieldRow>
                  <FieldRow
                    label={t("settings.scanProfileLabel")}
                    description={t("settings.scanProfileHint")}
                    icon={<Sliders size={15} />}
                    align="start"
                  >
                    <div className="w-full min-[1200px]:w-[420px]">
                      <Select
                        value={draft.scanProfile}
                        options={scanProfileOptions.map((option) => ({
                          ...option,
                          label: t(`settings.scanProfile.${option.value}`),
                          description: t(
                            `settings.scanProfile.${option.value}Hint`,
                          ),
                        }))}
                        onChange={(value) =>
                          updateDraft((prev) => ({
                            ...prev,
                            scanProfile: value as ScanProfile,
                          }))
                        }
                        aria-label={t("settings.scanProfileLabel")}
                      />
                    </div>
                  </FieldRow>
                  {draft.scanProfile === "custom" && (
                    <FieldRow
                      label={t("settings.scanAnalysesLabel")}
                      description={t("settings.scanAnalysesHint")}
                      icon={<Sliders size={15} />}
                      align="start"
                    >
                      <div className="grid w-full gap-2 min-[1200px]:w-[420px]">
                        {(
                          [
                            "references",
                            "nearDuplicates",
                            "optimization",
                          ] as const
                        ).map((analysis) => (
                          <label
                            key={analysis}
                            className="flex min-h-10 items-center justify-between gap-3 rounded-g-md border border-g-line bg-g-surface-2 px-3 py-2"
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-g text-g-ui font-[510] text-g-ink">
                                {t(`settings.scanAnalyses.${analysis}`)}
                              </span>
                              <span className="block truncate text-g-caption text-g-ink-3">
                                {t(`settings.scanAnalyses.${analysis}Hint`)}
                              </span>
                            </span>
                            <Switch
                              checked={draft.scanAnalyses[analysis]}
                              onCheckedChange={(next) =>
                                updateDraft((prev) => ({
                                  ...prev,
                                  scanAnalyses: {
                                    ...prev.scanAnalyses,
                                    [analysis]: next,
                                  },
                                }))
                              }
                              aria-label={t(
                                `settings.scanAnalyses.${analysis}`,
                              )}
                            />
                          </label>
                        ))}
                      </div>
                    </FieldRow>
                  )}
                  <FieldRow
                    label={t("settings.excludePatterns")}
                    description={t("settings.excludePatternsHint")}
                    icon={<Sliders size={15} />}
                    align="start"
                  >
                    <Textarea
                      disabled={
                        settingsQuery.isLoading || updateMutation.isPending
                      }
                      value={draft.excludePatternsText}
                      onChange={(event) =>
                        updateDraft((prev) => ({
                          ...prev,
                          excludePatternsText: event.target.value,
                        }))
                      }
                      placeholder={"node_modules\n.git\ndist/**"}
                      rows={6}
                      className="w-full min-[1200px]:w-[420px]"
                      textareaClassName="min-h-36 font-g-mono text-g-ui tracking-g-mono"
                    />
                  </FieldRow>
                  {updateMutation.error && (
                    <Notice tone="danger">
                      {errorMessage(updateMutation.error)}
                    </Notice>
                  )}
                  {settingActions}
                </div>
              </Card>
              <Card
                className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
                padding="none"
              >
                <div className="flex items-center gap-2.5 border-b border-g-line px-6 py-3 md:px-8">
                  <Scan size={15} className="shrink-0 text-g-ink-3" />
                  <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
                    {t("settings.ocrGroup")}
                  </span>
                </div>
                <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
                  <FieldRow
                    label={t("settings.ocrEnabled")}
                    description={t("settings.ocrEnabledHint")}
                    icon={<Scan size={15} />}
                  >
                    <Switch
                      checked={draft.ocrEnabled}
                      onCheckedChange={(next) =>
                        updateDraft((prev) => ({ ...prev, ocrEnabled: next }))
                      }
                      disabled={
                        settingsQuery.isLoading || updateMutation.isPending
                      }
                      aria-label={t("settings.ocrEnabled")}
                    />
                  </FieldRow>
                  <FieldRow
                    label={t("settings.ocrLanguages")}
                    description={t("settings.ocrLanguagesHint")}
                    icon={<Globe2 size={15} />}
                    align="start"
                  >
                    <div className="w-full min-[1200px]:w-[420px]">
                      <OCRLanguageSelect
                        value={draft.ocrLanguages}
                        packs={ocrLanguagePacks}
                        onChange={(languages) =>
                          updateDraft((prev) => ({
                            ...prev,
                            ocrLanguages: languages,
                          }))
                        }
                        disabled={
                          settingsQuery.isLoading || updateMutation.isPending
                        }
                      />
                    </div>
                  </FieldRow>
                  <FieldRow
                    label={t("settings.ocrLimits")}
                    description={t("settings.ocrLimitsHint")}
                    icon={<Sliders size={15} />}
                    align="start"
                  >
                    <div className="flex w-full items-center justify-start min-[1200px]:w-[420px] min-[1200px]:justify-end">
                      <Button
                        variant="secondary"
                        className="min-w-[96px]"
                        leadingIcon={<Sliders size={14} />}
                        onClick={() => setOCRLimitsOpen(true)}
                        aria-label={`${t("settings.ocrLimits")} ${t("settings.ocrLimitsEdit")}`}
                        disabled={
                          settingsQuery.isLoading || updateMutation.isPending
                        }
                      >
                        {t("settings.ocrLimitsEdit")}
                      </Button>
                    </div>
                  </FieldRow>
                  <FieldRow
                    label={t("settings.ocrRuntime")}
                    description={t("settings.ocrRuntimeHint")}
                    icon={<Download size={15} />}
                    align="start"
                  >
                    <div className="flex w-full flex-col items-start gap-2 min-[1200px]:w-[560px] min-[1200px]:items-end">
                      <div className="flex flex-wrap justify-start gap-2 min-[1200px]:justify-end">
                        <Button
                          variant="secondary"
                          leadingIcon={
                            installOCRMutation.isPending ? (
                              <LoaderCircle
                                size={14}
                                className="animate-[icon-spin_900ms_linear_infinite]"
                              />
                            ) : (
                              <Download size={14} />
                            )
                          }
                          onClick={() => void onInstallOCR()}
                          disabled={
                            working ||
                            ocrWorking ||
                            !hasSelectedOCRLanguages ||
                            !hasUninstalledSelectedOCRLanguages
                          }
                        >
                          {installOCRMutation.isPending
                            ? t("settings.ocrInstalling")
                            : t("settings.ocrInstall")}
                        </Button>
                        <Button
                          variant="secondary"
                          leadingIcon={
                            removeOCRMutation.isPending ? (
                              <LoaderCircle
                                size={14}
                                className="animate-[icon-spin_900ms_linear_infinite]"
                              />
                            ) : (
                              <Trash2 size={14} />
                            )
                          }
                          onClick={() => setRemoveOCRConfirmOpen(true)}
                          disabled={
                            working ||
                            ocrWorking ||
                            !settings?.ocrRuntime.installed
                          }
                        >
                          {removeOCRMutation.isPending
                            ? t("settings.ocrRemoving")
                            : t("settings.ocrRemove")}
                        </Button>
                        {ocrWorking ? (
                          <Button
                            variant="secondary"
                            leadingIcon={
                              ocrRunStopping ? (
                                <LoaderCircle
                                  size={14}
                                  className="animate-[icon-spin_900ms_linear_infinite]"
                                />
                              ) : (
                                <Square size={14} />
                              )
                            }
                            onClick={onStopOCR}
                            disabled={ocrRunStopping}
                          >
                            {ocrRunStopping
                              ? t("settings.ocrStopping")
                              : t("settings.ocrStop")}
                          </Button>
                        ) : (
                          <Button
                            variant="primary"
                            leadingIcon={<Scan size={14} />}
                            onClick={() => setRunOCRConfirmOpen(true)}
                            disabled={
                              working ||
                              !draft.ocrEnabled ||
                              !settings?.ocrRuntime.installed ||
                              !settings?.ocrRuntime.engineAvailable ||
                              !selectedOCRLanguagesInstalled
                            }
                          >
                            {t("settings.ocrRun")}
                          </Button>
                        )}
                      </div>
                      <p className="font-g text-g-caption tracking-g-ui text-g-ink-3">
                        {settings?.ocrRuntime.installed
                          ? t("settings.ocrInstalled")
                          : t("settings.ocrNotInstalled")}
                      </p>
                      <p className="w-full rounded-g-md border border-g-line bg-g-surface-2 px-3 py-2 text-left font-g text-g-ui leading-[1.55] tracking-g-ui text-g-ink-3">
                        {t("settings.ocrCacheScopeHint")}
                      </p>
                      {settings?.ocrRuntime.engineAvailable === false && (
                        <p className="font-g text-g-caption tracking-g-ui text-g-red">
                          {t("settings.ocrEngineUnavailable", {
                            error: settings.ocrRuntime.engineError,
                          })}
                        </p>
                      )}
                      {settings?.ocrRuntime.installed &&
                        missingSelectedOCRLanguages.length > 0 && (
                          <p className="font-g text-g-caption tracking-g-ui text-g-red">
                            {t("settings.ocrMissingSelectedLanguages", {
                              languages: missingSelectedOCRLanguages
                                .map((language) =>
                                  ocrLanguageLabel(language, t),
                                )
                                .join(", "),
                            })}
                          </p>
                        )}
                      {ocrProgress && (
                        <p className="font-g-mono text-g-chip tracking-g-mono text-g-ink-3 flex items-center gap-1.5">
                          {ocrRunActive && (
                            <LoaderCircle
                              size={12}
                              className="animate-spin shrink-0"
                            />
                          )}
                          {ocrProgress}
                        </p>
                      )}
                    </div>
                  </FieldRow>
                  {updateMutation.error && (
                    <Notice tone="danger">
                      {errorMessage(updateMutation.error)}
                    </Notice>
                  )}
                  {settingActions}
                </div>
              </Card>
            </div>
          )}

          {activeSection === "customFilters" && (
            <Card
              className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm hover:border-g-line hover:shadow-g-sm"
              padding="none"
            >
              <SectionHeading
                title={t("settings.section.customFilters")}
                description={t("settings.customFiltersDesc")}
                icon={sectionIcon("customFilters")}
              />
              <div className="px-6 py-5 md:px-8">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-g-display text-g-h3 font-[650] leading-[1.2] tracking-g-tight text-g-ink">
                      {t("settings.customFilters")}
                    </h2>
                    <p className="mt-1 max-w-[62ch] font-g text-g-ui tracking-g-ui text-g-ink-3">
                      {t("settings.customFiltersDesc")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <IconButton
                      size="sm"
                      aria-label={t("settings.customFiltersHelp")}
                      onClick={() => setCustomFiltersHelpOpen(true)}
                    >
                      <Info size={15} />
                    </IconButton>
                    {draft.customAssetFilters.length > 0 && (
                      <Button
                        variant="secondary"
                        size="sm"
                        leadingIcon={<Plus size={13} />}
                        disabled={working}
                        onClick={onAddCustomFilter}
                      >
                        {t("settings.addCustomFilter")}
                      </Button>
                    )}
                  </div>
                </div>

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
                              size="sm"
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
                                    onDeleteCustomFilter(filter.id),
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
                                      disabled={
                                        working || filter.groups.length <= 1
                                      }
                                      aria-label={t(
                                        "settings.deleteCustomFilterGroup",
                                      )}
                                      onClick={() =>
                                        onDeleteCustomFilterGroup(
                                          filter.id,
                                          groupIndex,
                                        )
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
                                          <div className="flex justify-center py-0.5">
                                            <span className="font-g-mono text-g-chip font-[510] uppercase tracking-g-mono text-g-ink-3">
                                              AND
                                            </span>
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
                                              value={clause.value}
                                              className="min-w-0"
                                              aria-label={t(
                                                "settings.customFilterValueLabel",
                                              )}
                                              options={valueOptions.map(
                                                (value) => ({
                                                  value,
                                                  label: t(
                                                    `settings.customFilterValue.${value}`,
                                                  ),
                                                }),
                                              )}
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
                                              working ||
                                              group.clauses.length <= 1
                                            }
                                            aria-label={t("action.delete")}
                                            onClick={() =>
                                              onDeleteCustomFilterClause(
                                                filter.id,
                                                groupIndex,
                                                clauseIndex,
                                              )
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
                                      onAddCustomFilterClause(
                                        filter.id,
                                        groupIndex,
                                      )
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
                                onClick={() =>
                                  onAddCustomFilterGroup(filter.id)
                                }
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
                {updateMutation.error && (
                  <Notice tone="danger" className="mt-4">
                    {errorMessage(updateMutation.error)}
                  </Notice>
                )}
                {settingActions}
              </div>
            </Card>
          )}

          {activeSection === "optimization" && (
            <Card
              className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
              padding="none"
            >
              <SectionHeading
                title={t("settings.section.optimization")}
                description={t("settings.optimizationDesc")}
                icon={sectionIcon("optimization")}
              />
              <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
                <FieldRow
                  label={t("settings.defaultQuality")}
                  description={t("settings.defaultQualityHint")}
                  icon={<Sliders size={15} />}
                  align="start"
                >
                  <div className="flex w-full flex-col gap-3 min-[1200px]:w-[320px]">
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={draft.optimizationDefaultQuality}
                        disabled={
                          settingsQuery.isLoading || updateMutation.isPending
                        }
                        onChange={(event) =>
                          updateDraft((prev) => ({
                            ...prev,
                            optimizationDefaultQuality: Number(
                              event.target.value,
                            ),
                          }))
                        }
                        className="w-full flex-1 rounded-g-sm accent-g-active-bg focus-visible:outline-none focus-visible:shadow-g-focus disabled:cursor-not-allowed disabled:opacity-[0.38]"
                        aria-label={t("settings.defaultQuality")}
                      />
                      <span className="inline-flex h-g-btn-sm min-w-[44px] items-center justify-center rounded-g-md border border-g-line bg-g-surface-2 font-g-mono text-g-ui font-[590] tabular-nums tracking-g-mono text-g-ink">
                        {draft.optimizationDefaultQuality}
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      {(
                        [
                          { label: t("settings.qualityLow"), value: 60 },
                          { label: t("settings.qualityStandard"), value: 80 },
                          { label: t("settings.qualityHigh"), value: 95 },
                          { label: t("settings.qualityMax"), value: 100 },
                        ] as const
                      ).map((preset) => (
                        <button
                          key={preset.value}
                          type="button"
                          disabled={
                            settingsQuery.isLoading || updateMutation.isPending
                          }
                          onClick={() =>
                            updateDraft((prev) => ({
                              ...prev,
                              optimizationDefaultQuality: preset.value,
                            }))
                          }
                          className={cn(
                            "flex-1 rounded-g-md border px-2 py-1 font-g text-g-caption font-[510] tracking-g-ui transition-[background,border-color,color] duration-[120ms] ease-g focus-visible:outline-none focus-visible:shadow-g-focus disabled:cursor-not-allowed disabled:opacity-[0.38]",
                            draft.optimizationDefaultQuality === preset.value
                              ? "border-g-active-bg bg-g-active-bg text-g-active-text"
                              : "border-g-line bg-g-surface hover:bg-g-surface-2 text-g-ink-2",
                          )}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </FieldRow>
                <FieldRow
                  label={t("settings.autoApply")}
                  description={t("settings.autoApplyHint")}
                  icon={<Sliders size={15} />}
                >
                  <Switch
                    checked={draft.optimizationAutoApply}
                    onCheckedChange={(next) =>
                      updateDraft((prev) => ({
                        ...prev,
                        optimizationAutoApply: next,
                      }))
                    }
                    disabled={
                      settingsQuery.isLoading || updateMutation.isPending
                    }
                    aria-label={t("settings.autoApply")}
                  />
                </FieldRow>
                {updateMutation.error && (
                  <Notice tone="danger">
                    {errorMessage(updateMutation.error)}
                  </Notice>
                )}
                {settingActions}
              </div>
            </Card>
          )}

          {activeSection === "hotkeys" && (
            <div className="flex flex-col gap-4">
              <Card
                className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
                padding="none"
              >
                <div className="flex items-center gap-2.5 border-b border-g-line px-6 py-3 md:px-8">
                  <Keyboard size={15} className="shrink-0 text-g-ink-3" />
                  <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
                    {t("settings.hotkeyGeneral")}
                  </span>
                </div>
                <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
                  <FieldRow label={t("settings.hotkeyPalette")}>
                    <Keycap>⌘ P</Keycap>
                  </FieldRow>
                  <FieldRow label={t("settings.hotkeyClose")}>
                    <Keycap>Esc</Keycap>
                  </FieldRow>
                </div>
              </Card>
              <Card
                className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
                padding="none"
              >
                <div className="flex items-center gap-2.5 border-b border-g-line px-6 py-3 md:px-8">
                  <ArrowLeftRight size={15} className="shrink-0 text-g-ink-3" />
                  <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
                    {t("settings.hotkeyNavigation")}
                  </span>
                </div>
                <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
                  <FieldRow label={t("settings.hotkeyPrevAsset")}>
                    <Keycap>←</Keycap>
                  </FieldRow>
                  <FieldRow label={t("settings.hotkeyNextAsset")}>
                    <Keycap>→</Keycap>
                  </FieldRow>
                </div>
              </Card>
            </div>
          )}

          {activeSection === "about" && (
            <Card
              className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm hover:border-g-line hover:shadow-g-sm"
              padding="none"
            >
              <SectionHeading
                title={t("settings.section.about")}
                description={t("settings.aboutDesc")}
                icon={sectionIcon("about")}
              />
              <div className="px-6 pt-5 pb-2 md:px-8">
                {/* ── Version ── */}
                <div className="flex flex-col gap-3 min-[1200px]:flex-row min-[1200px]:items-start min-[1200px]:justify-between min-[1200px]:gap-8">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-g-display text-g-body font-[590] leading-[1.3] tracking-[-0.013em] text-g-ink">
                        Asset Studio
                      </span>
                      <Badge tone="default">
                        {versionQuery.data?.currentVersion ?? "dev"}
                      </Badge>
                      {versionQuery.data?.updateAvailable ? (
                        <Badge tone="amber">
                          {t("settings.updateAvailable", {
                            version: versionQuery.data.latestVersion,
                          })}
                        </Badge>
                      ) : versionQuery.isError ? (
                        <Badge tone="red">
                          {t("settings.updateCheckFailed")}
                        </Badge>
                      ) : (
                        <Badge tone="green">{t("settings.upToDate")}</Badge>
                      )}
                    </div>
                    <p className="mt-1 font-g text-g-ui font-normal tracking-g-ui text-g-ink-3">
                      {t("settings.license")}: MIT
                      {versionQuery.data?.devMode && (
                        <span className="ml-2 text-g-ink-3">
                          · {t("settings.versionDevHint")}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      leadingIcon={
                        updateAppMutation.isPending ? (
                          <LoaderCircle size={15} className="animate-spin" />
                        ) : (
                          <RefreshCw size={15} />
                        )
                      }
                      onClick={() => void onUpdateApp()}
                      disabled={
                        updateAppMutation.isPending ||
                        versionQuery.isLoading ||
                        (!versionQuery.data?.updateAvailable &&
                          !versionQuery.data?.devMode &&
                          !import.meta.env.DEV)
                      }
                    >
                      {updateAppMutation.isPending
                        ? t("settings.updating")
                        : versionQuery.data?.updateAvailable
                          ? t("settings.updateAction")
                          : t("settings.upToDateAction")}
                    </Button>
                    <Button
                      variant="secondary"
                      leadingIcon={<Download size={15} />}
                      onClick={() => void onInstallApp()}
                      disabled={installedApp}
                    >
                      {installedApp
                        ? t("settings.installInstalledAction")
                        : t("settings.installAppAction")}
                    </Button>
                  </div>
                </div>
                {installMessage && (
                  <div className="mt-2">
                    <Notice tone={installedApp ? "success" : "info"}>
                      {installMessage}
                    </Notice>
                  </div>
                )}

                {/* ── Data ── */}
                <div className="mt-6 border-t border-g-line pt-5">
                  <div className="mb-3">
                    <span className="block font-g text-g-body font-[510] leading-[1.4] tracking-g-ui text-g-ink">
                      {t("settings.data")}
                    </span>
                    <p className="mt-0.5 max-w-[48ch] font-g text-g-ui font-normal tracking-g-ui text-g-ink-3">
                      {t("settings.dataDesc")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      leadingIcon={<Download size={15} />}
                      onClick={onExport}
                    >
                      {t("settings.export")}
                    </Button>
                    <Button
                      variant="secondary"
                      leadingIcon={<Upload size={15} />}
                      onClick={() => fileInputRef.current?.click()}
                      disabled={working}
                    >
                      {t("settings.import")}
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/json,.json"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = "";
                        if (file) void onImport(file);
                      }}
                    />
                    <span className="hidden h-4 w-px bg-g-line min-[480px]:block" />
                    <Button
                      variant="danger"
                      leadingIcon={<RotateCcw size={15} />}
                      onClick={() => setResetDatabaseOpen(true)}
                      disabled={working}
                    >
                      {t("settings.resetDatabase")}
                    </Button>
                  </div>
                </div>

                {/* ── Storage ── */}
                <div className="mt-6 border-t border-g-line pt-5">
                  <div className="mb-3">
                    <span className="block font-g text-g-body font-[510] leading-[1.4] tracking-g-ui text-g-ink">
                      {t("settings.storage")}
                    </span>
                    <p className="mt-0.5 max-w-[48ch] font-g text-g-ui font-normal tracking-g-ui text-g-ink-3">
                      {t("settings.storageDesc")}
                    </p>
                  </div>
                  <div className="grid gap-2">
                    {(
                      [
                        ["databasePath", settings?.databasePath],
                        ["dataDir", settings?.dataDir],
                        ["cacheDir", settings?.cacheDir],
                      ] as const
                    ).map(([key, value]) => (
                      <div
                        key={key}
                        className="flex flex-col gap-1 rounded-g-md bg-g-surface-2 px-3 py-2.5 min-[1200px]:flex-row min-[1200px]:items-center min-[1200px]:gap-4"
                      >
                        <span className="shrink-0 font-g text-g-ui font-[510] tracking-g-ui text-g-ink-2 min-[1200px]:w-[100px]">
                          {t(`settings.${key}`)}
                        </span>
                        <code className="min-w-0 break-all font-g-mono text-g-chip tracking-g-mono text-g-ink-3">
                          {value ?? "..."}
                        </code>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="h-4" />
              </div>
            </Card>
          )}
        </div>
      </div>
      {ocrLimitsOpen && (
        <Modal
          title={t("settings.ocrLimitsHelpTitle")}
          description={t("settings.ocrLimitsHelpDesc")}
          size="md"
          onClose={() => setOCRLimitsOpen(false)}
          bodyClassName="space-y-4"
        >
          <Notice tone="info">{t("settings.ocrLimitsKeepDefaults")}</Notice>

          {/* ── Performance group ── */}
          <fieldset className="space-y-0.5 rounded-g-md border border-g-line bg-g-surface-2 p-3">
            <legend className="sr-only">
              {t("settings.ocrGroupPerformance")}
            </legend>
            <p className="mb-2.5 font-g text-g-caption font-[510] uppercase tracking-[0.04em] text-g-ink-3">
              {t("settings.ocrGroupPerformance")}
            </p>

            <label className="grid gap-1.5">
              <span className="font-g text-g-body font-[510] leading-[1.4] tracking-g-ui text-g-ink">
                {t("settings.ocrMaxPixels")}
              </span>
              <span className="font-g text-g-ui leading-[1.6] tracking-g-ui text-g-ink-3">
                {t("settings.ocrMaxPixelsHint")}
              </span>
              <TextInput
                type="number"
                min={100000}
                step={100000}
                value={String(draft.ocrMaxPixels)}
                suffix={<span>{t("settings.ocrMaxPixelsSuffix")}</span>}
                onChange={(event) =>
                  updateDraft((prev) => ({
                    ...prev,
                    ocrMaxPixels: Number(event.target.value),
                  }))
                }
                aria-label={t("settings.ocrMaxPixels")}
              />
              <span className="font-g text-g-chip tracking-g-ui text-g-ink-3">
                {t("settings.ocrMaxPixelsDefault")}
              </span>
            </label>

            <div className="my-2 border-t border-g-line" role="separator" />

            <label className="grid gap-1.5">
              <span className="font-g text-g-body font-[510] leading-[1.4] tracking-g-ui text-g-ink">
                {t("settings.ocrBatchSize")}
              </span>
              <span className="font-g text-g-ui leading-[1.6] tracking-g-ui text-g-ink-3">
                {t("settings.ocrBatchSizeHint")}
              </span>
              <TextInput
                type="number"
                min={1}
                max={200}
                step={5}
                value={String(draft.ocrBatchSize)}
                onChange={(event) =>
                  updateDraft((prev) => ({
                    ...prev,
                    ocrBatchSize: Number(event.target.value),
                  }))
                }
                aria-label={t("settings.ocrBatchSize")}
              />
              <span className="font-g text-g-chip tracking-g-ui text-g-ink-3">
                {t("settings.ocrBatchSizeDefault")}
              </span>
            </label>

            <div className="my-2 border-t border-g-line" role="separator" />

            <label className="grid gap-1.5">
              <span className="font-g text-g-body font-[510] leading-[1.4] tracking-g-ui text-g-ink">
                {t("settings.ocrConcurrency")}
              </span>
              <span className="font-g text-g-ui leading-[1.6] tracking-g-ui text-g-ink-3">
                {t("settings.ocrConcurrencyHint")}
              </span>
              <TextInput
                type="number"
                min={1}
                max={2}
                value={String(draft.ocrConcurrency)}
                onChange={(event) =>
                  updateDraft((prev) => ({
                    ...prev,
                    ocrConcurrency: Number(event.target.value),
                  }))
                }
                aria-label={t("settings.ocrConcurrency")}
              />
              <span className="font-g text-g-chip tracking-g-ui text-g-ink-3">
                {t("settings.ocrConcurrencyDefault")}
              </span>
            </label>
          </fieldset>

          {/* ── Search behavior group ── */}
          <fieldset className="rounded-g-md border border-g-line bg-g-surface-2 p-3">
            <legend className="sr-only">{t("settings.ocrGroupSearch")}</legend>
            <p className="mb-2.5 font-g text-g-caption font-[510] uppercase tracking-[0.04em] text-g-ink-3">
              {t("settings.ocrGroupSearch")}
            </p>

            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-g text-g-body font-[510] leading-[1.4] tracking-g-ui text-g-ink">
                  {t("settings.ocrFuzzySearch")}
                </div>
                <p className="mt-1 font-g text-g-ui leading-[1.6] tracking-g-ui text-g-ink-3">
                  {t("settings.ocrFuzzySearchHint")}
                </p>
              </div>
              <Switch
                checked={draft.ocrFuzzySearch}
                onCheckedChange={(next) =>
                  updateDraft((prev) => ({
                    ...prev,
                    ocrFuzzySearch: next,
                  }))
                }
                aria-label={t("settings.ocrFuzzySearch")}
              />
            </div>
          </fieldset>
        </Modal>
      )}
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
      <WorkspaceDialog
        open={addWorkspaceOpen}
        loading={addWorkspaceMutation.isPending}
        onConfirm={onAddWorkspace}
        onCancel={() => setAddWorkspaceOpen(false)}
      />
      <WorkspaceDialog
        open={Boolean(workspaceBeingRenamed)}
        workspace={workspaceBeingRenamed}
        loading={renameWorkspaceMutation.isPending}
        onConfirm={onRenameWorkspace}
        onCancel={() => setRenameWorkspaceId(null)}
      />
      <ConfirmDialog
        open={Boolean(workspaceBeingRemoved)}
        variant="danger"
        title={t("settings.removeWorkspace")}
        message={t("settings.removeWorkspaceConfirm", {
          name: workspaceBeingRemoved?.name ?? "",
        })}
        confirmText={t("action.delete")}
        cancelText={t("common.cancel")}
        loading={removeWorkspaceMutation.isPending}
        onConfirm={onRemoveWorkspace}
        onCancel={() => setRemoveWorkspaceId(null)}
      />
      <ProjectDialog
        open={Boolean(projectBeingRenamed)}
        project={projectBeingRenamed}
        loading={renameProjectMutation.isPending}
        onConfirm={onRenameProject}
        onCancel={() => setRenameProjectId(null)}
      />
      <ConfirmDialog
        open={Boolean(projectBeingRemoved)}
        variant="danger"
        title={t("projects.removeDialogTitle")}
        message={t("projects.removeConfirm", {
          name: projectBeingRemoved?.name ?? "",
        })}
        confirmText={t("projects.removeDialogConfirm")}
        cancelText={t("common.cancel")}
        loading={removeProjectMutation.isPending}
        onConfirm={onRemoveProject}
        onCancel={() => setRemoveProjectId(null)}
      />
      <ConfirmDialog
        open={runOCRConfirmOpen}
        title={t("settings.ocrRunConfirmTitle")}
        message={
          <div className="grid gap-2">
            <p>{t("settings.ocrRunConfirmIntro")}</p>
            <ul className="m-0 list-disc space-y-1 pl-4">
              <li>{t("settings.ocrRunConfirmLocal")}</li>
              <li>
                {t("settings.ocrRunConfirmBatch", {
                  batchSize: draft.ocrBatchSize,
                })}
              </li>
              <li>{t("settings.ocrRunConfirmSettings")}</li>
              <li>{t("settings.ocrRunConfirmSearch")}</li>
            </ul>
          </div>
        }
        confirmText={t("settings.ocrRunConfirmAction")}
        cancelText={t("common.cancel")}
        loading={ocrWorking}
        onConfirm={() => void onRunOCRConfirmed()}
        onCancel={() => setRunOCRConfirmOpen(false)}
      />
      <ConfirmDialog
        open={removeOCRConfirmOpen}
        title={t("settings.ocrRemoveConfirmTitle")}
        message={t("settings.ocrRemoveConfirmMessage")}
        confirmText={t("settings.ocrRemoveConfirmAction")}
        cancelText={t("common.cancel")}
        variant="danger"
        loading={removeOCRMutation.isPending}
        onConfirm={() => void onRemoveOCR()}
        onCancel={() => setRemoveOCRConfirmOpen(false)}
      />
      <ConfirmDialog
        open={resetSettingsOpen}
        title={t("settings.resetSettings")}
        message={t("settings.resetSettingsConfirm")}
        confirmText={t("settings.reset")}
        cancelText={t("common.cancel")}
        loading={updateMutation.isPending}
        onConfirm={() => void onConfirmResetSettings()}
        onCancel={() => setResetSettingsOpen(false)}
      />
      <ConfirmDialog
        open={resetDatabaseOpen}
        variant="danger"
        title={t("settings.resetDatabase")}
        message={t("settings.resetConfirm")}
        confirmText={t("settings.resetDatabase")}
        cancelText={t("common.cancel")}
        loading={resetMutation.isPending}
        onConfirm={onReset}
        onCancel={() => setResetDatabaseOpen(false)}
      />
    </>
  );
}
