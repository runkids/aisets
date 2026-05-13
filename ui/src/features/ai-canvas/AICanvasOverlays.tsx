import {
  ClipboardCopy,
  Download,
  FolderInput,
  LoaderCircle,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { TFunction } from "i18next";
import { Button, CopyButton, IconButton, Select } from "@/components/ui";
import { CARD_WIDTH } from "./canvasUtils";
import {
  copyBlobToClipboard,
  downloadBlob,
  saveToProject,
} from "./useCanvasCapture";
import type { CanvasCard, ChatHistoryEntry } from "./aiCanvasState";
import type { WorkingState } from "./aiCanvasTypes";

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
        <div className="relative bg-[repeating-conic-gradient(rgba(255,255,255,0.06)_0%_25%,transparent_0%_50%)] bg-[length:12px_12px] p-2.5">
          <img
            src={preview.url}
            alt={t("aiCanvas.screenshot")}
            className="block max-h-[280px] rounded-[10px]"
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

type AICanvasDebugPanelProps = {
  viewport: { x: number; y: number; scale: number };
  selectedCardIds: string[];
  cardWidths: Record<string, number>;
  cards: CanvasCard[];
  chatHistory: ChatHistoryEntry[];
  working: WorkingState;
  aiCursor: {
    x: number;
    y: number;
    label?: string;
    status: "thinking" | "acting" | "idle";
  };
  onClose: () => void;
};

function serializeCards(
  cards: CanvasCard[],
  cardWidths: Record<string, number>,
) {
  return cards.map((c) => {
    const base: Record<string, unknown> = {
      id: c.id,
      kind: c.kind,
      x: Math.round(c.x),
      y: Math.round(c.y),
      width: cardWidths[c.id] ?? CARD_WIDTH,
    };
    if (c.kind === "asset") {
      base.assetId = c.asset.id;
      base.repoPath = c.asset.repoPath;
    }
    if (c.kind === "proposal") {
      base.tool = c.tool;
      base.status = c.status;
    }
    if (c.kind === "comment") {
      base.anchor = c.anchorId;
      base.text = c.text;
      base.region = c.region;
    }
    return base;
  });
}

export function AICanvasDebugPanel({
  viewport,
  selectedCardIds,
  cardWidths,
  cards,
  chatHistory,
  working,
  aiCursor,
  onClose,
}: AICanvasDebugPanelProps) {
  const sessionDebug = {
    version: 1,
    viewport,
    selectedCardIds,
    cardWidths,
    cards: serializeCards(cards, cardWidths),
    chatHistory,
  };
  const visibleDebug = {
    viewport,
    selectedCardIds,
    working,
    cardsCount: cards.length,
    cardWidths,
    cardKinds: cards.map((c) => `${c.kind}:${c.id.slice(0, 8)}`),
    chatHistoryCount: chatHistory.length,
    aiCursor,
    cards: serializeCards(cards, cardWidths).map((card) =>
      typeof card.text === "string"
        ? { ...card, text: card.text.slice(0, 40), region: undefined }
        : card,
    ),
  };

  return (
    <div
      data-ai-canvas-overlay="true"
      className="pointer-events-auto absolute right-3 bottom-[160px] z-[70] max-h-[60vh] w-[420px] overflow-auto rounded-g-md border border-white/10 bg-[rgba(20,20,20,0.95)] p-3 font-mono text-[11px] leading-[1.5] text-green-400 shadow-g-pop backdrop-blur-xl"
      data-ai-canvas-scroll="true"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between text-white/60">
        <span className="font-[590] uppercase tracking-wider">
          Canvas Debug
        </span>
        <div className="flex items-center gap-2">
          <CopyButton
            value={JSON.stringify(sessionDebug, null, 2)}
            size="sm"
            className="text-white/40 hover:text-white"
          />
          <button
            type="button"
            className="text-white/40 hover:text-white"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <pre className="whitespace-pre-wrap break-all">
        {JSON.stringify(visibleDebug, null, 2)}
      </pre>
    </div>
  );
}
