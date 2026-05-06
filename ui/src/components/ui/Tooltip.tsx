import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Placement = "top" | "bottom" | "left" | "right";

type TooltipProps = {
  label: ReactNode;
  shortcut?: string;
  placement?: Placement;
  delay?: number;
  disabled?: boolean;
  children: ReactNode;
};

export function Tooltip({
  label,
  shortcut,
  placement = "bottom",
  delay = 200,
  disabled,
  children,
}: TooltipProps) {
  const [shown, setShown] = useState(false);
  const timerRef = useRef<number | null>(null);
  const id = useId();

  const clear = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const show = useCallback(() => {
    if (disabled) return;
    clear();
    timerRef.current = window.setTimeout(() => setShown(true), delay);
  }, [clear, delay, disabled]);

  const hide = useCallback(() => {
    clear();
    setShown(false);
  }, [clear]);

  useEffect(() => () => clear(), [clear]);

  return (
    <span
      className="tooltip-anchor"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      <span
        id={id}
        role="tooltip"
        className="tooltip"
        data-placement={placement}
        data-shown={shown || undefined}
        aria-hidden={!shown}
      >
        <span className="tooltip-label">{label}</span>
        {shortcut && <span className="tooltip-kbd">{shortcut}</span>}
      </span>
    </span>
  );
}
