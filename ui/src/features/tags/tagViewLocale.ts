const TAG_LOCALE_OPTIONS = [
  { value: "en", label: "EN" },
  { value: "zh-TW", label: "繁中" },
  { value: "zh-CN", label: "简中" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
];

const TAG_LOCALE_LABELS = new Map(
  TAG_LOCALE_OPTIONS.map((option) => [option.value, option.label]),
);

export function normalizeDisplayLocale(locale: string | undefined) {
  if (!locale) return "en";
  if (locale === "en" || locale.startsWith("en-")) return "en";
  return TAG_LOCALE_LABELS.has(locale) ? locale : "en";
}

export function tagViewLocaleOptions(translationLocales?: string[]) {
  const seen = new Set<string>();
  const locales =
    translationLocales && translationLocales.length > 0
      ? translationLocales
      : ["en"];
  return locales
    .map(normalizeDisplayLocale)
    .filter((locale) => {
      if (seen.has(locale)) return false;
      seen.add(locale);
      return TAG_LOCALE_LABELS.has(locale);
    })
    .map((locale) => ({
      value: locale,
      label: TAG_LOCALE_LABELS.get(locale) ?? locale,
    }));
}

export function defaultTagViewLocale(
  appLocale: string | undefined,
  translationLocales?: string[],
) {
  const normalizedAppLocale = normalizeDisplayLocale(appLocale);
  const options = tagViewLocaleOptions(translationLocales);
  if (
    normalizedAppLocale !== "en" &&
    options.some((option) => option.value === normalizedAppLocale)
  ) {
    return normalizedAppLocale;
  }
  return "en";
}
