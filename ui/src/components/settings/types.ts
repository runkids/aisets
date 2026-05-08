import type { ImageBackgroundMode } from "../../imageBackground";
import type { OCRActivityState } from "../../ocrActivity";
import type {
  CustomAssetFilter,
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
  onThemeChange: (theme: ThemePreference) => void;
  onImagePreviewEnabledChange: (enabled: boolean) => void;
  onImageBackgroundModeChange: (mode: ImageBackgroundMode) => void;
  onStartOCR: (saveSettings: () => Promise<void>) => void;
  onStopOCR: () => void;
  onDismissOCR: () => void;
};

export type Section =
  | "workspace"
  | "projects"
  | "theme"
  | "scanning"
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
  excludePatternsText: string;
  excludePatternsByIntentText: Record<ProjectScanIntent, string>;
  optimizationDefaultQuality: number;
  optimizationAutoApply: boolean;
  optimizationThresholds: OptimizationThresholds;
  customAssetFilters: CustomAssetFilter[];
};

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export type OCRLanguagePack =
  SettingsInfo["ocrRuntime"]["availableLanguages"][number];
