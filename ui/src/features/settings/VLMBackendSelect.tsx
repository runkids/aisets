import { useState } from "react";
import { Check, ChevronDown, Cpu, Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { Badge, TextInput } from "@/components/ui";
import type { AgentRuntime, LLMModel, LLMRuntime } from "@/types";

type ParsedBackend =
  | { type: "inherit" }
  | { type: "local"; model: string }
  | { type: "agent"; adapterId: string; model: string };

function parseBackendValue(value: string): ParsedBackend {
  if (!value) return { type: "inherit" };
  if (value.startsWith("agent:")) {
    const rest = value.slice(6);
    const idx = rest.indexOf("/");
    if (idx >= 0) {
      return {
        type: "agent",
        adapterId: rest.slice(0, idx),
        model: rest.slice(idx + 1),
      };
    }
    return { type: "agent", adapterId: rest, model: "" };
  }
  if (value.startsWith("local-llm/")) {
    return { type: "local", model: value.slice(10) };
  }
  if (value === "local-llm") {
    return { type: "local", model: "" };
  }
  return { type: "inherit" };
}

function formatBackendValue(parsed: ParsedBackend): string {
  switch (parsed.type) {
    case "inherit":
      return "";
    case "local":
      return parsed.model ? `local-llm/${parsed.model}` : "local-llm";
    case "agent":
      return parsed.model
        ? `agent:${parsed.adapterId}/${parsed.model}`
        : `agent:${parsed.adapterId}`;
  }
}

export function VLMBackendSelect({
  value,
  agentRuntime,
  llmRuntime,
  models,
  showInherit,
  inheritLabel,
  disabled,
  onChange,
}: {
  value: string;
  agentRuntime?: AgentRuntime;
  llmRuntime?: LLMRuntime;
  models?: LLMModel[];
  showInherit?: boolean;
  inheritLabel?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const parsed = parseBackendValue(value);
  const isAgent = parsed.type === "agent";

  const agentModelFromValue = isAgent ? parsed.model : "";
  const [agentModel, setAgentModel] = useState(agentModelFromValue);

  if (agentModel !== agentModelFromValue && isAgent) {
    setAgentModel(agentModelFromValue);
  }

  const adapters =
    agentRuntime?.adapters?.filter((a) => a.id !== "local-llm") ?? [];
  const localModels = models ?? [];
  const isConnected = !!llmRuntime?.connected;

  function displayLabel(): string {
    switch (parsed.type) {
      case "inherit":
        return inheritLabel || t("settings.vlmBackendInherit");
      case "local":
        if (parsed.model) return parsed.model;
        return `${t("settings.vlmBackendLocalDefault")}${llmRuntime?.visionModel ? ` (${llmRuntime.visionModel})` : ""}`;
      case "agent": {
        const adapter = adapters.find((a) => a.id === parsed.adapterId);
        const name = adapter?.name ?? parsed.adapterId;
        return parsed.model ? `${name} · ${parsed.model}` : name;
      }
    }
  }

  function handleAgentModelCommit() {
    if (parsed.type !== "agent") return;
    const trimmed = agentModel.trim();
    const next = formatBackendValue({
      type: "agent",
      adapterId: parsed.adapterId,
      model: trimmed,
    });
    if (next !== value) {
      onChange(next);
    }
  }

  return (
    <div
      className={
        isAgent
          ? "grid w-full max-w-[466px] grid-cols-[minmax(0,1fr)_180px] items-center gap-1.5"
          : "w-full max-w-[466px]"
      }
    >
      <DropdownMenuPrimitive.Root>
        <DropdownMenuPrimitive.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="inline-flex h-g-btn-md w-full items-center gap-2 rounded-g-md border border-g-line bg-g-surface px-3 font-g text-g-ui font-[510] tracking-g-ui text-g-ink-2 shadow-g-inset transition-[background,border-color,box-shadow] duration-[120ms] ease-g hover:bg-g-surface-2 focus-visible:outline-none focus-visible:shadow-g-focus disabled:cursor-not-allowed disabled:opacity-[0.38]"
          >
            <span className="min-w-0 flex-1 truncate text-left">
              {displayLabel()}
            </span>
            <ChevronDown size={14} className="shrink-0 text-g-ink-3" />
          </button>
        </DropdownMenuPrimitive.Trigger>

        <DropdownMenuPrimitive.Portal>
          <DropdownMenuPrimitive.Content
            align="end"
            sideOffset={6}
            className="z-[60] min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-auto rounded-g-md border border-g-line-strong bg-g-surface p-1.5 shadow-g-pop animate-[modalIn_120ms_var(--g-ease-out)]"
            style={{ maxHeight: 360 }}
          >
            {showInherit && (
              <DropdownMenuPrimitive.Item
                onSelect={() => onChange("")}
                className="group flex min-h-9 w-full cursor-pointer items-center gap-1.5 rounded-g-md px-2 py-2 text-left font-g text-g-body leading-[1.4] font-[510] text-g-ink-2 outline-none transition-[background,color,box-shadow] duration-[120ms] ease-g focus-visible:shadow-g-focus data-[highlighted]:bg-g-surface-3 data-[highlighted]:text-g-ink"
              >
                <span className="grid size-3.5 shrink-0 place-items-center">
                  {parsed.type === "inherit" && (
                    <Check size={14} className="text-g-active-text" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {inheritLabel || t("settings.vlmBackendInherit")}
                </span>
              </DropdownMenuPrimitive.Item>
            )}

            {/* Local LLM models group */}
            {(localModels.length > 0 || isConnected) && (
              <DropdownMenuPrimitive.Group>
                {showInherit && (
                  <DropdownMenuPrimitive.Separator className="my-1.5 h-px bg-g-line" />
                )}
                <DropdownMenuPrimitive.Label className="flex items-center gap-1.5 px-2 py-1.5 font-g text-[11px] font-[590] uppercase tracking-[0.08em] text-g-ink-4">
                  <Cpu size={12} />
                  {t("settings.vlmBackendLocal")}
                </DropdownMenuPrimitive.Label>
                {/* "Use LLM tab default" option — global row only */}
                {!showInherit && (
                  <DropdownMenuPrimitive.Item
                    onSelect={() => onChange("local-llm")}
                    className="group flex min-h-9 w-full cursor-pointer items-center gap-1.5 rounded-g-md px-2 py-2 text-left font-g text-g-body leading-[1.4] font-[510] text-g-ink-2 outline-none transition-[background,color,box-shadow] duration-[120ms] ease-g focus-visible:shadow-g-focus data-[highlighted]:bg-g-surface-3 data-[highlighted]:text-g-ink"
                  >
                    <span className="grid size-3.5 shrink-0 place-items-center">
                      {value === "local-llm" && (
                        <Check size={14} className="text-g-active-text" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {t("settings.vlmBackendLocalDefault")}
                      {llmRuntime?.visionModel
                        ? ` (${llmRuntime.visionModel})`
                        : ""}
                    </span>
                    <Badge tone={isConnected ? "green" : "line"}>
                      {isConnected
                        ? t("settings.vlmBackendAvailable")
                        : t("settings.vlmBackendUnavailable")}
                    </Badge>
                  </DropdownMenuPrimitive.Item>
                )}
                {localModels.length > 0 ? (
                  localModels.map((m) => {
                    const itemValue = `local-llm/${m.name}`;
                    const isSelected = value === itemValue;
                    return (
                      <DropdownMenuPrimitive.Item
                        key={m.name}
                        onSelect={() => onChange(itemValue)}
                        className="group flex min-h-9 w-full cursor-pointer items-center gap-1.5 rounded-g-md px-2 py-2 text-left font-g text-g-body leading-[1.4] font-[510] text-g-ink-2 outline-none transition-[background,color,box-shadow] duration-[120ms] ease-g focus-visible:shadow-g-focus data-[highlighted]:bg-g-surface-3 data-[highlighted]:text-g-ink"
                      >
                        <span className="grid size-3.5 shrink-0 place-items-center">
                          {isSelected && (
                            <Check size={14} className="text-g-active-text" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {m.name}
                        </span>
                        <Badge tone={isConnected ? "green" : "line"}>
                          {isConnected
                            ? t("settings.vlmBackendAvailable")
                            : t("settings.vlmBackendUnavailable")}
                        </Badge>
                      </DropdownMenuPrimitive.Item>
                    );
                  })
                ) : (
                  <div className="px-2 py-2 font-g text-[11px] text-g-ink-4">
                    {t("settings.vlmBackendNoModels")}
                  </div>
                )}
              </DropdownMenuPrimitive.Group>
            )}

            {/* Agent CLI group */}
            {adapters.length > 0 && (
              <DropdownMenuPrimitive.Group>
                <DropdownMenuPrimitive.Separator className="my-1.5 h-px bg-g-line" />
                <DropdownMenuPrimitive.Label className="flex items-center gap-1.5 px-2 py-1.5 font-g text-[11px] font-[590] uppercase tracking-[0.08em] text-g-ink-4">
                  <Bot size={12} />
                  {t("settings.vlmBackendAgentGroup")}
                </DropdownMenuPrimitive.Label>
                {adapters.map((a) => {
                  const isSelected =
                    parsed.type === "agent" && parsed.adapterId === a.id;
                  return (
                    <DropdownMenuPrimitive.Item
                      key={a.id}
                      onSelect={() => onChange(`agent:${a.id}`)}
                      className="group flex min-h-9 w-full cursor-pointer items-center gap-1.5 rounded-g-md px-2 py-2 text-left font-g text-g-body leading-[1.4] font-[510] text-g-ink-2 outline-none transition-[background,color,box-shadow] duration-[120ms] ease-g focus-visible:shadow-g-focus data-[highlighted]:bg-g-surface-3 data-[highlighted]:text-g-ink"
                    >
                      <span className="grid size-3.5 shrink-0 place-items-center">
                        {isSelected && (
                          <Check size={14} className="text-g-active-text" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {a.name}
                        {a.version ? ` ${a.version}` : ""}
                      </span>
                      <Badge tone="green">
                        {t("settings.vlmBackendAvailable")}
                      </Badge>
                    </DropdownMenuPrimitive.Item>
                  );
                })}
              </DropdownMenuPrimitive.Group>
            )}
          </DropdownMenuPrimitive.Content>
        </DropdownMenuPrimitive.Portal>
      </DropdownMenuPrimitive.Root>

      {isAgent && (
        <TextInput
          value={agentModel}
          onChange={(e) => setAgentModel(e.target.value)}
          onBlur={handleAgentModelCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAgentModelCommit();
          }}
          placeholder={t("settings.vlmBackendAgentModelPlaceholder")}
          disabled={disabled}
          aria-label={t("settings.vlmBackendAgentModelPlaceholder")}
          className="w-full"
        />
      )}
    </div>
  );
}
