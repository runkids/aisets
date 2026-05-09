import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { APIError } from "../api";
import en from "./locales/en.json";
import zhTW from "./locales/zh-TW.json";
import zhCN from "./locales/zh-CN.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";
export {
  languageOptionsForLocale,
  supportedLanguages,
} from "./languageOptions";

const supportedLngs = ["en", "zh-TW", "zh-CN", "ja", "ko"];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      "zh-TW": { translation: zhTW },
      "zh-CN": { translation: zhCN },
      ja: { translation: ja },
      ko: { translation: ko },
    },
    supportedLngs,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "aisets-lang",
    },
  });

export function errorMessage(error: unknown) {
  if (error instanceof APIError) {
    const key = `error.${error.code}`;
    const params = error.params as Record<string, unknown> | undefined;
    if (i18n.exists(key)) return i18n.t(key, params ?? {});
    return error.message ?? error.code;
  }
  return error instanceof Error ? error.message : i18n.t("error.unknown");
}

export default i18n;
