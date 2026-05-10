import type { ImageBackgroundMode } from "../../imageBackground";
import type { Mode } from "../../ui";
import type { AITagActivityState } from "../../aiTagActivity";
import type { OCRActivityState } from "../../ocrActivity";
import type { VLMOcrActivityState } from "../../vlmOcrActivity";
import type {
  CustomAssetFilter,
  OptimizationExternalTool,
  OptimizationStrategy,
  OptimizationThresholds,
  ProjectScanIntent,
  ScanAnalyses,
  ScanProfile,
  SettingsInfo,
} from "../../types";

export type ThemePreference = "light" | "dark" | "system";

export type SettingsViewProps = {
  theme: ThemePreference;
  imagePreviewEnabled: boolean;
  imageBackgroundMode: ImageBackgroundMode;
  ocrActivity: OCRActivityState;
  aiTagActivity: AITagActivityState;
  vlmOcrActivity: VLMOcrActivityState;
  scanWorking?: boolean;
  onThemeChange: (theme: ThemePreference) => void;
  onImagePreviewEnabledChange: (enabled: boolean) => void;
  onImageBackgroundModeChange: (mode: ImageBackgroundMode) => void;
  onStartOCR: (saveSettings: () => Promise<void>) => void;
  onStopOCR: () => void;
  onDismissOCR: () => void;
  onStartAITag: (
    saveSettings: () => Promise<void>,
    presetId?: string,
    projectIds?: string[],
  ) => void;
  onStopAITag: () => void;
  onDismissAITag: () => void;
  onStartVLMOcr: (
    saveSettings: () => Promise<void>,
    presetId?: string,
    projectIds?: string[],
  ) => void;
  onStopVLMOcr: () => void;
  onDismissVLMOcr: () => void;
  onAddProject?: () => void;
  onNavigate?: (mode: Mode) => void;
};

export type Section =
  | "workspace"
  | "projects"
  | "appearance"
  | "scanning"
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
  llmConcurrency: number;
  llmTimeout: number;
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
};

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export type OCRLanguagePack =
  SettingsInfo["ocrRuntime"]["availableLanguages"][number];
