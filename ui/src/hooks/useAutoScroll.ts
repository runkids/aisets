import type { Virtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, type RefObject } from 'react'

export function useAutoScroll<TScrollElement extends HTMLElement, TItemElement extends Element>({
  items,
  activeAssetId,
  autoScrollAssetId,
  scrollRef,
  virtualizer,
  toIndex,
  enabled = true,
  onDone,
}: {
  items: { id: string }[]
  activeAssetId: string
  autoScrollAssetId: string
  scrollRef: RefObject<TScrollElement | null>
  virtualizer: Virtualizer<TScrollElement, TItemElement>
  toIndex?: (selectedIndex: number) => number
  enabled?: boolean
  onDone: () => void
}) {
  const selectedIndex = useMemo(
    () => items.findIndex((item) => item.id === autoScrollAssetId),
    [autoScrollAssetId, items],
  )

  useEffect(() => {
    if (!enabled || !autoScrollAssetId || activeAssetId !== autoScrollAssetId || selectedIndex < 0 || !scrollRef.current) return

    const scrollIndex = toIndex ? toIndex(selectedIndex) : selectedIndex
    virtualizer.scrollToIndex(scrollIndex, { align: 'center' })

    const raf = window.requestAnimationFrame(() => {
      virtualizer.scrollToIndex(scrollIndex, { align: 'center' })
      onDone()
    })

    return () => window.cancelAnimationFrame(raf)
  }, [activeAssetId, autoScrollAssetId, enabled, onDone, scrollRef, selectedIndex, toIndex, virtualizer])
}
