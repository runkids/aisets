import { useCallback, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { TFunction } from "i18next";
import { FolderOpen, Layers, Pencil, Trash2, X } from "lucide-react";
import { canvasSessionThumbnailUrl } from "@/api";
import { Button, IconButton } from "@/components/ui";
import {
  DialogBody,
  DialogHeader,
  DialogOverlay,
  DialogSurface,
  DialogTitle,
  DialogViewport,
} from "@/components/ui/DialogShell";
import { useToast } from "@/components/shared/ToastProvider";
import {
  useCanvasSessionsQuery,
  useDeleteCanvasSessionMutation,
  useRenameCanvasSessionMutation,
} from "@/queries";
import type { CanvasSessionMeta } from "@/types";

type Props = {
  open: boolean;
  onClose: () => void;
  onLoad: (sessionId: string) => void;
  onSessionRenamed?: (id: string, name: string) => void;
  currentSessionId?: string;
  t: TFunction;
};

function relativeTime(iso: string) {
  const diff = Date.now() - Date.parse(iso);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function SessionCard({
  session,
  isCurrent,
  onLoad,
  onRename,
  onDelete,
  t,
}: {
  session: CanvasSessionMeta;
  isCurrent: boolean;
  onLoad: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  t: TFunction;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(session.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const commitRename = useCallback(() => {
    const trimmed = editValue.trim();
    setEditing(false);
    if (trimmed && trimmed !== session.name) {
      onRename(trimmed);
    }
  }, [editValue, session.name, onRename]);

  return (
    <button
      type="button"
      onClick={() => {
        if (!editing) onLoad();
      }}
      className="group relative flex flex-col overflow-hidden rounded-g-md border border-g-line bg-g-surface-2/60 text-left transition-colors hover:border-g-line-strong hover:bg-g-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-g-accent data-[current]:border-g-accent/50"
      data-current={isCurrent || undefined}
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-g-surface-3">
        {session.hasThumbnail ? (
          <img
            src={canvasSessionThumbnailUrl(session.id)}
            alt={session.name}
            className="h-full w-full object-contain"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-g-ink-3">
            <Layers size={32} strokeWidth={1.5} />
          </div>
        )}
        {isCurrent && (
          <span className="absolute left-2 top-2 rounded-g-sm bg-g-accent/90 px-1.5 py-0.5 font-g text-[11px] font-medium text-white">
            {t("aiCanvas.currentSession")}
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 px-3 py-2">
        {editing ? (
          <input
            ref={inputRef}
            className="w-full rounded-g-sm border border-g-line bg-g-surface px-1.5 py-0.5 font-g text-g-ui text-g-ink outline-none focus:border-g-accent"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setEditing(false);
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate font-g text-g-ui font-medium text-g-ink">
            {session.name}
          </span>
        )}
        <span className="truncate font-g text-[12px] text-g-ink-3">
          {t("aiCanvas.sessionCards", { count: session.cardCount })}
          {" · "}
          {relativeTime(session.updatedAt)}
        </span>
      </div>

      <div
        className="absolute right-1.5 top-1.5 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <IconButton
          size="sm"
          aria-label={t("aiCanvas.renameSession")}
          className="bg-g-surface/80 backdrop-blur-sm"
          onClick={() => {
            setEditValue(session.name);
            setEditing(true);
            requestAnimationFrame(() => {
              inputRef.current?.focus();
              inputRef.current?.select();
            });
          }}
        >
          <Pencil size={14} />
        </IconButton>
        <IconButton
          size="sm"
          aria-label={t("aiCanvas.deleteSession")}
          className="bg-g-surface/80 backdrop-blur-sm text-red-500 hover:text-red-400"
          onClick={onDelete}
        >
          <Trash2 size={14} />
        </IconButton>
      </div>
    </button>
  );
}

export function CanvasSessionsDialog({
  open,
  onClose,
  onLoad,
  onSessionRenamed,
  currentSessionId,
  t,
}: Props) {
  const toast = useToast();
  const { data, isLoading } = useCanvasSessionsQuery();
  const renameMut = useRenameCanvasSessionMutation();
  const deleteMut = useDeleteCanvasSessionMutation();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const sessions = data?.sessions ?? [];

  const handleRename = useCallback(
    (id: string, name: string) => {
      renameMut.mutate(
        { id, name },
        {
          onSuccess: () => {
            toast.success(t("aiCanvas.sessionRenamed"));
            onSessionRenamed?.(id, name);
          },
        },
      );
    },
    [renameMut, toast, t, onSessionRenamed],
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteMut.mutate(id, {
        onSuccess: () => {
          toast.success(t("aiCanvas.sessionDeleted"));
          setDeleteTarget(null);
        },
      });
    },
    [deleteMut, toast, t],
  );

  if (!open) return null;

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay asChild>
          <DialogOverlay />
        </DialogPrimitive.Overlay>
        <DialogViewport>
          <DialogPrimitive.Content asChild>
            <DialogSurface
              size="lg"
              className="backdrop-blur-xl !bg-g-surface/80"
            >
              <DialogHeader className="gap-4 px-5 pb-2 pt-5">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <FolderOpen size={18} className="shrink-0 text-g-ink-2" />
                  <DialogPrimitive.Title asChild>
                    <DialogTitle>{t("aiCanvas.savedSessions")}</DialogTitle>
                  </DialogPrimitive.Title>
                </div>
                <DialogPrimitive.Close asChild>
                  <IconButton size="sm" aria-label="Close">
                    <X />
                  </IconButton>
                </DialogPrimitive.Close>
              </DialogHeader>

              <DialogBody padding="md" className="min-h-[300px]">
                {isLoading ? (
                  <div className="flex h-[200px] items-center justify-center text-g-ink-3">
                    Loading…
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="flex h-[200px] flex-col items-center justify-center gap-2 text-center">
                    <Layers
                      size={40}
                      strokeWidth={1.2}
                      className="text-g-ink-3"
                    />
                    <p className="font-g text-g-ui font-medium text-g-ink-2">
                      {t("aiCanvas.noSavedSessions")}
                    </p>
                    <p className="font-g text-[13px] text-g-ink-3">
                      {t("aiCanvas.noSavedSessionsDesc")}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {sessions.map((session) => (
                      <SessionCard
                        key={session.id}
                        session={session}
                        isCurrent={session.id === currentSessionId}
                        onLoad={() => onLoad(session.id)}
                        onRename={(name) => handleRename(session.id, name)}
                        onDelete={() => setDeleteTarget(session.id)}
                        t={t}
                      />
                    ))}
                  </div>
                )}
              </DialogBody>

              {deleteTarget && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-g-lg bg-[rgba(8,9,10,0.55)] backdrop-blur-md">
                  <div className="mx-6 flex w-full max-w-[380px] flex-col gap-4 rounded-g-lg border border-g-line-strong bg-g-surface/95 px-6 py-5 shadow-g-pop backdrop-blur-xl">
                    <p className="font-g text-[15px] leading-[1.5] text-g-ink">
                      {t("aiCanvas.sessionDeleteConfirm")}
                    </p>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setDeleteTarget(null)}
                      >
                        {t("common.cancel")}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleDelete(deleteTarget)}
                        disabled={deleteMut.isPending}
                      >
                        {t("aiCanvas.sessionDeleteAction")}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </DialogSurface>
          </DialogPrimitive.Content>
        </DialogViewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
