import { Check, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";

export function AICategorySelect({
  value,
  options,
  orphaned,
  disabled,
  onChange,
}: {
  value: string[];
  options: string[];
  orphaned: string[];
  disabled: boolean;
  onChange: (category: string) => void;
}) {
  const { t } = useTranslation();
  const selected = new Set(value);

  const categoryLabel = (cat: string) => {
    const translated = t(`settings.aiCategory.${cat}`, { defaultValue: cat });
    return translated !== cat ? `${translated} (${cat})` : cat;
  };

  const selectedLabels = value.map(categoryLabel);
  const label =
    selectedLabels.length > 0
      ? selectedLabels.join(", ")
      : t("settings.aiCategoriesPlaceholder");

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex h-g-btn-md w-full items-center gap-2 rounded-g-md border border-g-line bg-g-surface px-3 font-g text-g-ui font-[510] tracking-g-ui text-g-ink shadow-g-inset transition-[background,border-color,box-shadow] duration-[120ms] ease-g hover:bg-g-surface-2 focus-visible:outline-none focus-visible:shadow-g-focus disabled:cursor-not-allowed disabled:opacity-[0.38]"
          aria-label={t("settings.strategyAICategory")}
        >
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronDown size={15} className="shrink-0" />
        </button>
      </DropdownMenuPrimitive.Trigger>

      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="end"
          sideOffset={6}
          className="z-[60] min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-auto rounded-g-md border border-g-line-strong bg-g-surface p-1.5 shadow-g-pop animate-[modalIn_120ms_var(--g-ease-out)]"
          style={{ maxHeight: 320 }}
        >
          {options.map((cat) => (
            <DropdownMenuPrimitive.CheckboxItem
              key={cat}
              checked={selected.has(cat)}
              onCheckedChange={() => onChange(cat)}
              onSelect={(event) => event.preventDefault()}
              className="group flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-g-md px-3 py-2 text-left font-g text-g-body leading-[1.4] font-[510] text-g-ink-2 outline-none transition-[background,color,box-shadow] duration-[120ms] ease-g focus-visible:shadow-g-focus data-[highlighted]:bg-g-surface-3 data-[highlighted]:text-g-ink data-[state=checked]:text-g-ink"
            >
              <span className="grid size-4 shrink-0 place-items-center rounded-g-sm border border-g-line bg-g-surface-2 text-g-active-text transition-[background,border-color,color] duration-[120ms] ease-g group-data-[state=checked]:border-g-active-bg group-data-[state=checked]:bg-g-active-bg group-data-[state=checked]:text-g-active-text">
                <DropdownMenuPrimitive.ItemIndicator>
                  <Check size={12} />
                </DropdownMenuPrimitive.ItemIndicator>
              </span>
              <span className="min-w-0 flex-1 truncate">
                {categoryLabel(cat)}
              </span>
            </DropdownMenuPrimitive.CheckboxItem>
          ))}
          {orphaned.map((cat) => (
            <DropdownMenuPrimitive.CheckboxItem
              key={cat}
              checked
              onCheckedChange={() => onChange(cat)}
              onSelect={(event) => event.preventDefault()}
              className="group flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-g-md px-3 py-2 text-left font-g text-g-body leading-[1.4] font-[510] text-g-ink-4 line-through outline-none transition-[background,color,box-shadow] duration-[120ms] ease-g focus-visible:shadow-g-focus data-[highlighted]:bg-g-surface-3 data-[highlighted]:text-g-ink data-[state=checked]:text-g-ink-3"
            >
              <span className="grid size-4 shrink-0 place-items-center rounded-g-sm border border-g-line bg-g-surface-2 text-g-active-text transition-[background,border-color,color] duration-[120ms] ease-g group-data-[state=checked]:border-g-active-bg group-data-[state=checked]:bg-g-active-bg group-data-[state=checked]:text-g-active-text">
                <DropdownMenuPrimitive.ItemIndicator>
                  <Check size={12} />
                </DropdownMenuPrimitive.ItemIndicator>
              </span>
              <span className="min-w-0 flex-1 truncate">{cat}</span>
            </DropdownMenuPrimitive.CheckboxItem>
          ))}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
