export type PromptPresetType =
  | "system"
  | "tag"
  | "ocr"
  | "optimize"
  | "duplicate"
  | "precheck"
  | "canvas";
export type PromptVariableType = "tags" | "text" | "select";

export type PromptVariable = {
  type: PromptVariableType;
  values: string[];
};

export type PromptPresetContent = {
  template: string;
  variables: Record<string, PromptVariable>;
};

export type PromptPreset = {
  id: string;
  type: PromptPresetType;
  name: string;
  content: PromptPresetContent;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};
