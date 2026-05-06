import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, CircleOff, Copy, Sparkles, Square } from 'lucide-react'
import type { AssetItem } from '../types'
import { useAutoScroll } from '../hooks/useAutoScroll'
import { fileName, formatBytes } from '../ui'
import { Badge, ImagePreview, Tooltip } from './ui'

type BrowseGridProps = {
  items: AssetItem[]
  gridSize: 's' | 'm' | 'l'
  bgMode: 'checker' | 'light' | 'dark'
  bulkMode: boolean
  selected: Set<string>
  activeAssetId: string
  autoScrollAssetId: string
  imagePreviewEnabled: boolean
  onAutoScrollDone: () => void
  onSelect: (item: AssetItem) => void
  onToggleSelect: (id: string) => void
}

const SIZE_CONFIG: Record<BrowseGridProps['gridSize'], { min: number; gap: number; meta: number; thumbRatio: number }> = {
  s: { min: 140, gap: 8, meta: 68, thumbRatio: 1 },
  m: { min: 200, gap: 12, meta: 84, thumbRatio: 3 / 4 },
  l: { min: 300, gap: 16, meta: 96, thumbRatio: 2 / 3 },
}
const CARD_HOVER_BLEED = 12

function formatExt(ext: string) {
  return ext.replace(/^\./, '').toUpperCase()
}

function hasDuplicates(item: AssetItem) {
  return item.duplicates.length > 0 || item.similar.length > 0 || item.duplicateGroupId != null
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const update = () => {
      const nextWidth = Math.floor(element.getBoundingClientRect().width)
      setWidth((current) => (current === nextWidth ? current : nextWidth))
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}

export function BrowseGrid({
  items,
  gridSize,
  bgMode,
  bulkMode,
  selected,
  activeAssetId,
  autoScrollAssetId,
  imagePreviewEnabled,
  onAutoScrollDone,
  onSelect,
  onToggleSelect,
}: BrowseGridProps) {
  const { t } = useTranslation()
  const cfg = SIZE_CONFIG[gridSize]
  const scrollRef = useRef<HTMLDivElement>(null)
  const [gridRef, gridWidth] = useElementWidth<HTMLElement>()
  const columnCount = Math.max(1, Math.floor((gridWidth + cfg.gap) / (cfg.min + cfg.gap)))
  const rowCount = Math.ceil(items.length / columnCount)
  const cardWidth = gridWidth > 0 ? (gridWidth - cfg.gap * (columnCount - 1)) / columnCount : cfg.min
  const rowHeight = Math.ceil(cardWidth * cfg.thumbRatio + cfg.meta + cfg.gap)
  const rows = useMemo(
    () => Array.from({ length: rowCount }, (_, rowIndex) => items.slice(rowIndex * columnCount, rowIndex * columnCount + columnCount)),
    [columnCount, items, rowCount],
  )

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is intentionally used for every Browse grid so large image catalogs stay responsive.
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 6,
    paddingStart: CARD_HOVER_BLEED,
    paddingEnd: CARD_HOVER_BLEED,
  })

  useEffect(() => {
    rowVirtualizer.measure()
  }, [rowHeight, rowVirtualizer])

  const toRowIndex = useCallback((index: number) => Math.floor(index / columnCount), [columnCount])

  useAutoScroll({
    items,
    activeAssetId,
    autoScrollAssetId,
    scrollRef,
    virtualizer: rowVirtualizer,
    toIndex: toRowIndex,
    enabled: gridWidth > 0,
    onDone: onAutoScrollDone,
  })

  function renderCard(item: AssetItem) {
    const isActive = activeAssetId === item.id
    const isSelected = selected.has(item.id)
    const isVisuallySelected = isSelected || isActive
    const isUnused = item.usedBy.length === 0
    const duplicate = hasDuplicates(item)
    const optimizable = item.optimizationRecommendations.length > 0
    const statusLabels = [
      duplicate ? t('browse.flagDuplicate') : '',
      isUnused ? t('browse.flagUnused') : '',
      optimizable ? t('browse.flagOptimizable') : '',
    ].filter(Boolean)
    const ariaLabel = [item.repoPath, ...statusLabels].join(' · ')

    const imgSrc = item.thumbnailUrl || item.url

    return (
      <button
        key={item.id}
        type="button"
        className="acard"
        data-selected={isVisuallySelected || undefined}
        onClick={() => (bulkMode ? onToggleSelect(item.id) : onSelect(item))}
        aria-label={ariaLabel}
      >
        <ImagePreview
          src={imgSrc}
          alt={fileName(item.repoPath)}
          enabled={imagePreviewEnabled}
        >
          <div className="acard-thumb" data-bg={bgMode}>
            <img src={imgSrc} alt="" loading="lazy" className="acard-img" />
            {(duplicate || isUnused || optimizable) && (
              <div className="acard-flags" aria-hidden="true">
                {duplicate && (
                  <span className="flag flag-dup">
                    <Copy size={10} />
                    {t('browse.flagDuplicate')}
                  </span>
                )}
                {isUnused && (
                  <span className="flag flag-unused">
                    <CircleOff size={10} />
                    {t('browse.flagUnused')}
                  </span>
                )}
                {optimizable && (
                  <span className="flag flag-opt">
                    <Sparkles size={10} />
                    {t('browse.flagOptimizable')}
                  </span>
                )}
              </div>
            )}
            <span
              className="acard-check"
              role={bulkMode ? 'checkbox' : undefined}
              aria-checked={bulkMode ? isSelected : undefined}
              aria-label={bulkMode ? (isSelected ? t('action.deselect') : t('action.select')) : undefined}
            >
              {isSelected || (!bulkMode && isActive) ? <Check size={12} /> : <Square size={10} />}
            </span>
          </div>
        </ImagePreview>
        <div className="acard-meta">
          <Tooltip label={item.repoPath} placement="top">
            <div className="acard-name">{fileName(item.repoPath)}</div>
          </Tooltip>
          <Tooltip label={item.repoPath} placement="top">
            <div className="acard-path">{item.repoPath}</div>
          </Tooltip>
          <div className="acard-row">
            <Badge tone="line">{formatExt(item.ext)}</Badge>
            <Badge>{formatBytes(item.bytes)}</Badge>
            <Badge className="ml-auto" tone={isUnused ? 'red' : 'line'}>{item.usedBy.length}↗</Badge>
          </div>
        </div>
      </button>
    )
  }

  return (
    <div ref={scrollRef} className="browse-grid-scroll scroll-thin">
      <section
        ref={gridRef}
        className="browse-grid browse-grid--virtual"
        data-size={gridSize}
        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        aria-label={t('browse.gridAriaLabel')}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            className="vgrid-row"
            style={{
              '--row-y': `${virtualRow.start}px`,
              '--row-cols': columnCount,
              '--row-gap': `${cfg.gap}px`,
              height: `${rowHeight}px`,
              paddingBottom: cfg.gap,
            } as CSSProperties}
          >
            {rows[virtualRow.index]?.map(renderCard)}
          </div>
        ))}
      </section>
    </div>
  )
}
