import {
  AlertTriangle,
  ChevronLeft,
  Folder,
  FolderOpen,
  HardDrive,
  Loader2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "../i18n/index";
import { useDirectoryListingQuery } from "../queries";
import { Button, EmptyState, Modal, TextInput } from "./ui";

type Props = {
  open: boolean;
  working: boolean;
  initialPath?: string;
  onClose: () => void;
  onSelect: (path: string) => void;
};

export function DirectoryPickerModal({
  open,
  working,
  initialPath = "",
  onClose,
  onSelect,
}: Props) {
  const { t } = useTranslation();
  const [path, setPath] = useState("");
  const [draftPath, setDraftPath] = useState("");
  const activePath = path || initialPath;
  const listingQuery = useDirectoryListingQuery(activePath, open);
  const listing = listingQuery.data;
  const currentPath = listing?.path ?? activePath;
  const directoryError = listingQuery.error
    ? errorMessage(listingQuery.error)
    : "";

  if (!open) return null;

  function resetAndClose() {
    setPath("");
    setDraftPath("");
    onClose();
  }

  function selectCurrent() {
    setPath("");
    setDraftPath("");
    onSelect(currentPath);
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
      footer={
        <>
          <div className="min-w-0 truncate text-g-body text-g-ink-4">
            {currentPath || t("directoryPicker.defaultDir")}
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={resetAndClose}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={!listing?.path || working}
              onClick={selectCurrent}
            >
              {t("directoryPicker.addDir")}
            </Button>
          </div>
        </>
      }
    >
      <div className="flex flex-col gap-3 min-h-[320px]">
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

        <div className="flex-1 bg-g-canvas border border-g-line rounded-g-md shadow-g-inset overflow-hidden min-h-[280px] flex flex-col">
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
            />
          ) : listing ? (
            <div
              className="flex flex-col gap-0.5 p-1.5 overflow-y-auto flex-1"
              role="list"
            >
              {listing.parent && (
                <button
                  type="button"
                  className="grid grid-cols-[18px_minmax(0,200px)_1fr] items-center gap-2.5 py-2 px-2.5 rounded-g-md bg-transparent text-g-ink-2 text-[13px] font-normal tracking-[-0.012em] text-left cursor-pointer transition-[background,color] duration-[120ms] ease-[var(--g-ease)] w-full hover:bg-g-surface-2 hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus [&>svg]:text-g-ink-3 [&>svg]:size-[18px] [&>svg]:shrink-0 [&>span]:font-g [&>span]:font-[510] [&>span]:text-g-ink [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:whitespace-nowrap [&>code]:font-g-mono [&>code]:text-[11px] [&>code]:tracking-[-0.015em] [&>code]:text-g-ink-4 [&>code]:overflow-hidden [&>code]:text-ellipsis [&>code]:whitespace-nowrap [&>code]:text-right [&>code]:bg-transparent [&>code]:p-0 hover:[&>code]:text-g-ink-3"
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
                  className="grid grid-cols-[18px_minmax(0,200px)_1fr] items-center gap-2.5 py-2 px-2.5 rounded-g-md bg-transparent text-g-ink-2 text-[13px] font-normal tracking-[-0.012em] text-left cursor-pointer transition-[background,color] duration-[120ms] ease-[var(--g-ease)] w-full hover:bg-g-surface-2 hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus [&>svg]:text-g-ink-3 [&>svg]:size-[18px] [&>svg]:shrink-0 [&>span]:font-g [&>span]:font-[510] [&>span]:text-g-ink [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:whitespace-nowrap [&>code]:font-g-mono [&>code]:text-[11px] [&>code]:tracking-[-0.015em] [&>code]:text-g-ink-4 [&>code]:overflow-hidden [&>code]:text-ellipsis [&>code]:whitespace-nowrap [&>code]:text-right [&>code]:bg-transparent [&>code]:p-0 hover:[&>code]:text-g-ink-3"
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
