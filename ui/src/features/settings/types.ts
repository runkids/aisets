import type { ImageBackgroundMode } from "@/imageBackground";
import type { Mode } from "@/ui";
import type { AITagActivityState } from "@/activity/aiTagActivity";
import type { OCRActivityState } from "@/activity/ocrActivity";
import type { VLMOcrActivityState } from "@/activity/vlmOcrActivity";
import type { EmbedActivityState } from "@/activity/embedActivity";
import type {
  CustomAssetFilter,
  LintRuleSettings,
  OptimizationExternalTool,
  OptimizationStrategy,
  OptimizationThresholds,
  ProjectScanIntent,
  ScanAnalyses,
  ScanProfile,
  SettingsInfo,
} from "@/types";

export type ThemePreference = "light" | "dark" | "system";

export type SettingsViewProps = {
  theme: ThemePreference;
  imagePreviewEnabled: boolean;
  imagePreviewDelaySeconds: number;
  imagePreviewSize: { width: number; height: number };
  imageBackgroundMode: ImageBackgroundMode;
  ocrActivity: OCRActivityState;
  aiTagActivity: AITagActivityState;
  vlmOcrActivity: VLMOcrActivityState;
  scanWorking?: boolean;
  onThemeChange: (theme: ThemePreference) => void;
  onImagePreviewEnabledChange: (enabled: boolean) => void;
  onImagePreviewDelaySecondsChange: (seconds: number) => void;
  onImagePreviewSizeChange: (size: { width: number; height: number }) => void;
  onImageBackgroundModeChange: (mode: ImageBackgroundMode) => void;
  onStartOCR: (saveSettings: () => Promise<void>) => void;
  onStopOCR: () => void;
  onDismissOCR: () => void;
  onStartAITag: (
    saveSettings: () => Promise<void>,
    presetId?: string,
    projectIds?: string[],
    scopeLabel?: string,
  ) => void;
  onStopAITag: () => void;
  onDismissAITag: () => void;
  onStartVLMOcr: (
    saveSettings: () => Promise<void>,
    presetId?: string,
    projectIds?: string[],
    scopeLabel?: string,
  ) => void;
  onStopVLMOcr: () => void;
  onDismissVLMOcr: () => void;
  embedActivity: EmbedActivityState;
  onStartEmbed: (
    projectIds?: string[],
    scopeLabel?: string,
    force?: boolean,
  ) => void;
  onStopEmbed: () => void;
  onDismissEmbed: () => void;
  onAddProject?: () => void;
  onNavigate?: (mode: Mode) => void;
};

export type Section =
  | "workspace"
  | "projects"
  | "appearance"
  | "scanning"
  | "lintRules"
  | "ai"
  | "customFilters"
  | "optimization"
  | "hotkeys"
  | "about";

export type SettingsDraft = {
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
  llmEnabled: boolean;
  llmProvider: string;
  llmEndpoint: string;
  llmApiKey: string;
  llmVisionModel: string;
  llmEmbedModel: string;
  llmTagPrompt: string;
  llmOcrPrompt: string;
  llmPrecheckPrompt: string;
  llmAutoLocale: boolean;
  llmTranslationLocales: string[];
  llmConcurrency: number;
  llmTimeout: number;
  agentEnabled: boolean;
  agentAdapter: string;
  agentModel: string;
  vlmBackend: string;
  vlmBackendTag: string;
  vlmBackendOcr: string;
  vlmBackendOptimize: string;
  vlmBackendDuplicate: string;
  vlmBackendPrecheck: string;
  vlmBackendTranslate: string;
  vlmBackendCanvas: string;
  aiNickname: string;
  excludePatternsText: string;
  excludePatternsByIntentText: Record<ProjectScanIntent, string>;
  optimizationDefaultQuality: number;
  optimizationWorkers: number;
  optimizationAvifSpeed: number;
  optimizationAutoApply: boolean;
  optimizationThresholds: OptimizationThresholds;
  optimizationExternalTools: OptimizationExternalTool[];
  optimizationStrategies: OptimizationStrategy[];
  customAssetFilters: CustomAssetFilter[];
  lintRules: LintRuleSettings;
  embedSearchThreshold: number;
  embedSearchLimit: number;
  embedSearchType: string;
  embedInputFields: string[];
};

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export type OCRLanguagePack =
  SettingsInfo["ocrRuntime"]["availableLanguages"][number];
