import { Star, X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type {
  PromptPresetType,
  PromptVariable,
  PromptVariableType,
} from "../../types";
import { Select } from "../ui/Select";
import { Textarea, TextInput } from "../ui/TextInput";
import { isBuiltinVariable, getBuiltinVariables } from "./builtinVariables";

type Props = {
  variables: Record<string, PromptVariable>;
  onChange: (variables: Record<string, PromptVariable>) => void;
  presetType: PromptPresetType;
};

export function VariablesPanel({ variables, onChange, presetType }: Props) {
  const { t } = useTranslation();
  const entries = Object.entries(variables);

  if (entries.length === 0) return null;

  const builtins = getBuiltinVariables(presetType);

  function updateVariable(name: string, updated: PromptVariable) {
    onChange({ ...variables, [name]: updated });
  }

  function updateType(name: string, type: PromptVariableType) {
    updateVariable(name, { ...variables[name], type });
  }

  return (
    <div className="flex flex-col gap-2.5">
      {entries.map(([name, variable]) => {
        const isBuiltin = isBuiltinVariable(presetType, name);
        const builtinDef = builtins.find((b) => b.name === name);
        return (
          <div
            key={name}
            className="flex flex-col gap-1.5 rounded-g-md border border-g-line bg-g-surface-2 p-2.5"
          >
            <div className="flex items-center gap-2">
              <span className="flex min-w-0 flex-1 items-center gap-1.5 font-g-mono text-[12px] text-g-ink">
                <span className="truncate">{`{{${name}}}`}</span>
                {isBuiltin && (
                  <span className="shrink-0 rounded-g-sm bg-g-accent/10 px-1.5 py-0.5 font-sans text-[10px] font-medium text-g-accent">
                    {t("prompts.builtinBadge")}
                  </span>
                )}
                {builtinDef?.required && (
                  <Star
                    size={10}
                    className="shrink-0 fill-current text-g-amber"
                  />
                )}
              </span>
              <div className="w-[160px] shrink-0">
                <Select
                  size="sm"
                  value={variable.type}
                  options={[
                    { value: "tags", label: t("prompts.typeTags") },
                    { value: "text", label: t("prompts.typeText") },
                    { value: "select", label: t("prompts.typeSelect") },
                  ]}
                  onChange={(v) => updateType(name, v as PromptVariableType)}
                  aria-label={t("prompts.variableType")}
                />
              </div>
            </div>
            <VariableValueInput
              variable={variable}
              onChange={(updated) => updateVariable(name, updated)}
            />
          </div>
        );
      })}
    </div>
  );
}

function VariableValueInput({
  variable,
  onChange,
}: {
  variable: PromptVariable;
  onChange: (v: PromptVariable) => void;
}) {
  const { t } = useTranslation();

  if (variable.type === "tags") {
    return (
      <TagsInput
        values={variable.values}
        onChange={(values) => onChange({ ...variable, values })}
      />
    );
  }

  if (variable.type === "text") {
    const val = variable.values[0] ?? "";
    const isMultiline = val.includes("\n");
    if (isMultiline) {
      return (
        <Textarea
          rows={4}
          placeholder={t("prompts.variableValues")}
          value={val}
          onChange={(e) => onChange({ ...variable, values: [e.target.value] })}
          className="text-[12px]"
        />
      );
    }
    return (
      <TextInput
        size="sm"
        placeholder={t("prompts.variableValues")}
        value={val}
        onChange={(e) => onChange({ ...variable, values: [e.target.value] })}
      />
    );
  }

  // select type: comma-separated options
  return (
    <TextInput
      size="sm"
      placeholder={t("prompts.variableValues")}
      value={variable.values.join(", ")}
      onChange={(e) =>
        onChange({
          ...variable,
          values: e.target.value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        })
      }
    />
  );
}

function TagsInput({
  values,
  onChange,
}: {
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [input, setInput] = useState("");

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && input.trim()) {
      e.preventDefault();
      if (!values.includes(input.trim())) {
        onChange([...values, input.trim()]);
      }
      setInput("");
    } else if (e.key === "Backspace" && !input && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  function removeTag(index: number) {
    onChange(values.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-g-md border border-g-input-border bg-g-surface px-2 py-1.5 transition-[border-color,box-shadow] duration-[120ms] ease-g hover:border-g-input-hover focus-within:border-g-input-focus focus-within:shadow-g-input-focus">
      {values.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
          className="inline-flex items-center gap-0.5 rounded-g-sm bg-g-surface-2 px-1.5 py-0.5 text-[11px] text-g-ink"
        >
          {tag}
          <button
            type="button"
            className="ml-0.5 text-g-ink-4 hover:text-g-ink"
            onClick={() => removeTag(i)}
            aria-label={`Remove ${tag}`}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        type="text"
        className="min-w-[60px] flex-1 border-none bg-transparent py-0.5 text-[12px] text-g-ink outline-none placeholder:text-g-ink-4"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={values.length === 0 ? "Type + Enter" : ""}
      />
    </div>
  );
}
