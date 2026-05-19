import {
  ArrowRight,
  Circle,
  Eraser,
  Minus,
  Pencil,
  Square,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { CANVAS_DRAWING_COLORS, DRAWING_STROKE_WIDTHS } from "./aiCanvasState";
import type { DrawingTool } from "./useCanvasDrawing";

const TOOL_BTN =
  "flex size-7 items-center justify-center rounded-g-sm text-g-ink-2 transition-colors duration-100 ease-g hover:bg-g-surface-2 hover:text-g-ink";
const TOOL_BTN_ACTIVE =
  "bg-g-active-bg text-white hover:bg-g-active-bg hover:text-white";

const TOOLS: Array<{
  id: DrawingTool;
  icon: typeof Pencil;
  labelKey: string;
}> = [
  { id: "pen", icon: Pencil, labelKey: "aiCanvas.drawing.pen" },
  { id: "rect", icon: Square, labelKey: "aiCanvas.drawing.rect" },
  { id: "ellipse", icon: Circle, labelKey: "aiCanvas.drawing.ellipse" },
  { id: "line", icon: Minus, labelKey: "aiCanvas.drawing.line" },
  { id: "arrow", icon: ArrowRight, labelKey: "aiCanvas.drawing.arrow" },
  { id: "eraser", icon: Eraser, labelKey: "aiCanvas.drawing.eraser" },
];

export function CanvasDrawingToolbar({
  tool,
  onToolChange,
  color,
  onColorChange,
  strokeWidth,
  onStrokeWidthChange,
  filled,
  onFilledChange,
}: {
  tool: DrawingTool;
  onToolChange: (tool: DrawingTool) => void;
  color: string;
  onColorChange: (color: string) => void;
  strokeWidth: number;
  onStrokeWidthChange: (width: number) => void;
  filled: boolean;
  onFilledChange: (filled: boolean) => void;
}) {
  const { t } = useTranslation();
  const canFill = tool === "rect" || tool === "ellipse";

  return (
    <div
      className="flex items-center gap-1 rounded-g-md border border-g-line bg-g-surface-3/95 px-1.5 py-1 shadow-g-pop backdrop-blur-xl"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      data-ai-canvas-drawing-toolbar="true"
    >
      {TOOLS.map(({ id, icon: Icon, labelKey }) => (
        <button
          key={id}
          type="button"
          className={cn(TOOL_BTN, tool === id && TOOL_BTN_ACTIVE)}
          onClick={() => onToolChange(id)}
          aria-label={t(labelKey)}
          aria-pressed={tool === id}
        >
          <Icon size={13} />
        </button>
      ))}

      <div className="mx-0.5 h-5 w-px bg-g-line" aria-hidden="true" />

      <div className="flex items-center gap-0.5">
        {CANVAS_DRAWING_COLORS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className={cn(
              "size-5 rounded-full border transition-transform duration-100 ease-g hover:scale-110",
              color === swatch
                ? "border-g-active-bg ring-1 ring-g-active-bg"
                : "border-g-line",
            )}
            style={{ backgroundColor: swatch }}
            onClick={() => onColorChange(swatch)}
            aria-label={t("aiCanvas.drawing.color")}
            aria-pressed={color === swatch}
          />
        ))}
      </div>

      <div className="mx-0.5 h-5 w-px bg-g-line" aria-hidden="true" />

      <div
        className="flex items-center gap-0.5"
        aria-label={t("aiCanvas.drawing.strokeWidth")}
      >
        {DRAWING_STROKE_WIDTHS.map((width) => (
          <button
            key={width}
            type="button"
            className={cn(
              "flex size-7 items-center justify-center rounded-g-sm transition-colors duration-100 ease-g hover:bg-g-surface-2",
              strokeWidth === width && "bg-g-active-bg",
            )}
            onClick={() => onStrokeWidthChange(width)}
            aria-label={`${width}px`}
            aria-pressed={strokeWidth === width}
          >
            <span
              className="block rounded-full"
              style={{
                width: Math.min(18, width + 4),
                height: Math.min(18, width + 4),
                backgroundColor: strokeWidth === width ? "#ffffff" : color,
              }}
            />
          </button>
        ))}
      </div>

      {canFill ? (
        <>
          <div className="mx-0.5 h-5 w-px bg-g-line" aria-hidden="true" />
          <button
            type="button"
            className={cn(TOOL_BTN, filled && TOOL_BTN_ACTIVE)}
            onClick={() => onFilledChange(!filled)}
            aria-label={t("aiCanvas.drawing.fill")}
            aria-pressed={filled}
          >
            <span
              className="block size-3 rounded-sm border"
              style={{
                backgroundColor: filled ? color : "transparent",
                borderColor: filled ? "transparent" : color,
              }}
            />
          </button>
        </>
      ) : null}
    </div>
  );
}
