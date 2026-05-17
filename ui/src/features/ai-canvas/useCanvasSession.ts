import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { getCanvasSession, isCanvasSessionNotFound } from "@/api";
import {
  useCreateCanvasSessionMutation,
  useUpdateCanvasSessionMutation,
} from "@/queries";
import { fileName } from "@/ui";
import {
  normalizeAICanvasSession,
  shouldScheduleAICanvasAutoSave,
  type AICanvasSession,
  type CanvasCard,
  type ChatHistoryEntry,
} from "./aiCanvasState";
import type { CanvasPlanState } from "./canvasPlanState";
import type { TFunction } from "i18next";

interface UseCanvasSessionOpts {
  cards: CanvasCard[];
  selectedCardIds: string[];
  viewport: { x: number; y: number; scale: number };
  chatHistory: ChatHistoryEntry[];
  cardWidths: Record<string, number>;
  plan?: CanvasPlanState;
  viewMode: "normal" | "compact" | "hidden";
  setCards: Dispatch<SetStateAction<CanvasCard[]>>;
  setSelectedCardIds: Dispatch<SetStateAction<string[]>>;
  setViewport: Dispatch<
    SetStateAction<{ x: number; y: number; scale: number }>
  >;
  setChatHistory: Dispatch<SetStateAction<ChatHistoryEntry[]>>;
  setCardWidths: Dispatch<SetStateAction<Record<string, number>>>;
  setPlan: Dispatch<SetStateAction<CanvasPlanState | undefined>>;
  setHideNonImageCards: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setClearConfirmOpen: Dispatch<SetStateAction<boolean>>;
  isDragging: boolean;
  isDraggingRef: MutableRefObject<boolean>;
  captureCanvasBlob: () => Promise<Blob | undefined>;
  urlSessionId: string | undefined;
  setSearchParams: (
    updater: (prev: URLSearchParams) => URLSearchParams,
    opts?: { replace?: boolean },
  ) => void;
  t: TFunction;
  toast: {
    success: (msg: string) => void;
    error: (msg: string, opts?: { title?: string }) => void;
  };
}

export function useCanvasSession(opts: UseCanvasSessionOpts) {
  const {
    cards,
    selectedCardIds,
    viewport,
    chatHistory,
    cardWidths,
    plan,
    viewMode,
    setCards,
    setSelectedCardIds,
    setViewport,
    setChatHistory,
    setCardWidths,
    setPlan,
    setHideNonImageCards,
    setError,
    setClearConfirmOpen,
    isDragging,
    isDraggingRef,
    captureCanvasBlob,
    urlSessionId,
    setSearchParams,
    t,
    toast,
  } = opts;

  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>(
    () =>
      urlSessionId ??
      sessionStorage.getItem("aisets.canvas.sessionId") ??
      undefined,
  );
  const [currentSessionName, setCurrentSessionName] = useState<
    string | undefined
  >(() => sessionStorage.getItem("aisets.canvas.sessionName") ?? undefined);
  const [isDirty, setIsDirty] = useState(false);
  const [sessionsDialogOpen, setSessionsDialogOpen] = useState(false);
  const [newCanvasConfirmOpen, setNewCanvasConfirmOpen] = useState(false);
  const [saveNameDialogOpen, setSaveNameDialogOpen] = useState(false);
  const [saveNameDefault, setSaveNameDefault] = useState("");
  const [saveAsMode, setSaveAsMode] = useState(false);

  const dirtyVersionRef = useRef(0);
  const savedVersionRef = useRef(0);
  const suppressDirtyRef = useRef(true);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const createSessionMut = useCreateCanvasSessionMutation();
  const updateSessionMut = useUpdateCanvasSessionMutation();
  const isSaving = createSessionMut.isPending || updateSessionMut.isPending;

  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (currentSessionId) {
          next.set("session", currentSessionId);
        } else {
          next.delete("session");
        }
        return next;
      },
      { replace: true },
    );
  }, [currentSessionId, setSearchParams]);

  useEffect(() => {
    try {
      if (currentSessionId) {
        sessionStorage.setItem("aisets.canvas.sessionId", currentSessionId);
      } else {
        sessionStorage.removeItem("aisets.canvas.sessionId");
      }
      if (currentSessionName) {
        sessionStorage.setItem("aisets.canvas.sessionName", currentSessionName);
      } else {
        sessionStorage.removeItem("aisets.canvas.sessionName");
      }
    } catch {
      // sessionStorage unavailable
    }
  }, [currentSessionId, currentSessionName]);

  function clearMissingSessionReference() {
    suppressDirtyRef.current = true;
    setCurrentSessionId(undefined);
    setCurrentSessionName(undefined);
    dirtyVersionRef.current = 0;
    savedVersionRef.current = 0;
    setIsDirty(false);
    requestAnimationFrame(() => {
      suppressDirtyRef.current = false;
    });
  }

  useEffect(() => {
    if (!urlSessionId) return;
    let cancelled = false;
    getCanvasSession(urlSessionId)
      .then(({ session }) => {
        if (cancelled) return;
        const parsed = normalizeAICanvasSession(JSON.parse(session.stateJson));
        suppressDirtyRef.current = true;
        setCards(parsed.cards);
        setSelectedCardIds(parsed.selectedCardIds ?? []);
        setViewport(parsed.viewport);
        setChatHistory(parsed.chatHistory ?? []);
        setCardWidths(parsed.cardWidths ?? {});
        setHideNonImageCards(parsed.viewMode === "hidden");
        setCurrentSessionId(session.id);
        setCurrentSessionName(session.name);
        dirtyVersionRef.current = 0;
        savedVersionRef.current = 0;
        setIsDirty(false);
        requestAnimationFrame(() => {
          suppressDirtyRef.current = false;
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          if (isCanvasSessionNotFound(err)) {
            clearMissingSessionReference();
            return;
          }
          suppressDirtyRef.current = false;
          toast.error(t("aiCanvas.saveError"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (suppressDirtyRef.current) return;
    dirtyVersionRef.current += 1;
    setIsDirty(dirtyVersionRef.current !== savedVersionRef.current);
  }, [cards, chatHistory, cardWidths, plan, viewport]);

  useEffect(() => {
    if (urlSessionId) return;
    requestAnimationFrame(() => {
      suppressDirtyRef.current = false;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function clearCanvas() {
    suppressDirtyRef.current = true;
    setCards([]);
    setSelectedCardIds([]);
    setChatHistory([]);
    setPlan(undefined);
    setError("");
    setClearConfirmOpen(false);
    setCurrentSessionId(undefined);
    setCurrentSessionName(undefined);
    setIsDirty(false);
    dirtyVersionRef.current = 0;
    savedVersionRef.current = 0;
    requestAnimationFrame(() => {
      suppressDirtyRef.current = false;
    });
  }

  function autoSessionName() {
    const firstAsset = cards.find((c) => c.kind === "asset");
    if (firstAsset && firstAsset.kind === "asset") {
      const name = fileName(firstAsset.asset.repoPath);
      const extra = cards.length - 1;
      return extra > 0 ? `${name} +${extra}` : name;
    }
    return `Canvas ${new Date().toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
  }

  function buildStateJson(): string {
    const session: AICanvasSession = {
      version: 1,
      cards,
      selectedCardIds: selectedCardIds.length > 0 ? selectedCardIds : undefined,
      viewport,
      chatHistory: chatHistory.slice(-10),
      cardWidths: Object.keys(cardWidths).length > 0 ? cardWidths : undefined,
      plan,
      viewMode: viewMode !== "normal" ? viewMode : undefined,
    };
    return JSON.stringify(session);
  }

  async function doSave(name: string, asNew: boolean, silent = false) {
    const thumbnail = await captureCanvasBlob();
    const stateJson = buildStateJson();
    const cardCount = cards.length;
    const createNewSession = () => {
      createSessionMut.mutate(
        { name, stateJson, thumbnail, cardCount },
        {
          onSuccess: (res) => {
            savedVersionRef.current = dirtyVersionRef.current;
            setIsDirty(false);
            setCurrentSessionId(res.session.id);
            setCurrentSessionName(res.session.name);
            if (!silent) toast.success(t("aiCanvas.saveSuccess"));
          },
          onError: () => toast.error(t("aiCanvas.saveError")),
        },
      );
    };

    if (currentSessionId && !asNew) {
      updateSessionMut.mutate(
        { id: currentSessionId, name, stateJson, thumbnail, cardCount },
        {
          onSuccess: (res) => {
            savedVersionRef.current = dirtyVersionRef.current;
            setIsDirty(false);
            setCurrentSessionName(res.session.name);
            if (!silent) toast.success(t("aiCanvas.saveSuccess"));
          },
          onError: (err) => {
            if (isCanvasSessionNotFound(err)) {
              clearMissingSessionReference();
              createNewSession();
              return;
            }
            toast.error(t("aiCanvas.saveError"));
          },
        },
      );
    } else {
      createNewSession();
    }
  }

  function handleSave() {
    void doSave(currentSessionName ?? autoSessionName(), false);
  }

  function handleSaveAs() {
    setSaveAsMode(true);
    setSaveNameDefault(autoSessionName());
    setSaveNameDialogOpen(true);
  }

  const handleSaveRef = useRef(handleSave);
  const handleSaveAsRef = useRef(handleSaveAs);
  useEffect(() => {
    handleSaveRef.current = handleSave;
    handleSaveAsRef.current = handleSaveAs;
  });

  useEffect(() => {
    if (
      !shouldScheduleAICanvasAutoSave({
        isDirty,
        cardsLength: cards.length,
        isSaving,
        isDragging: isDragging || isDraggingRef.current,
      })
    ) {
      return;
    }
    clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      if (cards.length === 0 || isDraggingRef.current) return;
      void doSave(currentSessionName ?? autoSessionName(), false, true);
    }, 3000);
    return () => clearTimeout(autoSaveTimerRef.current);
  });

  async function handleLoadSession(sessionId: string) {
    setSessionsDialogOpen(false);
    try {
      const { session } = await getCanvasSession(sessionId);
      const parsed = normalizeAICanvasSession(JSON.parse(session.stateJson));
      suppressDirtyRef.current = true;
      setCards(parsed.cards);
      setSelectedCardIds(parsed.selectedCardIds ?? []);
      setViewport(parsed.viewport);
      setChatHistory(parsed.chatHistory ?? []);
      setCardWidths(parsed.cardWidths ?? {});
      setPlan(parsed.plan);
      setHideNonImageCards(parsed.viewMode === "hidden");
      setCurrentSessionId(session.id);
      setCurrentSessionName(session.name);
      dirtyVersionRef.current = 0;
      savedVersionRef.current = 0;
      setIsDirty(false);
      requestAnimationFrame(() => {
        suppressDirtyRef.current = false;
      });
    } catch {
      toast.error(t("aiCanvas.saveError"));
    }
  }

  return {
    currentSessionId,
    currentSessionName,
    setCurrentSessionName,
    isDirty,
    isSaving,
    handleSave,
    handleSaveAs,
    handleSaveRef,
    handleSaveAsRef,
    handleLoadSession,
    clearCanvas,
    doSave,
    sessionsDialogOpen,
    setSessionsDialogOpen,
    newCanvasConfirmOpen,
    setNewCanvasConfirmOpen,
    saveNameDialogOpen,
    setSaveNameDialogOpen,
    saveNameDefault,
    saveAsMode,
  };
}
