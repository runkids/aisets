import { Building2, FileWarning, FolderOpen, Recycle, Search, Settings, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AssetItem } from '../types'
import { fileName, type Mode } from '../ui'

type Props = {
  open: boolean
  assets: AssetItem[]
  onClose: () => void
  onNavigate: (mode: Mode) => void
  onOpenAsset: (id: string) => void
}

type ModeItem = { id: Mode; labelKey: string; icon: ReactNode }

const MODE_ITEMS: ModeItem[] = [
  { id: 'projects', labelKey: 'nav.projects', icon: <Building2 size={14} /> },
  { id: 'browse', labelKey: 'nav.browse', icon: <FolderOpen size={14} /> },
  { id: 'duplicates', labelKey: 'nav.duplicates', icon: <Recycle size={14} /> },
  { id: 'unused', labelKey: 'nav.unused', icon: <Trash2 size={14} /> },
  { id: 'optimize', labelKey: 'nav.optimize', icon: <Sparkles size={14} /> },
  { id: 'lint', labelKey: 'nav.lint', icon: <FileWarning size={14} /> },
  { id: 'precheck', labelKey: 'nav.precheck', icon: <ShieldCheck size={14} /> },
  { id: 'settings', labelKey: 'nav.settings', icon: <Settings size={14} /> },
]

export function CommandPalette({ open, assets, onClose, onNavigate, onOpenAsset }: Props) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return undefined
    const id = window.setTimeout(() => {
      setQuery('')
      setActiveIndex(0)
      inputRef.current?.focus()
    }, 50)
    return () => window.clearTimeout(id)
  }, [open])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const modesWithLabels = MODE_ITEMS.map((mode) => ({ ...mode, label: t(mode.labelKey) }))
    if (!q) return { modes: modesWithLabels.slice(0, 5), assets: [] }

    const modes = modesWithLabels.filter((mode) => mode.label.toLowerCase().includes(q))
    const matched = assets
      .filter((asset) => fileName(asset.repoPath).toLowerCase().includes(q) || asset.repoPath.toLowerCase().includes(q))
      .slice(0, 8)
    return { modes, assets: matched }
  }, [query, assets, t])

  const totalItems = results.modes.length + results.assets.length
  const activeItemIndex = totalItems === 0 ? 0 : Math.min(activeIndex, totalItems - 1)

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (totalItems > 0) setActiveIndex((index) => Math.min(index + 1, totalItems - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (totalItems > 0) setActiveIndex((index) => Math.max(index - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (totalItems > 0) selectItem(activeItemIndex)
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  function selectItem(index: number) {
    if (index < 0 || index >= totalItems) return

    if (index < results.modes.length) {
      onNavigate(results.modes[index].id)
    } else {
      const asset = results.assets[index - results.modes.length]
      if (asset) onOpenAsset(asset.id)
    }
    onClose()
  }

  if (!open) return null

  return (
    <div
      className="cmdk-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="cmdk" role="dialog" aria-modal="true" aria-label={t('commandPalette.ariaLabel')}>
        <div className="cmdk-input">
          <Search size={16} className="cmdk-input-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(0)
            }}
            onKeyDown={handleKey}
            placeholder={t('commandPalette.placeholder')}
            aria-label={t('commandPalette.searchAriaLabel')}
          />
          <span className="search-kbd">esc</span>
        </div>

        <div className="cmdk-list">
          {results.modes.length > 0 && <div className="cmdk-section-h">{t('commandPalette.pages')}</div>}
          {results.modes.map((mode, index) => (
            <button
              key={mode.id}
              type="button"
              className="cmdk-item"
              data-active={activeItemIndex === index || undefined}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectItem(index)}
            >
              <span className="cmdk-item-icon" aria-hidden="true">{mode.icon}</span>
              <span className="cmdk-item-label">{mode.label}</span>
            </button>
          ))}

          {results.assets.length > 0 && <div className="cmdk-section-h">{t('commandPalette.assets')}</div>}
          {results.assets.map((asset, index) => {
            const resultIndex = results.modes.length + index
            return (
              <button
                key={asset.id}
                type="button"
                className="cmdk-item cmdk-item-asset"
                data-active={activeItemIndex === resultIndex || undefined}
                onMouseEnter={() => setActiveIndex(resultIndex)}
                onClick={() => selectItem(resultIndex)}
              >
                <span className="cmdk-mini-thumb" aria-hidden="true">
                  <img src={asset.thumbnailUrl || asset.url} alt="" loading="lazy" />
                </span>
                <span className="cmdk-asset-text">
                  <span className="cmdk-item-label cmdk-asset-name">{fileName(asset.repoPath)}</span>
                  <span className="cmdk-item-path">{asset.repoPath}</span>
                </span>
                <span className="cmdk-item-meta">{asset.projectName}</span>
              </button>
            )
          })}

          {totalItems === 0 && <div className="cmdk-empty">{t('common.noResults')}</div>}
        </div>
      </div>
    </div>
  )
}
