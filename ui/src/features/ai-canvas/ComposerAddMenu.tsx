import {
  Camera,
  Paperclip,
  Plus,
  ScanText,
  Trash2,
  WandSparkles,
} from "lucide-react";
import type { RefObject } from "react";
import type { TFunction } from "i18next";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { IconButton, Switch } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { ChatHistoryEntry } from "./aiCanvasState";
import type { MentionableImageCard } from "./aiCanvasTypes";

const composerIconClass =
  "rounded-full border-transparent bg-transparent text-white/52 hover:bg-white/[0.08] hover:text-white";

type ComposerAddMenuProps = {
  t: TFunction;
  handleAttachImage: () => void;
  handleExtractText: () => Promise<void> | void;
  handlePreparePhotoStaging: () => void;
  extractTextDisabled: boolean;
  extractTextTargetCount: number;
  isWorking: boolean;
  mentionableImageCards: MentionableImageCard[];
  promptInputRef: RefObject<HTMLTextAreaElement | null>;
  imageOptimizationAdvice: boolean;
  setImageOptimizationAdvice: (next: boolean) => void;
  chatHistory: ChatHistoryEntry[];
  clearChatHistory: () => void;
};

export function ComposerAddMenu({
  t,
  handleAttachImage,
  handleExtractText,
  handlePreparePhotoStaging,
  extractTextDisabled,
  extractTextTargetCount,
  isWorking,
  mentionableImageCards,
  promptInputRef,
  imageOptimizationAdvice,
  setImageOptimizationAdvice,
  chatHistory,
  clearChatHistory,
}: ComposerAddMenuProps) {
  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <IconButton
          size="md"
          aria-label={t("aiCanvas.addAttachment")}
          className={composerIconClass}
        >
          <Plus />
        </IconButton>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="start"
          sideOffset={10}
          className="z-[80] min-w-[220px] rounded-[18px] border border-white/[0.08] bg-[rgba(31,31,31,0.96)] p-2 shadow-g-pop backdrop-blur-xl animate-[modalIn_120ms_var(--g-ease-out)]"
        >
          <DropdownMenuPrimitive.Item
            onSelect={handleAttachImage}
            className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-[12px] px-3 py-1.5 font-g text-g-ui font-[510] text-white outline-none transition-colors duration-[120ms] ease-g data-[highlighted]:bg-white/[0.1]"
          >
            <Paperclip size={14} className="shrink-0 text-white/54" />
            <span>{t("aiCanvas.attachImage")}</span>
          </DropdownMenuPrimitive.Item>
          <DropdownMenuPrimitive.Item
            disabled={extractTextDisabled || isWorking}
            title={
              extractTextDisabled
                ? t("aiCanvas.extractTextDisabled")
                : undefined
            }
            onSelect={(event) => {
              if (extractTextDisabled || isWorking) {
                event.preventDefault();
                return;
              }
              void handleExtractText();
            }}
            className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-[12px] px-3 py-1.5 font-g text-g-ui font-[510] text-white outline-none transition-colors duration-[120ms] ease-g data-[disabled]:cursor-not-allowed data-[disabled]:opacity-[0.38] data-[highlighted]:bg-white/[0.1]"
          >
            <ScanText size={14} className="shrink-0 text-white/54" />
            <span className="min-w-0 flex-1">{t("aiCanvas.extractText")}</span>
            {extractTextTargetCount > 0 && (
              <span className="rounded-full bg-white/[0.08] px-1.5 py-0.5 font-g-mono text-[10px] text-white/50">
                {extractTextTargetCount}
              </span>
            )}
          </DropdownMenuPrimitive.Item>
          <DropdownMenuPrimitive.Item
            disabled={mentionableImageCards.length === 0 || isWorking}
            title={
              mentionableImageCards.length === 0
                ? t("aiCanvas.photoStageDisabled")
                : undefined
            }
            onSelect={(event) => {
              if (mentionableImageCards.length === 0 || isWorking) {
                event.preventDefault();
                return;
              }
              handlePreparePhotoStaging();
              window.requestAnimationFrame(() => {
                promptInputRef.current?.focus();
              });
            }}
            className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-[12px] px-3 py-1.5 font-g text-g-ui font-[510] text-white outline-none transition-colors duration-[120ms] ease-g data-[disabled]:cursor-not-allowed data-[disabled]:opacity-[0.38] data-[highlighted]:bg-white/[0.1]"
          >
            <Camera size={14} className="shrink-0 text-white/54" />
            <span className="min-w-0 flex-1">{t("aiCanvas.photoStage")}</span>
            {mentionableImageCards.length > 0 && (
              <span className="rounded-full bg-white/[0.08] px-1.5 py-0.5 font-g-mono text-[10px] text-white/50">
                {mentionableImageCards.length}
              </span>
            )}
          </DropdownMenuPrimitive.Item>
          <div
            className={cn(
              "flex min-h-12 items-center gap-3 rounded-[12px] px-3 py-2 font-g text-white outline-none transition-[background,box-shadow] duration-[120ms] ease-g",
              imageOptimizationAdvice
                ? "bg-[color-mix(in_srgb,var(--g-amber)_16%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--g-amber)_34%,transparent)] hover:bg-[color-mix(in_srgb,var(--g-amber)_22%,transparent)]"
                : "hover:bg-white/[0.06]",
            )}
          >
            <WandSparkles
              size={14}
              className={cn(
                "shrink-0",
                imageOptimizationAdvice ? "text-g-amber" : "text-white/54",
              )}
            />
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  "text-g-ui font-[510]",
                  imageOptimizationAdvice && "text-g-amber",
                )}
              >
                {t("aiCanvas.imageOptimizationAdvice")}
              </div>
              <div
                className={cn(
                  "mt-0.5 text-g-caption",
                  imageOptimizationAdvice ? "text-white/60" : "text-white/42",
                )}
              >
                {t("aiCanvas.imageOptimizationAdviceDesc")}
              </div>
            </div>
            <Switch
              checked={imageOptimizationAdvice}
              onCheckedChange={setImageOptimizationAdvice}
              aria-label={t("aiCanvas.imageOptimizationAdvice")}
              className="data-[state=checked]:!bg-[color-mix(in_srgb,var(--g-amber)_72%,var(--g-surface-3))]"
            />
          </div>
          <DropdownMenuPrimitive.Separator className="mx-2 my-2 h-px bg-white/[0.1]" />
          <DropdownMenuPrimitive.Item
            disabled={chatHistory.length === 0}
            onSelect={clearChatHistory}
            className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-[12px] px-3 py-1.5 font-g text-g-ui font-[510] text-white outline-none transition-colors duration-[120ms] ease-g data-[disabled]:cursor-not-allowed data-[disabled]:opacity-[0.38] data-[highlighted]:bg-white/[0.1]"
          >
            <Trash2 size={14} className="shrink-0 text-white/54" />
            <span>{t("aiCanvas.clearChat")}</span>
          </DropdownMenuPrimitive.Item>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
