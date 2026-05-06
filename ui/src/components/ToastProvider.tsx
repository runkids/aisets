import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Toast } from "./ui";

type ToastTone = "info" | "success" | "warning" | "danger";

type ToastItem = {
  id: string;
  tone: ToastTone;
  title?: string;
  body: ReactNode;
};

type ToastApi = {
  show: (
    tone: ToastTone,
    body: ReactNode,
    opts?: { title?: string; durationMs?: number },
  ) => void;
  success: (
    body: ReactNode,
    opts?: { title?: string; durationMs?: number },
  ) => void;
  error: (
    body: ReactNode,
    opts?: { title?: string; durationMs?: number },
  ) => void;
  info: (
    body: ReactNode,
    opts?: { title?: string; durationMs?: number },
  ) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const show = useCallback<ToastApi["show"]>(
    (tone, body, opts) => {
      counter.current += 1;
      const id = `t-${Date.now()}-${counter.current}`;
      const duration = opts?.durationMs ?? (tone === "danger" ? 6000 : 3500);
      setItems((prev) => [...prev, { id, tone, title: opts?.title, body }]);
      window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (body, opts) => show("success", body, opts),
      error: (body, opts) => show("danger", body, opts),
      info: (body, opts) => show("info", body, opts),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {items.length > 0 && (
        <div className="pointer-events-none fixed bottom-6 right-6 z-[200] flex max-w-[min(420px,90vw)] flex-col gap-2">
          {items.map((it) => (
            <Toast
              key={it.id}
              tone={it.tone}
              title={it.title}
              onDismiss={() => dismiss(it.id)}
            >
              {it.body}
            </Toast>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
