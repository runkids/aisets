import { Check, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { Badge } from "@/components/ui";
import { fallbackOCRLanguages } from "./constants";
import { ocrLanguageLabel } from "./helpers";
import type { OCRLanguagePack } from "./types";

export function OCRLanguageSelect({
  value,
  packs,
  disabled,
  onChange,
}: {
  value: string[];
  packs: OCRLanguagePack[];
  disabled: boolean;
  onChange: (languages: string[]) => void;
}) {
  const { t } = useTranslation();
  const knownPacks =
    packs.length > 0
      ? packs
      : fallbackOCRLanguages.map((language) => ({
          language,
          installed: false,
          sizeBytes: 0,
        }));
  const knownLanguages = new Set(knownPacks.map((pack) => pack.language));
  const options = [
    ...knownPacks,
    ...value
      .filter((language) => !knownLanguages.has(language))
      .map((language) => ({ language, installed: false, sizeBytes: 0 })),
  ];
  const selected = new Set(value);
  const selectedLabels = value.map((language) => ocrLanguageLabel(language, t));
  const label =
    selectedLabels.length > 0
      ? selectedLabels.join(", ")
      : t("settings.ocrLanguagesPlaceholder");

  function toggleLanguage(language: string) {
    if (selected.has(language)) {
      if (value.length <= 1) return;
      onChange(value.filter((item) => item !== language));
      return;
    }
    onChange([...value, language]);
  }

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex h-g-btn-md w-full items-center gap-2 rounded-g-md border border-g-line bg-g-surface px-3 font-g text-g-ui font-[510] tracking-g-ui text-g-ink shadow-g-inset transition-[background,border-color,box-shadow] duration-[120ms] ease-g hover:bg-g-surface-2 focus-visible:outline-none focus-visible:shadow-g-focus disabled:cursor-not-allowed disabled:opacity-[0.38]"
          aria-label={t("settings.ocrLanguages")}
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
          {options.map((pack) => (
            <DropdownMenuPrimitive.CheckboxItem
              key={pack.language}
              checked={selected.has(pack.language)}
              onCheckedChange={() => toggleLanguage(pack.language)}
              onSelect={(event) => event.preventDefault()}
              className="group flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-g-md px-3 py-2 text-left font-g text-g-body leading-[1.4] font-[510] text-g-ink-2 outline-none transition-[background,color,box-shadow] duration-[120ms] ease-g focus-visible:shadow-g-focus data-[highlighted]:bg-g-surface-3 data-[highlighted]:text-g-ink data-[state=checked]:text-g-ink"
            >
              <span className="grid size-4 shrink-0 place-items-center rounded-g-sm border border-g-line bg-g-surface-2 text-g-active-text transition-[background,border-color,color] duration-[120ms] ease-g group-data-[state=checked]:border-g-active-bg group-data-[state=checked]:bg-g-active-bg group-data-[state=checked]:text-g-active-text">
                <DropdownMenuPrimitive.ItemIndicator>
                  <Check size={12} />
                </DropdownMenuPrimitive.ItemIndicator>
              </span>
              <span className="min-w-0 flex-1 truncate">
                {ocrLanguageLabel(pack.language, t)}
              </span>
              <Badge tone={pack.installed ? "green" : "line"}>
                {pack.installed
                  ? t("settings.installed")
                  : t("settings.notInstalled")}
              </Badge>
            </DropdownMenuPrimitive.CheckboxItem>
          ))}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
