import {
  ArrowLeftRight,
  CheckSquare,
  Keyboard,
  MessageCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, Keycap } from "@/components/ui";
import { FieldRow } from "./FieldRow";

export function HotkeysSection() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4">
      <Card
        className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
        padding="none"
      >
        <div className="flex items-center gap-2.5 border-b border-g-line px-6 py-3 md:px-8">
          <Keyboard size={15} className="shrink-0 text-g-ink-3" />
          <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
            {t("settings.hotkeyGeneral")}
          </span>
        </div>
        <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
          <FieldRow label={t("settings.hotkeyPalette")}>
            <Keycap>⌘ P</Keycap>
          </FieldRow>
          <FieldRow label={t("settings.hotkeyClose")}>
            <Keycap>Esc</Keycap>
          </FieldRow>
        </div>
      </Card>
      <Card
        className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
        padding="none"
      >
        <div className="flex items-center gap-2.5 border-b border-g-line px-6 py-3 md:px-8">
          <MessageCircle size={15} className="shrink-0 text-g-ink-3" />
          <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
            {t("settings.hotkeyCanvas")}
          </span>
        </div>
        <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
          <FieldRow label={t("settings.hotkeyCanvasComment")}>
            <Keycap>Shift C</Keycap>
          </FieldRow>
          <FieldRow label={t("settings.hotkeyCanvasMention")}>
            <Keycap>Shift @</Keycap>
          </FieldRow>
        </div>
      </Card>
      <Card
        className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
        padding="none"
      >
        <div className="flex items-center gap-2.5 border-b border-g-line px-6 py-3 md:px-8">
          <ArrowLeftRight size={15} className="shrink-0 text-g-ink-3" />
          <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
            {t("settings.hotkeyNavigation")}
          </span>
        </div>
        <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
          <FieldRow label={t("settings.hotkeyPrevAsset")}>
            <Keycap>←</Keycap>
          </FieldRow>
          <FieldRow label={t("settings.hotkeyNextAsset")}>
            <Keycap>→</Keycap>
          </FieldRow>
        </div>
      </Card>
      <Card
        className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
        padding="none"
      >
        <div className="flex items-center gap-2.5 border-b border-g-line px-6 py-3 md:px-8">
          <CheckSquare size={15} className="shrink-0 text-g-ink-3" />
          <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
            {t("settings.hotkeyBulkSelect")}
          </span>
        </div>
        <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
          <FieldRow label={t("settings.hotkeyBulkClick1")}>
            <Keycap>Ctrl Q</Keycap>
          </FieldRow>
          <FieldRow label={t("settings.hotkeyBulkClick2")}>
            <Keycap>Ctrl Q</Keycap>
          </FieldRow>
          <FieldRow label={t("settings.hotkeyBulkClick3")}>
            <Keycap>Ctrl Q</Keycap>
          </FieldRow>
          <FieldRow label={t("settings.hotkeyBulkEsc")}>
            <Keycap>Esc</Keycap>
          </FieldRow>
        </div>
      </Card>
    </div>
  );
}
