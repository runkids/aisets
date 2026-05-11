import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { AssetItem } from "../../types";
import { useAssetTagsMutation } from "../../tagsQueries";
import { errorMessage } from "../../i18n";
import { Badge } from "../ui";
import { TagPickerInput } from "./TagPickerInput";
import { useToast } from "../shared/ToastProvider";

type Props = {
  asset: AssetItem;
  triggerRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
};

export function TagPickerPopover({ asset, triggerRef, onClose }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 280,
  });

  const currentTags = asset.aiTag?.tags ?? [];
  const mutation = useAssetTagsMutation();

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const popoverHeight = 300;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top =
      spaceBelow > popoverHeight
        ? rect.bottom + 4
        : rect.top - popoverHeight - 4;
    setPos({
      top: Math.max(4, top),
      left: Math.max(4, Math.min(rect.left, window.innerWidth - 288)),
      width: Math.max(280, rect.width),
    });
  }, [triggerRef]);

  useEffect(() => {
    updatePosition();
    let raf = 0;
    const throttled = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        updatePosition();
      });
    };
    window.addEventListener("scroll", throttled, { capture: true });
    window.addEventListener("resize", throttled);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", throttled, { capture: true });
      window.removeEventListener("resize", throttled);
    };
  }, [updatePosition]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose, triggerRef]);

  function setTags(newTags: string[]) {
    mutation.mutate(
      {
        projectId: asset.projectId,
        repoPath: asset.repoPath,
        contentHash: asset.contentHash,
        hashAlgorithm: asset.hashAlgorithm,
        tags: newTags,
      },
      {
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  }

  function handleAdd(tag: string) {
    if (!currentTags.includes(tag)) {
      setTags([...currentTags, tag]);
    }
  }

  function handleRemove(tag: string) {
    setTags(currentTags.filter((t) => t !== tag));
  }

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-[1000] flex flex-col gap-2 rounded-g-md border border-g-line bg-g-surface p-3 shadow-g-popover"
      style={{
        top: pos.top,
        left: pos.left,
        width: pos.width,
      }}
    >
      {currentTags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {currentTags.map((tag) => (
            <Badge key={tag} tone="line" className="gap-1 pr-1 text-g-ink-2">
              {tag}
              <button
                type="button"
                className="inline-flex items-center justify-center size-3.5 rounded-full hover:bg-g-surface-3 transition-colors cursor-pointer"
                onClick={() => handleRemove(tag)}
                aria-label={`${t("tags.removeTag")} ${tag}`}
              >
                <X size={9} />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <TagPickerInput existingTags={currentTags} onAdd={handleAdd} autoFocus />
    </div>,
    document.body,
  );
}
