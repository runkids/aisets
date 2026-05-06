export const supportedLanguages = [
  { code: "en", label: "English" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "zh-CN", label: "简体中文" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
] as const;

const simplifiedChineseFirstRegions = new Set(["CN", "HK", "MO"]);
const simplifiedChineseCode = "zh-CN";

export function prefersSimplifiedChineseFirst(locale: string | undefined) {
  if (!locale) return false;

  try {
    const parsed = new Intl.Locale(locale);
    if (parsed.region) {
      return simplifiedChineseFirstRegions.has(parsed.region.toUpperCase());
    }
    return parsed.language.toLowerCase() === "zh" && parsed.script === "Hans";
  } catch {
    const normalized = locale.toUpperCase();
    return [...simplifiedChineseFirstRegions].some((region) =>
      normalized.includes(`-${region}`),
    );
  }
}

function primaryBrowserLocale() {
  if (typeof navigator === "undefined") return undefined;
  return navigator.languages?.[0] ?? navigator.language;
}

export function languageOptionsForLocale(locale = primaryBrowserLocale()) {
  if (!prefersSimplifiedChineseFirst(locale)) return supportedLanguages;

  const simplified = supportedLanguages.find(
    (language) => language.code === simplifiedChineseCode,
  );
  if (!simplified) return supportedLanguages;

  return [
    simplified,
    ...supportedLanguages.filter(
      (language) => language.code !== simplifiedChineseCode,
    ),
  ];
}
