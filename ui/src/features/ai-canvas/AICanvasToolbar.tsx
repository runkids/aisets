import {
  ArrowLeft,
  BoxSelect,
  Bug,
  Camera,
  Eye,
  EyeOff,
  FilePlus2,
  FolderOpen,
  LoaderCircle,
  LocateFixed,
  Monitor,
  RotateCcw,
  Save,
  Square,
  Trash2,
  Type,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { TFunction } from "i18next";
import { Badge, Button, IconButton, Range, Switch } from "@/components/ui";
import type { StateSetter } from "./aiCanvasTypes";
import {
  DEFAULT_CAPTURE_PADDING,
  type CapturePadding,
} from "./useCanvasCapture";

type AICanvasToolbarProps = {
  t: TFunction;
  onExitCanvas?: () => void;
  viewportScale: number;
  zoomCanvasBy: (factor: number) => void;
  centerCanvasView: () => void;
  isCapturing: boolean;
  captureTransparent: boolean;
  setCaptureTransparent: StateSetter<boolean>;
  capturePadding: CapturePadding;
  setCapturePadding: StateSetter<CapturePadding>;
  captureViewport: (transparent: boolean) => void | Promise<void>;
  captureCanvas: (transparent: boolean) => void | Promise<void>;
  captureSelected: (transparent: boolean) => void | Promise<void>;
  selectedCardCount: number;
  hideNonImageCards: boolean;
  setHideNonImageCards: StateSetter<boolean>;
  setSelectedCardIds: StateSetter<string[]>;
  canClear: boolean;
  onClear: () => void;
  debugOpen: boolean;
  onToggleDebug: () => void;
  onSave: () => void;
  onOpenSessions: () => void;
  onNewCanvas: () => void;
  isSaving: boolean;
  isDirty: boolean;
  hasSession: boolean;
  sessionName?: string;
  onAddTextCard?: () => void;
};

function parseCapturePadding(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(512, parsed));
}

export function AICanvasToolbar({
  t,
  onExitCanvas,
  viewportScale,
  zoomCanvasBy,
  centerCanvasView,
  isCapturing,
  captureTransparent,
  setCaptureTransparent,
  capturePadding,
  setCapturePadding,
  captureViewport,
  captureCanvas,
  captureSelected,
  selectedCardCount,
  hideNonImageCards,
  setHideNonImageCards,
  setSelectedCardIds,
  canClear,
  onClear,
  debugOpen,
  onToggleDebug,
  onSave,
  onOpenSessions,
  onNewCanvas,
  isSaving,
  isDirty,
  hasSession,
  sessionName,
  onAddTextCard,
}: AICanvasToolbarProps) {
  return (
    <div
      data-ai-canvas-overlay="true"
      className="pointer-events-auto absolute right-3 top-3 z-50 flex items-center gap-1 rounded-g-lg border border-transparent bg-g-surface/75 p-1.5 shadow-g-pop backdrop-blur-xl [[data-theme='dark']_&]:border-g-line [[data-theme='dark']_&]:bg-g-surface-3/80"
    >
      {onExitCanvas && (
        <Button
          size="sm"
          variant="ghost"
          leadingIcon={<ArrowLeft />}
          onClick={onExitCanvas}
        >
          {t("aiCanvas.exitCanvas")}
        </Button>
      )}
      <IconButton
        size="sm"
        aria-label={t("aiCanvas.zoomOut")}
        onClick={() => zoomCanvasBy(1 / 1.25)}
      >
        <ZoomOut />
      </IconButton>
      <Badge tone="line">{Math.round(viewportScale * 100)}%</Badge>
      <IconButton
        size="sm"
        aria-label={t("aiCanvas.zoomIn")}
        onClick={() => zoomCanvasBy(1.25)}
      >
        <ZoomIn />
      </IconButton>
      <IconButton
        size="sm"
        aria-label={t("aiCanvas.centerView")}
        onClick={centerCanvasView}
      >
        <LocateFixed />
      </IconButton>
      {onAddTextCard && (
        <IconButton
          size="sm"
          aria-label={t("aiCanvas.addText")}
          onClick={onAddTextCard}
        >
          <Type />
        </IconButton>
      )}
      <span className="mx-0.5 h-4 w-px bg-g-line" />
      {hasSession && (
        <IconButton
          size="sm"
          aria-label={t("aiCanvas.newCanvas")}
          onClick={onNewCanvas}
        >
          <FilePlus2 />
        </IconButton>
      )}
      <IconButton
        size="sm"
        aria-label={t("aiCanvas.openSessions")}
        onClick={onOpenSessions}
      >
        <FolderOpen />
      </IconButton>
      <div className="relative">
        <IconButton
          size="sm"
          aria-label={t("aiCanvas.save")}
          onClick={onSave}
          disabled={isSaving}
        >
          {isSaving ? <LoaderCircle className="animate-spin" /> : <Save />}
        </IconButton>
        {isDirty && !isSaving && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400" />
        )}
      </div>
      {sessionName && (
        <span className="max-w-[120px] truncate font-g text-[12px] text-g-ink-2">
          {sessionName}
        </span>
      )}
      <span className="mx-0.5 h-4 w-px bg-g-line" />
      <DropdownMenuPrimitive.Root>
        <DropdownMenuPrimitive.Trigger asChild>
          <IconButton
            size="sm"
            aria-label={t("aiCanvas.screenshot")}
            disabled={isCapturing}
          >
            {isCapturing ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Camera />
            )}
          </IconButton>
        </DropdownMenuPrimitive.Trigger>
        <DropdownMenuPrimitive.Portal>
          <DropdownMenuPrimitive.Content
            align="end"
            sideOffset={8}
            className="z-[80] min-w-[260px] rounded-g-lg border border-g-line bg-g-surface p-1.5 shadow-g-pop animate-[modalIn_120ms_var(--g-ease-out)]"
          >
            <div className="px-2 pt-1 pb-1 font-g text-[10px] font-[600] uppercase tracking-[0.08em] text-g-ink-4">
              {t("aiCanvas.captureSection")}
            </div>
            <DropdownMenuPrimitive.Item
              onSelect={() => {
                void captureViewport(captureTransparent);
              }}
              className="flex min-h-8 cursor-pointer items-center gap-2.5 rounded-g-sm px-2 py-1.5 font-g text-g-ui text-g-ink outline-none transition-colors duration-[120ms] ease-g data-[highlighted]:bg-g-surface-2"
            >
              <Monitor className="size-4 text-g-ink-3" />
              <span className="flex-1">{t("aiCanvas.captureViewport")}</span>
            </DropdownMenuPrimitive.Item>
            <DropdownMenuPrimitive.Item
              onSelect={() => {
                void captureCanvas(captureTransparent);
              }}
              className="flex min-h-8 cursor-pointer items-center gap-2.5 rounded-g-sm px-2 py-1.5 font-g text-g-ui text-g-ink outline-none transition-colors duration-[120ms] ease-g data-[highlighted]:bg-g-surface-2"
            >
              <Square className="size-4 text-g-ink-3" />
              <span className="flex-1">{t("aiCanvas.captureCanvas")}</span>
            </DropdownMenuPrimitive.Item>
            <DropdownMenuPrimitive.Item
              disabled={selectedCardCount === 0}
              onSelect={() => {
                void captureSelected(captureTransparent);
              }}
              className="flex min-h-8 cursor-pointer items-center gap-2.5 rounded-g-sm px-2 py-1.5 font-g text-g-ui text-g-ink outline-none transition-colors duration-[120ms] ease-g data-[disabled]:cursor-not-allowed data-[disabled]:opacity-[0.38] data-[highlighted]:bg-g-surface-2"
            >
              <BoxSelect className="size-4 text-g-ink-3" />
              <span className="flex-1">{t("aiCanvas.captureSelected")}</span>
              {selectedCardCount > 0 && (
                <span className="rounded-full bg-g-surface-2 px-1.5 font-g text-g-chip tabular-nums text-g-ink-3">
                  {selectedCardCount}
                </span>
              )}
            </DropdownMenuPrimitive.Item>
            <div className="mx-2 my-1.5 h-px bg-g-line" />
            <div className="px-2 pb-1 font-g text-[10px] font-[600] uppercase tracking-[0.08em] text-g-ink-4">
              {t("aiCanvas.captureOptionsSection")}
            </div>
            <div
              className="flex min-h-8 items-center justify-between gap-3 rounded-g-sm px-2 py-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="font-g text-g-ui text-g-ink">
                {t("aiCanvas.transparentBg")}
              </span>
              <Switch
                checked={captureTransparent}
                onCheckedChange={setCaptureTransparent}
                aria-label={t("aiCanvas.transparentBg")}
              />
            </div>
            <div
              className="px-2 py-1.5"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <div className="mb-1.5 flex items-center gap-2">
                <span className="flex-1 font-g text-g-ui text-g-ink">
                  {t("aiCanvas.capturePadding")}
                </span>
                <span className="font-g text-g-chip tabular-nums text-g-ink-4">
                  {capturePadding.x} × {capturePadding.y} px
                </span>
                <button
                  type="button"
                  aria-label={t("aiCanvas.capturePaddingReset")}
                  onClick={() => setCapturePadding(DEFAULT_CAPTURE_PADDING)}
                  className="-mr-1 flex size-6 items-center justify-center rounded-g-sm text-g-ink-4 outline-none transition-colors duration-[120ms] ease-g hover:bg-g-surface-2 hover:text-g-ink focus-visible:ring-2 focus-visible:ring-g-active-bg/40"
                >
                  <RotateCcw className="size-3.5" />
                </button>
              </div>
              <div className="grid gap-2">
                <div className="grid grid-cols-[12px_1fr_44px] items-center gap-2.5">
                  <span className="text-center font-g text-g-chip font-[560] text-g-ink-4">
                    {t("aiCanvas.capturePaddingX")}
                  </span>
                  <Range
                    min={0}
                    max={128}
                    step={1}
                    aria-label={t("aiCanvas.capturePaddingX")}
                    value={capturePadding.x}
                    onChange={(event) => {
                      const x = parseCapturePadding(event.currentTarget.value);
                      setCapturePadding((padding) => ({ ...padding, x }));
                    }}
                  />
                  <input
                    type="number"
                    min={0}
                    max={512}
                    step={1}
                    aria-label={t("aiCanvas.capturePaddingX")}
                    value={capturePadding.x}
                    onChange={(event) => {
                      const x = parseCapturePadding(event.currentTarget.value);
                      setCapturePadding((padding) => ({ ...padding, x }));
                    }}
                    className="h-6 w-full rounded-g-sm bg-g-surface-2 px-1.5 text-right font-g text-g-chip tabular-nums text-g-ink outline-none transition-colors duration-[120ms] ease-g hover:bg-g-surface-3 focus-visible:bg-g-surface focus-visible:shadow-g-focus [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                </div>
                <div className="grid grid-cols-[12px_1fr_44px] items-center gap-2.5">
                  <span className="text-center font-g text-g-chip font-[560] text-g-ink-4">
                    {t("aiCanvas.capturePaddingY")}
                  </span>
                  <Range
                    min={0}
                    max={128}
                    step={1}
                    aria-label={t("aiCanvas.capturePaddingY")}
                    value={capturePadding.y}
                    onChange={(event) => {
                      const y = parseCapturePadding(event.currentTarget.value);
                      setCapturePadding((padding) => ({ ...padding, y }));
                    }}
                  />
                  <input
                    type="number"
                    min={0}
                    max={512}
                    step={1}
                    aria-label={t("aiCanvas.capturePaddingY")}
                    value={capturePadding.y}
                    onChange={(event) => {
                      const y = parseCapturePadding(event.currentTarget.value);
                      setCapturePadding((padding) => ({ ...padding, y }));
                    }}
                    className="h-6 w-full rounded-g-sm bg-g-surface-2 px-1.5 text-right font-g text-g-chip tabular-nums text-g-ink outline-none transition-colors duration-[120ms] ease-g hover:bg-g-surface-3 focus-visible:bg-g-surface focus-visible:shadow-g-focus [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                </div>
              </div>
            </div>
          </DropdownMenuPrimitive.Content>
        </DropdownMenuPrimitive.Portal>
      </DropdownMenuPrimitive.Root>
      <IconButton
        size="sm"
        aria-label={
          hideNonImageCards
            ? t("aiCanvas.showAllElements")
            : t("aiCanvas.hideNonImageElements")
        }
        data-active={hideNonImageCards || undefined}
        className={hideNonImageCards ? "bg-g-surface-3 text-g-ink" : undefined}
        onClick={() => {
          setHideNonImageCards((hidden) => !hidden);
          setSelectedCardIds([]);
        }}
      >
        {hideNonImageCards ? <EyeOff /> : <Eye />}
      </IconButton>
      <IconButton
        size="sm"
        aria-label={t("aiCanvas.clear")}
        disabled={!canClear}
        onClick={onClear}
      >
        <Trash2 />
      </IconButton>
      <IconButton
        size="sm"
        aria-label="Debug"
        onClick={onToggleDebug}
        className={debugOpen ? "text-green-500" : undefined}
      >
        <Bug />
      </IconButton>
    </div>
  );
}
