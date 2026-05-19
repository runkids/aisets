import { useCallback, useRef, useState } from "react";
import {
  createDrawingShapeId,
  DEFAULT_DRAWING_COLOR,
  DEFAULT_DRAWING_STROKE,
  type DrawingShape,
} from "./aiCanvasState";

export type DrawingTool =
  | "pen"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "eraser";

const RDP_TOLERANCE = 1.5;

function rdp(points: { x: number; y: number }[], tolerance = RDP_TOLERANCE) {
  if (points.length < 3) return points;
  const sqTol = tolerance * tolerance;
  const last = points.length - 1;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[last] = true;

  const stack: Array<[number, number]> = [[0, last]];
  while (stack.length) {
    const [first, end] = stack.pop()!;
    let maxSq = 0;
    let index = 0;
    const ax = points[first].x;
    const ay = points[first].y;
    const bx = points[end].x;
    const by = points[end].y;
    const dx = bx - ax;
    const dy = by - ay;
    const denom = dx * dx + dy * dy;
    for (let i = first + 1; i < end; i++) {
      const px = points[i].x;
      const py = points[i].y;
      let sq: number;
      if (denom === 0) {
        const ex = px - ax;
        const ey = py - ay;
        sq = ex * ex + ey * ey;
      } else {
        const t = ((px - ax) * dx + (py - ay) * dy) / denom;
        const cx = ax + t * dx;
        const cy = ay + t * dy;
        const ex = px - cx;
        const ey = py - cy;
        sq = ex * ex + ey * ey;
      }
      if (sq > maxSq) {
        index = i;
        maxSq = sq;
      }
    }
    if (maxSq > sqTol) {
      keep[index] = true;
      stack.push([first, index]);
      stack.push([index, end]);
    }
  }

  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) out.push(points[i]);
  }
  return out;
}

function distSqToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const denom = dx * dx + dy * dy;
  let t = 0;
  if (denom > 0) {
    t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / denom));
  }
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  const ex = p.x - cx;
  const ey = p.y - cy;
  return ex * ex + ey * ey;
}

export function shapeHitTest(
  shape: DrawingShape,
  point: { x: number; y: number },
  tolerance: number,
): boolean {
  const sqTol = tolerance * tolerance;
  switch (shape.kind) {
    case "path": {
      for (let i = 1; i < shape.points.length; i++) {
        if (
          distSqToSegment(point, shape.points[i - 1], shape.points[i]) < sqTol
        ) {
          return true;
        }
      }
      return false;
    }
    case "rect": {
      const x = Math.min(shape.x, shape.x + shape.width);
      const y = Math.min(shape.y, shape.y + shape.height);
      const w = Math.abs(shape.width);
      const h = Math.abs(shape.height);
      return (
        point.x >= x - tolerance &&
        point.x <= x + w + tolerance &&
        point.y >= y - tolerance &&
        point.y <= y + h + tolerance
      );
    }
    case "ellipse": {
      const rx = Math.abs(shape.rx) + tolerance;
      const ry = Math.abs(shape.ry) + tolerance;
      if (rx <= 0 || ry <= 0) return false;
      const nx = (point.x - shape.cx) / rx;
      const ny = (point.y - shape.cy) / ry;
      return nx * nx + ny * ny <= 1;
    }
    case "line":
    case "arrow":
      return (
        distSqToSegment(
          point,
          { x: shape.x1, y: shape.y1 },
          { x: shape.x2, y: shape.y2 },
        ) < sqTol
      );
    default:
      return false;
  }
}

export interface UseCanvasDrawingOptions {
  onCommitShape: (shape: DrawingShape) => void;
  onEraseAt: (point: { x: number; y: number }) => void;
}

export interface UseCanvasDrawingResult {
  tool: DrawingTool;
  setTool: (tool: DrawingTool) => void;
  color: string;
  setColor: (color: string) => void;
  strokeWidth: number;
  setStrokeWidth: (width: number) => void;
  filled: boolean;
  setFilled: (filled: boolean) => void;
  previewShape: DrawingShape | null;
  onPointerDown: (point: { x: number; y: number }) => void;
  onPointerMove: (point: { x: number; y: number }) => void;
  onPointerUp: (point: { x: number; y: number }) => void;
  cancel: () => void;
}

export function useCanvasDrawing({
  onCommitShape,
  onEraseAt,
}: UseCanvasDrawingOptions): UseCanvasDrawingResult {
  const [tool, setTool] = useState<DrawingTool>("pen");
  const [color, setColor] = useState<string>(DEFAULT_DRAWING_COLOR);
  const [strokeWidth, setStrokeWidth] = useState<number>(
    DEFAULT_DRAWING_STROKE,
  );
  const [filled, setFilled] = useState<boolean>(false);
  const [previewShape, setPreviewShape] = useState<DrawingShape | null>(null);
  const drawingRef = useRef<{
    start: { x: number; y: number };
    points: { x: number; y: number }[];
  } | null>(null);

  const baseId = useCallback(() => createDrawingShapeId("path"), []);

  const onPointerDown = useCallback(
    (point: { x: number; y: number }) => {
      if (tool === "eraser") {
        onEraseAt(point);
        drawingRef.current = { start: point, points: [point] };
        return;
      }
      drawingRef.current = { start: point, points: [point] };
      if (tool === "pen") {
        setPreviewShape({
          id: baseId(),
          kind: "path",
          color,
          strokeWidth,
          points: [point],
        });
        return;
      }
      const fillValue = filled ? color : null;
      switch (tool) {
        case "rect":
          setPreviewShape({
            id: baseId(),
            kind: "rect",
            color,
            strokeWidth,
            x: point.x,
            y: point.y,
            width: 0,
            height: 0,
            fill: fillValue,
          });
          break;
        case "ellipse":
          setPreviewShape({
            id: baseId(),
            kind: "ellipse",
            color,
            strokeWidth,
            cx: point.x,
            cy: point.y,
            rx: 0,
            ry: 0,
            fill: fillValue,
          });
          break;
        case "line":
          setPreviewShape({
            id: baseId(),
            kind: "line",
            color,
            strokeWidth,
            x1: point.x,
            y1: point.y,
            x2: point.x,
            y2: point.y,
          });
          break;
        case "arrow":
          setPreviewShape({
            id: baseId(),
            kind: "arrow",
            color,
            strokeWidth,
            x1: point.x,
            y1: point.y,
            x2: point.x,
            y2: point.y,
          });
          break;
      }
    },
    [tool, color, strokeWidth, filled, baseId, onEraseAt],
  );

  const onPointerMove = useCallback(
    (point: { x: number; y: number }) => {
      const drawing = drawingRef.current;
      if (!drawing) return;
      if (tool === "eraser") {
        onEraseAt(point);
        return;
      }
      drawing.points.push(point);
      const start = drawing.start;
      const fillValue = filled ? color : null;
      if (tool === "pen") {
        setPreviewShape({
          id: baseId(),
          kind: "path",
          color,
          strokeWidth,
          points: drawing.points.slice(),
        });
        return;
      }
      switch (tool) {
        case "rect":
          setPreviewShape({
            id: baseId(),
            kind: "rect",
            color,
            strokeWidth,
            x: start.x,
            y: start.y,
            width: point.x - start.x,
            height: point.y - start.y,
            fill: fillValue,
          });
          break;
        case "ellipse": {
          const rx = Math.abs(point.x - start.x) / 2;
          const ry = Math.abs(point.y - start.y) / 2;
          const cx = (point.x + start.x) / 2;
          const cy = (point.y + start.y) / 2;
          setPreviewShape({
            id: baseId(),
            kind: "ellipse",
            color,
            strokeWidth,
            cx,
            cy,
            rx,
            ry,
            fill: fillValue,
          });
          break;
        }
        case "line":
          setPreviewShape({
            id: baseId(),
            kind: "line",
            color,
            strokeWidth,
            x1: start.x,
            y1: start.y,
            x2: point.x,
            y2: point.y,
          });
          break;
        case "arrow":
          setPreviewShape({
            id: baseId(),
            kind: "arrow",
            color,
            strokeWidth,
            x1: start.x,
            y1: start.y,
            x2: point.x,
            y2: point.y,
          });
          break;
      }
    },
    [tool, color, strokeWidth, filled, baseId, onEraseAt],
  );

  const onPointerUp = useCallback(
    (point: { x: number; y: number }) => {
      const drawing = drawingRef.current;
      drawingRef.current = null;
      if (!drawing) {
        setPreviewShape(null);
        return;
      }
      if (tool === "eraser") {
        setPreviewShape(null);
        return;
      }
      const start = drawing.start;
      const fillValue = filled ? color : null;
      let final: DrawingShape | null = null;
      if (tool === "pen") {
        const simplified = rdp(drawing.points);
        if (simplified.length >= 2) {
          final = {
            id: createDrawingShapeId("path"),
            kind: "path",
            color,
            strokeWidth,
            points: simplified,
          };
        }
      } else {
        const dxAbs = Math.abs(point.x - start.x);
        const dyAbs = Math.abs(point.y - start.y);
        if (dxAbs < 3 && dyAbs < 3) {
          setPreviewShape(null);
          return;
        }
        switch (tool) {
          case "rect":
            final = {
              id: createDrawingShapeId("rect"),
              kind: "rect",
              color,
              strokeWidth,
              x: start.x,
              y: start.y,
              width: point.x - start.x,
              height: point.y - start.y,
              fill: fillValue,
            };
            break;
          case "ellipse": {
            const rx = dxAbs / 2;
            const ry = dyAbs / 2;
            const cx = (point.x + start.x) / 2;
            const cy = (point.y + start.y) / 2;
            final = {
              id: createDrawingShapeId("ellipse"),
              kind: "ellipse",
              color,
              strokeWidth,
              cx,
              cy,
              rx,
              ry,
              fill: fillValue,
            };
            break;
          }
          case "line":
            final = {
              id: createDrawingShapeId("line"),
              kind: "line",
              color,
              strokeWidth,
              x1: start.x,
              y1: start.y,
              x2: point.x,
              y2: point.y,
            };
            break;
          case "arrow":
            final = {
              id: createDrawingShapeId("arrow"),
              kind: "arrow",
              color,
              strokeWidth,
              x1: start.x,
              y1: start.y,
              x2: point.x,
              y2: point.y,
            };
            break;
        }
      }
      setPreviewShape(null);
      if (final) onCommitShape(final);
    },
    [tool, color, strokeWidth, filled, onCommitShape],
  );

  const cancel = useCallback(() => {
    drawingRef.current = null;
    setPreviewShape(null);
  }, []);

  return {
    tool,
    setTool,
    color,
    setColor,
    strokeWidth,
    setStrokeWidth,
    filled,
    setFilled,
    previewShape,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    cancel,
  };
}
