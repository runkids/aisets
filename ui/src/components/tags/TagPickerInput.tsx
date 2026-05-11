import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { useTagSuggestQuery } from "../../tagsQueries";
import { useDebouncedValue } from "../../useDebouncedValue";
import { TextInput } from "../ui";

type Props = {
  existingTags: string[];
  onAdd: (tag: string) => void;
  autoFocus?: boolean;
  className?: string;
};

export function TagPickerInput({
  existingTags,
  onAdd,
  autoFocus,
  className,
}: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedValue = useDebouncedValue(value, 150);
  const { data } = useTagSuggestQuery(
    debouncedValue,
    debouncedValue.length > 0,
  );

  const existingSet = useMemo(
    () => new Set(existingTags.map((t) => t.toLowerCase())),
    [existingTags],
  );

  const suggestions = (data?.suggestions ?? []).filter(
    (s) => !existingSet.has(s.toLowerCase()),
  );

  const trimmed = value.trim().toLowerCase();
  const isNewTag =
    trimmed.length > 0 &&
    !suggestions.some((s) => s.toLowerCase() === trimmed) &&
    !existingSet.has(trimmed);

  const options = [
    ...suggestions,
    ...(isNewTag ? [`__create__${value.trim()}`] : []),
  ];

  const addTag = useCallback(
    (tag: string) => {
      const clean = tag.startsWith("__create__") ? tag.slice(10) : tag;
      setValue("");
      setShowSuggestions(false);
      setHighlightIndex(-1);
      if (clean && !existingSet.has(clean.toLowerCase())) {
        onAdd(clean);
      }
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [existingSet, onAdd],
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightIndex >= 0 && highlightIndex < options.length) {
        addTag(options[highlightIndex]);
      } else if (value.trim()) {
        addTag(value.trim());
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  }

  useEffect(() => {
    if (!showSuggestions) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={wrapperRef} className={`relative ${className ?? ""}`}>
      <TextInput
        ref={inputRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setShowSuggestions(true);
          setHighlightIndex(-1);
        }}
        onFocus={() => value.trim() && setShowSuggestions(true)}
        onKeyDown={handleKeyDown}
        placeholder={t("tags.addTag")}
        className="h-g-btn-md w-full"
        autoFocus={autoFocus}
      />

      {showSuggestions && options.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-[200px] overflow-y-auto rounded-g-md border border-g-line bg-g-surface shadow-g-popover">
          {options.map((opt, i) => {
            const isCreate = opt.startsWith("__create__");
            const label = isCreate ? opt.slice(10) : opt;

            return (
              <button
                key={opt}
                type="button"
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-g-ui transition-colors cursor-pointer ${
                  i === highlightIndex
                    ? "bg-g-active-bg text-g-active-text"
                    : "text-g-ink hover:bg-g-surface-2"
                }`}
                onMouseEnter={() => setHighlightIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  addTag(opt);
                }}
              >
                {isCreate && (
                  <Plus size={12} className="shrink-0 text-g-ink-3" />
                )}
                <span className={isCreate ? "text-g-ink-2 font-[510]" : ""}>
                  {isCreate ? t("tags.createNew", { tag: label }) : label}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {showSuggestions && options.length === 0 && value.trim().length === 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-g-md border border-g-line bg-g-surface shadow-g-popover px-3 py-2.5">
          <span className="text-g-caption text-g-ink-4">
            {t("tags.suggestEmpty")}
          </span>
        </div>
      )}
    </div>
  );
}
