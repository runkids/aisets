import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Folder,
  FolderOpen,
  FolderRoot,
  HardDrive,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { detectProjectScanIntent } from "../api";
import { errorMessage } from "../i18n/index";
import {
  intentSelectOptions,
  normalizeProjectScanIntent,
  projectScanIntentDescription,
  projectScanIntentLabel,
} from "../projectScanIntent";
import { useDirectoryListingQuery } from "../queries";
import type { ProjectScanIntent, ProjectScanIntentDetection } from "../types";
import {
  Badge,
  Button,
  EmptyState,
  Modal,
  Select,
  TextInput,
  Tooltip,
} from "./ui";

const dirRowClass =
  "grid grid-cols-[18px_minmax(0,200px)_1fr] items-center gap-2.5 py-2 px-2.5 rounded-g-md bg-transparent text-g-ink-2 text-[13px] font-normal tracking-[-0.012em] text-left cursor-pointer transition-[background,color] duration-[120ms] ease-[var(--g-ease)] w-full hover:bg-g-surface-2 hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus [&>svg]:text-g-ink-3 [&>svg]:size-[18px] [&>svg]:shrink-0 [&>span]:font-g [&>span]:font-[510] [&>span]:text-g-ink [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:whitespace-nowrap [&>code]:font-g-mono [&>code]:text-[11px] [&>code]:tracking-[-0.015em] [&>code]:text-g-ink-4 [&>code]:overflow-hidden [&>code]:text-ellipsis [&>code]:whitespace-nowrap [&>code]:text-right [&>code]:bg-transparent [&>code]:p-0 hover:[&>code]:text-g-ink-3";

type Props = {
  open: boolean;
  working: boolean;
  disabledReason?: string;
  initialPath?: string;
  onClose: () => void;
  onSelect: (path: string, scanIntent: ProjectScanIntent) => void;
};

export function DirectoryPickerModal({
  open,
  working,
  disabledReason,
  initialPath = "",
  onClose,
  onSelect,
}: Props) {
  const { t } = useTranslation();
  const [path, setPath] = useState("");
  const [draftPath, setDraftPath] = useState("");
  const [scanIntent, setScanIntent] = useState<ProjectScanIntent>("code");
  const [detection, setDetection] = useState<ProjectScanIntentDetection | null>(
    null,
  );
  const [detecting, setDetecting] = useState(false);
  const [detectionError, setDetectionError] = useState("");
  const activePath = path || initialPath;
  const listingQuery = useDirectoryListingQuery(activePath, open);
  const listing = listingQuery.data;
  const currentPath = listing?.path ?? activePath;
  const directoryError = listingQuery.error
    ? errorMessage(listingQuery.error)
    : "";

  const intentOptions = useMemo(() => intentSelectOptions(t), [t]);

  useEffect(() => {
    if (!open || !listing?.path) return;
    let cancelled = false;
    void Promise.resolve()
      .then(() => {
        if (cancelled) return null;
        setDetecting(true);
        setDetectionError("");
        return detectProjectScanIntent(listing.path);
      })
      .then((result) => {
        if (cancelled || !result) return;
        setDetection(result.detection);
        setScanIntent(
          result.detection.confidence === "low"
            ? "mixed"
            : normalizeProjectScanIntent(result.detection.suggestedScanIntent),
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDetection(null);
        setScanIntent("mixed");
        setDetectionError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setDetecting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listing?.path, open]);

  if (!open) return null;

  function resetAndClose() {
    setPath("");
    setDraftPath("");
    setDetection(null);
    setDetectionError("");
    setScanIntent("code");
    onClose();
  }

  function selectCurrent() {
    setPath("");
    setDraftPath("");
    onSelect(currentPath, scanIntent);
  }

  function go(target: string) {
    setPath(target);
    setDraftPath(target);
  }

  function submitDraft() {
    go(draftPath.trim());
  }

  return (
    <Modal
      title={t("directoryPicker.title")}
      description={t("directoryPicker.description")}
      onClose={resetAndClose}
      bodyPadding="none"
      bodyClassName="flex flex-col overflow-hidden"
      footer={
        <>
          <div className="flex min-w-0 items-center gap-1.5 text-g-ink-4">
            <FolderRoot size={14} className="shrink-0" aria-hidden="true" />
            <code className="min-w-0 truncate bg-transparent p-0 font-g-mono text-[11px] tracking-g-mono">
              {currentPath || t("directoryPicker.defaultDir")}
            </code>
          </div>
          <div className="ml-auto flex shrink-0 gap-2">
            <Button variant="secondary" onClick={resetAndClose}>
              {t("common.cancel")}
            </Button>
            <Tooltip label={disabledReason} disabled={!disabledReason}>
              <span className="inline-flex">
                <Button
                  variant="primary"
                  disabled={!listing?.path || working || !!disabledReason}
                  onClick={selectCurrent}
                >
                  {working && (
                    <Loader2
                      size={14}
                      className="animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  {working
                    ? t("directoryPicker.adding")
                    : t("directoryPicker.addDir")}
                </Button>
              </span>
            </Tooltip>
          </div>
        </>
      }
    >
      <div className="flex min-h-[420px] flex-1 flex-col">
        <div className="z-[30] flex shrink-0 flex-col gap-3 border-b border-g-line bg-g-surface px-5 pb-3">
          <div className="flex gap-2 items-center">
            <TextInput
              icon={<HardDrive size={16} />}
              value={draftPath || currentPath}
              onChange={(event) => setDraftPath(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitDraft();
              }}
              placeholder={t("directoryPicker.pathPlaceholder")}
              aria-label={t("directoryPicker.pathLabel")}
            />
            <Button variant="secondary" onClick={submitDraft}>
              {t("directoryPicker.go")}
            </Button>
          </div>

          <div className="rounded-g-md border border-g-line bg-g-surface-2 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="font-g text-g-ui font-[590] tracking-g-ui text-g-ink">
                  {t("directoryPicker.projectType")}
                </p>
                <p className="mt-0.5 font-g text-g-caption tracking-g-ui text-g-ink-3">
                  {t("directoryPicker.projectTypeHint")}
                </p>
              </div>
              <Select
                value={scanIntent}
                options={intentOptions}
                onChange={(value) => setScanIntent(value as ProjectScanIntent)}
                aria-label={t("directoryPicker.projectType")}
                className="w-full sm:w-[240px]"
              />
            </div>
            <div className="mt-2 font-g text-g-caption tracking-g-ui text-g-ink-3">
              {detecting ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" />
                  {t("directoryPicker.detectingIntent")}
                </span>
              ) : detection ? (
                <span className="inline-flex items-center gap-1.5">
                  <Badge tone="green" className="gap-1">
                    <CheckCircle2 size={10} aria-hidden="true" />
                    {t("directoryPicker.detectedIntent", {
                      intent: projectScanIntentLabel(
                        t,
                        normalizeProjectScanIntent(
                          detection.suggestedScanIntent,
                        ),
                      ),
                    })}
                  </Badge>
                  <span className="text-g-ink-4">
                    {projectScanIntentDescription(
                      t,
                      normalizeProjectScanIntent(detection.suggestedScanIntent),
                    )}
                  </span>
                </span>
              ) : detectionError ? (
                <span className="inline-flex items-center gap-1.5">
                  <Badge tone="amber" className="gap-1">
                    <AlertTriangle size={10} aria-hidden="true" />
                    {t("directoryPicker.detectIntentFailed")}
                  </Badge>
                </span>
              ) : (
                <span>{projectScanIntentDescription(t, scanIntent)}</span>
              )}
            </div>
          </div>
        </div>

        <div className="mx-5 mb-5 mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-g-md border border-g-line bg-g-canvas shadow-g-inset">
          {listingQuery.isPending ? (
            <EmptyState
              icon={<Loader2 className="animate-spin" size={22} />}
              title={t("directoryPicker.loading")}
              description={t("directoryPicker.loadingDesc")}
            />
          ) : directoryError ? (
            <EmptyState
              icon={<AlertTriangle size={22} />}
              title={t("directoryPicker.loadError")}
              description={directoryError}
              tone="warning"
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => listingQuery.refetch()}
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  {t("common.retry")}
                </Button>
              }
            />
          ) : listing ? (
            <div
              className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-1.5"
              role="list"
            >
              {listing.parent && (
                <button
                  type="button"
                  className={dirRowClass}
                  onClick={() => go(listing.parent)}
                >
                  <ChevronLeft size={18} />
                  <span>{t("directoryPicker.parent")}</span>
                  <code>{listing.parent}</code>
                </button>
              )}
              {listing.directories.map((dir) => (
                <button
                  key={dir.path}
                  type="button"
                  className={dirRowClass}
                  onClick={() => go(dir.path)}
                >
                  <Folder size={18} />
                  <span>{dir.name}</span>
                  <code>{dir.path}</code>
                </button>
              ))}
              {listing.directories.length === 0 && !listing.parent && (
                <EmptyState
                  icon={<FolderOpen size={22} />}
                  title={t("directoryPicker.noSubdirs")}
                  description={t("directoryPicker.noSubdirsDesc")}
                />
              )}
            </div>
          ) : (
            <EmptyState
              icon={<FolderOpen size={22} />}
              title={t("directoryPicker.selectStart")}
              description={t("directoryPicker.selectStartDesc")}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
