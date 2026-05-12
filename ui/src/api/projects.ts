import type {
  DirectoryListing,
  Project,
  ProjectScanIntent,
  ProjectScanIntentDetection,
  SettingsInfo,
} from "@/types";
import { request } from "./client";

export type AddProjectResult = {
  status: "added" | "existing" | "restored";
  project: Project;
};

export function addProject(
  path: string,
  scanIntent: ProjectScanIntent = "code",
) {
  return request<{ projects: Project[]; result?: AddProjectResult }>(
    "/api/projects/add",
    {
      method: "POST",
      body: JSON.stringify({ path, scanIntent }),
    },
  );
}

export function detectProjectScanIntent(path: string) {
  return request<{ detection: ProjectScanIntentDetection }>(
    "/api/projects/detect-scan-intent",
    {
      method: "POST",
      body: JSON.stringify({ path }),
    },
  );
}

export function removeProject(id: string) {
  return request<{ projects: Project[] }>("/api/projects/remove", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export function addWorkspace(name: string, iconImage = "") {
  return request<{ settings: SettingsInfo }>("/api/workspaces/add", {
    method: "POST",
    body: JSON.stringify({ name, iconImage }),
  });
}

export function switchWorkspace(id: string) {
  return request<{ settings: SettingsInfo }>("/api/workspaces/switch", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export function renameWorkspace(id: string, name: string, iconImage = "") {
  return request<{ settings: SettingsInfo }>("/api/workspaces/rename", {
    method: "POST",
    body: JSON.stringify({ id, name, iconImage }),
  });
}

export function removeWorkspace(id: string) {
  return request<{ settings: SettingsInfo }>("/api/workspaces/remove", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export function renameProject(
  id: string,
  name: string,
  iconImage = "",
  scanIntent: ProjectScanIntent = "code",
) {
  return request<{ projects: Project[] }>("/api/projects/rename", {
    method: "POST",
    body: JSON.stringify({ id, name, iconImage, scanIntent }),
  });
}

export function listDirectories(path: string) {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  const query = params.toString();
  return request<DirectoryListing>(
    `/api/fs/directories${query ? `?${query}` : ""}`,
  );
}
