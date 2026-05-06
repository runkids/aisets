import {
  Database,
  Download,
  FolderPlus,
  Info,
  Keyboard,
  Moon,
  Paintbrush,
  RotateCcw,
  Scan,
  Settings2,
  Sliders,
  Sun,
  Upload,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { exportSettings } from '../api'
import { errorMessage, supportedLanguages } from '../i18n/index'
import { cn } from '../lib/cn'
import {
  useCatalogQuery,
  useImportSettingsMutation,
  useResetDatabaseMutation,
  useSettingsQuery,
  useUpdateSettingsMutation,
} from '../queries'
import type { ExportData, SettingsInfo, SettingsUpdate } from '../types'
import { Badge, Button, Card, Notice, Select, Tabs, TextInput } from './ui'

type Props = {
  theme: 'light' | 'dark'
  imagePreviewEnabled: boolean
  onThemeChange: (theme: 'light' | 'dark') => void
  onImagePreviewEnabledChange: (enabled: boolean) => void
}

type Section =
  | 'workspace'
  | 'projects'
  | 'theme'
  | 'scanning'
  | 'optimization'
  | 'hotkeys'
  | 'about'

type SettingsDraft = {
  workspaceName: string
  defaultProjectRoot: string
  autoScanOnOpen: boolean
  scanOnOpen: boolean
  excludePatternsText: string
  optimizationDefaultQuality: number
  optimizationAutoApply: boolean
}

const sectionMeta: { id: Section; icon: ReactNode }[] = [
  { id: 'workspace', icon: <Settings2 size={15} /> },
  { id: 'projects', icon: <FolderPlus size={15} /> },
  { id: 'theme', icon: <Paintbrush size={15} /> },
  { id: 'scanning', icon: <Scan size={15} /> },
  { id: 'optimization', icon: <Sliders size={15} /> },
  { id: 'hotkeys', icon: <Keyboard size={15} /> },
  { id: 'about', icon: <Info size={15} /> },
]

const defaultSettings: SettingsUpdate = {
  workspaceName: 'Asset Studio',
  defaultProjectRoot: '/workspace',
  autoScanOnOpen: false,
  scanOnOpen: false,
  excludePatterns: [],
  optimizationDefaultQuality: 80,
  optimizationAutoApply: false,
}

function draftFromSettings(settings?: SettingsInfo): SettingsDraft {
  return {
    workspaceName: settings?.workspaceName ?? defaultSettings.workspaceName ?? '',
    defaultProjectRoot:
      settings?.defaultProjectRoot ?? defaultSettings.defaultProjectRoot ?? '',
    autoScanOnOpen: settings?.autoScanOnOpen ?? false,
    scanOnOpen: settings?.scanOnOpen ?? false,
    excludePatternsText: (settings?.excludePatterns ?? []).join(', '),
    optimizationDefaultQuality: settings?.optimizationDefaultQuality ?? 80,
    optimizationAutoApply: settings?.optimizationAutoApply ?? false,
  }
}

function updateFromDraft(draft: SettingsDraft): SettingsUpdate {
  return {
    workspaceName: draft.workspaceName,
    defaultProjectRoot: draft.defaultProjectRoot,
    autoScanOnOpen: draft.autoScanOnOpen,
    scanOnOpen: draft.scanOnOpen,
    excludePatterns: draft.excludePatternsText
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
    optimizationDefaultQuality: draft.optimizationDefaultQuality,
    optimizationAutoApply: draft.optimizationAutoApply,
  }
}

function Toggle({
  checked,
  onChange,
  disabled = false,
  'aria-label': ariaLabel,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  'aria-label': string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-g-pill border border-transparent transition-colors duration-[120ms] ease-g',
        'focus-visible:outline-none focus-visible:shadow-g-focus disabled:cursor-not-allowed disabled:opacity-[0.38]',
        checked ? 'bg-g-accent' : 'bg-g-surface-3',
      )}
    >
      <span
        className={cn(
          'pointer-events-none block size-3.5 rounded-full transition-transform duration-[120ms] ease-g',
          checked
            ? 'translate-x-[18px] bg-g-accent-ink'
            : 'translate-x-[3px] bg-g-ink-3',
        )}
      />
    </button>
  )
}

function FieldRow({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 rounded-g-md border border-g-line bg-g-surface-2 px-3 py-2.5 shadow-g-inset sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <span className="font-g text-g-ui font-[510] tracking-g-ui text-g-ink-2">
          {label}
        </span>
        {description && (
          <p className="mt-0.5 font-g text-g-caption tracking-g-ui text-g-ink-4">
            {description}
          </p>
        )}
      </div>
      <div className="w-full shrink-0 sm:flex sm:w-auto sm:justify-end">
        {children}
      </div>
    </div>
  )
}

function SectionHeading({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  return (
    <div className="mb-5">
      <h2 className="m-0 font-g-display text-[18px] font-[590] leading-[1.33] tracking-[-0.013em] text-g-ink">
        {title}
      </h2>
      {description && (
        <p className="mt-1 font-g text-g-ui tracking-g-ui text-g-ink-3">
          {description}
        </p>
      )}
    </div>
  )
}

function PathRow({
  icon,
  label,
  value,
}: {
  icon?: ReactNode
  label: string
  value?: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-g-line px-3 py-2 last:border-b-0">
      <span className="flex items-center gap-1.5 whitespace-nowrap font-g text-g-caption font-[510] text-g-ink-3">
        {icon}
        {label}
      </span>
      <code className="min-w-0 truncate font-g-mono text-g-chip tracking-g-mono text-g-ink-2">
        {value ?? '...'}
      </code>
    </div>
  )
}

function SettingsActions({
  disabled,
  onSave,
  onReset,
  saveLabel,
  resetLabel,
}: {
  disabled: boolean
  onSave: () => void
  onReset: () => void
  saveLabel: string
  resetLabel: string
}) {
  return (
    <div className="mt-2 flex gap-2">
      <Button
        variant="primary"
        onClick={onSave}
        disabled={disabled}
      >
        {saveLabel}
      </Button>
      <Button variant="ghost" onClick={onReset} disabled={disabled}>
        {resetLabel}
      </Button>
    </div>
  )
}

export function SettingsView({
  theme,
  imagePreviewEnabled,
  onThemeChange,
  onImagePreviewEnabledChange,
}: Props) {
  const { i18n, t } = useTranslation()
  const [activeSection, setActiveSection] = useState<Section>('workspace')
  const [draftOverride, setDraftOverride] = useState<SettingsDraft | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const settingsQuery = useSettingsQuery()
  const catalogQuery = useCatalogQuery()
  const importMutation = useImportSettingsMutation()
  const resetMutation = useResetDatabaseMutation()
  const updateMutation = useUpdateSettingsMutation()

  const settings = settingsQuery.data?.settings
  const draft = draftOverride ?? draftFromSettings(settings)
  const projects = catalogQuery.data?.projects ?? []
  const items = catalogQuery.data?.items ?? []
  const working =
    importMutation.isPending || resetMutation.isPending || updateMutation.isPending
  const settingsActionDisabled = settingsQuery.isLoading || working

  const assetCountByProject: Record<string, number> = {}
  for (const item of items) {
    assetCountByProject[item.projectId] =
      (assetCountByProject[item.projectId] ?? 0) + 1
  }

  function updateDraft(updater: (current: SettingsDraft) => SettingsDraft) {
    setDraftOverride((current) =>
      updater(current ?? draftFromSettings(settingsQuery.data?.settings)),
    )
  }

  async function onSaveSettings() {
    const result = await updateMutation.mutateAsync(updateFromDraft(draft))
    setDraftOverride(draftFromSettings(result.settings))
  }

  async function onResetSettings() {
    const result = await updateMutation.mutateAsync(defaultSettings)
    setDraftOverride(draftFromSettings(result.settings))
  }

  async function onExport() {
    const data = await exportSettings()
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `asset-studio-export-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function onImport(file: File) {
    const text = await file.text()
    const data = JSON.parse(text) as ExportData
    await importMutation.mutateAsync(data)
    setDraftOverride(null)
  }

  async function onReset() {
    const confirmed = window.confirm(t('settings.resetConfirm'))
    if (!confirmed) return
    await resetMutation.mutateAsync()
  }

  const settingActions = (
    <SettingsActions
      disabled={settingsActionDisabled}
      onSave={() => void onSaveSettings()}
      onReset={() => void onResetSettings()}
      saveLabel={t('settings.save')}
      resetLabel={t('settings.reset')}
    />
  )

  return (
    <>
      <nav
        className="filter-rail settings-filter-rail"
        aria-label={t('mode.settings')}
      >
        <section className="filter-rail-section">
          {sectionMeta.map(({ id, icon }) => (
            <button
              key={id}
              type="button"
              className="f-pill"
              data-active={activeSection === id || undefined}
              aria-pressed={activeSection === id}
              onClick={() => setActiveSection(id)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="inline-flex shrink-0 text-current opacity-70">
                  {icon}
                </span>
                <span className="f-label">{t(`settings.section.${id}`)}</span>
              </span>
            </button>
          ))}
        </section>
      </nav>

      <div className="content-scroll settings-content-scroll">
        <div className="content-grid settings-content-grid">
          {activeSection === 'workspace' && (
            <Card padding="lg">
              <SectionHeading
                title={t('settings.section.workspace')}
                description={t('settings.workspaceDesc')}
              />
              <div className="flex flex-col gap-4">
                <FieldRow label={t('settings.workspaceName')}>
                  <TextInput
                    type="text"
                    disabled={settingsQuery.isLoading || updateMutation.isPending}
                    value={draft.workspaceName}
                    onChange={(event) =>
                      updateDraft((prev) => ({
                        ...prev,
                        workspaceName: event.target.value,
                      }))
                    }
                    placeholder="Asset Studio"
                    className="sm:w-48"
                    inputClassName="font-g tracking-g-ui"
                  />
                </FieldRow>
                <FieldRow
                  label={t('settings.defaultRoot')}
                  description={t('settings.defaultRootHint')}
                >
                  <TextInput
                    type="text"
                    disabled={settingsQuery.isLoading || updateMutation.isPending}
                    value={draft.defaultProjectRoot}
                    onChange={(event) =>
                      updateDraft((prev) => ({
                        ...prev,
                        defaultProjectRoot: event.target.value,
                      }))
                    }
                    placeholder="/workspace"
                    className="sm:w-56"
                  />
                </FieldRow>
                <FieldRow
                  label={t('settings.autoScan')}
                  description={t('settings.autoScanHint')}
                >
                  <Toggle
                    checked={draft.autoScanOnOpen}
                    onChange={(next) =>
                      updateDraft((prev) => ({ ...prev, autoScanOnOpen: next }))
                    }
                    disabled={settingsQuery.isLoading || updateMutation.isPending}
                    aria-label={t('settings.autoScan')}
                  />
                </FieldRow>
                {updateMutation.error && (
                  <Notice tone="danger">
                    {errorMessage(updateMutation.error)}
                  </Notice>
                )}
                {settingActions}
              </div>
            </Card>
          )}

          {activeSection === 'projects' && (
            <Card padding="lg">
              <SectionHeading
                title={t('settings.section.projects')}
                description={t('settings.projectsDesc')}
              />
              <div className="flex flex-col gap-3">
                {projects.length === 0 ? (
                  <p className="py-6 text-center font-g text-g-ui text-g-ink-3">
                    {t('settings.noProjects')}
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-g-md border border-g-line bg-g-surface-2">
                    {projects.map((project) => (
                      <div
                        key={project.id}
                        className="flex items-center justify-between gap-3 border-b border-g-line px-3 py-2.5 last:border-b-0"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-g text-g-ui font-[510] text-g-ink">
                            {project.name}
                          </div>
                          <div className="truncate font-g-mono text-g-chip tracking-g-mono text-g-ink-4">
                            {project.path}
                          </div>
                        </div>
                        <Badge tone="line">
                          {t('settings.projectAssets', {
                            count: assetCountByProject[project.id] ?? 0,
                          })}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )}

          {activeSection === 'theme' && (
            <Card padding="lg">
              <SectionHeading
                title={t('settings.section.theme')}
                description={t('settings.appearanceDesc')}
              />
              <div className="flex flex-col gap-4">
                <FieldRow label={t('settings.language')}>
                  <Select
                    value={i18n.language}
                    options={supportedLanguages.map((lang) => ({
                      value: lang.code,
                      label: lang.label,
                    }))}
                    onChange={(value) => i18n.changeLanguage(value)}
                    aria-label={t('settings.language')}
                  />
                </FieldRow>
                <FieldRow label={t('settings.theme')}>
                  <Tabs
                    value={theme}
                    items={[
                      {
                        value: 'light',
                        label: t('settings.light'),
                        icon: <Sun size={15} />,
                      },
                      {
                        value: 'dark',
                        label: t('settings.dark'),
                        icon: <Moon size={15} />,
                      },
                    ]}
                    onChange={onThemeChange}
                    ariaLabel={t('settings.theme')}
                  />
                </FieldRow>
                <FieldRow
                  label={t('settings.imagePreview')}
                  description={t('settings.imagePreviewHint')}
                >
                  <Toggle
                    checked={imagePreviewEnabled}
                    onChange={onImagePreviewEnabledChange}
                    aria-label={t('settings.imagePreview')}
                  />
                </FieldRow>
              </div>
            </Card>
          )}

          {activeSection === 'scanning' && (
            <Card padding="lg">
              <SectionHeading
                title={t('settings.section.scanning')}
                description={t('settings.scanningDesc')}
              />
              <div className="flex flex-col gap-4">
                <FieldRow label={t('settings.scanOnOpen')}>
                  <Toggle
                    checked={draft.scanOnOpen}
                    onChange={(next) =>
                      updateDraft((prev) => ({ ...prev, scanOnOpen: next }))
                    }
                    disabled={settingsQuery.isLoading || updateMutation.isPending}
                    aria-label={t('settings.scanOnOpen')}
                  />
                </FieldRow>
                <FieldRow
                  label={t('settings.excludePatterns')}
                  description={t('settings.excludePatternsHint')}
                >
                  <TextInput
                    type="text"
                    disabled={settingsQuery.isLoading || updateMutation.isPending}
                    value={draft.excludePatternsText}
                    onChange={(event) =>
                      updateDraft((prev) => ({
                        ...prev,
                        excludePatternsText: event.target.value,
                      }))
                    }
                    placeholder="node_modules, .git, dist"
                    className="sm:w-56"
                  />
                </FieldRow>
                {updateMutation.error && (
                  <Notice tone="danger">
                    {errorMessage(updateMutation.error)}
                  </Notice>
                )}
                {settingActions}
              </div>
            </Card>
          )}

          {activeSection === 'optimization' && (
            <Card padding="lg">
              <SectionHeading
                title={t('settings.section.optimization')}
                description={t('settings.optimizationDesc')}
              />
              <div className="flex flex-col gap-4">
                <FieldRow
                  label={t('settings.defaultQuality')}
                  description={t('settings.defaultQualityHint')}
                >
                  <div className="flex w-full items-center justify-end gap-3 sm:w-auto">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={draft.optimizationDefaultQuality}
                      disabled={settingsQuery.isLoading || updateMutation.isPending}
                      onChange={(event) =>
                        updateDraft((prev) => ({
                          ...prev,
                          optimizationDefaultQuality: Number(event.target.value),
                        }))
                      }
                      className="w-32 rounded-g-sm accent-g-accent focus-visible:outline-none focus-visible:shadow-g-focus disabled:cursor-not-allowed disabled:opacity-[0.38]"
                      aria-label={t('settings.defaultQuality')}
                    />
                    <Badge tone="line">{draft.optimizationDefaultQuality}</Badge>
                  </div>
                </FieldRow>
                <FieldRow
                  label={t('settings.autoApply')}
                  description={t('settings.autoApplyHint')}
                >
                  <Toggle
                    checked={draft.optimizationAutoApply}
                    onChange={(next) =>
                      updateDraft((prev) => ({
                        ...prev,
                        optimizationAutoApply: next,
                      }))
                    }
                    disabled={settingsQuery.isLoading || updateMutation.isPending}
                    aria-label={t('settings.autoApply')}
                  />
                </FieldRow>
                {updateMutation.error && (
                  <Notice tone="danger">
                    {errorMessage(updateMutation.error)}
                  </Notice>
                )}
                {settingActions}
              </div>
            </Card>
          )}

          {activeSection === 'hotkeys' && (
            <Card padding="lg">
              <SectionHeading
                title={t('settings.section.hotkeys')}
                description={t('settings.hotkeysDesc')}
              />
              <div className="overflow-hidden rounded-g-md border border-g-line bg-g-surface-2">
                {[
                  { keys: '⌘ K', action: t('settings.hotkeyPalette') },
                  { keys: 'Esc', action: t('settings.hotkeyClose') },
                ].map(({ keys, action }) => (
                  <div
                    key={keys}
                    className="flex items-center justify-between gap-3 border-b border-g-line px-3 py-2.5 last:border-b-0"
                  >
                    <span className="font-g text-g-ui text-g-ink-2">
                      {action}
                    </span>
                    <kbd className="rounded-g-sm border border-g-line-strong bg-g-surface-3 px-2 py-0.5 font-g-mono text-g-caption text-g-ink-3">
                      {keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {activeSection === 'about' && (
            <Card padding="lg">
              <SectionHeading
                title={t('settings.section.about')}
                description={t('settings.aboutDesc')}
              />
              <div className="flex flex-col gap-4">
                <FieldRow label={t('settings.version')}>
                  <Badge tone="default">0.1.0</Badge>
                </FieldRow>
                <FieldRow label={t('settings.license')}>
                  <span className="font-g text-g-ui text-g-ink-2">MIT</span>
                </FieldRow>
                <div className="mt-4 border-t border-g-line pt-4">
                  <h3 className="mb-3 font-g text-g-ui font-[510] tracking-g-ui text-g-ink">
                    {t('settings.data')}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      leadingIcon={<Download size={15} />}
                      onClick={onExport}
                    >
                      {t('settings.export')}
                    </Button>
                    <Button
                      variant="secondary"
                      leadingIcon={<Upload size={15} />}
                      onClick={() => fileInputRef.current?.click()}
                      disabled={working}
                    >
                      {t('settings.import')}
                    </Button>
                    <Button
                      variant="danger"
                      leadingIcon={<RotateCcw size={15} />}
                      onClick={() => void onReset()}
                      disabled={working}
                    >
                      {t('settings.resetDatabase')}
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/json,.json"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0]
                        event.currentTarget.value = ''
                        if (file) void onImport(file)
                      }}
                    />
                  </div>
                </div>
                <div className="mt-2 border-t border-g-line pt-4">
                  <h3 className="mb-3 font-g text-g-ui font-[510] tracking-g-ui text-g-ink">
                    {t('settings.storage')}
                  </h3>
                  <div className="overflow-hidden rounded-g-md border border-g-line bg-g-surface-2">
                    <PathRow
                      icon={<Database size={15} />}
                      label={t('settings.databasePath')}
                      value={settings?.databasePath}
                    />
                    <PathRow
                      label={t('settings.dataDir')}
                      value={settings?.dataDir}
                    />
                    <PathRow
                      label={t('settings.configDir')}
                      value={settings?.configDir}
                    />
                    <PathRow
                      label={t('settings.cacheDir')}
                      value={settings?.cacheDir}
                    />
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
