import {
  ArrowUp,
  AtSign,
  Check,
  CheckCircle2,
  ChevronDown,
  LoaderCircle,
  MessageCircle,
  Layers,
  Paperclip,
  Plus,
  ScanText,
  Square,
  Trash2,
  WandSparkles,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { TFunction } from "i18next";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import {
  AssetThumbnail,
  Badge,
  Button,
  CopyButton,
  IconButton,
  Switch,
  Tooltip,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  type ChatAttachment,
  type ChatActivityEntry,
  type ChatHistoryEntry,
  type PendingAttachment,
  type ProposalCanvasCard,
  type ChatRunUsage,
} from "./aiCanvasState";
import {
  AICanvasActivityPanel,
  AICanvasRunUsageChips,
} from "./AICanvasActivityPanel";
import {
  canvasUserPromptHistory,
  navigateCanvasPromptHistory,
  type CanvasPromptHistoryState,
} from "./canvasPromptHistory";
import { renderMarkdown } from "./canvasUtils";
import { proposalToolLabel } from "./proposalLabels";
import type {
  AIBackendOption,
  MentionableImageCard,
  StateSetter,
} from "./aiCanvasTypes";

const composerActionClass =
  "border-white/[0.08] bg-white/[0.07] text-white/72 hover:bg-white/[0.12] hover:text-white";
const composerIconClass =
  "rounded-full border-transparent bg-transparent text-white/52 hover:bg-white/[0.08] hover:text-white";
const composerConfirmClass =
  "border-white/80 bg-white text-black hover:bg-white/90";

type GroupedBackendOptions = Array<{
  group: string;
  options: AIBackendOption[];
}>;

type AICanvasComposerProps = {
  t: TFunction;
  collapsed: boolean;
  setCollapsed: StateSetter<boolean>;
  height: number;
  setHeight: StateSetter<number>;
  isWorking: boolean;
  composerStatusLabel: string;
  composerStatusText: string;
  elapsedLabel?: string | null;
  activeChatActivity?: ChatActivityEntry[];
  activeChatUsage?: ChatRunUsage;
  activeElapsedMs?: number;
  currentTargets?: MentionableImageCard[];
  latestChatContent: string;
  chatHistory: ChatHistoryEntry[];
  composerToolsOpen: boolean;
  composerAdvancedOpen: boolean;
  imageOptimizationAdvice: boolean;
  setImageOptimizationAdvice: StateSetter<boolean>;
  mentionMenuOpen: boolean;
  setMentionMenuOpen: StateSetter<boolean>;
  mentionSelectedAsset: () => void;
  handleAttachImage: () => void;
  handleExtractText: () => void | Promise<void>;
  extractTextTargetCount: number;
  extractTextDisabled: boolean;
  commentMode: boolean;
  setCommentMode: StateSetter<boolean>;
  addAssistantCard: (promptText: string, message?: string) => void;
  selectedProposal?: ProposalCanvasCard;
  pendingProposals: ProposalCanvasCard[];
  handleRejectProposal: (proposal: ProposalCanvasCard) => void;
  handleApproveProposal: (proposal: ProposalCanvasCard) => void;
  mentionedImageCards: MentionableImageCard[];
  setMentionedCardIds: StateSetter<string[]>;
  mentionableImageCards: MentionableImageCard[];
  mentionedCardIds: string[];
  mentionImageCard: (cardId: string) => void;
  mentionAllImageCards: () => void;
  prompt: string;
  setPrompt: StateSetter<string>;
  handleAsk: () => void | Promise<void>;
  handleStop: () => void;
  aiBackendLabel?: string;
  aiBackendValue?: string;
  aiBackendOptions: AIBackendOption[];
  aiBackendPending?: boolean;
  onAiBackendChange?: (value: string) => void;
  groupedBackendOptions: GroupedBackendOptions;
  clearChatHistory: () => void;
  pendingAttachments: PendingAttachment[];
  setPendingAttachments: StateSetter<PendingAttachment[]>;
  handlePlaceOnCanvas: (att: ChatAttachment) => void;
};

export function AICanvasComposer({
  t,
  collapsed,
  setCollapsed,
  height,
  setHeight,
  isWorking,
  composerStatusLabel,
  composerStatusText,
  elapsedLabel,
  activeChatActivity = [],
  activeChatUsage,
  activeElapsedMs,
  currentTargets = [],
  latestChatContent,
  chatHistory,
  composerToolsOpen,
  composerAdvancedOpen,
  imageOptimizationAdvice,
  setImageOptimizationAdvice,
  mentionMenuOpen,
  setMentionMenuOpen,
  mentionSelectedAsset,
  handleAttachImage,
  handleExtractText,
  extractTextTargetCount,
  extractTextDisabled,
  commentMode,
  setCommentMode,
  addAssistantCard,
  selectedProposal,
  pendingProposals,
  handleRejectProposal,
  handleApproveProposal,
  mentionedImageCards,
  setMentionedCardIds,
  mentionableImageCards,
  mentionedCardIds,
  mentionImageCard,
  mentionAllImageCards,
  prompt,
  setPrompt,
  handleAsk,
  handleStop,
  aiBackendLabel,
  aiBackendValue,
  aiBackendOptions,
  aiBackendPending,
  onAiBackendChange,
  groupedBackendOptions,
  clearChatHistory,
  pendingAttachments,
  setPendingAttachments,
  handlePlaceOnCanvas,
}: AICanvasComposerProps) {
  const composerDragRef = useRef<{ startY: number; startH: number } | null>(
    null,
  );
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const promptHistoryNavigationRef = useRef<CanvasPromptHistoryState>({
    index: null,
    draft: "",
  });
  const userPromptHistory = useMemo(
    () => canvasUserPromptHistory(chatHistory),
    [chatHistory],
  );

  const currentTargetPreview = currentTargets.find((target) => target.src);
  const currentTargetText =
    currentTargets.length === 0
      ? t("aiCanvas.noCurrentTarget")
      : currentTargets.length === 1
        ? currentTargets[0].name
        : t("aiCanvas.currentTargetCount", { count: currentTargets.length });
  const currentTargetTitle = currentTargets
    .map((target) => target.name)
    .join("\n");

  useEffect(() => {
    if (collapsed) return undefined;
    const el = chatScrollRef.current;
    if (!el) return undefined;
    const frame = window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeChatActivity.length,
    chatHistory.length,
    collapsed,
    height,
    isWorking,
    latestChatContent,
  ]);

  useEffect(() => {
    promptHistoryNavigationRef.current = { index: null, draft: "" };
  }, [chatHistory.length]);

  function movePromptCursorToEnd() {
    window.requestAnimationFrame(() => {
      const el = promptInputRef.current;
      if (!el) return;
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
  }

  return (
    <div
      data-ai-canvas-overlay="true"
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-[60] mx-auto max-w-[900px] px-4 pb-3 text-white max-[760px]:px-2 max-[760px]:pb-2"
      style={{ height: collapsed ? 112 : height }}
    >
      <div className="relative h-full">
        {!collapsed && (
          <div
            className="absolute inset-x-7 bottom-[52px] overflow-hidden border border-[rgba(255,255,255,0.08)] bg-[rgba(28,28,28,0.78)] shadow-g-pop backdrop-blur-xl max-[760px]:inset-x-2 rounded-t-[24px] rounded-b-none border-b-0"
            style={{ height: height - 72 }}
          >
            <div
              className="flex h-3 cursor-ns-resize items-center justify-center"
              onPointerDown={(e) => {
                e.preventDefault();
                composerDragRef.current = {
                  startY: e.clientY,
                  startH: height,
                };
                const onMove = (ev: PointerEvent) => {
                  if (!composerDragRef.current) return;
                  const delta = composerDragRef.current.startY - ev.clientY;
                  const next = Math.min(
                    Math.max(composerDragRef.current.startH + delta, 200),
                    window.innerHeight * 0.75,
                  );
                  setHeight(next);
                };
                const onUp = () => {
                  composerDragRef.current = null;
                  document.removeEventListener("pointermove", onMove);
                  document.removeEventListener("pointerup", onUp);
                };
                document.addEventListener("pointermove", onMove);
                document.addEventListener("pointerup", onUp);
              }}
            >
              <div className="h-[3px] w-8 rounded-full bg-white/20" />
            </div>
            <button
              type="button"
              aria-label={t("aiCanvas.resizeComposer")}
              className="flex h-12 w-full shrink-0 items-center gap-3 px-5 text-left text-g-body leading-none text-white/62 transition-colors duration-[120ms] ease-g hover:bg-white/[0.04] hover:text-white focus-visible:outline-none focus-visible:shadow-g-focus"
              onClick={() => setCollapsed((current) => !current)}
            >
              {isWorking && (
                <LoaderCircle
                  size={14}
                  className="shrink-0 animate-spin text-white/54"
                />
              )}
              <span className="shrink-0 font-[590] text-white/68">
                {composerStatusLabel}
              </span>
              {currentTargets.length > 0 && (
                <span
                  className="inline-flex h-8 max-w-[280px] shrink-0 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.06] px-2 text-g-caption font-[510] leading-none text-white/74"
                  title={currentTargetTitle || undefined}
                >
                  {currentTargetPreview?.src && (
                    <AssetThumbnail
                      src={currentTargetPreview.src}
                      size="sm"
                      className="size-6 rounded-[8px] border-white/[0.1] bg-white/[0.06]"
                      imageClassName="max-h-5 max-w-5"
                      draggable={false}
                    />
                  )}
                  <span className="shrink-0 text-white/42">
                    {t("aiCanvas.currentTarget")}
                  </span>
                  <span className="min-w-0 truncate">{currentTargetText}</span>
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-white/58">
                {composerStatusText}
              </span>
              {elapsedLabel && (
                <span className="shrink-0 text-g-caption text-white/38">
                  {elapsedLabel}
                </span>
              )}
              <ChevronDown
                size={17}
                className="shrink-0 rotate-180 text-white/42 transition-transform duration-[160ms] ease-g"
                aria-hidden="true"
              />
            </button>
            <div
              ref={chatScrollRef}
              data-ai-canvas-scroll="true"
              className="flex h-[calc(100%-48px)] flex-col gap-2 overflow-y-auto px-5 pb-16"
            >
              {chatHistory.length === 0 ? (
                <div className="py-4 text-center text-g-caption text-white/30">
                  {t("aiCanvas.emptyDesc")}
                </div>
              ) : (
                chatHistory.map((entry, i) => {
                  const isUser = entry.role === "user";
                  return (
                    <article
                      key={i}
                      className={cn(
                        "w-[calc(100%-48px)] rounded-g-md border px-3 py-2 text-g-body leading-[1.45] text-white/84 max-[760px]:w-[calc(100%-20px)]",
                        isUser
                          ? "self-end rounded-br-g-sm border-white/[0.12] bg-white/[0.13]"
                          : "self-start rounded-bl-g-sm border-white/[0.06] bg-white/[0.06]",
                      )}
                    >
                      {entry.mentions && entry.mentions.length > 0 && (
                        <div className="mb-1.5 flex flex-wrap gap-1.5">
                          {entry.mentions.map((mention) => (
                            <span
                              key={mention.id}
                              className="inline-flex max-w-[190px] items-center gap-1.5 rounded-[10px] border border-white/[0.08] bg-black/[0.16] py-0.5 pl-0.5 pr-1.5"
                            >
                              <AssetThumbnail
                                src={mention.src}
                                size="sm"
                                className="size-6 rounded-[8px] border-white/[0.1] bg-white/[0.06]"
                                imageClassName="max-h-4 max-w-4"
                                draggable={false}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-g-mono text-g-chip font-[510] tracking-g-mono text-white/86">
                                  @{mention.name}
                                </span>
                                <span className="block truncate text-[9px] leading-3 text-white/38">
                                  {mention.meta}
                                </span>
                              </span>
                            </span>
                          ))}
                        </div>
                      )}
                      {entry.attachments && entry.attachments.length > 0 && (
                        <div className="mb-1.5 flex flex-wrap gap-2">
                          {entry.attachments.map((att, attIdx) => (
                            <div
                              key={att.token || attIdx}
                              className="rounded-[12px] border border-white/[0.08] bg-black/[0.16] p-1"
                            >
                              <img
                                src={att.thumbnailDataUrl}
                                alt={att.fileName}
                                className="max-h-32 max-w-[200px] rounded-[10px] object-contain"
                                draggable={false}
                              />
                              <div className="mt-1 flex items-center gap-1 px-0.5">
                                <span className="min-w-0 flex-1 truncate text-[10px] text-white/50">
                                  {att.fileName}
                                </span>
                                {isUser && (
                                  <button
                                    type="button"
                                    className="inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-[510] text-white/60 transition-colors hover:bg-white/[0.1] hover:text-white"
                                    onClick={() => handlePlaceOnCanvas(att)}
                                  >
                                    <Layers size={10} />
                                    {t("aiCanvas.placeOnCanvas")}
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {!isUser && entry.activity?.length && (
                        <AICanvasActivityPanel
                          t={t}
                          activity={entry.activity}
                          usage={entry.usage}
                          className={entry.content ? "mb-2" : undefined}
                        />
                      )}
                      {entry.content && (
                        <div className="whitespace-pre-wrap">
                          {renderMarkdown(entry.content)}
                        </div>
                      )}
                      {(entry.content || (!isUser && entry.usage)) && (
                        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-white/[0.05] pt-2 text-white/38">
                          {entry.content && (
                            <CopyButton
                              value={entry.content}
                              label={t("aiCanvas.copyMessage")}
                              className="size-6 text-white/42 hover:bg-white/[0.08] hover:text-white"
                            />
                          )}
                          {!isUser && entry.usage && (
                            <AICanvasRunUsageChips
                              t={t}
                              usage={entry.usage}
                              className="ml-auto justify-end"
                            />
                          )}
                        </div>
                      )}
                    </article>
                  );
                })
              )}
              {isWorking && activeChatActivity.length > 0 ? (
                <div className="w-[calc(100%-48px)] self-start max-[760px]:w-[calc(100%-20px)]">
                  <AICanvasActivityPanel
                    t={t}
                    activity={activeChatActivity}
                    usage={activeChatUsage}
                    elapsedMs={activeElapsedMs}
                    live
                    defaultOpen
                  />
                </div>
              ) : isWorking ? (
                <div className="flex items-center gap-2 self-start rounded-g-md border border-white/[0.06] bg-white/[0.07] px-3 py-2 text-g-caption text-white/56">
                  <LoaderCircle size={12} className="animate-spin" />
                  {t("aiCanvas.statusProcessingDetail")}
                </div>
              ) : null}
            </div>
          </div>
        )}

        {collapsed && (
          <button
            type="button"
            aria-label={t("aiCanvas.resizeComposer")}
            className="absolute inset-x-7 bottom-[52px] flex h-12 items-center gap-3 rounded-t-[24px] border border-b-0 border-[rgba(255,255,255,0.08)] bg-[rgba(28,28,28,0.78)] px-5 text-left text-g-body leading-none text-white/62 shadow-g-pop backdrop-blur-xl transition-colors duration-[120ms] ease-g hover:bg-[rgba(38,38,38,0.84)] hover:text-white focus-visible:outline-none focus-visible:shadow-g-focus max-[760px]:inset-x-2"
            onClick={() => setCollapsed(false)}
          >
            {isWorking && (
              <LoaderCircle
                size={14}
                className="shrink-0 animate-spin text-white/54"
              />
            )}
            <span className="shrink-0 font-[590] text-white/68">
              {composerStatusLabel}
            </span>
            <span className="min-w-0 flex-1 truncate text-white/58">
              {composerStatusText}
            </span>
            {elapsedLabel && (
              <span className="shrink-0 text-g-caption text-white/38">
                {elapsedLabel}
              </span>
            )}
            <ChevronDown
              size={17}
              className="shrink-0 text-white/42 transition-transform duration-[160ms] ease-g"
              aria-hidden="true"
            />
          </button>
        )}

        <div className="absolute inset-x-0 bottom-0 rounded-[28px] border border-[rgba(255,255,255,0.08)] bg-[rgba(31,31,31,0.96)] px-2.5 py-2 shadow-g-pop backdrop-blur-xl">
          {composerToolsOpen && (
            <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-white/[0.06] pb-3 text-g-caption text-white/58">
              {composerAdvancedOpen && (
                <>
                  <Button
                    size="sm"
                    variant="chip"
                    leadingIcon={<AtSign />}
                    className={composerActionClass}
                    onClick={mentionSelectedAsset}
                  >
                    {t("aiCanvas.mentionAsset")}
                  </Button>
                  <Button
                    size="sm"
                    variant="chip"
                    leadingIcon={<Paperclip />}
                    className={composerActionClass}
                    onClick={handleAttachImage}
                  >
                    {t("aiCanvas.attachImage")}
                  </Button>
                  <Button
                    size="sm"
                    variant="chip"
                    leadingIcon={<CheckCircle2 />}
                    className={composerActionClass}
                    onClick={() =>
                      addAssistantCard(t("aiCanvas.describePrompt"))
                    }
                  >
                    {t("aiCanvas.describe")}
                  </Button>
                  <Badge tone={imageOptimizationAdvice ? "amber" : "line"}>
                    {imageOptimizationAdvice
                      ? t("aiCanvas.imageOptimizationAdviceShort")
                      : t("aiCanvas.autoReview")}
                  </Badge>
                  <Badge tone="line">{t("aiCanvas.modelHigh")}</Badge>
                </>
              )}
            </div>
          )}
          {(selectedProposal?.status === "pending" ||
            pendingProposals.length > 0) && (
            <div className="mb-2 flex items-center gap-2 border-b border-white/[0.06] px-3 pb-2">
              {selectedProposal?.status === "pending" ? (
                <>
                  <Badge tone="amber">
                    {proposalToolLabel(t, selectedProposal.tool)}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-g-caption text-white/70">
                    {t("aiCanvas.pending")}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="border-white/[0.08] text-white/58 hover:bg-white/[0.08] hover:text-white"
                    leadingIcon={<XCircle />}
                    onClick={() => handleRejectProposal(selectedProposal)}
                  >
                    {t("aiCanvas.reject")}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    leadingIcon={<Check />}
                    className={composerConfirmClass}
                    onClick={() => handleApproveProposal(selectedProposal)}
                  >
                    {t("aiCanvas.approve")}
                  </Button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 text-g-caption text-white/50">
                    {t("aiCanvas.pendingProposals", {
                      count: pendingProposals.length,
                    })}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="border-white/[0.08] text-white/58 hover:bg-white/[0.08] hover:text-white"
                    onClick={() => {
                      for (const p of pendingProposals) handleRejectProposal(p);
                    }}
                  >
                    {t("aiCanvas.rejectAll")}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    className={composerConfirmClass}
                    onClick={() => {
                      for (const p of pendingProposals)
                        handleApproveProposal(p);
                    }}
                  >
                    {t("aiCanvas.approveAll")}
                  </Button>
                </>
              )}
            </div>
          )}
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
          <div className="flex min-h-10 items-center gap-2 pl-1 pr-0.5">
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
                    <span className="min-w-0 flex-1">
                      {t("aiCanvas.extractText")}
                    </span>
                    {extractTextTargetCount > 0 && (
                      <span className="rounded-full bg-white/[0.08] px-1.5 py-0.5 font-g-mono text-[10px] text-white/50">
                        {extractTextTargetCount}
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
                        imageOptimizationAdvice
                          ? "text-g-amber"
                          : "text-white/54",
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
                          imageOptimizationAdvice
                            ? "text-white/60"
                            : "text-white/42",
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
            <IconButton
              size="sm"
              aria-label={t("aiCanvas.attachImage")}
              className={composerIconClass}
              onClick={handleAttachImage}
            >
              <Paperclip />
            </IconButton>
            <Tooltip
              label={t("aiCanvas.commentMode")}
              shortcut="Shift C"
              placement="top"
            >
              <IconButton
                size="sm"
                aria-label={t("aiCanvas.commentMode")}
                aria-keyshortcuts="Shift+C"
                className={cn(
                  composerIconClass,
                  commentMode && "!bg-white/[0.15] !text-white",
                )}
                onClick={() => setCommentMode((v) => !v)}
              >
                <MessageCircle />
              </IconButton>
            </Tooltip>
            <DropdownMenuPrimitive.Root
              open={mentionMenuOpen}
              onOpenChange={setMentionMenuOpen}
            >
              <DropdownMenuPrimitive.Trigger asChild>
                <span>
                  <Tooltip
                    label={t("aiCanvas.mentionAsset")}
                    shortcut="Shift @"
                    placement="top"
                  >
                    <IconButton
                      size="sm"
                      aria-label={t("aiCanvas.mentionAsset")}
                      aria-keyshortcuts="Shift+@"
                      className={composerIconClass}
                    >
                      <AtSign />
                    </IconButton>
                  </Tooltip>
                </span>
              </DropdownMenuPrimitive.Trigger>
              <DropdownMenuPrimitive.Portal>
                <DropdownMenuPrimitive.Content
                  align="start"
                  sideOffset={10}
                  className="z-[80] min-w-[280px] max-w-[360px] rounded-[18px] border border-white/[0.08] bg-[rgba(31,31,31,0.96)] p-2 shadow-g-pop backdrop-blur-xl animate-[modalIn_120ms_var(--g-ease-out)]"
                >
                  <DropdownMenuPrimitive.Label className="px-3 py-1.5 font-g text-g-caption font-[510] tracking-g-ui text-white/38">
                    {t("aiCanvas.mentionCanvasImage")}
                  </DropdownMenuPrimitive.Label>
                  {mentionableImageCards.length === 0 ? (
                    <div className="px-3 py-2 text-g-caption text-white/42">
                      {t("aiCanvas.noMentionImages")}
                    </div>
                  ) : (
                    <>
                      {mentionableImageCards.length > 1 && (
                        <DropdownMenuPrimitive.Item
                          onSelect={(event) => {
                            event.preventDefault();
                            mentionAllImageCards();
                          }}
                          className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[12px] px-2 py-1.5 font-g text-white outline-none transition-colors duration-[120ms] ease-g data-[highlighted]:bg-white/[0.1]"
                        >
                          <span className="flex size-8 items-center justify-center rounded-[10px] border border-white/[0.1] bg-white/[0.06] text-g-caption text-white/60">
                            {mentionableImageCards.length}
                          </span>
                          <span className="font-g-mono text-g-caption font-[510] tracking-g-mono text-white/86">
                            {t("common.all")}
                          </span>
                          {mentionableImageCards.every((c) =>
                            mentionedCardIds.includes(c.id),
                          ) && (
                            <Check
                              size={14}
                              className="ml-auto shrink-0 text-white"
                            />
                          )}
                        </DropdownMenuPrimitive.Item>
                      )}
                      <div
                        className="max-h-[320px] overflow-y-auto"
                        data-ai-canvas-scroll="true"
                      >
                        {mentionableImageCards.map((card) => (
                          <DropdownMenuPrimitive.Item
                            key={card.id}
                            onSelect={(event) => {
                              event.preventDefault();
                              mentionImageCard(card.id);
                            }}
                            className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[12px] px-2 py-1.5 font-g text-white outline-none transition-colors duration-[120ms] ease-g data-[highlighted]:bg-white/[0.1]"
                          >
                            <AssetThumbnail
                              src={card.src}
                              size="sm"
                              className="size-8 rounded-[10px] border-white/[0.1] bg-white/[0.06]"
                              imageClassName="max-h-6 max-w-6"
                              draggable={false}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-g-mono text-g-caption font-[510] tracking-g-mono text-white/86">
                                {card.name}
                              </span>
                              <span className="block truncate text-g-chip text-white/42">
                                {card.meta}
                              </span>
                            </span>
                            {mentionedCardIds.includes(card.id) && (
                              <Check
                                size={14}
                                className="shrink-0 text-white"
                              />
                            )}
                          </DropdownMenuPrimitive.Item>
                        ))}
                      </div>
                    </>
                  )}
                </DropdownMenuPrimitive.Content>
              </DropdownMenuPrimitive.Portal>
            </DropdownMenuPrimitive.Root>
            <textarea
              ref={promptInputRef}
              value={prompt}
              placeholder={t("aiCanvas.composerPlaceholder")}
              className="max-h-20 min-h-5 flex-1 resize-none border-0 bg-transparent py-0 font-g-mono text-g-body leading-5 text-white outline-none placeholder:text-white/35"
              rows={1}
              onChange={(event) => {
                promptHistoryNavigationRef.current = {
                  index: null,
                  draft: event.target.value,
                };
                setPrompt(event.target.value);
              }}
              onKeyDown={(event) => {
                if (
                  (event.key === "ArrowUp" || event.key === "ArrowDown") &&
                  !event.shiftKey &&
                  !event.altKey &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.nativeEvent.isComposing
                ) {
                  const browsingHistory =
                    promptHistoryNavigationRef.current.index !== null;
                  const isMultiline = event.currentTarget.value.includes("\n");
                  const caretAtStart =
                    event.currentTarget.selectionStart === 0 &&
                    event.currentTarget.selectionEnd === 0;
                  const caretAtEnd =
                    event.currentTarget.selectionStart ===
                      event.currentTarget.value.length &&
                    event.currentTarget.selectionEnd ===
                      event.currentTarget.value.length;
                  const shouldNavigateHistory =
                    event.key === "ArrowUp"
                      ? browsingHistory || !isMultiline || caretAtStart
                      : browsingHistory && (!isMultiline || caretAtEnd);

                  if (shouldNavigateHistory) {
                    const next = navigateCanvasPromptHistory(
                      userPromptHistory,
                      event.key === "ArrowUp" ? "previous" : "next",
                      promptHistoryNavigationRef.current,
                      event.currentTarget.value,
                    );
                    if (next) {
                      event.preventDefault();
                      promptHistoryNavigationRef.current = next.state;
                      setPrompt(next.prompt);
                      movePromptCursorToEnd();
                      return;
                    }
                  }
                }

                if (event.key === "@" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  setMentionMenuOpen(true);
                  return;
                }
                if (
                  event.key === "C" &&
                  event.shiftKey &&
                  !event.altKey &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  setCommentMode((v) => !v);
                  return;
                }
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  if (!isWorking) void handleAsk();
                }
              }}
            />
            {aiBackendLabel && (
              <DropdownMenuPrimitive.Root>
                <DropdownMenuPrimitive.Trigger asChild>
                  <button
                    type="button"
                    disabled={
                      aiBackendPending ||
                      !onAiBackendChange ||
                      aiBackendOptions.length === 0
                    }
                    className="flex h-7 max-w-[220px] shrink-0 items-center gap-1.5 truncate rounded-full px-2 font-g text-g-caption font-[510] tracking-g-ui text-white/72 transition-colors duration-[120ms] ease-g hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:shadow-g-focus disabled:cursor-default disabled:opacity-60"
                  >
                    <span className="truncate">{aiBackendLabel}</span>
                    <ChevronDown
                      size={14}
                      className="shrink-0 text-white/42"
                      aria-hidden="true"
                    />
                  </button>
                </DropdownMenuPrimitive.Trigger>
                <DropdownMenuPrimitive.Portal>
                  <DropdownMenuPrimitive.Content
                    align="end"
                    sideOffset={10}
                    className="z-[80] min-w-[240px] max-w-[360px] overflow-auto rounded-[18px] border border-white/[0.08] bg-[rgba(42,42,42,0.98)] p-3 shadow-g-pop backdrop-blur-xl animate-[modalIn_120ms_var(--g-ease-out)]"
                    style={{ maxHeight: 320 }}
                  >
                    {groupedBackendOptions.map((group, groupIndex) => (
                      <DropdownMenuPrimitive.Group key={group.group}>
                        {groupIndex > 0 && (
                          <DropdownMenuPrimitive.Separator className="mx-2 my-2 h-px bg-white/[0.12]" />
                        )}
                        <DropdownMenuPrimitive.Label className="px-3 py-1 font-g text-g-caption font-[510] tracking-g-ui text-white/38">
                          {group.group}
                        </DropdownMenuPrimitive.Label>
                        {group.options.map((option) => {
                          const selected = option.value === aiBackendValue;
                          return (
                            <DropdownMenuPrimitive.Item
                              key={option.value}
                              disabled={option.disabled || aiBackendPending}
                              onSelect={() => onAiBackendChange?.(option.value)}
                              className={cn(
                                "flex min-h-9 cursor-pointer items-center gap-2.5 rounded-[14px] px-3 py-1.5 font-g text-g-ui font-[510] leading-[1.35] text-white outline-none transition-[background,color,box-shadow] duration-[120ms] ease-g data-[disabled]:cursor-not-allowed data-[disabled]:opacity-[0.38] data-[highlighted]:bg-white/[0.1]",
                                selected && "bg-white/[0.13]",
                              )}
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {option.label}
                              </span>
                              <span className="grid size-4 shrink-0 place-items-center text-white">
                                {selected && <Check size={15} />}
                              </span>
                            </DropdownMenuPrimitive.Item>
                          );
                        })}
                      </DropdownMenuPrimitive.Group>
                    ))}
                  </DropdownMenuPrimitive.Content>
                </DropdownMenuPrimitive.Portal>
              </DropdownMenuPrimitive.Root>
            )}
            {isWorking ? (
              <button
                type="button"
                aria-label={t("aiCanvas.stopChat")}
                className="grid size-10 shrink-0 place-items-center rounded-full border border-white/70 bg-white/[0.92] text-black transition-colors duration-[120ms] ease-g hover:bg-white focus-visible:outline-none focus-visible:shadow-g-focus"
                onClick={handleStop}
              >
                <Square size={15} fill="currentColor" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                aria-label={t("aiCanvas.ask")}
                disabled={
                  prompt.trim() === "" && pendingAttachments.length === 0
                }
                className="grid size-10 shrink-0 place-items-center rounded-full border border-white/70 bg-white/[0.82] text-black transition-colors duration-[120ms] ease-g hover:bg-white focus-visible:outline-none focus-visible:shadow-g-focus disabled:cursor-not-allowed disabled:opacity-[0.38]"
                onClick={() => void handleAsk()}
              >
                <ArrowUp size={20} strokeWidth={2.1} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
