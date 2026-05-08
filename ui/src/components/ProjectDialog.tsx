import { Upload, Trash2 } from "lucide-react";
import type { ChangeEvent } from "react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  intentSelectOptions,
  projectScanIntentDescription,
} from "../projectScanIntent";
import type { Project, ProjectScanIntent } from "../types";
import { Button, Modal, Select, TextInput } from "./ui";
import { ProjectAvatar } from "./ProjectAvatar";

type ProjectDialogValue = {
  name: string;
  iconImage: string;
  scanIntent: ProjectScanIntent;
};

type ProjectDialogProps = {
  open: boolean;
  project?: Project | null;
  loading: boolean;
  onConfirm: (value: ProjectDialogValue) => void;
  onCancel: () => void;
};

const projectIconMaxBytes = 512 * 1024;
const projectIconAccept = "image/png,image/jpeg,image/gif,image/webp";

function readProjectIcon(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function ProjectDialogContent({
  project,
  loading,
  onConfirm,
  onCancel,
}: Omit<ProjectDialogProps, "open">) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const defaultName = project?.name ?? "";
  const defaultIconImage = project?.iconImage ?? "";
  const defaultScanIntent = project?.scanIntent ?? "code";
  const [name, setName] = useState(defaultName);
  const [iconImage, setIconImage] = useState(defaultIconImage);
  const [scanIntent, setScanIntent] =
    useState<ProjectScanIntent>(defaultScanIntent);
  const [error, setError] = useState("");

  const trimmedName = name.trim();
  const changed =
    trimmedName !== defaultName ||
    iconImage !== defaultIconImage ||
    scanIntent !== defaultScanIntent;
  const canSubmit = trimmedName.length > 0 && changed;
  const intentOptions = intentSelectOptions(t);

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!projectIconAccept.split(",").includes(file.type)) {
      setError(t("projects.projectIconTypeError"));
      return;
    }
    if (file.size > projectIconMaxBytes) {
      setError(t("projects.projectIconSizeError"));
      return;
    }
    try {
      setIconImage(await readProjectIcon(file));
      setError("");
    } catch {
      setError(t("projects.projectIconReadError"));
    }
  }

  function submit() {
    if (!canSubmit) return;
    onConfirm({ name: trimmedName, iconImage, scanIntent });
  }

  return (
    <Modal
      title={t("projects.editDialogTitle")}
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
            {t("action.saveChanges")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-4">
          <ProjectAvatar
            iconImage={iconImage}
            className="size-16 bg-g-surface-3 [&_svg]:size-7"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={projectIconAccept}
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => void onFileChange(event)}
              disabled={loading}
            />
            <div>
              <p className="font-g text-g-ui font-[510] tracking-g-ui text-g-ink">
                {t("projects.projectIcon")}
              </p>
              <p className="mt-0.5 font-g text-g-caption tracking-g-ui text-g-ink-3">
                {t("projects.projectIconHint")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Upload size={13} />}
                onClick={() => inputRef.current?.click()}
                disabled={loading}
                className="h-7 gap-1.5 px-2 text-[11px] [&_svg]:!size-3"
              >
                {t("projects.uploadProjectIcon")}
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
                  className="h-7 gap-1.5 px-2 text-[11px] text-g-ink-3 hover:bg-g-red-soft hover:text-g-red [&_svg]:!size-3"
                >
                  {t("projects.removeProjectIcon")}
                </Button>
              )}
            </div>
            {error && (
              <p className="font-g text-g-caption tracking-g-ui text-g-red">
                {error}
              </p>
            )}
          </div>
        </div>
        <TextInput
          label={t("projects.renameLabel")}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("projects.renameLabel")}
          autoFocus
          disabled={loading}
        />
        <div>
          <p className="mb-1.5 font-g text-g-ui font-[510] tracking-g-ui text-g-ink">
            {t("projects.projectType")}
          </p>
          <Select
            value={scanIntent}
            options={intentOptions}
            onChange={(value) => setScanIntent(value as ProjectScanIntent)}
            aria-label={t("projects.projectType")}
          />
          <p className="mt-1.5 font-g text-g-caption tracking-g-ui text-g-ink-3">
            {projectScanIntentDescription(t, scanIntent)}
          </p>
        </div>
      </div>
    </Modal>
  );
}

export function ProjectDialog({ open, project, ...props }: ProjectDialogProps) {
  if (!open || !project) return null;
  return <ProjectDialogContent key={project.id} project={project} {...props} />;
}
