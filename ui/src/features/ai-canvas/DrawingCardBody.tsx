import { useMemo } from "react";
import type {
  DrawingArrowShape,
  DrawingCanvasCard,
  DrawingEllipseShape,
  DrawingLineShape,
  DrawingPathShape,
  DrawingRectShape,
  DrawingShape,
} from "./aiCanvasState";

function pointsToPathD(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x} ${p.y} L ${p.x + 0.01} ${p.y}`;
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
}

function PathShape({ shape }: { shape: DrawingPathShape }) {
  return (
    <path
      d={pointsToPathD(shape.points)}
      stroke={shape.color}
      strokeWidth={shape.strokeWidth}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function RectShape({ shape }: { shape: DrawingRectShape }) {
  const x = Math.min(shape.x, shape.x + shape.width);
  const y = Math.min(shape.y, shape.y + shape.height);
  const w = Math.abs(shape.width);
  const h = Math.abs(shape.height);
  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      stroke={shape.color}
      strokeWidth={shape.strokeWidth}
      fill={shape.fill ?? "none"}
      rx={2}
      ry={2}
    />
  );
}

function EllipseShape({ shape }: { shape: DrawingEllipseShape }) {
  return (
    <ellipse
      cx={shape.cx}
      cy={shape.cy}
      rx={Math.max(0, Math.abs(shape.rx))}
      ry={Math.max(0, Math.abs(shape.ry))}
      stroke={shape.color}
      strokeWidth={shape.strokeWidth}
      fill={shape.fill ?? "none"}
    />
  );
}

function LineShape({ shape }: { shape: DrawingLineShape }) {
  return (
    <line
      x1={shape.x1}
      y1={shape.y1}
      x2={shape.x2}
      y2={shape.y2}
      stroke={shape.color}
      strokeWidth={shape.strokeWidth}
      strokeLinecap="round"
    />
  );
}

function ArrowShape({
  shape,
  markerId,
}: {
  shape: DrawingArrowShape;
  markerId: string;
}) {
  return (
    <line
      x1={shape.x1}
      y1={shape.y1}
      x2={shape.x2}
      y2={shape.y2}
      stroke={shape.color}
      strokeWidth={shape.strokeWidth}
      strokeLinecap="round"
      markerEnd={`url(#${markerId})`}
    />
  );
}

function renderDrawingShape(shape: DrawingShape, markerIdForArrow: string) {
  switch (shape.kind) {
    case "path":
      return <PathShape key={shape.id} shape={shape} />;
    case "rect":
      return <RectShape key={shape.id} shape={shape} />;
    case "ellipse":
      return <EllipseShape key={shape.id} shape={shape} />;
    case "line":
      return <LineShape key={shape.id} shape={shape} />;
    case "arrow":
      return (
        <ArrowShape key={shape.id} shape={shape} markerId={markerIdForArrow} />
      );
    default:
      return null;
  }
}

export function DrawingCardBody({
  card,
  previewShape,
}: {
  card: DrawingCanvasCard;
  previewShape?: DrawingShape | null;
}) {
  const arrowMarkers = useMemo(() => {
    const colors = new Set<string>();
    for (const shape of card.shapes) {
      if (shape.kind === "arrow") colors.add(shape.color);
    }
    if (previewShape?.kind === "arrow") colors.add(previewShape.color);
    return Array.from(colors);
  }, [card.shapes, previewShape]);

  const markerIdFor = (color: string) =>
    `arrow-${card.id}-${color.replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <div
      className="relative h-full w-full overflow-visible bg-transparent"
      data-ai-canvas-drawing-frame="true"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${card.width} ${card.height}`}
        preserveAspectRatio="none"
        className="h-full w-full"
      >
        <defs>
          {arrowMarkers.map((color) => (
            <marker
              key={color}
              id={markerIdFor(color)}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill={color} />
            </marker>
          ))}
        </defs>
        {card.shapes.map((shape) =>
          renderDrawingShape(
            shape,
            shape.kind === "arrow" ? markerIdFor(shape.color) : "",
          ),
        )}
        {previewShape
          ? renderDrawingShape(
              previewShape,
              previewShape.kind === "arrow"
                ? markerIdFor(previewShape.color)
                : "",
            )
          : null}
      </svg>
    </div>
  );
}
