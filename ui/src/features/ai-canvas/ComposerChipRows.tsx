import { X } from "lucide-react";
import type { TFunction } from "i18next";
import { AssetThumbnail } from "@/components/ui";
import type {
  ChatMentionPreview,
  PendingAttachment,
} from "./aiCanvasState";
import type { StateSetter } from "./aiCanvasTypes";

type ComposerChipRowsProps = {
  t: TFunction;
  mentionedImageCards: ChatMentionPreview[];
  setMentionedCardIds: StateSetter<string[]>;
  pendingAttachments: PendingAttachment[];
  setPendingAttachments: StateSetter<PendingAttachment[]>;
};

export function ComposerChipRows({
  t,
  mentionedImageCards,
  setMentionedCardIds,
  pendingAttachments,
  setPendingAttachments,
}: ComposerChipRowsProps) {
  return (
    <>
      {mentionedImageCards.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2 px-1">
          {mentionedImageCards.map((card) => (
            <span
              key={card.id}
              className="inline-flex max-w-[220px] items-center gap-2 rounded-[14px] border border-white/[0.08] bg-white/[0.07] py-1 pl-1 pr-1.5 text-white/78"
            >
              <AssetThumbnail
                src={card.src}
                size="sm"
                className="size-7 rounded-[10px] border-white/[0.1] bg-white/[0.06]"
                imageClassName="max-h-5 max-w-5"
                draggable={false}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-g-mono text-g-chip font-[510] tracking-g-mono">
                  @{card.name}
                </span>
                <span className="block truncate text-[9px] leading-3 text-white/38">
                  {card.meta}
                </span>
              </span>
              <button
                type="button"
                aria-label={t("aiCanvas.removeMention")}
                className="grid size-5 shrink-0 place-items-center rounded-full text-white/42 transition-colors duration-[120ms] ease-g hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:shadow-g-focus"
                onClick={() =>
                  setMentionedCardIds((current) =>
                    current.filter((id) => id !== card.id),
                  )
                }
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {pendingAttachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2 px-1">
          {pendingAttachments.map((att) => (
            <span
              key={att.id}
              className="relative inline-flex flex-col items-center rounded-[14px] border border-white/[0.08] bg-white/[0.07] p-1"
            >
              <img
                src={att.thumbnailDataUrl}
                alt={att.fileName}
                className="max-h-20 max-w-[120px] rounded-[10px] object-contain"
                draggable={false}
              />
              <span className="mt-0.5 max-w-[120px] truncate px-1 text-[10px] text-white/58">
                {att.fileName}
              </span>
              <button
                type="button"
                aria-label={t("aiCanvas.removeAttachment")}
                className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-white/[0.12] text-white/60 hover:bg-white/[0.2] hover:text-white"
                onClick={() =>
                  setPendingAttachments((prev) =>
                    prev.filter((a) => a.id !== att.id),
                  )
                }
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </>
  );
}
