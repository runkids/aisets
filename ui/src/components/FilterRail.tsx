import { useTranslation } from 'react-i18next'
import type { AssetItem } from '../types'

type FilterOption = {
  id: string
  count: number
}

type FilterRailProps = {
  items: AssetItem[]
  filters: { project: string; ext: string }
  projectOptions?: FilterOption[]
  projectTotal?: number
  extensionOptions?: FilterOption[]
  extensionTotal?: number
  onFiltersChange: (filters: { project: string; ext: string }) => void
}

function countBy(items: AssetItem[], key: 'projectName' | 'ext') {
  const map = new Map<string, number>()
  for (const item of items) {
    const value = item[key]
    map.set(value, (map.get(value) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
}

export function FilterRail({
  items,
  filters,
  projectOptions,
  projectTotal,
  extensionOptions,
  extensionTotal,
  onFiltersChange,
}: FilterRailProps) {
  const { t } = useTranslation()
  const projects = projectOptions ?? countBy(items, 'projectName')
  const extensions = extensionOptions ?? countBy(items, 'ext')
  const allProjectsCount = projectTotal ?? items.length
  const allExtensionsCount = extensionTotal ?? items.length

  function toggle(key: 'project' | 'ext', value: string) {
    onFiltersChange({
      ...filters,
      [key]: filters[key] === value ? '' : value,
    })
  }

  return (
    <aside className="filter-rail">
      <section className="filter-rail-section">
        <h3 className="filter-rail-heading">{t('filter.project')}</h3>
        <button
          type="button"
          className="f-pill"
          data-active={filters.project === '' || undefined}
          onClick={() => onFiltersChange({ ...filters, project: '' })}
        >
          <span className="f-label">{t('filter.allProjects')}</span>
          <span className="f-count">{allProjectsCount}</span>
        </button>
        {projects.map((option) => (
          <button
            key={option.id}
            type="button"
            className="f-pill"
            data-active={filters.project === option.id || undefined}
            onClick={() => toggle('project', option.id)}
          >
            <span className="f-label">{option.id}</span>
            <span className="f-count">{option.count}</span>
          </button>
        ))}
      </section>

      <section className="filter-rail-section">
        <h3 className="filter-rail-heading">{t('filter.extension')}</h3>
        <button
          type="button"
          className="f-pill"
          data-active={filters.ext === '' || undefined}
          onClick={() => onFiltersChange({ ...filters, ext: '' })}
        >
          <span className="f-label">{t('filter.allExtensions')}</span>
          <span className="f-count">{allExtensionsCount}</span>
        </button>
        {extensions.map((option) => (
          <button
            key={option.id}
            type="button"
            className="f-pill"
            data-active={filters.ext === option.id || undefined}
            onClick={() => toggle('ext', option.id)}
          >
            <span className="f-label">{option.id}</span>
            <span className="f-count">{option.count}</span>
          </button>
        ))}
      </section>
    </aside>
  )
}
