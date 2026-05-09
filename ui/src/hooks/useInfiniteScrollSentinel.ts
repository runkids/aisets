import { useEffect, type RefObject } from "react";

type InfiniteScrollSentinelOptions = {
  rootRef: RefObject<HTMLElement | null>;
  sentinelRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  onLoadMore?: () => void;
};

export function useInfiniteScrollSentinel({
  rootRef,
  sentinelRef,
  enabled,
  onLoadMore,
}: InfiniteScrollSentinelOptions) {
  useEffect(() => {
    const root = rootRef.current;
    const sentinel = sentinelRef.current;
    if (!enabled || !onLoadMore || !root || !sentinel) return undefined;

    let requested = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || requested) return;
        requested = true;
        onLoadMore();
      },
      {
        root,
        rootMargin: "640px 0px",
        threshold: 0,
      },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [enabled, onLoadMore, rootRef, sentinelRef]);
}
