import i18n from "i18next";

export type Mode =
  | "projects"
  | "history"
  | "browse"
  | "tags"
  | "duplicates"
  | "unused"
  | "optimize"
  | "lint"
  | "imageTools"
  | "aiCanvas"
  | "precheck"
  | "prompts"
  | "settings";

export const modes: Mode[] = [
  "projects",
  "history",
  "browse",
  "tags",
  "duplicates",
  "unused",
  "optimize",
  "lint",
  "imageTools",
  "aiCanvas",
  "precheck",
  "prompts",
  "settings",
];

export function pathForMode(mode: Mode) {
  if (mode === "imageTools") return "/image-tools";
  if (mode === "aiCanvas") return "/canvas";
  if (mode === "tags") return "/tags-categories";
  return `/${mode}`;
}

export function modeForPath(pathname: string): Mode {
  const segment = pathname.replace(/^\/+|\/+$/g, "").split("/")[0];
  if (segment === "image-tools") return "imageTools";
  if (segment === "canvas") return "aiCanvas";
  if (segment === "tags-categories") return "tags";
  return modes.includes(segment as Mode) ? (segment as Mode) : "projects";
}

export function titleForMode(mode: Mode) {
  return i18n.t(`mode.${mode}`);
}

export function descriptionForMode(mode: Mode) {
  return i18n.t(`mode.${mode}Desc`);
}
