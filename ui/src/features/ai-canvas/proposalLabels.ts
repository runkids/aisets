import type { TFunction } from "i18next";

export function proposalToolFallback(tool: string) {
  return tool.replaceAll("_", " ");
}

export function proposalToolLabel(t: TFunction, tool: string) {
  return String(
    t(`aiCanvas.proposalTool.${tool}`, {
      defaultValue: proposalToolFallback(tool),
    }),
  );
}
