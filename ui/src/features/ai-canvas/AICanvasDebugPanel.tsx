import { ChevronRight, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { CopyButton } from "@/components/ui";
import { CARD_WIDTH } from "./canvasUtils";
import type { CanvasCard, ChatHistoryEntry } from "./aiCanvasState";
import type { WorkingState } from "./aiCanvasTypes";

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
  error: string;
  viewMode: "normal" | "compact" | "hidden";
  composerCollapsed: boolean;
  commentMode: boolean;
  searchOpen: boolean;
  searchMode: "catalog" | "semantic";
  searchResultsCount: number;
  searchBusy: boolean;
  searchError: string;
  onClose: () => void;
  onResetViewport: () => void;
  onClearCards: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
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
      base.fileName = c.asset.repoPath.split("/").pop() ?? c.asset.repoPath;
      base.thumbnailUrl = c.asset.thumbnailUrl;
      base.url = c.asset.url;
      base.image = {
        width: c.asset.image.width,
        height: c.asset.image.height,
        format: c.asset.image.format,
      };
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
    if (c.kind === "upload") {
      base.token = c.token;
      base.fileName = c.fileName;
      base.size = `${c.uploadWidth}×${c.uploadHeight}`;
    }
    if (c.kind === "variant") {
      base.sourceAssetId = c.sourceAssetId;
      base.formats = `${c.inputFormat} → ${c.outputFormat}`;
    }
    if (c.kind === "assistant") {
      base.prompt = c.prompt.slice(0, 60);
      base.bulletsCount = c.bullets.length;
    }
    if (c.kind === "operation") {
      base.prompt = c.prompt.slice(0, 60);
      base.assetsCount = c.assetIds.length;
    }
    return base;
  });
}

function serializeCardFull(card: CanvasCard): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: card.id,
    kind: card.kind,
    x: card.x,
    y: card.y,
    createdAt: card.createdAt,
  };
  switch (card.kind) {
    case "asset":
      base.assetId = card.asset.id;
      base.fileName = card.asset.repoPath.split("/").pop() ?? card.asset.id;
      base.repoPath = card.asset.repoPath;
      base.projectName = card.asset.projectName;
      base.ext = card.asset.ext;
      base.image = {
        format: card.asset.image.format,
        width: card.asset.image.width,
        height: card.asset.image.height,
        animated: card.asset.image.animated,
        alpha: card.asset.image.alpha,
        pages: card.asset.image.pages,
        bytes: card.asset.bytes,
      };
      base.visual = {
        url: card.asset.url,
        thumbnailUrl: card.asset.thumbnailUrl,
      };
      base.aiTag = {
        category: card.asset.aiTag?.category,
        tags: card.asset.aiTag?.tags,
        description: card.asset.aiTag?.description,
        languages: card.asset.aiTag?.languages,
      };
      if (card.asset.ocr?.text) {
        base.ocr = {
          text: card.asset.ocr.text,
          languages: card.asset.ocr.languages,
        };
      }
      base.usedByCount = card.asset.usedBy.length;
      break;
    case "comment":
      base.anchorId = card.anchorId;
      base.text = card.text;
      base.region = card.region;
      base.isAi = card.isAi ?? false;
      break;
    case "assistant":
      base.prompt = card.prompt;
      base.message = card.message;
      base.bullets = card.bullets;
      base.assetIds = card.assetIds;
      base.commentIds = card.commentIds;
      break;
    case "variant":
      base.sourceAssetId = card.sourceAssetId;
      base.sourceName = card.sourceName;
      base.token = card.token;
      base.inputBytes = card.inputBytes;
      base.outputBytes = card.outputBytes;
      base.inputFormat = card.inputFormat;
      base.outputFormat = card.outputFormat;
      break;
    case "operation":
      base.prompt = card.prompt;
      base.token = card.token;
      base.assetIds = card.assetIds;
      break;
    case "proposal":
      base.proposalId = card.proposalId;
      base.tool = card.tool;
      base.params = card.params;
      base.description = card.description;
      base.impact = card.impact;
      base.status = card.status;
      base.result = card.result;
      base.error = card.error;
      break;
    case "upload":
      base.token = card.token;
      base.fileName = card.fileName;
      base.uploadWidth = card.uploadWidth;
      base.uploadHeight = card.uploadHeight;
      break;
  }
  return base;
}

type DebugTab = "state" | "cards" | "chat" | "actions";

const DEBUG_TABS: { value: DebugTab; label: string }[] = [
  { value: "state", label: "State" },
  { value: "cards", label: "Cards" },
  { value: "chat", label: "Chat" },
  { value: "actions", label: "Actions" },
];

function DebugValue({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "green" | "red" | "yellow" | "dim";
}) {
  const colors: Record<string, string> = {
    green: "text-green-400",
    red: "text-red-400",
    yellow: "text-yellow-400",
    dim: "text-white/30",
  };
  return (
    <div className="flex items-baseline justify-between gap-2 py-[1px]">
      <span className="shrink-0 text-white/40">{label}</span>
      <span className={`truncate text-right ${colors[tone ?? "green"]}`}>
        {value}
      </span>
    </div>
  );
}

function DebugSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2">
      <div className="mb-1 text-[10px] font-[590] uppercase tracking-wider text-white/25">
        {title}
      </div>
      {children}
    </div>
  );
}

function CardInspectorRow({
  card,
  isSelected,
}: {
  card: CanvasCard;
  isSelected: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const kindColors: Record<string, string> = {
    asset: "text-blue-400",
    comment: "text-amber-400",
    assistant: "text-purple-400",
    variant: "text-cyan-400",
    operation: "text-orange-400",
    proposal: "text-pink-400",
    upload: "text-emerald-400",
  };

  const label =
    card.kind === "asset"
      ? (card.asset.repoPath.split("/").pop() ?? card.asset.id)
      : card.kind === "comment"
        ? card.text.slice(0, 30)
        : card.kind === "upload"
          ? card.fileName
          : card.kind === "proposal"
            ? card.tool
            : card.kind === "assistant"
              ? card.prompt.slice(0, 30)
              : card.id.slice(0, 12);

  return (
    <div
      className={`rounded border border-white/5 ${isSelected ? "bg-white/10" : "bg-white/[0.03]"}`}
    >
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <ChevronRight
          size={10}
          className={`shrink-0 text-white/30 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <span
          className={`shrink-0 ${kindColors[card.kind] ?? "text-green-400"}`}
        >
          {card.kind}
        </span>
        <span className="min-w-0 flex-1 truncate text-white/50">{label}</span>
        {isSelected && (
          <span className="shrink-0 text-[9px] text-yellow-500/70">SEL</span>
        )}
      </button>
      {expanded && (
        <pre className="border-t border-white/5 px-2 py-1 text-[10px] leading-[1.4] text-green-400/80 whitespace-pre-wrap break-all">
          {JSON.stringify(serializeCardFull(card), null, 2)}
        </pre>
      )}
    </div>
  );
}

function DebugActionButton({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`w-full rounded border px-2.5 py-1.5 text-left text-[11px] transition-colors ${
        danger
          ? "border-red-500/20 text-red-400/80 hover:bg-red-500/10 hover:text-red-400"
          : "border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80"
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function AICanvasDebugPanel({
  viewport,
  selectedCardIds,
  cardWidths,
  cards,
  chatHistory,
  working,
  aiCursor,
  error,
  viewMode,
  composerCollapsed,
  commentMode,
  searchOpen,
  searchMode,
  searchResultsCount,
  searchBusy,
  searchError,
  onClose,
  onResetViewport,
  onClearCards,
  onSelectAll,
  onDeselectAll,
}: AICanvasDebugPanelProps) {
  const [tab, setTab] = useState<DebugTab>("state");
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const onHeaderPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: rect.left,
      origY: rect.top,
    };
    panel.setPointerCapture(e.pointerId);
  }, []);

  const onPanelPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    setPos({
      x: drag.origX + (e.clientX - drag.startX),
      y: drag.origY + (e.clientY - drag.startY),
    });
  }, []);

  const onPanelPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const sessionDebug = {
    version: 1,
    viewport,
    selectedCardIds,
    cardWidths,
    cards: serializeCards(cards, cardWidths),
    chatHistory,
  };

  const selectedSet = new Set(selectedCardIds);
  const kindCounts = cards.reduce<Record<string, number>>((acc, c) => {
    acc[c.kind] = (acc[c.kind] ?? 0) + 1;
    return acc;
  }, {});
  const proposals = cards.filter((c) => c.kind === "proposal");
  const pendingProposals = proposals.filter(
    (c) => c.kind === "proposal" && c.status === "pending",
  );

  return (
    <div
      ref={panelRef}
      data-ai-canvas-overlay="true"
      className="pointer-events-auto z-[70] flex max-h-[60vh] w-[440px] flex-col overflow-hidden rounded-g-md border border-white/15 bg-[rgba(20,20,20,0.75)] font-mono text-[11px] leading-[1.5] text-green-400 shadow-g-pop backdrop-blur-2xl"
      style={
        pos
          ? { position: "fixed", left: pos.x, top: pos.y }
          : { position: "absolute", right: 12, bottom: 160 }
      }
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={onPanelPointerMove}
      onPointerUp={onPanelPointerUp}
    >
      {/* Header — draggable */}
      <div
        className="z-10 flex cursor-grab items-center justify-between border-b border-white/10 bg-[rgba(20,20,20,0.8)] px-3 py-2 text-white/60 backdrop-blur-2xl active:cursor-grabbing"
        onPointerDown={onHeaderPointerDown}
      >
        <span className="font-[590] uppercase tracking-wider select-none">
          Debug
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

      {/* Tabs */}
      <div className="flex border-b border-white/10 bg-[rgba(20,20,20,0.6)]">
        {DEBUG_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            className={`flex-1 py-1.5 text-center text-[10px] font-[590] uppercase tracking-wider transition-colors ${
              tab === t.value
                ? "border-b border-green-400/60 text-green-400"
                : "text-white/30 hover:text-white/50"
            }`}
            onClick={() => setTab(t.value)}
          >
            {t.label}
            {t.value === "cards" && (
              <span className="ml-1 text-white/20">{cards.length}</span>
            )}
            {t.value === "chat" && (
              <span className="ml-1 text-white/20">{chatHistory.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="overflow-auto p-3" data-ai-canvas-scroll="true">
        {tab === "state" && (
          <>
            <DebugSection title="Viewport">
              <DebugValue label="x" value={viewport.x.toFixed(1)} />
              <DebugValue label="y" value={viewport.y.toFixed(1)} />
              <DebugValue
                label="scale"
                value={`${(viewport.scale * 100).toFixed(0)}%`}
              />
            </DebugSection>

            <DebugSection title="Working">
              <DebugValue
                label="status"
                value={working}
                tone={working === "idle" ? "dim" : "yellow"}
              />
              {error && <DebugValue label="error" value={error} tone="red" />}
            </DebugSection>

            <DebugSection title="UI Mode">
              <DebugValue label="viewMode" value={viewMode} />
              <DebugValue
                label="composer"
                value={composerCollapsed ? "collapsed" : "open"}
                tone={composerCollapsed ? "dim" : "green"}
              />
              <DebugValue
                label="commentMode"
                value={commentMode ? "on" : "off"}
                tone={commentMode ? "yellow" : "dim"}
              />
            </DebugSection>

            <DebugSection title="Search">
              <DebugValue
                label="open"
                value={searchOpen ? "yes" : "no"}
                tone={searchOpen ? "green" : "dim"}
              />
              <DebugValue label="mode" value={searchMode} />
              <DebugValue label="results" value={searchResultsCount} />
              <DebugValue
                label="busy"
                value={searchBusy ? "yes" : "no"}
                tone={searchBusy ? "yellow" : "dim"}
              />
              {searchError && (
                <DebugValue label="error" value={searchError} tone="red" />
              )}
            </DebugSection>

            <DebugSection title="Selection">
              <DebugValue label="count" value={selectedCardIds.length} />
              {selectedCardIds.length > 0 && (
                <div className="mt-1 text-[10px] text-white/20 break-all">
                  {selectedCardIds.map((id) => id.slice(0, 12)).join(", ")}
                </div>
              )}
            </DebugSection>

            <DebugSection title="AI Cursor">
              <DebugValue
                label="status"
                value={aiCursor.status}
                tone={
                  aiCursor.status === "idle"
                    ? "dim"
                    : aiCursor.status === "thinking"
                      ? "yellow"
                      : "green"
                }
              />
              <DebugValue
                label="pos"
                value={`${aiCursor.x.toFixed(0)}, ${aiCursor.y.toFixed(0)}`}
              />
              {aiCursor.label && (
                <DebugValue label="label" value={aiCursor.label} />
              )}
            </DebugSection>

            <DebugSection title="Cards Summary">
              {Object.entries(kindCounts).map(([kind, count]) => (
                <DebugValue key={kind} label={kind} value={count} />
              ))}
              {pendingProposals.length > 0 && (
                <DebugValue
                  label="pending proposals"
                  value={pendingProposals.length}
                  tone="yellow"
                />
              )}
            </DebugSection>
          </>
        )}

        {tab === "cards" && (
          <div className="flex flex-col gap-1">
            {cards.length === 0 ? (
              <div className="py-4 text-center text-white/20">No cards</div>
            ) : (
              cards.map((card) => (
                <CardInspectorRow
                  key={card.id}
                  card={card}
                  isSelected={selectedSet.has(card.id)}
                />
              ))
            )}
          </div>
        )}

        {tab === "chat" && (
          <div className="flex flex-col gap-1">
            {chatHistory.length === 0 ? (
              <div className="py-4 text-center text-white/20">
                No chat history
              </div>
            ) : (
              chatHistory.map((entry, i) => (
                <div
                  key={i}
                  className="rounded border border-white/5 bg-white/[0.03] px-2 py-1"
                >
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`shrink-0 text-[10px] font-[590] uppercase ${
                        entry.role === "user"
                          ? "text-blue-400"
                          : entry.role === "assistant"
                            ? "text-purple-400"
                            : "text-white/30"
                      }`}
                    >
                      {entry.role}
                    </span>
                    <span className="text-[10px] text-white/20">#{i + 1}</span>
                    {entry.mentions && entry.mentions.length > 0 && (
                      <span className="text-[10px] text-amber-400/50">
                        {entry.mentions.length} mention
                        {entry.mentions.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10px] leading-[1.4] text-white/40 line-clamp-3">
                    {entry.content.slice(0, 200)}
                    {entry.content.length > 200 ? "…" : ""}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "actions" && (
          <div className="flex flex-col gap-1.5">
            <DebugSection title="Viewport">
              <DebugActionButton
                label="Reset viewport to origin"
                onClick={onResetViewport}
              />
            </DebugSection>

            <DebugSection title="Selection">
              <div className="flex gap-1.5">
                <div className="flex-1">
                  <DebugActionButton label="Select all" onClick={onSelectAll} />
                </div>
                <div className="flex-1">
                  <DebugActionButton
                    label="Deselect all"
                    onClick={onDeselectAll}
                  />
                </div>
              </div>
            </DebugSection>

            <DebugSection title="Data">
              <div className="flex flex-col gap-1.5">
                <DebugActionButton
                  label="Dump full state to console"
                  onClick={() => {
                    console.log("[Canvas Debug]", sessionDebug);
                  }}
                />
                <DebugActionButton
                  label="Clear all cards"
                  onClick={onClearCards}
                  danger
                />
              </div>
            </DebugSection>
          </div>
        )}
      </div>
    </div>
  );
}
