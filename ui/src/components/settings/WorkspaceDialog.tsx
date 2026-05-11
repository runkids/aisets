import type { ChangeEvent } from "react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2, Upload } from "lucide-react";
import { Button, Modal, Notice, TextInput } from "../ui";
import { WorkspaceAvatar } from "../project/WorkspaceAvatar";
import type { Workspace } from "../../types";
import {
  workspaceDialogButtonClass,
  workspaceDialogDangerButtonClass,
} from "./constants";
import {
  workspaceIconMaxBytes,
  workspaceIconAccept,
  readWorkspaceIcon,
} from "./helpers";

export type WorkspaceDialogProps = {
  open: boolean;
  workspace?: Workspace;
  loading: boolean;
  onConfirm: (value: { name: string; iconImage: string }) => void;
  onCancel: () => void;
};

export type WorkspaceDialogContentProps = Omit<WorkspaceDialogProps, "open">;

function WorkspaceDialogContent({
  workspace,
  loading,
  onConfirm,
  onCancel,
}: WorkspaceDialogContentProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const defaultName = workspace?.name ?? "";
  const defaultIconImage = workspace?.iconImage ?? "";
  const [name, setName] = useState(defaultName);
  const [iconImage, setIconImage] = useState(defaultIconImage);
  const [error, setError] = useState("");

  const trimmedName = name.trim();
  const changed = trimmedName !== defaultName || iconImage !== defaultIconImage;
  const canSubmit = trimmedName.length > 0 && (!workspace || changed);

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!workspaceIconAccept.split(",").includes(file.type)) {
      setError(t("settings.workspaceIconTypeError"));
      return;
    }
    if (file.size > workspaceIconMaxBytes) {
      setError(t("settings.workspaceIconSizeError"));
      return;
    }
    try {
      setIconImage(await readWorkspaceIcon(file));
      setError("");
    } catch {
      setError(t("settings.workspaceIconReadError"));
    }
  }

  function submit() {
    if (!canSubmit) return;
    onConfirm({ name: trimmedName, iconImage });
  }

  return (
    <Modal
      title={
        workspace ? t("settings.editWorkspace") : t("settings.addWorkspace")
      }
      onClose={onCancel}
      size="sm"
      footer={
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={loading || !canSubmit}
          >
            {workspace ? t("action.saveChanges") : t("settings.addWorkspace")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-4">
          <WorkspaceAvatar
            name={trimmedName || defaultName || t("settings.addWorkspace")}
            iconImage={iconImage}
            className="size-16 bg-g-surface-3 text-2xl shadow-g-inset"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={workspaceIconAccept}
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => void onFileChange(event)}
              disabled={loading}
            />
            <div>
              <p className="font-g text-g-ui font-[510] tracking-g-ui text-g-ink">
                {t("settings.workspaceIcon")}
              </p>
              <p className="mt-0.5 font-g text-g-caption tracking-g-ui text-g-ink-3">
                {t("settings.workspaceIconHint")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Upload size={13} />}
                onClick={() => inputRef.current?.click()}
                disabled={loading}
                className={workspaceDialogButtonClass}
              >
                {t("settings.uploadWorkspaceIcon")}
              </Button>
              {iconImage && (
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={<Trash2 size={13} />}
                  onClick={() => {
                    setIconImage("");
                    setError("");
                  }}
                  disabled={loading}
                  className={workspaceDialogDangerButtonClass}
                >
                  {t("settings.removeWorkspaceIcon")}
                </Button>
              )}
            </div>
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-g-caption font-[510] text-g-ink-3">
            {t("settings.workspaceName")}
          </label>
          <TextInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={
              workspace
                ? t("settings.renameWorkspacePrompt")
                : t("settings.addWorkspacePrompt")
            }
            disabled={loading}
            className="w-full"
          />
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Modal>
  );
}

export function WorkspaceDialog({
  open,
  workspace,
  ...props
}: WorkspaceDialogProps) {
  if (!open) return null;
  return (
    <WorkspaceDialogContent
      key={workspace?.id ?? "new"}
      workspace={workspace}
      {...props}
    />
  );
}
