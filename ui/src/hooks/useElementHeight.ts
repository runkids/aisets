import { useCallback, useRef, useState } from "react";

export function useElementHeight(): [
  number,
  (el: HTMLDivElement | null) => void,
] {
  const [height, setHeight] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (roRef.current) {
      roRef.current.disconnect();
      roRef.current = null;
    }
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    roRef.current = ro;
  }, []);
  return [height, ref];
}
