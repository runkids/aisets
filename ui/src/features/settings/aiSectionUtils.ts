import type { ReactNode } from "react";
import type { AITagActivityState } from "@/activity/aiTagActivity";
import type { VLMOcrActivityState } from "@/activity/vlmOcrActivity";
import type { EmbedActivityState } from "@/activity/embedActivity";
import type { AgentAdapterInfo, SettingsInfo, Workspace } from "@/types";
import type { Mode } from "@/ui";
import type { ScopeProject } from "./AIScopePicker";
import type { SettingsDraft } from "./types";

// ── LastRun persistence ────────────────────────────────────────────

export type LastRunRecord<T> = {
  counts: T;
  timestamp: number;
  scopeLabel?: string;
  elapsedMs?: number;
  providerName?: string;
  modelName?: string;
  errors?: { repoPath: string; message: string }[];
};

export const AI_TAG_LAST_RUN_KEY = "aisets:ai-tag:last-run";
export const VLM_OCR_LAST_RUN_KEY = "aisets:vlm-ocr:last-run";
export const EMBED_LAST_RUN_KEY = "aisets:embed:last-run";

export function readLastRun<T>(key: string): LastRunRecord<T> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as LastRunRecord<T>) : null;
  } catch {
    return null;
  }
}

export function saveLastRun<T>(
  key: string,
  counts: T,
  scopeLabel?: string,
  elapsedMs?: number,
  providerName?: string,
  modelName?: string,
  errors?: { repoPath: string; message: string }[],
): void {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        counts,
        timestamp: Date.now(),
        scopeLabel,
        elapsedMs,
        providerName,
        modelName,
        errors: errors && errors.length > 0 ? errors : undefined,
      }),
    );
  } catch {
    // ignore storage errors (quota, private mode)
  }
}

export function clearLastRun(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore storage errors (quota, private mode)
  }
}

// ── Formatters ─────────────────────────────────────────────────────

export function formatElapsed(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export function middleTruncatePath(path: string, maxLen = 55): string {
  if (path.length <= maxLen) return path;
  const parts = path.split("/");
  if (parts.length <= 2) {
    const half = Math.floor((maxLen - 1) / 2);
    return path.slice(0, half) + "…" + path.slice(-(maxLen - half - 1));
  }
  const fileName = parts[parts.length - 1];
  for (let n = parts.length - 2; n >= 1; n--) {
    const head = parts.slice(0, n).join("/");
    const result = head + "/…/" + fileName;
    if (result.length <= maxLen) return result;
  }
  return parts[0] + "/…/" + fileName;
}

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function deriveHost(endpoint: string | undefined): string {
  try {
    return new URL(endpoint ?? "http://localhost").hostname;
  } catch {
    return "localhost";
  }
}

export function agentCliAdapters(
  adapters: AgentAdapterInfo[] | undefined,
): AgentAdapterInfo[] {
  return adapters?.filter((adapter) => adapter.id !== "local-llm") ?? [];
}

// ── Locale helpers ─────────────────────────────────────────────────

export const ALL_TRANSLATION_LOCALES = [
  { id: "en", label: "English" },
  { id: "zh-TW", label: "繁體中文" },
  { id: "zh-CN", label: "简体中文" },
  { id: "ja", label: "日本語" },
  { id: "ko", label: "한국어" },
];

export function sortedTranslationLocales(currentLang: string) {
  const en = ALL_TRANSLATION_LOCALES[0];
  const current = ALL_TRANSLATION_LOCALES.find((l) => l.id === currentLang);
  const rest = ALL_TRANSLATION_LOCALES.filter(
    (l) => l.id !== "en" && l.id !== currentLang,
  );
  return current && current.id !== "en"
    ? [en, current, ...rest]
    : [en, ...rest];
}

// ── Shared props ───────────────────────────────────────────────────

export type AISectionProps = {
  draft: SettingsDraft;
  settings?: SettingsInfo;
  imagePreviewEnabled: boolean;
  imagePreviewDelaySeconds: number;
  imagePreviewSize: { width: number; height: number };
  working: boolean;
  aiTagActivity: AITagActivityState;
  vlmOcrActivity: VLMOcrActivityState;
  workspaces: Workspace[];
  projects: ScopeProject[];
  activeWorkspaceId: string;
  settingActions: ReactNode;
  onUpdateDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void;
  onStartAITag: (
    presetId?: string,
    projectIds?: string[],
    scopeLabel?: string,
  ) => void;
  onStopAITag: () => void;
  onStartVLMOcr: (
    presetId?: string,
    projectIds?: string[],
    scopeLabel?: string,
  ) => void;
  onStopVLMOcr: () => void;
  embedActivity: EmbedActivityState;
  onStartEmbed: (
    projectIds?: string[],
    scopeLabel?: string,
    force?: boolean,
  ) => void;
  onStopEmbed: () => void;
  onNavigate?: (mode: Mode) => void;
};
