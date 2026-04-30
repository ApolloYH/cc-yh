import { useEffect, useMemo, useState } from 'react'
import { useSkillStore } from '../../stores/skillStore'
import { useTranslation } from '../../i18n'
import { Button } from '../shared/Button'
import { Modal } from '../shared/Modal'
import { Input } from '../shared/Input'
import type { SkillMeta, SkillSource } from '../../types/skill'

const SOURCE_ORDER: SkillSource[] = ['user', 'project', 'plugin', 'mcp', 'bundled']

const SOURCE_ICONS: Record<SkillSource, string> = {
  user: 'person',
  project: 'folder',
  plugin: 'extension',
  mcp: 'hub',
  bundled: 'inventory_2',
}

const SOURCE_ACCENT_CLASSES: Record<SkillSource, string> = {
  user: 'bg-[var(--color-primary-fixed)] text-[var(--color-brand)]',
  project: 'bg-[var(--color-success-container)] text-[var(--color-success)]',
  plugin: 'bg-[var(--color-warning-container)] text-[var(--color-warning)]',
  mcp: 'bg-[var(--color-info-container)] text-[var(--color-info)]',
  bundled: 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]',
}

function estimateTokens(contentLength: number) {
  return Math.ceil(contentLength / 4)
}

function isTauriRuntime() {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  )
}

export function SkillList() {
  const {
    skills,
    skillsDir,
    isLoading,
    isMutating,
    error,
    operationMessage,
    fetchSkills,
    fetchSkillDetail,
    installSkill,
    createSkill,
    deleteSkill,
    clearMessage,
  } = useSkillStore()
  const t = useTranslation()

  const [showInstallModal, setShowInstallModal] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [installMode, setInstallMode] = useState<'package' | 'local'>('package')
  const [installCommand, setInstallCommand] = useState('')
  const [installPath, setInstallPath] = useState('')
  const [installName, setInstallName] = useState('')
  const [newSkillName, setNewSkillName] = useState('')
  const [newSkillDisplayName, setNewSkillDisplayName] = useState('')
  const [newSkillDescription, setNewSkillDescription] = useState('')
  const [copiedPathHint, setCopiedPathHint] = useState<string | null>(null)

  useEffect(() => {
    fetchSkills()
  }, [fetchSkills])

  useEffect(() => {
    if (!copiedPathHint) return
    const timer = window.setTimeout(() => setCopiedPathHint(null), 3000)
    return () => window.clearTimeout(timer)
  }, [copiedPathHint])

  const grouped = useMemo(() => {
    const result: Partial<Record<SkillSource, SkillMeta[]>> = {}
    for (const skill of skills) {
      const src = skill.source as SkillSource
      ;(result[src] ??= []).push(skill)
    }
    return result
  }, [skills])

  const totalTokens = useMemo(
    () => skills.reduce((sum, skill) => sum + estimateTokens(skill.contentLength), 0),
    [skills],
  )

  const visibleGroupCount = useMemo(
    () => SOURCE_ORDER.filter((source) => (grouped[source] ?? []).length > 0).length,
    [grouped],
  )

  const closeInstallModal = () => {
    setInstallMode('package')
    setInstallCommand('')
    setInstallPath('')
    setInstallName('')
    setShowInstallModal(false)
  }

  const closeCreateModal = () => {
    setNewSkillName('')
    setNewSkillDisplayName('')
    setNewSkillDescription('')
    setShowCreateModal(false)
  }

  const handleOpenSkillsDir = async () => {
    if (!skillsDir) return

    if (isTauriRuntime()) {
      try {
        const { open } = await import('@tauri-apps/plugin-shell')
        await open(skillsDir)
        return
      } catch (err) {
        console.error('[SkillList] Failed to open skills dir:', err)
      }
    }

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(skillsDir)
        setCopiedPathHint(t('settings.skills.pathCopied'))
        return
      } catch {
        // fall through to prompt fallback
      }
    }

    window.prompt(t('settings.skills.pathPrompt'), skillsDir)
  }

  const handlePickInstallFolder = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('settings.skills.installDialogTitle'),
      })
      if (selected) {
        setInstallPath(String(selected))
      }
    } catch (err) {
      console.error('[SkillList] Failed to open install folder dialog:', err)
    }
  }

  const handleInstall = async () => {
    const name = installName.trim() || undefined
    if (installMode === 'package') {
      if (!installCommand.trim()) return
      await installSkill({ installCommand: installCommand.trim(), name })
    } else {
      if (!installPath.trim()) return
      await installSkill({ sourcePath: installPath.trim(), name })
    }
    closeInstallModal()
  }

  const handleCreate = async () => {
    if (!newSkillName.trim()) return
    const skill = await createSkill({
      name: newSkillName.trim(),
      displayName: newSkillDisplayName.trim() || undefined,
      description: newSkillDescription.trim() || undefined,
    })
    closeCreateModal()
    await fetchSkillDetail('user', skill.name)
  }

  const handleDelete = async (
    skill: SkillMeta,
    event?: React.MouseEvent<HTMLButtonElement>,
  ) => {
    event?.stopPropagation()
    if (!window.confirm(t('settings.skills.confirmDelete', { name: skill.displayName || skill.name }))) {
      return
    }
    await deleteSkill(skill.name)
  }

  const renderToolbar = () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="sm" onClick={() => void fetchSkills()} loading={isLoading}>
        <span className="material-symbols-outlined text-[15px]">refresh</span>
        {t('settings.skills.refresh')}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setShowInstallModal(true)}>
        <span className="material-symbols-outlined text-[15px]">upload</span>
        {t('settings.skills.installLocal')}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setShowCreateModal(true)}>
        <span className="material-symbols-outlined text-[15px]">add_circle</span>
        {t('settings.skills.quickCreate')}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => void handleOpenSkillsDir()} disabled={!skillsDir}>
        <span className="material-symbols-outlined text-[15px]">folder_open</span>
        {t('settings.skills.openDir')}
      </Button>
    </div>
  )

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin w-5 h-5 border-2 border-[var(--color-brand)] border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-6 min-w-0">
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] overflow-hidden">
          <div className="grid gap-4 px-5 py-5 min-w-0 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)] xl:items-end">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-tertiary)] mb-2">
                {t('settings.skills.browserEyebrow')}
              </div>
              <div className="flex items-center gap-3 mb-2">
                <span className="material-symbols-outlined text-[22px] text-[var(--color-brand)]">
                  auto_awesome
                </span>
                <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                  {t('settings.skills.browserTitle')}
                </h3>
              </div>
              <p className="text-sm leading-6 text-[var(--color-text-secondary)] max-w-3xl">
                {t('settings.skills.browserDescription')}
              </p>
              {skillsDir && (
                <div className="mt-3 text-xs text-[var(--color-text-tertiary)] break-all">
                  {t('settings.skills.skillsDirLabel')}: {skillsDir}
                </div>
              )}
              {copiedPathHint && (
                <div className="mt-2 text-xs text-[var(--color-success)]">{copiedPathHint}</div>
              )}
            </div>

            <div className="grid gap-3">
              {renderToolbar()}
              <div className="grid grid-cols-2 gap-3 min-w-0 sm:grid-cols-3">
                <SummaryCard
                  label={t('settings.skills.summary.totalSkills')}
                  value={String(skills.length)}
                  icon="auto_awesome"
                />
                <SummaryCard
                  label={t('settings.skills.summary.sources')}
                  value={String(
                    SOURCE_ORDER.filter((source) => (grouped[source] ?? []).length > 0)
                      .length,
                  )}
                  icon="layers"
                />
                <SummaryCard
                  label={t('settings.skills.summary.tokens')}
                  value={t('settings.skills.tokenEstimateShort', { count: String(totalTokens) })}
                  icon="notes"
                  className="col-span-2 sm:col-span-1"
                />
              </div>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-[var(--color-error)]/20 bg-[var(--color-error)]/8 px-4 py-3 text-sm text-[var(--color-error)]">
            {error}
          </div>
        )}

        {operationMessage && (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-[var(--color-success)]/20 bg-[var(--color-success)]/8 px-4 py-3 text-sm text-[var(--color-success)]">
            <span>{operationMessage}</span>
            <button
              type="button"
              onClick={clearMessage}
              className="text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        )}

        {skills.length === 0 ? (
          <div className="text-center py-12 rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-6">
            <span className="material-symbols-outlined text-[40px] text-[var(--color-text-tertiary)] mb-2 block">
              auto_awesome
            </span>
            <p className="text-sm text-[var(--color-text-tertiary)]">
              {t('settings.skills.empty')}
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
              {t('settings.skills.emptyHint')}
            </p>
          </div>
        ) : (
          <div className={`grid gap-4 ${visibleGroupCount >= 2 ? 'xl:grid-cols-2' : ''}`}>
            {SOURCE_ORDER.map((source) => {
              const group = grouped[source]
              if (!group?.length) return null

              const sourceLabel = t(`settings.skills.source.${source}`)
              const sourceTokenCount = group.reduce(
                (sum, skill) => sum + estimateTokens(skill.contentLength),
                0,
              )

              return (
                <section
                  key={source}
                  className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden min-w-0"
                >
                  <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${SOURCE_ACCENT_CLASSES[source]}`}>
                          <span className="material-symbols-outlined text-[16px]">
                            {SOURCE_ICONS[source]}
                          </span>
                        </span>
                        <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
                          {sourceLabel}
                        </h4>
                        <span className="text-xs text-[var(--color-text-tertiary)]">
                          {group.length}
                        </span>
                      </div>
                      <p className="text-xs leading-5 text-[var(--color-text-tertiary)]">
                        {t('settings.skills.groupHint', {
                          source: sourceLabel,
                          count: String(group.length),
                        })}
                      </p>
                    </div>
                    <div className="text-[11px] text-[var(--color-text-tertiary)] whitespace-nowrap">
                      {t('settings.skills.tokenEstimateShort', {
                        count: String(sourceTokenCount),
                      })}
                    </div>
                  </div>

                  <div className="flex flex-col p-2">
                    {group.map((skill) => (
                      <div
                        key={`${skill.source}-${skill.name}`}
                        onClick={() =>
                          skill.hasDirectory && fetchSkillDetail(skill.source, skill.name)
                        }
                        onKeyDown={(event) => {
                          if (!skill.hasDirectory) return
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.preventDefault()
                          fetchSkillDetail(skill.source, skill.name)
                        }}
                        role="button"
                        tabIndex={skill.hasDirectory ? 0 : -1}
                        aria-disabled={!skill.hasDirectory}
                        className={`group rounded-xl border border-transparent px-3 py-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)] ${
                          skill.hasDirectory
                            ? 'cursor-pointer hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)]'
                            : 'cursor-default opacity-60'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)]">
                            auto_awesome
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-[var(--color-text-primary)] break-all">
                                {skill.displayName || skill.name}
                              </span>
                              {skill.version && (
                                <span className="rounded-full bg-[var(--color-surface-container-high)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-tertiary)]">
                                  v{skill.version}
                                </span>
                              )}
                              {skill.userInvocable && (
                                <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-tertiary)]">
                                  {t('settings.skills.slashCommand')}
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)] break-words">
                              {skill.description}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-tertiary)]">
                              <span>{sourceLabel}</span>
                              <span>
                                {t('settings.skills.tokenEstimateShort', {
                                  count: String(estimateTokens(skill.contentLength)),
                                })}
                              </span>
                              <span>
                                {skill.hasDirectory
                                  ? t('settings.skills.ready')
                                  : t('settings.skills.unavailable')}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 pl-2">
                            {skill.source === 'user' && (
                              <button
                                type="button"
                                onClick={(event) => void handleDelete(skill, event)}
                                className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-text-tertiary)] opacity-0 transition-all hover:bg-[var(--color-surface-selected)] hover:text-[var(--color-error)] group-hover:opacity-100"
                                title={t('settings.skills.delete')}
                              >
                                <span className="material-symbols-outlined text-[16px]">delete</span>
                              </button>
                            )}
                            <span className="material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)] opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100">
                              chevron_right
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>

      <Modal
        open={showInstallModal}
        onClose={closeInstallModal}
        title={t('settings.skills.installModalTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={closeInstallModal}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => void handleInstall()}
              loading={isMutating}
              disabled={
                installMode === 'package'
                  ? !installCommand.trim()
                  : !installPath.trim()
              }
            >
              {t('settings.skills.installConfirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
            {t('settings.skills.installModalHint')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={installMode === 'package' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setInstallMode('package')}
            >
              {t('settings.skills.installModePackage')}
            </Button>
            <Button
              type="button"
              variant={installMode === 'local' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setInstallMode('local')}
            >
              {t('settings.skills.installModeLocal')}
            </Button>
          </div>
          {installMode === 'package' && (
            <div className="flex flex-col gap-1">
              <label htmlFor="skill-install-command" className="text-sm font-medium text-[var(--color-text-primary)]">
                {t('settings.skills.installCommandLabel')}
              </label>
              <textarea
                id="skill-install-command"
                rows={3}
                value={installCommand}
                onChange={(event) => setInstallCommand(event.target.value)}
                onInput={(event) => setInstallCommand(event.currentTarget.value)}
                placeholder={t('settings.skills.installCommandPlaceholder')}
                className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none transition-colors duration-150 placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:shadow-[0_0_0_3px_rgba(153,153,153,0.1)]"
              />
              <p className="text-xs leading-5 text-[var(--color-text-tertiary)]">
                {t('settings.skills.installCommandHint')}
              </p>
            </div>
          )}
          {installMode === 'local' && (
            <div className="space-y-2">
              <Input
                label={t('settings.skills.installPathLabel')}
                placeholder={t('settings.skills.installPathPlaceholder')}
                value={installPath}
                onChange={(event) => setInstallPath(event.target.value)}
              />
              {isTauriRuntime() && (
                <Button variant="secondary" size="sm" onClick={() => void handlePickInstallFolder()}>
                  <span className="material-symbols-outlined text-[15px]">folder_open</span>
                  {t('settings.skills.browse')}
                </Button>
              )}
            </div>
          )}
          <Input
            label={t('settings.skills.installNameLabel')}
            placeholder={t('settings.skills.installNamePlaceholder')}
            value={installName}
            onChange={(event) => setInstallName(event.target.value)}
          />
        </div>
      </Modal>

      <Modal
        open={showCreateModal}
        onClose={closeCreateModal}
        title={t('settings.skills.createModalTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={closeCreateModal}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void handleCreate()} loading={isMutating} disabled={!newSkillName.trim()}>
              {t('settings.skills.createConfirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
            {t('settings.skills.createModalHint')}
          </p>
          <Input
            label={t('settings.skills.newSkillNameLabel')}
            placeholder={t('settings.skills.newSkillNamePlaceholder')}
            value={newSkillName}
            onChange={(event) => setNewSkillName(event.target.value)}
            required
          />
          <Input
            label={t('settings.skills.newSkillDisplayNameLabel')}
            placeholder={t('settings.skills.newSkillDisplayNamePlaceholder')}
            value={newSkillDisplayName}
            onChange={(event) => setNewSkillDisplayName(event.target.value)}
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-[var(--color-text-primary)]">
              {t('settings.skills.newSkillDescriptionLabel')}
            </label>
            <textarea
              rows={4}
              value={newSkillDescription}
              onChange={(event) => setNewSkillDescription(event.target.value)}
              placeholder={t('settings.skills.newSkillDescriptionPlaceholder')}
              className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none transition-colors duration-150 placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:shadow-[0_0_0_3px_rgba(153,153,153,0.1)]"
            />
          </div>
        </div>
      </Modal>
    </>
  )
}

function SummaryCard({
  label,
  value,
  icon,
  className = '',
}: {
  label: string
  value: string
  icon: string
  className?: string
}) {
  return (
    <div className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 min-w-0 ${className}`}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-tertiary)] min-w-0">
        <span className="material-symbols-outlined text-[14px] flex-shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 text-lg font-semibold text-[var(--color-text-primary)] truncate">
        {value}
      </div>
    </div>
  )
}
