import {
  ArrowLeft,
  Bug,
  Camera,
  Eye,
  EyeOff,
  FilePlus2,
  FolderOpen,
  LoaderCircle,
  LocateFixed,
  Save,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { TFunction } from "i18next";
import { Badge, Button, IconButton, Switch } from "@/components/ui";
import type { StateSetter } from "./aiCanvasTypes";

type AICanvasToolbarProps = {
  t: TFunction;
  onExitCanvas?: () => void;
  viewportScale: number;
  zoomCanvasBy: (factor: number) => void;
  centerCanvasView: () => void;
  isCapturing: boolean;
  captureTransparent: boolean;
  setCaptureTransparent: StateSetter<boolean>;
  captureViewport: (transparent: boolean) => void | Promise<void>;
  captureCanvas: (transparent: boolean) => void | Promise<void>;
  captureSelected: (transparent: boolean) => void | Promise<void>;
  selectedCardCount: number;
  hideNonImageCards: boolean;
  setHideNonImageCards: StateSetter<boolean>;
  setSelectedCardIds: StateSetter<string[]>;
  cardsCount: number;
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
};

export function AICanvasToolbar({
  t,
  onExitCanvas,
  viewportScale,
  zoomCanvasBy,
  centerCanvasView,
  isCapturing,
  captureTransparent,
  setCaptureTransparent,
  captureViewport,
  captureCanvas,
  captureSelected,
  selectedCardCount,
  hideNonImageCards,
  setHideNonImageCards,
  setSelectedCardIds,
  cardsCount,
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
          disabled={isSaving || cardsCount === 0}
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
            className="z-[80] min-w-[200px] rounded-g-lg border border-g-line bg-g-surface p-1 shadow-g-pop animate-[modalIn_120ms_var(--g-ease-out)]"
          >
            <DropdownMenuPrimitive.Item
              onSelect={() => {
                void captureViewport(captureTransparent);
              }}
              className="flex min-h-8 cursor-pointer items-center gap-2 rounded-g-sm px-3 py-1.5 font-g text-g-ui text-g-ink outline-none transition-colors duration-[120ms] ease-g data-[highlighted]:bg-g-surface-2"
            >
              {t("aiCanvas.captureViewport")}
            </DropdownMenuPrimitive.Item>
            <DropdownMenuPrimitive.Item
              onSelect={() => {
                void captureCanvas(captureTransparent);
              }}
              className="flex min-h-8 cursor-pointer items-center gap-2 rounded-g-sm px-3 py-1.5 font-g text-g-ui text-g-ink outline-none transition-colors duration-[120ms] ease-g data-[highlighted]:bg-g-surface-2"
            >
              {t("aiCanvas.captureCanvas")}
            </DropdownMenuPrimitive.Item>
            <DropdownMenuPrimitive.Item
              disabled={selectedCardCount === 0}
              onSelect={() => {
                void captureSelected(captureTransparent);
              }}
              className="flex min-h-8 cursor-pointer items-center gap-2 rounded-g-sm px-3 py-1.5 font-g text-g-ui text-g-ink outline-none transition-colors duration-[120ms] ease-g data-[disabled]:cursor-not-allowed data-[disabled]:opacity-[0.38] data-[highlighted]:bg-g-surface-2"
            >
              {t("aiCanvas.captureSelected")}
            </DropdownMenuPrimitive.Item>
            <DropdownMenuPrimitive.Separator className="mx-2 my-1 h-px bg-g-line" />
            <div
              className="flex min-h-8 items-center justify-between gap-3 rounded-g-sm px-3 py-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="font-g text-g-ui text-g-ink-2">
                {t("aiCanvas.transparentBg")}
              </span>
              <Switch
                checked={captureTransparent}
                onCheckedChange={setCaptureTransparent}
                aria-label={t("aiCanvas.transparentBg")}
              />
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
        disabled={cardsCount === 0}
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
