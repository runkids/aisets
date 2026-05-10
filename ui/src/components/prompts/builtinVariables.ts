import type { PromptPresetType, PromptVariableType } from "../../types";

export type BuiltinVariableDef = {
  name: string;
  type: PromptVariableType;
  defaultValues: string[];
  required: boolean;
  descriptionKey: string;
  dynamic?: boolean;
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

export const OPTIMIZE_BUILTIN_VARIABLES: BuiltinVariableDef[] = [
  {
    name: "contentTypes",
    type: "tags",
    defaultValues: [
      "photo",
      "icon",
      "screenshot",
      "diagram",
      "illustration",
      "gradient",
      "pattern",
      "text-heavy",
    ],
    required: true,
    descriptionKey: "prompts.var.contentTypes",
  },
  {
    name: "formats",
    type: "tags",
    defaultValues: ["avif", "webp", "png", "svg", "jpeg"],
    required: true,
    descriptionKey: "prompts.var.formats",
  },
  {
    name: "rules",
    type: "text",
    defaultValues: [
      "- Icons with transparency: lossless WebP or AVIF, preserve alpha\n- Photos/banners: lossy WebP/AVIF, quality 70-85\n- Screenshots with text: lossless or quality 95+ to preserve sharpness\n- Diagrams with text: lossless compression, consider SVG if simple shapes\n- Decorative gradients: aggressive lossy, quality 60-70\n- Patterns: lossless PNG or WebP for tile accuracy",
    ],
    required: false,
    descriptionKey: "prompts.var.rules",
  },
  {
    name: "fileMetadata",
    type: "text",
    defaultValues: [],
    required: false,
    descriptionKey: "prompts.var.fileMetadata",
    dynamic: true,
  },
  {
    name: "lintFindings",
    type: "text",
    defaultValues: [],
    required: false,
    descriptionKey: "prompts.var.lintFindings",
    dynamic: true,
  },
  {
    name: "optimizationFindings",
    type: "text",
    defaultValues: [],
    required: false,
    descriptionKey: "prompts.var.optimizationFindings",
    dynamic: true,
  },
];

export const DUPLICATE_BUILTIN_VARIABLES: BuiltinVariableDef[] = [
  {
    name: "leftMetadata",
    type: "text",
    defaultValues: [],
    required: false,
    descriptionKey: "prompts.var.leftMetadata",
    dynamic: true,
  },
  {
    name: "rightMetadata",
    type: "text",
    defaultValues: [],
    required: false,
    descriptionKey: "prompts.var.rightMetadata",
    dynamic: true,
  },
  {
    name: "distance",
    type: "text",
    defaultValues: [],
    required: false,
    descriptionKey: "prompts.var.distance",
    dynamic: true,
  },
];

export function getBuiltinVariables(
  type: PromptPresetType,
): BuiltinVariableDef[] {
  if (type === "tag") return TAG_BUILTIN_VARIABLES;
  if (type === "ocr") return OCR_BUILTIN_VARIABLES;
  if (type === "optimize") return OPTIMIZE_BUILTIN_VARIABLES;
  if (type === "duplicate") return DUPLICATE_BUILTIN_VARIABLES;
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

export function isDynamicVariable(
  type: PromptPresetType,
  varName: string,
): boolean {
  return getBuiltinVariables(type).some((v) => v.name === varName && v.dynamic);
}
