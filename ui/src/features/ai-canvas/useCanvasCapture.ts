import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AssetCanvasCard,
  CanvasCard,
  UploadCanvasCard,
} from "./aiCanvasState";

type CaptureOpts = {
  rootRef: React.RefObject<HTMLDivElement | null>;
  cardElementsRef: React.MutableRefObject<Map<string, HTMLElement>>;
  scanId: number | undefined;
  cards: CanvasCard[];
  selectedCardIds: string[];
  viewport: { x: number; y: number; scale: number };
};

export type CapturePreview = {
  blob: Blob;
  url: string;
};

type FrameGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  bounds: { x: number; y: number; width: number; height: number };
};

export type CaptureFrame = FrameGeometry & {
  assetId: string;
};

type CaptureCrop = { x: number; y: number; width: number; height: number };

type CaptureRequest = {
  scanId: number;
  cards: Array<{
    assetId: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  transparent: boolean;
  outputWidth?: number;
  outputHeight?: number;
};

type RenderFrame = FrameGeometry & { img: HTMLImageElement };

const CAPTURE_PADDING = 24;
const IMAGE_FALLBACK_PADDING = 12;
const AUTO_DISMISS_MS = 15000;
const SESSION_THUMBNAIL_MAX_PX = 640;

function px(value: string | undefined, fallback = 0) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function screenRectToWorld(
  rect: DOMRect,
  rootRect: DOMRect,
  viewport: { x: number; y: number; scale: number },
) {
  return {
    x: (rect.left - rootRect.left - viewport.x) / viewport.scale,
    y: (rect.top - rootRect.top - viewport.y) / viewport.scale,
    width: rect.width / viewport.scale,
    height: rect.height / viewport.scale,
  };
}

function containRect(
  box: { x: number; y: number; width: number; height: number },
  naturalWidth: number,
  naturalHeight: number,
) {
  if (naturalWidth <= 0 || naturalHeight <= 0) return box;
  const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

function imageRenderFrames(
  cards: CanvasCard[],
  ids: Set<string>,
  cardElements: Map<string, HTMLElement>,
  root: HTMLElement,
  viewport: { x: number; y: number; scale: number },
): RenderFrame[] {
  const rootRect = root.getBoundingClientRect();
  return cards
    .filter(
      (c): c is AssetCanvasCard | UploadCanvasCard =>
        (c.kind === "asset" || c.kind === "upload") && ids.has(c.id),
    )
    .flatMap((card) => {
      const cardEl = cardElements.get(card.id);
      const frameEl = cardEl?.querySelector<HTMLElement>(
        "[data-ai-canvas-image-frame='true'], [data-ai-canvas-asset-frame='true']",
      );
      const img = frameEl?.querySelector<HTMLImageElement>("img");
      if (!cardEl || !frameEl || !img) return [];

      const frame = screenRectToWorld(
        frameEl.getBoundingClientRect(),
        rootRect,
        viewport,
      );
      const bounds = screenRectToWorld(
        cardEl.getBoundingClientRect(),
        rootRect,
        viewport,
      );
      const styles = window.getComputedStyle(img);
      const contentBox = {
        x: frame.x + px(styles.paddingLeft, IMAGE_FALLBACK_PADDING),
        y: frame.y + px(styles.paddingTop, IMAGE_FALLBACK_PADDING),
        width: Math.max(
          1,
          frame.width -
            px(styles.paddingLeft, IMAGE_FALLBACK_PADDING) -
            px(styles.paddingRight, IMAGE_FALLBACK_PADDING),
        ),
        height: Math.max(
          1,
          frame.height -
            px(styles.paddingTop, IMAGE_FALLBACK_PADDING) -
            px(styles.paddingBottom, IMAGE_FALLBACK_PADDING),
        ),
      };
      const rect = containRect(contentBox, img.naturalWidth, img.naturalHeight);

      return [{ ...rect, bounds, img }];
    });
}

function frameIntersectsCrop(frame: FrameGeometry, crop: CaptureCrop) {
  return (
    frame.bounds.x < crop.x + crop.width &&
    frame.bounds.x + frame.bounds.width > crop.x &&
    frame.bounds.y < crop.y + crop.height &&
    frame.bounds.y + frame.bounds.height > crop.y
  );
}

export function buildCaptureRequestFromFrames(
  scanId: number,
  frames: CaptureFrame[],
  crop?: CaptureCrop,
  outputScale = 1,
  transparent = false,
): CaptureRequest | null {
  const visibleFrames = crop
    ? frames.filter((frame) => frameIntersectsCrop(frame, crop))
    : frames;
  if (visibleFrames.length === 0) return null;

  const captureCrop =
    crop ??
    visibleFrames.reduce<CaptureCrop | null>((acc, frame) => {
      const minX = acc ? Math.min(acc.x, frame.bounds.x) : frame.bounds.x;
      const minY = acc ? Math.min(acc.y, frame.bounds.y) : frame.bounds.y;
      const maxX = Math.max(
        acc ? acc.x + acc.width : frame.bounds.x,
        frame.bounds.x + frame.bounds.width,
      );
      const maxY = Math.max(
        acc ? acc.y + acc.height : frame.bounds.y,
        frame.bounds.y + frame.bounds.height,
      );
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }, null);
  if (!captureCrop) return null;

  const inset = crop ? 0 : CAPTURE_PADDING;
  return {
    scanId,
    transparent,
    outputWidth: Math.ceil(captureCrop.width * outputScale + inset * 2),
    outputHeight: Math.ceil(captureCrop.height * outputScale + inset * 2),
    cards: visibleFrames.map((frame) => ({
      assetId: frame.assetId,
      x: (frame.x - captureCrop.x) * outputScale + inset,
      y: (frame.y - captureCrop.y) * outputScale + inset,
      width: frame.width * outputScale,
      height: frame.height * outputScale,
    })),
  };
}

function captureCropForFrames(frames: FrameGeometry[]): CaptureCrop | null {
  return (
    frames.reduce<CaptureCrop | null>((acc, frame) => {
      const minX = acc ? Math.min(acc.x, frame.bounds.x) : frame.bounds.x;
      const minY = acc ? Math.min(acc.y, frame.bounds.y) : frame.bounds.y;
      const maxX = Math.max(
        acc ? acc.x + acc.width : frame.bounds.x,
        frame.bounds.x + frame.bounds.width,
      );
      const maxY = Math.max(
        acc ? acc.y + acc.height : frame.bounds.y,
        frame.bounds.y + frame.bounds.height,
      );
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }, null) ?? null
  );
}

export function sessionThumbnailOutputScale(
  crop: CaptureCrop,
  maxDimension = SESSION_THUMBNAIL_MAX_PX,
) {
  const largestSide = Math.max(crop.width, crop.height);
  if (largestSide <= 0) return 0.5;
  return Math.min(0.5, maxDimension / largestSide);
}

function drawCanvasBackground(
  ctx: CanvasRenderingContext2D,
  root: HTMLElement,
  width: number,
  height: number,
  transparent: boolean,
) {
  if (transparent) return;
  const styles = window.getComputedStyle(root);
  ctx.fillStyle = styles.backgroundColor || "#fafaf7";
  ctx.fillRect(0, 0, width, height);

  const dotColor =
    document.documentElement.dataset.theme === "dark"
      ? "rgba(255,255,255,0.055)"
      : getComputedStyle(document.documentElement).getPropertyValue(
          "--g-line",
        ) || "rgba(0,0,0,0.12)";
  ctx.fillStyle = dotColor;
  for (let x = 1; x < width; x += 24) {
    for (let y = 1; y < height; y += 24) {
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("capture failed"));
    }, "image/png");
  });
}

function blobToDataURL(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("capture failed"));
    reader.readAsDataURL(blob);
  });
}

async function captureRenderedFrames(
  root: HTMLElement,
  frames: RenderFrame[],
  crop: CaptureCrop,
  outputScale: number,
  transparent: boolean,
) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(crop.width * outputScale));
  canvas.height = Math.max(1, Math.ceil(crop.height * outputScale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("capture canvas unavailable");

  drawCanvasBackground(ctx, root, canvas.width, canvas.height, transparent);

  for (const frame of frames) {
    if (!frameIntersectsCrop(frame, crop)) continue;
    ctx.drawImage(
      frame.img,
      (frame.x - crop.x) * outputScale,
      (frame.y - crop.y) * outputScale,
      frame.width * outputScale,
      frame.height * outputScale,
    );
  }

  return canvasToBlob(canvas);
}

export async function copyBlobToClipboard(blob: Blob) {
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

export function downloadBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `canvas-${Date.now()}.png`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function saveToProject(
  blob: Blob,
  projectId: string,
  fileName?: string,
): Promise<{ path: string }> {
  const form = new FormData();
  form.append("projectId", projectId);
  form.append("fileName", fileName || `canvas-${Date.now()}.png`);
  form.append("file", blob, "capture.png");
  const res = await fetch("/api/canvas/capture/save", {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    let msg = `save failed: ${res.status}`;
    try {
      const body = await res.json();
      msg = body?.error?.message || body?.error?.code || msg;
    } catch {
      const text = await res.text().catch(() => "");
      if (text) msg = text;
    }
    throw new Error(msg);
  }
  return res.json();
}

export function useCanvasCapture(opts: CaptureOpts) {
  const { rootRef, cardElementsRef, cards, selectedCardIds, viewport } = opts;
  const [isCapturing, setIsCapturing] = useState(false);
  const [preview, setPreview] = useState<CapturePreview | null>(null);
  const prevUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
    };
  }, []);

  const showPreview = useCallback((blob: Blob) => {
    if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
    const url = URL.createObjectURL(blob);
    prevUrlRef.current = url;
    setPreview({ blob, url });
  }, []);

  const dismissPreview = useCallback(() => {
    setPreview(null);
    if (prevUrlRef.current) {
      URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!preview) return;
    const timer = window.setTimeout(dismissPreview, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [preview, dismissPreview]);

  const captureWithIds = useCallback(
    async (
      ids: Set<string>,
      crop?: CaptureCrop,
      outputScale = 1,
      transparent = false,
    ) => {
      const root = rootRef.current;
      if (!root) return;
      const frames = imageRenderFrames(
        cards,
        ids,
        cardElementsRef.current,
        root,
        viewport,
      );
      if (frames.length === 0) return;
      const captureCrop = crop ?? captureCropForFrames(frames);
      if (!captureCrop) return;

      setIsCapturing(true);
      try {
        const blob = await captureRenderedFrames(
          root,
          frames,
          captureCrop,
          outputScale,
          transparent,
        );
        showPreview(blob);
      } finally {
        setIsCapturing(false);
      }
    },
    [rootRef, cards, cardElementsRef, viewport, showPreview],
  );

  const captureViewport = useCallback(
    async (transparent = false) => {
      const root = rootRef.current;
      if (!root) return;
      const worldMinX = -viewport.x / viewport.scale;
      const worldMinY = -viewport.y / viewport.scale;
      return captureWithIds(
        new Set(cards.map((c) => c.id)),
        {
          x: worldMinX,
          y: worldMinY,
          width: root.clientWidth / viewport.scale,
          height: root.clientHeight / viewport.scale,
        },
        viewport.scale,
        transparent,
      );
    },
    [rootRef, cards, viewport, captureWithIds],
  );

  const captureCanvas = useCallback(
    async (transparent = false) => {
      return captureWithIds(
        new Set(cards.map((c) => c.id)),
        undefined,
        1,
        transparent,
      );
    },
    [cards, captureWithIds],
  );

  const captureSelected = useCallback(
    async (transparent = false) => {
      if (selectedCardIds.length === 0) return;
      return captureWithIds(
        new Set(selectedCardIds),
        undefined,
        1,
        transparent,
      );
    },
    [selectedCardIds, captureWithIds],
  );

  const captureCanvasForAI = useCallback(async () => {
    const root = rootRef.current;
    if (!root) return undefined;
    const frames = imageRenderFrames(
      cards,
      new Set(cards.map((c) => c.id)),
      cardElementsRef.current,
      root,
      viewport,
    );
    if (frames.length === 0) return undefined;
    const crop = captureCropForFrames(frames);
    if (!crop) return undefined;
    const blob = await captureRenderedFrames(root, frames, crop, 1, false);
    return blobToDataURL(blob);
  }, [rootRef, cards, cardElementsRef, viewport]);

  const captureCanvasBlob = useCallback(async (): Promise<Blob | undefined> => {
    const root = rootRef.current;
    if (!root) return undefined;
    const frames = imageRenderFrames(
      cards,
      new Set(cards.map((c) => c.id)),
      cardElementsRef.current,
      root,
      viewport,
    );
    if (frames.length === 0) return undefined;
    const crop = captureCropForFrames(frames);
    if (!crop) return undefined;
    return captureRenderedFrames(
      root,
      frames,
      crop,
      sessionThumbnailOutputScale(crop),
      false,
    );
  }, [rootRef, cards, cardElementsRef, viewport]);

  return {
    captureViewport,
    captureCanvas,
    captureSelected,
    captureCanvasForAI,
    captureCanvasBlob,
    isCapturing,
    preview,
    dismissPreview,
  };
}
