import type { PromptPresetType, PromptVariableType } from "../../types";

export type BuiltinVariableDef = {
  name: string;
  type: PromptVariableType;
  defaultValues: string[];
  required: boolean;
  descriptionKey: string;
};

export const TAG_BUILTIN_VARIABLES: BuiltinVariableDef[] = [
  {
    name: "categories",
    type: "tags",
    defaultValues: [
      "icon",
      "photo",
      "screenshot",
      "diagram",
      "illustration",
      "pattern",
      "logo",
      "banner",
      "texture",
      "sprite",
      "mockup",
      "artwork",
    ],
    required: true,
    descriptionKey: "prompts.var.categories",
  },
  {
    name: "tags",
    type: "text",
    defaultValues: [
      'array of 3-8 descriptive tags in lowercase kebab-case (e.g. "dark-mode", "mobile", "login-form", "hero-section")',
    ],
    required: true,
    descriptionKey: "prompts.var.tags",
  },
  {
    name: "description",
    type: "text",
    defaultValues: ["one sentence describing the image content"],
    required: false,
    descriptionKey: "prompts.var.description",
  },
  {
    name: "languages",
    type: "text",
    defaultValues: [
      'array of ISO 639-3 language codes for any visible text (e.g. ["eng"]). Empty array if no text.',
    ],
    required: false,
    descriptionKey: "prompts.var.languages",
  },
];

export const OCR_BUILTIN_VARIABLES: BuiltinVariableDef[] = [
  {
    name: "text",
    type: "text",
    defaultValues: [
      "all visible text exactly as it appears, preserving original layout, line breaks, indentation and formatting. If the image contains code, preserve indentation exactly. Empty string if no text is visible.",
    ],
    required: true,
    descriptionKey: "prompts.var.text",
  },
  {
    name: "languages",
    type: "text",
    defaultValues: [
      'array of ISO 639-3 language codes detected in the text (e.g. ["eng"], ["zho", "eng"]). Empty array if no text.',
    ],
    required: false,
    descriptionKey: "prompts.var.languages",
  },
];

export function getBuiltinVariables(
  type: PromptPresetType,
): BuiltinVariableDef[] {
  if (type === "tag") return TAG_BUILTIN_VARIABLES;
  if (type === "ocr") return OCR_BUILTIN_VARIABLES;
  return [];
}

export function getRequiredVariables(
  type: PromptPresetType,
): BuiltinVariableDef[] {
  return getBuiltinVariables(type).filter((v) => v.required);
}

export function getMissingRequired(
  type: PromptPresetType,
  template: string,
): BuiltinVariableDef[] {
  const required = getRequiredVariables(type);
  return required.filter((v) => !template.includes(`{{${v.name}}}`));
}

export function getDefaultValue(
  type: PromptPresetType,
  varName: string,
): { type: PromptVariableType; values: string[] } | null {
  const builtins = getBuiltinVariables(type);
  const found = builtins.find((v) => v.name === varName);
  if (!found) return null;
  return { type: found.type, values: [...found.defaultValues] };
}

export function isBuiltinVariable(
  type: PromptPresetType,
  varName: string,
): boolean {
  return getBuiltinVariables(type).some((v) => v.name === varName);
}
