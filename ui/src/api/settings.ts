import type {
  ExportData,
  Project,
  SettingsInfo,
  SettingsUpdate,
  UpdateAppResult,
  VersionCheck,
} from "@/types";
import { request } from "./client";

export function getSettings() {
  return request<{ settings: SettingsInfo }>("/api/settings");
}

export function updateSettings(data: SettingsUpdate) {
  return request<{ settings: SettingsInfo }>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function detectAgentCLIs() {
  return request<{ settings: SettingsInfo }>("/api/agent/detect", {
    method: "POST",
  });
}

export function getVersionCheck() {
  return request<VersionCheck>("/api/version");
}

export function updateApp() {
  return request<{ ok: boolean; update: UpdateAppResult }>("/api/update", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function restartApp(options?: { clearCache?: boolean }) {
  return request<{ ok: boolean; restarting: boolean }>("/api/restart", {
    method: "POST",
    body: JSON.stringify(options ?? {}),
  });
}

export function exportSettings() {
  return request<ExportData>("/api/settings/export");
}

export function importSettings(data: ExportData) {
  return request<{ projects: Project[] }>("/api/settings/import", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function resetDatabase() {
  return request<{ ok: boolean }>("/api/settings/reset-database", {
    method: "POST",
    body: JSON.stringify({ confirm: "RESET" }),
  });
}
