import {
  ClipboardCopy,
  Download,
  FolderInput,
  LoaderCircle,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { TFunction } from "i18next";
import { Button, IconButton, Select } from "@/components/ui";
import {
  copyBlobToClipboard,
  downloadBlob,
  saveToProject,
} from "./useCanvasCapture";

type Project = { id: string; name: string };

type CapturePreview = {
  url: string;
  blob: Blob;
};

type AICanvasCapturePreviewProps = {
  t: TFunction;
  preview: CapturePreview;
  dismissPreview: () => void;
  onSaved?: (projectName: string, filePath: string) => void;
  onSaveError?: (message: string) => void;
};

const SAVE_PROJECT_KEY = "aisets.canvas.saveProjectId";

export function AICanvasCapturePreview({
  t,
  preview,
  dismissPreview,
  onSaved,
  onSaveError,
}: AICanvasCapturePreviewProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(() => {
    try {
      return localStorage.getItem(SAVE_PROJECT_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data: { projects: Project[] }) => {
        if (cancelled) return;
        const list = data.projects ?? [];
        setProjects(list);
        if (!list.some((p) => p.id === selectedProjectId) && list.length > 0) {
          setSelectedProjectId(list[0].id);
        }
      })
      .catch(() => {
        // network error — projects list stays empty
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;
    try {
      localStorage.setItem(SAVE_PROJECT_KEY, selectedProjectId);
    } catch {
      // localStorage unavailable
    }
  }, [selectedProjectId]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  async function handleSave() {
    if (!selectedProjectId || saving) return;
    setSaving(true);
    try {
      const result = await saveToProject(preview.blob, selectedProjectId);
      onSaved?.(selectedProject?.name ?? "", result.path);
      dismissPreview();
    } catch (err) {
      onSaveError?.(
        err instanceof Error ? err.message : t("aiCanvas.saveError"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      data-ai-canvas-overlay="true"
      className="pointer-events-auto absolute right-4 bottom-28 z-[80] animate-[capturePreviewIn_320ms_var(--g-ease-out)_both] motion-reduce:animate-none"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="group relative max-w-[360px] min-w-[160px] overflow-hidden rounded-[16px] bg-[rgba(31,31,31,0.92)] shadow-[0_8px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <div className="relative">
          <img
            src={preview.url}
            alt={t("aiCanvas.screenshot")}
            className="block max-h-[280px] bg-[repeating-conic-gradient(rgba(255,255,255,0.06)_0%_25%,transparent_0%_50%)] bg-[length:12px_12px]"
            draggable={false}
          />
        </div>
        <div className="flex items-center justify-center gap-1 px-3 py-1.5">
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<ClipboardCopy />}
            className="flex-1 border-transparent text-white/72 hover:bg-white/[0.1] hover:text-white"
            onClick={() => {
              void copyBlobToClipboard(preview.blob).then(dismissPreview);
            }}
          >
            {t("aiCanvas.copy")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<Download />}
            className="flex-1 border-transparent text-white/72 hover:bg-white/[0.1] hover:text-white"
            onClick={() => {
              downloadBlob(preview.blob);
              dismissPreview();
            }}
          >
            {t("aiCanvas.download")}
          </Button>
          <IconButton
            size="sm"
            aria-label={t("common.cancel")}
            className="border-transparent text-white/40 hover:bg-white/[0.1] hover:text-white"
            onClick={dismissPreview}
          >
            <X />
          </IconButton>
        </div>
        {projects.length > 0 && (
          <div className="flex items-center gap-1.5 border-t border-white/[0.08] px-3 py-1.5">
            <Select
              value={selectedProjectId}
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
              onChange={setSelectedProjectId}
              size="sm"
              variant="dark"
              aria-label={t("aiCanvas.saveToProject")}
              className="min-w-0 flex-1"
            />
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={
                saving ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <FolderInput />
                )
              }
              disabled={saving || !selectedProjectId}
              className="shrink-0 border-transparent text-white/72 hover:bg-white/[0.1] hover:text-white"
              onClick={() => void handleSave()}
            >
              {t("aiCanvas.saveToProject")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
