import { useRef, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, CircleOff, Copy, Sparkles, Square } from 'lucide-react'
import type { AssetItem } from '../types'
import { useAutoScroll } from '../hooks/useAutoScroll'
import { fileName, formatBytes } from '../ui'
import { Badge, ImagePreview, Tooltip } from './ui'

type BrowseListProps = {
  items: AssetItem[]
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

const ROW_HEIGHT = 60

function formatExt(ext: string) {
  return ext.replace(/^\./, '').toUpperCase()
}

function hasDuplicates(item: AssetItem) {
  return item.duplicates.length > 0 || item.similar.length > 0 || item.duplicateGroupId != null
}

export function BrowseList({
  items,
  bgMode,
  bulkMode,
  selected,
  activeAssetId,
  autoScrollAssetId,
  imagePreviewEnabled,
  onAutoScrollDone,
  onSelect,
  onToggleSelect,
}: BrowseListProps) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is intentionally used for every Browse list so large image catalogs stay responsive.
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => items[index]?.id ?? index,
    overscan: 12,
  })

  useAutoScroll({
    items,
    activeAssetId,
    autoScrollAssetId,
    scrollRef,
    virtualizer: rowVirtualizer,
    onDone: onAutoScrollDone,
  })

  function renderRow(item: AssetItem, style?: CSSProperties) {
    const isActive = activeAssetId === item.id
    const isSelected = selected.has(item.id)
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
        className={style ? 'list-row vrow' : 'list-row'}
        data-active={isSelected || isActive || undefined}
        style={style}
        onClick={() => (bulkMode ? onToggleSelect(item.id) : onSelect(item))}
        aria-label={ariaLabel}
      >
        <ImagePreview
          src={imgSrc}
          alt={fileName(item.repoPath)}
          enabled={imagePreviewEnabled}
        >
          <div className="list-thumb" data-bg={bgMode}>
            <img src={imgSrc} alt="" loading="lazy" className="img-contain" />
            {bulkMode && (
              <span className="list-check" role="checkbox" aria-checked={isSelected}>
                {isSelected ? <Check size={12} /> : <Square size={10} />}
              </span>
            )}
          </div>
        </ImagePreview>
        <div className="list-main">
          <Tooltip label={item.repoPath} placement="top">
            <div className="list-name">{fileName(item.repoPath)}</div>
          </Tooltip>
          <Tooltip label={item.repoPath} placement="top">
            <div className="list-path">{item.repoPath}</div>
          </Tooltip>
        </div>
        <span className="list-cell-num">{formatBytes(item.bytes)}</span>
        <span className="list-cell-num" data-tone={isUnused ? 'danger' : undefined}>{item.usedBy.length}</span>
        <span className="list-cell mono">{item.projectName}</span>
        <span className="list-badges">
          <Badge tone="line">{formatExt(item.ext)}</Badge>
          {duplicate && (
            <span className="flag flag-dup">
              <Copy size={10} />
              {t('browse.flagDuplicate')}
            </span>
          )}
          {isUnused && (
            <span className="flag flag-unused">
              <CircleOff size={10} />
              {t('browse.flagUnusedShort')}
            </span>
          )}
          {optimizable && (
            <span className="flag flag-opt">
              <Sparkles size={10} />
              {t('browse.flagOptimizableShort')}
            </span>
          )}
        </span>
      </button>
    )
  }

  return (
    <div ref={scrollRef} className="browse-list-scroll scroll-thin">
      <div className="list" aria-label={t('browse.listAriaLabel')}>
        <div className="list-row" data-header="true">
          <span />
          <span>{t('browse.listHeaderFile')}</span>
          <span className="list-cell-num">{t('browse.listHeaderSize')}</span>
          <span className="list-cell-num">{t('browse.listHeaderRefs')}</span>
          <span>{t('browse.listHeaderProject')}</span>
          <span>{t('browse.listHeaderStatus')}</span>
        </div>
        <div className="relative" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const item = items[virtualRow.index]
            if (!item) return null
            return renderRow(item, { '--row-y': `${virtualRow.start}px` } as CSSProperties)
          })}
        </div>
      </div>
    </div>
  )
}
