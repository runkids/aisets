import type { ReactNode } from "react";
import {
  Filter,
  FolderKanban,
  Info,
  Keyboard,
  Paintbrush,
  Scan,
  Settings2,
  Sliders,
} from "lucide-react";
import { AiChipIcon } from "../ui/AiChipIcon";
import type {
  CustomAssetFilterField,
  CustomAssetFilterOperator,
  ExcludePatternsByIntent,
  OptimizationExternalTool,
  OptimizationStrategy,
  ProjectScanIntent,
  ScanProfile,
  SettingsUpdate,
} from "../../types";
import type { Section } from "./types";

export const sectionMeta: { id: Section; icon: ReactNode }[] = [
  { id: "appearance", icon: <Paintbrush size={15} /> },
  { id: "workspace", icon: <Settings2 size={15} /> },
  { id: "projects", icon: <FolderKanban size={15} /> },
  { id: "scanning", icon: <Scan size={15} /> },
  { id: "ai", icon: <AiChipIcon size={15} /> },
  { id: "optimization", icon: <Sliders size={15} /> },
  { id: "customFilters", icon: <Filter size={15} /> },
  { id: "hotkeys", icon: <Keyboard size={15} /> },
  { id: "about", icon: <Info size={15} /> },
];

export const defaultOptimizationExternalTools: OptimizationExternalTool[] = [
  { id: "ffmpeg", enabled: false },
  { id: "cwebp", enabled: false },
  { id: "avifenc", enabled: false },
  { id: "gifsicle", enabled: false },
  { id: "svgo", enabled: false },
  { id: "magick", enabled: false },
  { id: "oxipng", enabled: false },
];

export const defaultOptimizationStrategies: OptimizationStrategy[] = [
  {
    id: "svg-minify",
    name: "SVG minify",
    enabled: true,
    priority: 10,
    match: { formats: ["svg"], alpha: "any", animated: "any" },
    action: { operation: "svg-minify", outputFormat: "svg" },
  },
  {
    id: "oversized-raster-resize",
    name: "Oversized raster resize",
    enabled: true,
    priority: 20,
    match: {
      formats: ["png", "jpg", "jpeg", "webp", "gif"],
      alpha: "any",
      animated: "any",
    },
    action: { operation: "resize" },
  },
  {
    id: "png-opaque-avif",
    name: "PNG opaque to AVIF",
    enabled: true,
    priority: 30,
    match: { formats: ["png"], alpha: "opaque", animated: "false" },
    action: {
      operation: "convert",
      outputFormat: "avif",
      quality: 50,
      avifSpeed: 6,
    },
  },
  {
    id: "png-alpha-webp",
    name: "PNG transparent to WebP",
    enabled: true,
    priority: 40,
    match: { formats: ["png"], alpha: "transparent", animated: "false" },
    action: { operation: "convert", outputFormat: "webp", quality: 80 },
  },
  {
    id: "jpeg-large-avif",
    name: "JPEG large to AVIF",
    enabled: true,
    priority: 50,
    match: {
      formats: ["jpg", "jpeg"],
      alpha: "opaque",
      animated: "false",
      minBytesKB: 200,
    },
    action: {
      operation: "convert",
      outputFormat: "avif",
      quality: 50,
      avifSpeed: 6,
    },
  },
  {
    id: "gif-animated-keep-gif",
    name: "GIF animated recompress",
    enabled: true,
    priority: 60,
    match: { formats: ["gif"], alpha: "any", animated: "true" },
    action: {
      operation: "recompress",
      outputFormat: "gif",
      quality: 75,
      preserveAnimation: true,
    },
  },
  {
    id: "webp-large-recompress",
    name: "WebP large recompress",
    enabled: true,
    priority: 70,
    match: {
      formats: ["webp"],
      alpha: "any",
      animated: "any",
      minBytesKB: 800,
    },
    action: { operation: "recompress", outputFormat: "webp", quality: 60 },
  },
];

export const LLM_MAX_CONCURRENCY = 8;
export const LLM_MIN_TIMEOUT = 30;
export const LLM_MAX_TIMEOUT = 600;

export const defaultSettings: SettingsUpdate = {
  workspaceName: "Aisets",
  defaultProjectRoot: "",
  autoScanOnOpen: false,
  scanOnOpen: false,
  scanProfile: "full",
  scanAnalyses: {
    references: true,
    nearDuplicates: true,
    optimization: true,
  },
  ocrEnabled: false,
  ocrLanguages: ["eng"],
  ocrMaxPixels: 2_000_000,
  ocrBatchSize: 25,
  ocrConcurrency: 1,
  ocrFuzzySearch: true,
  llmProvider: "",
  llmEndpoint: "http://localhost:11434",
  llmVisionModel: "",
  llmEmbedModel: "",
  llmConcurrency: 1,
  excludePatterns: [],
  excludePatternsByIntent: {
    code: [
      "**/*.test.*",
      "**/*.spec.*",
      "**/__tests__/**",
      "**/__mocks__/**",
      "**/*.stories.*",
    ],
    assetPack: [],
    library: [
      "**/*.test.*",
      "**/*.spec.*",
      "**/__tests__/**",
      "**/__mocks__/**",
      "**/*.stories.*",
    ],
    mixed: [
      "**/*.test.*",
      "**/*.spec.*",
      "**/__tests__/**",
      "**/__mocks__/**",
      "**/*.stories.*",
    ],
  },
  optimizationDefaultQuality: 80,
  optimizationWorkers: 1,
  optimizationAvifSpeed: 6,
  optimizationAutoApply: false,
  optimizationThresholds: {
    svgMinSavingsPercent: 10,
    maxDimensionPx: 2560,
    fileSizeWarningKB: 200,
    fileSizeCriticalKB: 500,
    pngAlphaCheckEnabled: true,
  },
  optimizationExternalTools: defaultOptimizationExternalTools,
  optimizationStrategies: defaultOptimizationStrategies,
  customAssetFilters: [],
};

export const projectScanIntentValues: ProjectScanIntent[] = [
  "code",
  "assetPack",
  "library",
  "mixed",
];

export const emptyExcludePatternsByIntent: ExcludePatternsByIntent = {
  code: [],
  assetPack: [],
  library: [],
  mixed: [],
};

export const scanProfileOptions: Array<{
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

export const customFilterFields: CustomAssetFilterField[] = [
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
  "aiCategory",
  "aiTag",
  "aiDescription",
  "aiStatus",
];

export const customFilterOperatorsByField: Record<
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
  aiCategory: ["equals", "contains", "regex"],
  aiTag: ["contains", "oneOf"],
  aiDescription: ["contains", "oneOf", "regex"],
  aiStatus: ["is"],
};

export const editorOptions = [
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

export const ghostDangerClass =
  "text-g-ink-3 hover:bg-g-red-soft hover:text-g-red";
export const smButtonOverrideClass =
  "!h-g-btn-sm !px-2 !font-g !text-g-caption !leading-none !tracking-g-ui";
export const rowActionButtonClass = `${smButtonOverrideClass} text-g-ink-3`;
export const rowActionDangerButtonClass = `${smButtonOverrideClass} ${ghostDangerClass}`;
export const workspaceDialogButtonClass = `${smButtonOverrideClass} [&_svg]:!size-3`;
export const workspaceDialogDangerButtonClass = `${workspaceDialogButtonClass} ${ghostDangerClass}`;
export const activeWorkspaceBadgeClass =
  "inline-flex items-center justify-center gap-1.5 h-7 px-2.5 rounded-g-pill border border-g-green/20 bg-g-green/[0.08] text-g-ink-2 font-g text-g-caption font-[510] leading-none tracking-g-ui [&_svg]:size-3 [&_svg]:text-g-green";
export const switchWorkspaceButtonClass =
  "inline-flex items-center justify-center gap-1.5 h-7 px-2.5 rounded-g-pill border border-g-line bg-g-surface font-g text-g-caption font-[510] leading-none tracking-g-ui text-g-ink-2 [&_svg]:size-3 hover:bg-g-surface-2 hover:border-g-line-strong";
export const projectAssetsBadgeClass =
  "shrink-0 border-g-line bg-g-surface-2 text-g-ink-3";
export const workspaceRowActionRevealClass =
  "flex flex-wrap items-center gap-1.5 sm:pointer-events-none sm:absolute sm:right-[calc(100%+6px)] sm:top-1/2 sm:z-10 sm:-translate-y-1/2 sm:flex-nowrap sm:opacity-0 sm:transition-opacity sm:duration-[120ms] sm:ease-g sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100";
export const projectRowActionRevealClass =
  "flex flex-wrap items-center gap-1.5 pl-3 sm:pointer-events-none sm:absolute sm:right-2 sm:top-1/2 sm:z-10 sm:-translate-y-1/2 sm:flex-nowrap sm:rounded-g-md sm:bg-g-surface-2 sm:p-1 sm:pl-1 sm:opacity-0 sm:shadow-g-sm sm:transition-opacity sm:duration-[120ms] sm:ease-g sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100";

export const defaultOCRLanguages = ["eng"];
export const fallbackOCRLanguages = [
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
