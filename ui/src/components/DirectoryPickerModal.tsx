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
          <div className="min-w-0 truncate text-sm text-(--g-ink-4)">
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
      <div className="directory-picker">
        <div className="directory-path-row">
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

        <div className="directory-panel">
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
            <div className="directory-list" role="list">
              {listing.parent && (
                <button
                  type="button"
                  className="directory-item"
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
                  className="directory-item"
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
