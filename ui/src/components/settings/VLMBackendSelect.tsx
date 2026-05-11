import { Check, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { Badge } from "../ui";
import type { AgentRuntime, LLMRuntime } from "../../types";

type VLMBackendOption = {
  value: string;
  label: string;
  available: boolean;
};

export function VLMBackendSelect({
  value,
  agentRuntime,
  llmRuntime,
  showInherit,
  inheritLabel,
  disabled,
  onChange,
}: {
  value: string;
  agentRuntime?: AgentRuntime;
  llmRuntime?: LLMRuntime;
  showInherit?: boolean;
  inheritLabel?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();

  const options: VLMBackendOption[] = [];

  if (showInherit) {
    options.push({
      value: "",
      label: inheritLabel || t("settings.vlmBackendInherit"),
      available: true,
    });
  }

  options.push({
    value: "local-llm",
    label: `${t("settings.vlmBackendLocal")}${llmRuntime?.visionModel ? ` (${llmRuntime.visionModel})` : ""}`,
    available: !!llmRuntime?.connected,
  });

  for (const adapter of agentRuntime?.adapters ?? []) {
    options.push({
      value: `agent:${adapter.id}`,
      label: adapter.name,
      available: true,
    });
  }

  const selected = options.find((o) => o.value === value);
  const displayLabel = selected?.label || options[0]?.label || "—";

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex h-g-btn-md w-[240px] items-center gap-2 rounded-g-md border border-g-line bg-g-surface px-3 font-g text-g-ui font-[510] tracking-g-ui text-g-ink-2 shadow-g-inset transition-[background,border-color,box-shadow] duration-[120ms] ease-g hover:bg-g-surface-2 focus-visible:outline-none focus-visible:shadow-g-focus disabled:cursor-not-allowed disabled:opacity-[0.38]"
        >
          <span className="min-w-0 truncate text-left">{displayLabel}</span>
          <ChevronDown size={14} className="shrink-0 text-g-ink-3" />
        </button>
      </DropdownMenuPrimitive.Trigger>

      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="end"
          sideOffset={6}
          className="z-[60] min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-auto rounded-g-md border border-g-line-strong bg-g-surface p-1.5 shadow-g-pop animate-[modalIn_120ms_var(--g-ease-out)]"
          style={{ maxHeight: 320 }}
        >
          {options.map((opt) => (
            <DropdownMenuPrimitive.Item
              key={opt.value}
              onSelect={() => onChange(opt.value)}
              className="group flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-g-md px-3 py-2 text-left font-g text-g-body leading-[1.4] font-[510] text-g-ink-2 outline-none transition-[background,color,box-shadow] duration-[120ms] ease-g focus-visible:shadow-g-focus data-[highlighted]:bg-g-surface-3 data-[highlighted]:text-g-ink"
            >
              <span className="grid size-4 shrink-0 place-items-center">
                {opt.value === value && (
                  <Check size={14} className="text-g-active-text" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate">{opt.label}</span>
              {opt.value !== "" && (
                <Badge tone={opt.available ? "green" : "line"}>
                  {opt.available
                    ? t("settings.vlmBackendAvailable")
                    : t("settings.vlmBackendUnavailable")}
                </Badge>
              )}
            </DropdownMenuPrimitive.Item>
          ))}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
