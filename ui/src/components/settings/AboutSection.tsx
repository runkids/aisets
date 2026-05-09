import {
  Download,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SettingsInfo, VersionCheck } from "../../types";
import { Badge, Button, Card, ConfirmDialog, Notice } from "../ui";
import { SectionHeading, sectionIcon } from "./index";
import type { BeforeInstallPromptEvent } from "./types";

function isStandaloneApp() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    ("standalone" in navigator &&
      (navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}

type AboutSectionProps = {
  settings: SettingsInfo | undefined;
  version: VersionCheck | undefined;
  working: boolean;
  onExport: () => void;
  onImport: (file: File) => Promise<void>;
  onClearScanHistory: () => void;
  onResetSettings: () => Promise<void>;
  onResetDatabase: () => void;
  onUpdateApp: () => Promise<void>;
  updateAppPending: boolean;
  clearScanHistoryPending: boolean;
  resetPending: boolean;
  importPending: boolean;
};

export function AboutSection({
  settings,
  version,
  working,
  onExport,
  onImport,
  onClearScanHistory,
  onResetSettings,
  onResetDatabase,
  onUpdateApp,
  updateAppPending,
  clearScanHistoryPending,
  resetPending,
  importPending,
}: AboutSectionProps) {
  const { t } = useTranslation();
  const [resetSettingsOpen, setResetSettingsOpen] = useState(false);
  const [clearScanHistoryOpen, setClearScanHistoryOpen] = useState(false);
  const [resetDatabaseOpen, setResetDatabaseOpen] = useState(false);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installMessage, setInstallMessage] = useState("");
  const [installedApp, setInstalledApp] = useState(() => isStandaloneApp());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setInstallMessage("");
    }
    function onAppInstalled() {
      setInstalledApp(true);
      setInstallPrompt(null);
      setInstallMessage(t("settings.installInstalled"));
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, [t]);

  async function handleInstallApp() {
    if (installedApp) {
      setInstallMessage(t("settings.installInstalled"));
      return;
    }
    if (!installPrompt) {
      setInstallMessage(t("settings.installManualHint"));
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    setInstallMessage(
      choice.outcome === "accepted"
        ? t("settings.installAccepted")
        : t("settings.installDismissed"),
    );
  }

  async function handleResetSettings() {
    try {
      await onResetSettings();
      setResetSettingsOpen(false);
    } catch {
      /* parent handles toast */
    }
  }

  return (
    <>
      <Card
        className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm hover:border-g-line hover:shadow-g-sm"
        padding="none"
      >
        <SectionHeading
          title={t("settings.section.about")}
          description={t("settings.aboutDesc")}
          icon={sectionIcon("about")}
        />
        <div className="px-6 pt-5 pb-2 md:px-8">
          <div className="flex flex-col gap-3 min-[1200px]:flex-row min-[1200px]:items-start min-[1200px]:justify-between min-[1200px]:gap-8">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <img
                  className="size-11 shrink-0 rounded-[10px] shadow-g-sm"
                  src="../../public/brand/aisets-app-icon.avif"
                  alt=""
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-g-display text-[20px] font-[620] leading-[1.2] tracking-[-0.02em] text-g-ink">
                    Aisets
                  </span>
                  <Badge tone="default">
                    {version?.currentVersion ?? "dev"}
                  </Badge>
                  {version?.updateAvailable ? (
                    <Badge tone="amber">
                      {t("settings.updateAvailable", {
                        version: version.latestVersion,
                      })}
                    </Badge>
                  ) : version === undefined ? null : (
                    <Badge tone="green">{t("settings.upToDate")}</Badge>
                  )}
                </div>
              </div>
              <p className="mt-1 font-g text-g-ui font-normal tracking-g-ui text-g-ink-3">
                {t("settings.license")}: MIT
                {version?.devMode && (
                  <span className="ml-2 text-g-ink-3">
                    · {t("settings.versionDevHint")}
                  </span>
                )}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                leadingIcon={
                  updateAppPending ? (
                    <LoaderCircle size={15} className="animate-spin" />
                  ) : (
                    <RefreshCw size={15} />
                  )
                }
                onClick={() => void onUpdateApp()}
                disabled={
                  updateAppPending ||
                  version === undefined ||
                  (!version?.updateAvailable &&
                    !version?.devMode &&
                    !import.meta.env.DEV)
                }
              >
                {updateAppPending
                  ? t("settings.updating")
                  : version?.updateAvailable
                    ? t("settings.updateAction")
                    : t("settings.upToDateAction")}
              </Button>
              <Button
                variant="secondary"
                leadingIcon={<Download size={15} />}
                onClick={() => void handleInstallApp()}
                disabled={installedApp}
              >
                {installedApp
                  ? t("settings.installInstalledAction")
                  : t("settings.installAppAction")}
              </Button>
            </div>
          </div>
          {installMessage && (
            <div className="mt-2">
              <Notice tone={installedApp ? "success" : "info"}>
                {installMessage}
              </Notice>
            </div>
          )}

          <div className="mt-6 border-t border-g-line pt-5">
            <div className="mb-3">
              <span className="block font-g text-g-body font-[510] leading-[1.4] tracking-g-ui text-g-ink">
                {t("settings.data")}
              </span>
              <p className="mt-0.5 max-w-[48ch] font-g text-g-ui font-normal tracking-g-ui text-g-ink-3">
                {t("settings.dataDesc")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                leadingIcon={<Download size={15} />}
                onClick={onExport}
              >
                {t("settings.export")}
              </Button>
              <Button
                variant="secondary"
                leadingIcon={<Upload size={15} />}
                onClick={() => fileInputRef.current?.click()}
                disabled={working}
              >
                {t("settings.import")}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void onImport(file);
                }}
              />
            </div>
            <div className="mt-4 rounded-g-md border border-g-red-soft bg-g-red-soft/10 p-4">
              <span className="block font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-red">
                {t("settings.dangerZone")}
              </span>
              <div className="mt-3 grid gap-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <span className="font-g text-g-ui font-[510] tracking-g-ui text-g-ink">
                      {t("settings.clearScanHistory")}
                    </span>
                    <p className="mt-0.5 max-w-[44ch] font-g text-g-caption tracking-g-ui text-g-ink-3">
                      {t("settings.clearScanHistoryHint")}
                    </p>
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    leadingIcon={<Trash2 size={13} />}
                    onClick={() => setClearScanHistoryOpen(true)}
                    disabled={working}
                    className="shrink-0 self-start"
                  >
                    {t("settings.clearScanHistory")}
                  </Button>
                </div>
                <div className="border-t border-g-red-soft/50" />
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <span className="font-g text-g-ui font-[510] tracking-g-ui text-g-ink">
                      {t("settings.resetDatabase")}
                    </span>
                    <p className="mt-0.5 max-w-[44ch] font-g text-g-caption tracking-g-ui text-g-ink-3">
                      {t("settings.resetDatabaseHint")}
                    </p>
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    leadingIcon={<RotateCcw size={13} />}
                    onClick={() => setResetDatabaseOpen(true)}
                    disabled={working}
                    className="shrink-0 self-start"
                  >
                    {t("settings.resetDatabase")}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 border-t border-g-line pt-5">
            <div className="mb-3">
              <span className="block font-g text-g-body font-[510] leading-[1.4] tracking-g-ui text-g-ink">
                {t("settings.storage")}
              </span>
              <p className="mt-0.5 max-w-[48ch] font-g text-g-ui font-normal tracking-g-ui text-g-ink-3">
                {t("settings.storageDesc")}
              </p>
            </div>
            <div className="grid gap-2">
              {(
                [
                  ["databasePath", settings?.databasePath],
                  ["dataDir", settings?.dataDir],
                  ["cacheDir", settings?.cacheDir],
                ] as const
              ).map(([key, value]) => (
                <div
                  key={key}
                  className="flex flex-col gap-1 rounded-g-md bg-g-surface-2 px-3 py-2.5 min-[1200px]:flex-row min-[1200px]:items-center min-[1200px]:gap-4"
                >
                  <span className="shrink-0 font-g text-g-ui font-[510] tracking-g-ui text-g-ink-2 min-[1200px]:w-[100px]">
                    {t(`settings.${key}`)}
                  </span>
                  <code className="min-w-0 break-all font-g-mono text-g-chip tracking-g-mono text-g-ink-3">
                    {value ?? "..."}
                  </code>
                </div>
              ))}
            </div>
          </div>

          <div className="h-4" />
        </div>
      </Card>
      <ConfirmDialog
        open={resetSettingsOpen}
        title={t("settings.resetSettings")}
        message={t("settings.resetSettingsConfirm")}
        confirmText={t("settings.reset")}
        cancelText={t("common.cancel")}
        loading={resetPending}
        onConfirm={() => void handleResetSettings()}
        onCancel={() => setResetSettingsOpen(false)}
      />
      <ConfirmDialog
        open={clearScanHistoryOpen}
        variant="danger"
        title={t("settings.clearScanHistory")}
        message={t("settings.clearScanHistoryConfirm")}
        confirmText={t("settings.clearScanHistory")}
        cancelText={t("common.cancel")}
        loading={clearScanHistoryPending}
        onConfirm={onClearScanHistory}
        onCancel={() => setClearScanHistoryOpen(false)}
      />
      <ConfirmDialog
        open={resetDatabaseOpen}
        variant="danger"
        title={t("settings.resetDatabase")}
        message={t("settings.resetConfirm")}
        confirmText={t("settings.resetDatabase")}
        cancelText={t("common.cancel")}
        loading={importPending}
        onConfirm={onResetDatabase}
        onCancel={() => setResetDatabaseOpen(false)}
      />
    </>
  );
}
