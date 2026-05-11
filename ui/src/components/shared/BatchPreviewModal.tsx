import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  FileText,
} from "lucide-react";
import { useState } from "react";
import { Modal } from "../ui/Modal";

export type BatchMoveEntry = { from: string; to: string };
export type BatchChange = {
  file: string;
  line: number;
  oldSpecifier: string;
  newSpecifier: string;
};
export type BatchBlocker = {
  file: string;
  line: number;
  code: string;
  reason: string;
};

type Props = {
  title: string;
  moves: BatchMoveEntry[];
  changes: BatchChange[];
  blockers: BatchBlocker[];
  canApply: boolean;
  working: boolean;
  onCancel: () => void;
  onApply: () => void;
};

export function BatchPreviewModal({
  title,
  moves: rawMoves,
  changes: rawChanges,
  blockers: rawBlockers,
  canApply,
  working,
  onCancel,
  onApply,
}: Props) {
  const moves = rawMoves ?? [];
  const changes = rawChanges ?? [];
  const blockers = rawBlockers ?? [];
  const { t } = useTranslation();
  const [showRefs, setShowRefs] = useState(false);

  return (
    <Modal
      title={title}
      onClose={onCancel}
      size="lg"
      footer={
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-g-ink-3">
            {t("batch.previewSummary", {
              moves: moves.length,
              refs: changes.length,
            })}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-g-md px-3 text-[13px] font-[510] text-g-ink-2 hover:bg-g-surface-2"
              onClick={onCancel}
              disabled={working}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-g-md bg-g-accent px-3 text-[13px] font-[510] text-g-canvas hover:brightness-[1.08] disabled:opacity-50"
              onClick={onApply}
              disabled={!canApply || working}
            >
              {t("preview.apply")}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {blockers.length > 0 && (
          <div className="rounded-g-md border border-g-yellow/30 bg-g-yellow/10 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[13px] font-[510] text-g-yellow">
              <AlertTriangle size={14} />
              {t("batch.blockersTitle", { count: blockers.length })}
            </div>
            <ul className="space-y-1 text-[12px] font-g-mono text-g-ink-2">
              {blockers.map((b, i) => (
                <li key={i}>
                  {b.file}:{b.line} — {b.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <h3 className="mb-2 text-[13px] font-[510] text-g-ink">
            {t("batch.fileChanges", { count: moves.length })}
          </h3>
          <div className="max-h-[200px] overflow-auto rounded-g-md border border-g-line bg-g-surface p-2 scroll-thin">
            {moves.map((m, i) => (
              <div
                key={i}
                className="flex items-center gap-2 py-1 font-g-mono text-[12px]"
              >
                <span className="text-g-ink-3 truncate">{m.from}</span>
                <ArrowRight size={12} className="shrink-0 text-g-ink-3" />
                <span className="text-g-ink truncate">{m.to}</span>
              </div>
            ))}
          </div>
        </div>

        {changes.length > 0 && (
          <div>
            <button
              type="button"
              className="mb-2 flex items-center gap-1 text-[13px] font-[510] text-g-ink-2 hover:text-g-ink"
              onClick={() => setShowRefs(!showRefs)}
            >
              {showRefs ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
              <FileText size={13} />
              {t("batch.refChanges", { count: changes.length })}
            </button>
            {showRefs && (
              <div className="max-h-[160px] overflow-auto rounded-g-md border border-g-line bg-g-surface p-2 scroll-thin">
                {changes.map((c, i) => (
                  <div key={i} className="py-0.5 font-g-mono text-[11px]">
                    <span className="text-g-ink-3">
                      {c.file}:{c.line}
                    </span>{" "}
                    <span className="text-g-red line-through">
                      {c.oldSpecifier}
                    </span>{" "}
                    → <span className="text-g-green">{c.newSpecifier}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
