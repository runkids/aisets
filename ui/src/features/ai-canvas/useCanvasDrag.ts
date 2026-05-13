import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  canvasWheelZoomFactor,
  intersects,
  selectionBounds,
  zoomViewportAtPoint,
  type CanvasSelection,
} from "./canvasUtils";
import { clampCanvasScale, type CanvasCard } from "./aiCanvasState";

export function useCanvasDrag(opts: {
  rootRef: React.RefObject<HTMLDivElement | null>;
  viewport: { x: number; y: number; scale: number };
  cards: CanvasCard[];
  selectedCardIds: string[];
  setCards: React.Dispatch<React.SetStateAction<CanvasCard[]>>;
  setViewport: React.Dispatch<
    React.SetStateAction<{ x: number; y: number; scale: number }>
  >;
  setSelectedCardIds: React.Dispatch<React.SetStateAction<string[]>>;
  setDragPreview: React.Dispatch<
    React.SetStateAction<{ cardId: string; x: number; y: number } | null>
  >;
}): {
  canvasSelection: CanvasSelection | null;
  cardElementsRef: React.MutableRefObject<Map<string, HTMLElement>>;
  registerCardElement: (cardId: string, node: HTMLElement | null) => void;
  handleDragStart: (
    e: ReactPointerEvent<HTMLDivElement>,
    card: CanvasCard,
  ) => void;
  handleDragMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  handleDragEnd: (e: ReactPointerEvent<HTMLDivElement>) => void;
  handleWheel: (e: ReactWheelEvent<HTMLDivElement>) => void;
  handleCanvasPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  handleCanvasPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  handleCanvasPointerEnd: (e: ReactPointerEvent<HTMLDivElement>) => void;
} {
  const {
    rootRef,
    viewport,
    cards,
    selectedCardIds,
    setCards,
    setViewport,
    setSelectedCardIds,
    setDragPreview,
  } = opts;

  const [canvasSelection, setCanvasSelection] =
    useState<CanvasSelection | null>(null);

  const cardElementsRef = useRef(new Map<string, HTMLElement>());
  const canvasSelectionRef = useRef<CanvasSelection | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const dragRef = useRef<{
    cardId: string;
    element: HTMLElement | null;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    previewsConnectors: boolean;
    lastPreviewAt: number;
    peers: Array<{
      id: string;
      el: HTMLElement;
      startX: number;
      startY: number;
    }>;
  } | null>(null);
  const wheelFrameRef = useRef<number | null>(null);
  const wheelPendingRef = useRef<{
    panX: number;
    panY: number;
    zoomFactor: number;
    point: { x: number; y: number } | null;
  }>({ panX: 0, panY: 0, zoomFactor: 1, point: null });

  // --- gesture prevention effect ---
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const options = { capture: true, passive: false } as const;
    const preventGesture = (event: Event) => event.preventDefault();
    const preventCanvasWheel = (event: WheelEvent) => {
      const target = event.target;
      const targetElement =
        target instanceof Element
          ? target
          : target instanceof Node
            ? target.parentElement
            : null;
      const scrollContainer = targetElement?.closest(
        "[data-ai-canvas-scroll='true']",
      );
      const verticalScroll = Math.abs(event.deltaY) >= Math.abs(event.deltaX);
      if (
        scrollContainer &&
        verticalScroll &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        return;
      }
      event.preventDefault();
    };

    root.addEventListener("gesturestart", preventGesture, options);
    root.addEventListener("gesturechange", preventGesture, options);
    root.addEventListener("gestureend", preventGesture, options);
    root.addEventListener("wheel", preventCanvasWheel, options);

    return () => {
      root.removeEventListener("gesturestart", preventGesture, true);
      root.removeEventListener("gesturechange", preventGesture, true);
      root.removeEventListener("gestureend", preventGesture, true);
      root.removeEventListener("wheel", preventCanvasWheel, true);
    };
  }, [rootRef]);

  // --- card element registration ---
  const registerCardElement = useCallback(
    (cardId: string, node: HTMLElement | null) => {
      if (node) {
        cardElementsRef.current.set(cardId, node);
        return;
      }
      cardElementsRef.current.delete(cardId);
    },
    [],
  );

  // --- drag animation frame helpers ---
  const renderDragFrame = useCallback(() => {
    dragFrameRef.current = null;
    const drag = dragRef.current;
    if (!drag?.element) return;
    const dx = drag.currentX - drag.startX;
    const dy = drag.currentY - drag.startY;
    drag.element.style.transform =
      "translate(" + drag.currentX + "px, " + drag.currentY + "px)";
    const peers = drag.peers;
    for (let i = 0; i < peers.length; i++) {
      const p = peers[i];
      p.el.style.transform =
        "translate(" + (p.startX + dx) + "px, " + (p.startY + dy) + "px)";
    }
    if (drag.previewsConnectors) {
      const now = performance.now();
      if (now - drag.lastPreviewAt >= 32) {
        drag.lastPreviewAt = now;
        setDragPreview({
          cardId: drag.cardId,
          x: drag.currentX,
          y: drag.currentY,
        });
      }
    }
  }, [setDragPreview]);

  const scheduleDragFrame = useCallback(() => {
    if (dragFrameRef.current !== null) return;
    dragFrameRef.current = window.requestAnimationFrame(renderDragFrame);
  }, [renderDragFrame]);

  const flushWheelFrame = useCallback(() => {
    wheelFrameRef.current = null;
    const pending = wheelPendingRef.current;
    wheelPendingRef.current = { panX: 0, panY: 0, zoomFactor: 1, point: null };

    setViewport((current) => {
      let next = current;
      if (pending.point && pending.zoomFactor !== 1) {
        const nextScale = clampCanvasScale(current.scale * pending.zoomFactor);
        next = zoomViewportAtPoint(current, pending.point, nextScale);
      }
      if (pending.panX !== 0 || pending.panY !== 0) {
        next = {
          ...next,
          x: next.x - pending.panX,
          y: next.y - pending.panY,
        };
      }
      return next;
    });
  }, [setViewport]);

  const scheduleWheelFrame = useCallback(() => {
    if (wheelFrameRef.current !== null) return;
    wheelFrameRef.current = window.requestAnimationFrame(flushWheelFrame);
  }, [flushWheelFrame]);

  useEffect(() => {
    return () => {
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current);
      }
      if (wheelFrameRef.current !== null) {
        window.cancelAnimationFrame(wheelFrameRef.current);
      }
    };
  }, []);

  // --- drag handlers ---
  function handleDragStart(
    event: ReactPointerEvent<HTMLDivElement>,
    card: CanvasCard,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const element = cardElementsRef.current.get(card.id) ?? null;
    if (element) {
      element.style.willChange = "transform";
      element.style.zIndex = "35";
    }
    const previewsConnectors =
      card.kind === "comment" ||
      cards.some(
        (candidate) =>
          candidate.kind === "comment" && candidate.anchorId === card.id,
      );
    if (previewsConnectors) {
      setDragPreview({ cardId: card.id, x: card.x, y: card.y });
    }
    const peers: Array<{
      id: string;
      el: HTMLElement;
      startX: number;
      startY: number;
    }> = [];
    if (selectedCardIds.includes(card.id)) {
      for (const peerId of selectedCardIds) {
        if (peerId === card.id) continue;
        const peerEl = cardElementsRef.current.get(peerId);
        const peerCard = cards.find((c) => c.id === peerId);
        if (peerEl && peerCard) {
          peerEl.style.willChange = "transform";
          peerEl.style.zIndex = "35";
          peers.push({
            id: peerId,
            el: peerEl,
            startX: peerCard.x,
            startY: peerCard.y,
          });
        }
      }
    }
    dragRef.current = {
      cardId: card.id,
      element,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: card.x,
      startY: card.y,
      currentX: card.x,
      currentY: card.y,
      previewsConnectors,
      lastPreviewAt: 0,
      peers,
    };
  }

  function handleDragMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    drag.currentX =
      drag.startX + (event.clientX - drag.startClientX) / viewport.scale;
    drag.currentY =
      drag.startY + (event.clientY - drag.startClientY) / viewport.scale;
    scheduleDragFrame();
  }

  function handleDragEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    const dx = drag.currentX - drag.startX;
    const dy = drag.currentY - drag.startY;
    if (drag.element) {
      drag.element.style.transform =
        "translate(" + drag.currentX + "px, " + drag.currentY + "px)";
      drag.element.style.willChange = "";
      drag.element.style.zIndex = "";
    }
    const endPeers = drag.peers;
    for (let i = 0; i < endPeers.length; i++) {
      const p = endPeers[i];
      p.el.style.transform =
        "translate(" + (p.startX + dx) + "px, " + (p.startY + dy) + "px)";
      p.el.style.willChange = "";
      p.el.style.zIndex = "";
    }
    const peerUpdates = new Map(
      endPeers.map((p) => [p.id, { x: p.startX + dx, y: p.startY + dy }]),
    );
    setCards((current) =>
      current.map((card) => {
        if (card.id === drag.cardId)
          return { ...card, x: drag.currentX, y: drag.currentY };
        const peerPos = peerUpdates.get(card.id);
        if (peerPos) return { ...card, x: peerPos.x, y: peerPos.y };
        return card;
      }),
    );
    if (drag.previewsConnectors) setDragPreview(null);
    dragRef.current = null;
  }

  // --- wheel handler ---
  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey) {
      const bounds = rootRef.current?.getBoundingClientRect();
      const point = bounds
        ? { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
        : { x: 0, y: 0 };
      const factor = canvasWheelZoomFactor(event.deltaY, event.deltaMode);
      wheelPendingRef.current.zoomFactor *= factor;
      wheelPendingRef.current.point = point;
      scheduleWheelFrame();
      return;
    }
    wheelPendingRef.current.panX += event.deltaX;
    wheelPendingRef.current.panY += event.deltaY;
    scheduleWheelFrame();
  }

  // --- canvas selection / pointer handlers ---
  function canvasPoint(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = rootRef.current?.getBoundingClientRect();
    if (!bounds) return { x: event.clientX, y: event.clientY };
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.target;
    if (
      target instanceof Element &&
      (target.closest("[data-ai-canvas-card='true']") ||
        target.closest("[data-ai-canvas-overlay='true']"))
    ) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = canvasPoint(event);
    const selection = {
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
    };
    canvasSelectionRef.current = selection;
    setCanvasSelection(selection);
  }

  function handleCanvasPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    setCanvasSelection((current) => {
      if (!current) return current;
      event.preventDefault();
      const point = canvasPoint(event);
      const next = { ...current, currentX: point.x, currentY: point.y };
      canvasSelectionRef.current = next;
      return next;
    });
  }

  function handleCanvasPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const selection = canvasSelectionRef.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!selection) return;
    const bounds = selectionBounds(selection);
    const rootBounds = rootRef.current?.getBoundingClientRect();
    const matchedIds: string[] =
      rootBounds && bounds.width > 4 && bounds.height > 4
        ? cards
            .filter((card) => {
              const element = cardElementsRef.current.get(card.id);
              if (!element) return false;
              const rect = element.getBoundingClientRect();
              return intersects(bounds, {
                left: rect.left - rootBounds.left,
                top: rect.top - rootBounds.top,
                width: rect.width,
                height: rect.height,
              });
            })
            .map((card) => card.id)
        : [];
    setSelectedCardIds(matchedIds);
    canvasSelectionRef.current = null;
    setCanvasSelection(null);
  }

  return {
    canvasSelection,
    cardElementsRef,
    registerCardElement,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleWheel,
    handleCanvasPointerDown,
    handleCanvasPointerMove,
    handleCanvasPointerEnd,
  };
}
