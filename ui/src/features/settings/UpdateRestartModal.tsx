import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UpdateAppResult } from "@/types";
import { Button, CopyButton, Modal } from "@/components/ui";

export function UpdateRestartModal({
  update,
  restartPending,
  onRestart,
  onClose,
}: {
  update: UpdateAppResult;
  restartPending: boolean;
  onRestart: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const version = update.latestVersion ?? update.currentVersion;
  const restartFlags = updateRestartFlags(update);
  const restartBodyKey = update.devMode
    ? "settings.updateRestartBodyDev"
    : update.uiCached
      ? "settings.updateRestartBodyCached"
      : "settings.updateRestartBody";
  const clearCacheFlag = update.uiCached ? "" : " --clear-cache";
  const backgroundCommand = `aisets ui stop${restartFlags}\naisets ui${restartFlags}${clearCacheFlag} --no-open`;
  const foregroundCommand = `Ctrl+C\naisets ui once${restartFlags}${clearCacheFlag} --no-open`;

  return (
    <Modal
      title={t("settings.updateRestartTitle")}
      description={t(
        update.devMode
          ? "settings.updateRestartDescDev"
          : "settings.updateRestartDesc",
      )}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button
            variant="primary"
            leadingIcon={
              restartPending ? (
                <LoaderCircle size={15} className="animate-spin" />
              ) : undefined
            }
            onClick={onRestart}
            disabled={restartPending}
          >
            {restartPending
              ? t("settings.updateRestarting")
              : t("settings.updateRestartAction")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-g-body text-g-ink-2">
        <p>{t(restartBodyKey, { version })}</p>
        {!update.devMode && (
          <>
            <RestartCommandBlock
              title={t("settings.updateRestartBackgroundTitle")}
              command={backgroundCommand}
            />
            <RestartCommandBlock
              title={t("settings.updateRestartForegroundTitle")}
              command={foregroundCommand}
            />
            <p className="text-g-caption text-g-ink-4">
              {t("settings.updateRestartKeepFlags")}
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

export function ElevatedUpdateModal({
  path,
  command,
  uiHost,
  uiPort,
  uiBasePath,
  onClose,
}: {
  path: string;
  command: string;
  uiHost?: string;
  uiPort?: string;
  uiBasePath?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const restartFlags = updateRestartFlags({ uiHost, uiPort, uiBasePath });
  const restartCommand = `aisets ui stop${restartFlags}\naisets ui${restartFlags} --clear-cache --no-open`;

  return (
    <Modal
      title={t("settings.updateElevatedTitle")}
      description={t("settings.updateElevatedDesc")}
      onClose={onClose}
      size="md"
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t("common.close")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 text-g-body text-g-ink-2">
        <p>{t("settings.updateElevatedBody", { path })}</p>
        <RestartCommandBlock
          title={t("settings.updateElevatedCommandTitle")}
          command={command}
        />
        <RestartCommandBlock
          title={t("settings.updateElevatedRestartTitle")}
          command={restartCommand}
        />
        <p className="text-g-caption text-g-ink-4">
          {t("settings.updateElevatedAfter")}
        </p>
      </div>
    </Modal>
  );
}

function RestartCommandBlock({
  title,
  command,
}: {
  title: string;
  command: string;
}) {
  const { t } = useTranslation();

  return (
    <section className="rounded-g-md border border-g-line bg-g-surface-2">
      <div className="flex min-h-9 items-center justify-between gap-3 border-b border-g-line px-3">
        <h3 className="text-g-caption font-[590] text-g-ink">{title}</h3>
        <CopyButton value={command} label={t("common.copy")} />
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words px-3 py-2.5 font-g-mono text-g-caption leading-[1.55] tracking-g-mono text-g-ink">
        {command}
      </pre>
    </section>
  );
}

function updateRestartFlags(
  update?: Pick<UpdateAppResult, "uiHost" | "uiPort" | "uiBasePath">,
) {
  const host = update?.uiHost || window.location.hostname || "127.0.0.1";
  const port = update?.uiPort || window.location.port || "19520";
  const basePath = update?.uiBasePath || window.__BASE_PATH__ || "";
  const basePathFlag = basePath ? ` --base-path ${basePath}` : "";
  return ` --host ${host} --port ${port}${basePathFlag}`;
}
