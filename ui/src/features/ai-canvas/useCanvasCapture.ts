import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { CanvasCard } from "./aiCanvasState";
import { isImageCard } from "./canvasUtils";

export type CapturePadding = { x: number; y: number };

type CaptureOpts = {
  rootRef: React.RefObject<HTMLDivElement | null>;
  cardElementsRef: React.MutableRefObject<Map<string, HTMLElement>>;
  scanId: number | undefined;
  cards: CanvasCard[];
  selectedCardIds: string[];
  viewport: { x: number; y: number; scale: number };
  capturePadding: CapturePadding;
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
const ZERO_CAPTURE_PADDING: CapturePadding = { x: 0, y: 0 };
export const DEFAULT_CAPTURE_PADDING: CapturePadding = {
  x: CAPTURE_PADDING,
  y: CAPTURE_PADDING,
};
const AUTO_DISMISS_MS = 15000;
const SESSION_THUMBNAIL_MAX_PX = 640;
const RENDER_FRAME_RETRY_COUNT = 8;
const IMAGE_READY_TIMEOUT_MS = 2000;

type CaptureState = Pick<
  CaptureOpts,
  "cards" | "selectedCardIds" | "viewport" | "capturePadding"
>;

export function captureImageCards(cards: CanvasCard[], ids: Set<string>) {
  return cards.filter((card) => isImageCard(card) && ids.has(card.id));
}

export async function capturePreviewSignature(blob: Blob) {
  const data = new Uint8Array(await blob.arrayBuffer());
  let hash = 0x811c9dc5;
  for (const byte of data) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${blob.type}:${blob.size}:${(hash >>> 0).toString(16)}`;
}

export function shouldSkipDuplicatePreview(
  previousSignature: string | null,
  activePreviewUrl: string | null,
  nextSignature: string,
) {
  return previousSignature === nextSignature && activePreviewUrl !== null;
}

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
  return captureImageCards(cards, ids).flatMap((card) => {
    const cardEl = cardElements.get(card.id);
    const frameEl = cardEl?.querySelector<HTMLElement>(
      "[data-ai-canvas-image-frame='true'], [data-ai-canvas-asset-frame='true']",
    );
    const img = frameEl?.querySelector<HTMLImageElement>("img");
    if (!cardEl || !frameEl || !img) return [];

    const bounds = screenRectToWorld(
      cardEl.getBoundingClientRect(),
      rootRect,
      viewport,
    );
    const imgs = Array.from(frameEl.querySelectorAll<HTMLImageElement>("img"));
    return imgs.map((img) => {
      const frame = screenRectToWorld(
        img.getBoundingClientRect(),
        rootRect,
        viewport,
      );
      const styles = window.getComputedStyle(img);
      const contentBox = {
        x: frame.x + px(styles.paddingLeft, 0),
        y: frame.y + px(styles.paddingTop, 0),
        width: Math.max(
          1,
          frame.width - px(styles.paddingLeft, 0) - px(styles.paddingRight, 0),
        ),
        height: Math.max(
          1,
          frame.height - px(styles.paddingTop, 0) - px(styles.paddingBottom, 0),
        ),
      };
      const rect = containRect(contentBox, img.naturalWidth, img.naturalHeight);

      return { ...rect, bounds, img };
    });
  });
}

function nextPaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function imageElementReady(img: HTMLImageElement) {
  return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
}

async function waitForImageReady(img: HTMLImageElement) {
  if (imageElementReady(img)) {
    await img.decode?.().catch(() => undefined);
    return imageElementReady(img);
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      img.removeEventListener("load", finish);
      img.removeEventListener("error", finish);
      resolve();
    };
    const timer = window.setTimeout(finish, IMAGE_READY_TIMEOUT_MS);
    img.addEventListener("load", finish, { once: true });
    img.addEventListener("error", finish, { once: true });
  });

  if (imageElementReady(img)) {
    await img.decode?.().catch(() => undefined);
  }
  return imageElementReady(img);
}

async function waitForRenderableFrames(
  cards: CanvasCard[],
  ids: Set<string>,
  cardElements: Map<string, HTMLElement>,
  root: HTMLElement,
  viewport: { x: number; y: number; scale: number },
  crop?: CaptureCrop,
) {
  const expectedImageCount = captureImageCards(cards, ids).length;
  let frames = imageRenderFrames(cards, ids, cardElements, root, viewport);

  for (let attempt = 0; attempt < RENDER_FRAME_RETRY_COUNT; attempt += 1) {
    const visibleFrames = crop
      ? frames.filter((frame) => frameIntersectsCrop(frame, crop))
      : frames;
    if (
      frames.length >= expectedImageCount &&
      visibleFrames.every((frame) => imageElementReady(frame.img))
    ) {
      return frames;
    }

    if (visibleFrames.length > 0) {
      await Promise.all(
        visibleFrames.map((frame) => waitForImageReady(frame.img)),
      );
    }
    await nextPaint();
    frames = imageRenderFrames(cards, ids, cardElements, root, viewport);
  }

  return frames;
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
  padding: CapturePadding = DEFAULT_CAPTURE_PADDING,
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

  const inset = padding;
  return {
    scanId,
    transparent,
    outputWidth: Math.ceil(captureCrop.width * outputScale + inset.x * 2),
    outputHeight: Math.ceil(captureCrop.height * outputScale + inset.y * 2),
    cards: visibleFrames.map((frame) => ({
      assetId: frame.assetId,
      x: (frame.x - captureCrop.x) * outputScale + inset.x,
      y: (frame.y - captureCrop.y) * outputScale + inset.y,
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

type CanvasBlobOptions = {
  type?: string;
  quality?: number;
};

function canvasToBlob(
  canvas: HTMLCanvasElement,
  options: CanvasBlobOptions = {},
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("capture failed"));
      },
      options.type ?? "image/png",
      options.quality,
    );
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
  padding: CapturePadding = ZERO_CAPTURE_PADDING,
  blobOptions?: CanvasBlobOptions,
) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(
    1,
    Math.ceil(crop.width * outputScale + padding.x * 2),
  );
  canvas.height = Math.max(
    1,
    Math.ceil(crop.height * outputScale + padding.y * 2),
  );
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("capture canvas unavailable");

  drawCanvasBackground(ctx, root, canvas.width, canvas.height, transparent);

  for (const frame of frames) {
    if (!frameIntersectsCrop(frame, crop)) continue;
    if (!(await waitForImageReady(frame.img))) continue;
    ctx.drawImage(
      frame.img,
      (frame.x - crop.x) * outputScale + padding.x,
      (frame.y - crop.y) * outputScale + padding.y,
      frame.width * outputScale,
      frame.height * outputScale,
    );
  }

  return canvasToBlob(canvas, blobOptions);
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
  const {
    rootRef,
    cardElementsRef,
    cards,
    selectedCardIds,
    viewport,
    capturePadding,
  } = opts;
  const [isCapturing, setIsCapturing] = useState(false);
  const [preview, setPreview] = useState<CapturePreview | null>(null);
  const prevUrlRef = useRef<string | null>(null);
  const prevSignatureRef = useRef<string | null>(null);
  const latestStateRef = useRef<CaptureState>({
    cards,
    selectedCardIds,
    viewport,
    capturePadding,
  });

  useLayoutEffect(() => {
    latestStateRef.current = {
      cards,
      selectedCardIds,
      viewport,
      capturePadding,
    };
  }, [cards, selectedCardIds, viewport, capturePadding]);

  useEffect(() => {
    return () => {
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
      prevSignatureRef.current = null;
    };
  }, []);

  const showPreview = useCallback(async (blob: Blob) => {
    const signature = await capturePreviewSignature(blob);
    if (
      shouldSkipDuplicatePreview(
        prevSignatureRef.current,
        prevUrlRef.current,
        signature,
      )
    ) {
      return;
    }
    if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
    const url = URL.createObjectURL(blob);
    prevUrlRef.current = url;
    prevSignatureRef.current = signature;
    setPreview({ blob, url });
  }, []);

  const dismissPreview = useCallback(() => {
    setPreview(null);
    if (prevUrlRef.current) {
      URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = null;
    }
    prevSignatureRef.current = null;
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
      const state = latestStateRef.current;
      const frames = await waitForRenderableFrames(
        state.cards,
        ids,
        cardElementsRef.current,
        root,
        state.viewport,
        crop,
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
          state.capturePadding,
        );
        await showPreview(blob);
      } finally {
        setIsCapturing(false);
      }
    },
    [rootRef, cardElementsRef, showPreview],
  );

  const captureViewport = useCallback(
    async (transparent = false) => {
      const root = rootRef.current;
      if (!root) return;
      const state = latestStateRef.current;
      const worldMinX = -state.viewport.x / state.viewport.scale;
      const worldMinY = -state.viewport.y / state.viewport.scale;
      return captureWithIds(
        new Set(state.cards.map((c) => c.id)),
        {
          x: worldMinX,
          y: worldMinY,
          width: root.clientWidth / state.viewport.scale,
          height: root.clientHeight / state.viewport.scale,
        },
        state.viewport.scale,
        transparent,
      );
    },
    [rootRef, captureWithIds],
  );

  const captureCanvas = useCallback(
    async (transparent = false) => {
      const state = latestStateRef.current;
      return captureWithIds(
        new Set(state.cards.map((c) => c.id)),
        undefined,
        1,
        transparent,
      );
    },
    [captureWithIds],
  );

  const captureSelected = useCallback(
    async (transparent = false) => {
      const state = latestStateRef.current;
      if (state.selectedCardIds.length === 0) return;
      return captureWithIds(
        new Set(state.selectedCardIds),
        undefined,
        1,
        transparent,
      );
    },
    [captureWithIds],
  );

  const captureCanvasForAI = useCallback(async () => {
    const root = rootRef.current;
    if (!root) return undefined;
    const state = latestStateRef.current;
    const frames = await waitForRenderableFrames(
      state.cards,
      new Set(state.cards.map((c) => c.id)),
      cardElementsRef.current,
      root,
      state.viewport,
    );
    if (frames.length === 0) return undefined;
    const crop = captureCropForFrames(frames);
    if (!crop) return undefined;
    const outputScale = Math.min(1, 512 / Math.max(crop.width, crop.height));
    const blob = await captureRenderedFrames(
      root,
      frames,
      crop,
      outputScale,
      false,
      ZERO_CAPTURE_PADDING,
      {
        type: "image/jpeg",
        quality: 0.72,
      },
    );
    return blobToDataURL(blob);
  }, [rootRef, cardElementsRef]);

  const captureCanvasBlob = useCallback(async (): Promise<Blob | undefined> => {
    const root = rootRef.current;
    if (!root) return undefined;
    const state = latestStateRef.current;
    const frames = await waitForRenderableFrames(
      state.cards,
      new Set(state.cards.map((c) => c.id)),
      cardElementsRef.current,
      root,
      state.viewport,
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
      ZERO_CAPTURE_PADDING,
    );
  }, [rootRef, cardElementsRef]);

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
