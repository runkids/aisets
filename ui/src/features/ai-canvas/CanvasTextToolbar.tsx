import { useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import {
  CANVAS_TEXT_COLORS,
  CANVAS_TEXT_FONTS,
  type TextCanvasCard,
  type TextStyle,
} from "./aiCanvasState";

const TOOL_BTN =
  "flex size-7 items-center justify-center rounded-g-sm text-g-ink-2 transition-colors duration-100 ease-g hover:bg-g-surface-2 hover:text-g-ink";
const TOOL_BTN_ACTIVE =
  "bg-g-active-bg text-white hover:bg-g-active-bg hover:text-white";

function fontIdFromStack(stack: string) {
  const match = CANVAS_TEXT_FONTS.find((f) => f.stack === stack);
  return match?.id ?? CANVAS_TEXT_FONTS[0].id;
}

export function CanvasTextToolbar({
  card,
  onUpdate,
}: {
  card: TextCanvasCard;
  onUpdate: (patch: Partial<TextStyle>) => void;
}) {
  const { t } = useTranslation();
  const { fontFamily, fontSize, fontWeight, fontStyle, color, textAlign } =
    card.style;
  const currentFontId = fontIdFromStack(fontFamily);
  const [sizeInput, setSizeInput] = useState(String(Math.round(fontSize)));
  const [prevFontSize, setPrevFontSize] = useState(fontSize);
  if (fontSize !== prevFontSize) {
    setPrevFontSize(fontSize);
    setSizeInput(String(Math.round(fontSize)));
  }

  const commitSize = () => {
    const n = Number(sizeInput);
    if (!Number.isFinite(n)) {
      setSizeInput(String(Math.round(fontSize)));
      return;
    }
    const clamped = Math.max(8, Math.min(400, n));
    onUpdate({ fontSize: clamped });
    setSizeInput(String(clamped));
  };

  return (
    <div
      className="flex items-center gap-1 rounded-g-md border border-g-line bg-g-surface-3/95 px-1.5 py-1 shadow-g-pop backdrop-blur-xl"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      data-ai-canvas-text-toolbar="true"
    >
      <select
        value={currentFontId}
        onChange={(event) => {
          const stack = CANVAS_TEXT_FONTS.find(
            (f) => f.id === event.target.value,
          )?.stack;
          if (stack) onUpdate({ fontFamily: stack });
        }}
        className="h-7 rounded-g-sm border border-g-line bg-g-surface px-2 font-g text-[12px] text-g-ink focus:border-g-active-bg focus:outline-none"
        aria-label={t("aiCanvas.text.fontFamily")}
      >
        {CANVAS_TEXT_FONTS.map((font) => (
          <option
            key={font.id}
            value={font.id}
            style={{ fontFamily: font.stack }}
          >
            {font.label}
          </option>
        ))}
      </select>

      <input
        type="number"
        min={8}
        max={400}
        step={1}
        value={sizeInput}
        onChange={(event) => setSizeInput(event.target.value)}
        onBlur={commitSize}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            setSizeInput(String(Math.round(fontSize)));
            event.currentTarget.blur();
          }
        }}
        className="h-7 w-14 rounded-g-sm border border-g-line bg-g-surface px-1.5 font-g text-[12px] text-g-ink focus:border-g-active-bg focus:outline-none"
        aria-label={t("aiCanvas.text.fontSize")}
      />

      <div className="mx-0.5 h-5 w-px bg-g-line" aria-hidden="true" />

      <button
        type="button"
        className={cn(TOOL_BTN, fontWeight === "bold" && TOOL_BTN_ACTIVE)}
        onClick={() =>
          onUpdate({ fontWeight: fontWeight === "bold" ? "normal" : "bold" })
        }
        aria-label={t("aiCanvas.text.bold")}
        aria-pressed={fontWeight === "bold"}
      >
        <Bold size={13} />
      </button>
      <button
        type="button"
        className={cn(TOOL_BTN, fontStyle === "italic" && TOOL_BTN_ACTIVE)}
        onClick={() =>
          onUpdate({ fontStyle: fontStyle === "italic" ? "normal" : "italic" })
        }
        aria-label={t("aiCanvas.text.italic")}
        aria-pressed={fontStyle === "italic"}
      >
        <Italic size={13} />
      </button>

      <div className="mx-0.5 h-5 w-px bg-g-line" aria-hidden="true" />

      <button
        type="button"
        className={cn(TOOL_BTN, textAlign === "left" && TOOL_BTN_ACTIVE)}
        onClick={() => onUpdate({ textAlign: "left" })}
        aria-label={t("aiCanvas.text.alignLeft")}
        aria-pressed={textAlign === "left"}
      >
        <AlignLeft size={13} />
      </button>
      <button
        type="button"
        className={cn(TOOL_BTN, textAlign === "center" && TOOL_BTN_ACTIVE)}
        onClick={() => onUpdate({ textAlign: "center" })}
        aria-label={t("aiCanvas.text.alignCenter")}
        aria-pressed={textAlign === "center"}
      >
        <AlignCenter size={13} />
      </button>
      <button
        type="button"
        className={cn(TOOL_BTN, textAlign === "right" && TOOL_BTN_ACTIVE)}
        onClick={() => onUpdate({ textAlign: "right" })}
        aria-label={t("aiCanvas.text.alignRight")}
        aria-pressed={textAlign === "right"}
      >
        <AlignRight size={13} />
      </button>

      <div className="mx-0.5 h-5 w-px bg-g-line" aria-hidden="true" />

      <div className="flex items-center gap-0.5">
        {CANVAS_TEXT_COLORS.map((swatch) => (
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
            onClick={() => onUpdate({ color: swatch })}
            aria-label={t("aiCanvas.text.color")}
            aria-pressed={color === swatch}
          />
        ))}
      </div>
    </div>
  );
}
