import {
  Code,
  Globe2,
  Grid3X3,
  Image,
  Monitor,
  Moon,
  Paintbrush,
  Sun,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ImageBackgroundMode } from "../../imageBackground";
import { languageOptionsForLocale } from "../../i18n/index";
import { Card, Select, Switch, Tabs } from "../ui";
import { useToast } from "../ToastProvider";
import { FieldRow } from "./index";
import { editorOptions } from "./constants";
import type { ThemePreference } from "./types";

type ThemeSectionProps = {
  theme: ThemePreference;
  imagePreviewEnabled: boolean;
  imageBackgroundMode: ImageBackgroundMode;
  preferredEditor?: string;
  translationLocales?: string[];
  onThemeChange: (theme: ThemePreference) => void;
  onImagePreviewEnabledChange: (enabled: boolean) => void;
  onImageBackgroundModeChange: (mode: ImageBackgroundMode) => void;
  onEditorChange: (editor: string) => void;
};

export function ThemeSection({
  theme,
  imagePreviewEnabled,
  imageBackgroundMode,
  preferredEditor,
  translationLocales,
  onThemeChange,
  onImagePreviewEnabledChange,
  onImageBackgroundModeChange,
  onEditorChange,
}: ThemeSectionProps) {
  const { i18n, t } = useTranslation();
  const toast = useToast();

  return (
    <div className="flex flex-col gap-4">
      <Card
        className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
        padding="none"
      >
        <div className="flex items-center gap-2.5 border-b border-g-line px-6 py-3 md:px-8">
          <Globe2 size={15} className="shrink-0 text-g-ink-3" />
          <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
            {t("settings.displayGroup")}
          </span>
        </div>
        <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
          <FieldRow label={t("settings.language")} icon={<Globe2 size={15} />}>
            <Select
              value={i18n.language}
              options={languageOptionsForLocale().map((lang) => ({
                value: lang.code,
                label: lang.label,
              }))}
              onChange={(value) => {
                i18n.changeLanguage(value);
                if (
                  translationLocales &&
                  translationLocales.length > 0 &&
                  value !== "en" &&
                  !translationLocales.includes(value)
                ) {
                  toast.info(t("settings.localeChangeAffectsTranslation"));
                }
              }}
              aria-label={t("settings.language")}
            />
          </FieldRow>
          <FieldRow label={t("settings.theme")} icon={<Paintbrush size={15} />}>
            <Tabs
              value={theme}
              items={[
                {
                  value: "light",
                  label: t("settings.light"),
                  icon: <Sun size={15} />,
                },
                {
                  value: "dark",
                  label: t("settings.dark"),
                  icon: <Moon size={15} />,
                },
                {
                  value: "system",
                  label: t("settings.system"),
                  icon: <Monitor size={15} />,
                },
              ]}
              onChange={onThemeChange}
              ariaLabel={t("settings.theme")}
              className="w-full min-w-[280px] max-w-full [&_[role=tab]]:min-w-0 [&_[role=tab]]:flex-1"
            />
          </FieldRow>
        </div>
      </Card>
      <Card
        className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
        padding="none"
      >
        <div className="flex items-center gap-2.5 border-b border-g-line px-6 py-3 md:px-8">
          <Image size={15} className="shrink-0 text-g-ink-3" />
          <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
            {t("settings.assetViewingGroup")}
          </span>
        </div>
        <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
          <FieldRow
            label={t("settings.imagePreview")}
            description={t("settings.imagePreviewHint")}
            icon={<Image size={15} />}
          >
            <Switch
              checked={imagePreviewEnabled}
              onCheckedChange={onImagePreviewEnabledChange}
              aria-label={t("settings.imagePreview")}
            />
          </FieldRow>
          <FieldRow
            label={t("settings.imageBackground")}
            description={t("settings.imageBackgroundHint")}
            icon={<Grid3X3 size={15} />}
          >
            <Tabs
              value={imageBackgroundMode}
              items={[
                {
                  value: "checker",
                  label: t("toolbar.checkerBg"),
                  icon: <Grid3X3 size={15} />,
                },
                {
                  value: "light",
                  label: t("toolbar.lightBg"),
                  icon: <Sun size={15} />,
                },
                {
                  value: "dark",
                  label: t("toolbar.darkBg"),
                  icon: <Moon size={15} />,
                },
              ]}
              onChange={onImageBackgroundModeChange}
              ariaLabel={t("settings.imageBackground")}
              className="w-full min-w-[280px] max-w-full [&_[role=tab]]:min-w-0 [&_[role=tab]]:flex-1"
            />
          </FieldRow>
          <FieldRow
            label={t("settings.preferredEditor")}
            description={t("settings.preferredEditorDesc")}
            icon={<Code size={15} />}
          >
            <Select
              value={preferredEditor ?? "vscode"}
              options={editorOptions}
              onChange={onEditorChange}
              aria-label={t("settings.preferredEditor")}
            />
          </FieldRow>
        </div>
      </Card>
    </div>
  );
}
