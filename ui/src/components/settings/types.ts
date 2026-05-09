import type { ImageBackgroundMode } from "../../imageBackground";
import type { AITagActivityState } from "../../aiTagActivity";
import type { OCRActivityState } from "../../ocrActivity";
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
  scanWorking?: boolean;
  onThemeChange: (theme: ThemePreference) => void;
  onImagePreviewEnabledChange: (enabled: boolean) => void;
  onImageBackgroundModeChange: (mode: ImageBackgroundMode) => void;
  onStartOCR: (saveSettings: () => Promise<void>) => void;
  onStopOCR: () => void;
  onDismissOCR: () => void;
  onStartAITag: (saveSettings: () => Promise<void>) => void;
  onStopAITag: () => void;
  onDismissAITag: () => void;
  onAddProject?: () => void;
};

export type Section =
  | "workspace"
  | "projects"
  | "theme"
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
  llmVisionModel: string;
  llmEmbedModel: string;
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
