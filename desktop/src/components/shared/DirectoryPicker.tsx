import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { sessionsApi, type RecentProject } from '../../api/sessions'
import { filesystemApi } from '../../api/filesystem'
import { useTranslation } from '../../i18n'

type Props = {
  value: string
  onChange: (path: string) => void
  variant?: 'default' | 'toolbar'
  showFullPath?: boolean
  placeholderLabel?: string
  disabled?: boolean
}

type DirEntry = { name: string; path: string; isDirectory: boolean }

// Module-level cache for recent projects (shared across instances, survives re-renders)
let cachedProjects: RecentProject[] | null = null
let cacheTimestamp = 0
const CACHE_TTL = 30_000
const ROOTS_SENTINEL = '__roots__'

function isTauriRuntime() {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
}

function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value)
}

function getPathTail(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? value
}

function getBrowseBreadcrumbs(currentPath: string): Array<{ label: string; path: string }> {
  if (!currentPath) return []
  if (currentPath === ROOTS_SENTINEL) {
    return [{ label: '此电脑', path: ROOTS_SENTINEL }]
  }

  const segments = currentPath.split(/[\\/]+/).filter(Boolean)
  if (segments.length === 0) {
    return [{ label: '/', path: '/' }]
  }

  if (isWindowsPath(currentPath)) {
    const [drive, ...rest] = segments
    const breadcrumbs: Array<{ label: string; path: string }> = [
      { label: drive!, path: `${drive}\\` },
    ]
    let acc = `${drive}\\`
    for (const segment of rest) {
      acc = acc.endsWith('\\') ? `${acc}${segment}` : `${acc}\\${segment}`
      breadcrumbs.push({ label: segment, path: acc })
    }
    return breadcrumbs
  }

  const breadcrumbs: Array<{ label: string; path: string }> = [{ label: '/', path: '/' }]
  let acc = ''
  for (const segment of segments) {
    acc += `/${segment}`
    breadcrumbs.push({ label: segment, path: acc })
  }
  return breadcrumbs
}

export function DirectoryPicker({
  value,
  onChange,
  variant = 'default',
  showFullPath = false,
  placeholderLabel,
  disabled = false,
}: Props) {
  const t = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [mode, setMode] = useState<'recent' | 'browse'>('recent')
  const [projects, setProjects] = useState<RecentProject[]>([])
  const [browseEntries, setBrowseEntries] = useState<DirEntry[]>([])
  const [browsePath, setBrowsePath] = useState('')
  const [browseParent, setBrowseParent] = useState('')
  const [loading, setLoading] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; direction: 'up' | 'down' } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const updateDropdownPos = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const dropdownHeight = 380
    const spaceAbove = rect.top
    const spaceBelow = window.innerHeight - rect.bottom
    const direction = spaceBelow >= dropdownHeight || spaceBelow >= spaceAbove ? 'down' : 'up'
    setDropdownPos({
      top: direction === 'down' ? rect.bottom + 4 : rect.top - 4,
      left: rect.left,
      direction,
    })
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    updateDropdownPos()
    window.addEventListener('scroll', updateDropdownPos, true)
    window.addEventListener('resize', updateDropdownPos)
    return () => {
      window.removeEventListener('scroll', updateDropdownPos, true)
      window.removeEventListener('resize', updateDropdownPos)
    }
  }, [isOpen, updateDropdownPos])

  useEffect(() => {
    if (!isOpen || mode !== 'recent') return
    if (cachedProjects && Date.now() - cacheTimestamp < CACHE_TTL) {
      setProjects(cachedProjects)
      return
    }
    setLoading(true)
    sessionsApi.getRecentProjects()
      .then(({ projects: recentProjects }) => {
        cachedProjects = recentProjects
        cacheTimestamp = Date.now()
        setProjects(recentProjects)
      })
      .catch(() => setProjects([]))
      .finally(() => setLoading(false))
  }, [isOpen, mode])

  const loadBrowseDir = async (dirPath?: string) => {
    setLoading(true)
    try {
      const result = await filesystemApi.browse(dirPath)
      setBrowsePath(result.currentPath)
      setBrowseParent(result.parentPath)
      setBrowseEntries(result.entries)
    } catch {
      // API not available
    } finally {
      setLoading(false)
    }
  }

  const handleSelect = (selectedPath: string) => {
    onChange(selectedPath)
    setIsOpen(false)
    setMode('recent')
    cachedProjects = null
  }

  const handleChooseFolder = async () => {
    if (isTauriRuntime()) {
      setIsOpen(false)
      try {
        const { open } = await import('@tauri-apps/plugin-dialog')
        const selected = await open({
          directory: true,
          multiple: false,
          title: t('dirPicker.chooseProjectFolder'),
        })
        if (selected) onChange(selected)
      } catch (err) {
        console.error('[DirectoryPicker] Failed to open folder dialog:', err)
      }
      return
    }

    setMode('browse')
    void loadBrowseDir(value || undefined)
  }

  const selectedProject = projects.find((project) => project.realPath === value)
  const isToolbar = variant === 'toolbar'
  const displayLabel = value
    ? (showFullPath ? value : selectedProject?.projectName || getPathTail(value))
    : (placeholderLabel || t('dirPicker.selectProject'))
  const breadcrumbs = getBrowseBreadcrumbs(browsePath)

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        onClick={() => {
          if (disabled) return
          setIsOpen(!isOpen)
          setMode('recent')
        }}
        disabled={disabled}
        className={
          isToolbar
            ? 'flex max-w-[260px] items-center gap-2.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-4 py-2 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-70'
            : value
              ? 'flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-1.5 text-xs transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-70'
              : 'flex items-center gap-2 text-xs text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-secondary)] disabled:cursor-not-allowed disabled:opacity-70'
        }
        title={value || displayLabel}
      >
        <span className={`material-symbols-outlined shrink-0 ${isToolbar ? 'text-[20px]' : 'text-[14px]'} text-[var(--color-text-secondary)]`}>
          folder_open
        </span>

        <span className={`min-w-0 flex-1 truncate ${isToolbar ? 'text-[14px] font-medium text-[var(--color-text-primary)]' : value ? 'font-medium text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]'}`}>
          {displayLabel}
        </span>

        {!isToolbar && selectedProject?.branch && !showFullPath && (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--color-text-tertiary)]">
              <circle cx="18" cy="18" r="3" />
              <circle cx="6" cy="6" r="3" />
              <path d="M13 6h3a2 2 0 0 1 2 2v7" />
              <line x1="6" y1="9" x2="6" y2="21" />
            </svg>
            <span className="shrink-0 text-[var(--color-text-tertiary)]">{selectedProject.branch}</span>
          </>
        )}

        <span className={`material-symbols-outlined shrink-0 ${isToolbar ? 'text-[18px]' : 'text-[12px]'} text-[var(--color-text-tertiary)]`}>
          expand_more
        </span>
      </button>

      {isOpen && dropdownPos && createPortal(
        <div
          ref={dropdownRef}
          className="cc-surface-pop w-[400px] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)]"
          style={{
            position: 'fixed',
            left: dropdownPos.left,
            ...(dropdownPos.direction === 'down'
              ? { top: dropdownPos.top }
              : { bottom: window.innerHeight - dropdownPos.top }),
            zIndex: 9999,
          }}
        >
          {mode === 'recent' ? (
            <>
              <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-[var(--color-outline)]">
                {t('dirPicker.recent')}
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                {loading ? (
                  <div className="px-4 py-6 text-center text-xs text-[var(--color-text-tertiary)]">{t('common.loading')}</div>
                ) : projects.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-[var(--color-text-tertiary)]">{t('dirPicker.noRecent')}</div>
                ) : (
                  projects.map((project) => {
                    const isSelected = project.realPath === value
                    return (
                      <button
                        key={project.projectPath}
                        onClick={() => handleSelect(project.realPath)}
                        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-hover)] ${
                          isSelected ? 'bg-[var(--color-surface-selected)]' : ''
                        }`}
                      >
                        <span className="material-symbols-outlined shrink-0 text-[20px] text-[var(--color-text-secondary)]">folder</span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                            {project.projectName}
                          </div>
                          <div className="truncate font-[var(--font-mono)] text-[11px] text-[var(--color-text-tertiary)]">
                            {project.repoName ? `${project.repoName} · ${project.realPath}` : project.realPath}
                          </div>
                        </div>
                        {isSelected && (
                          <span className="material-symbols-outlined shrink-0 text-[18px] text-[var(--color-brand)]" style={{ fontVariationSettings: "'FILL' 1" }}>
                            check
                          </span>
                        )}
                      </button>
                    )
                  })
                )}
              </div>

              <div className="border-t border-[var(--color-border)]">
                <button
                  onClick={handleChooseFolder}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
                >
                  <span className="material-symbols-outlined text-[20px] text-[var(--color-text-tertiary)]">create_new_folder</span>
                  <span className="text-sm text-[var(--color-text-secondary)]">{t('dirPicker.chooseFolder')}</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1 border-b border-[var(--color-border)] px-3 py-2">
                <button onClick={() => setMode('recent')} className="mr-2 text-xs text-[var(--color-text-accent)] hover:underline">
                  {'← ' + t('dirPicker.recent')}
                </button>
                {breadcrumbs.map((crumb, index) => (
                  <span key={`${crumb.path}-${index}`} className="flex items-center gap-1">
                    {index > 0 && <span className="text-[10px] text-[var(--color-text-tertiary)]">/</span>}
                    <button
                      onClick={() => loadBrowseDir(crumb.path)}
                      className="text-[10px] text-[var(--color-text-accent)] hover:underline"
                    >
                      {crumb.label}
                    </button>
                  </span>
                ))}
              </div>

              <div className="max-h-[240px] overflow-y-auto">
                {loading ? (
                  <div className="px-3 py-4 text-center text-xs text-[var(--color-text-tertiary)]">{t('common.loading')}</div>
                ) : (
                  <>
                    {browseParent && browseParent !== browsePath && (
                      <button onClick={() => loadBrowseDir(browseParent)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--color-surface-hover)]">
                        <span className="material-symbols-outlined text-[16px] text-[var(--color-text-tertiary)]">arrow_upward</span>
                        <span className="text-xs text-[var(--color-text-secondary)]">..</span>
                      </button>
                    )}

                    {browseEntries.length === 0 ? (
                      <div className="px-3 py-4 text-center text-xs text-[var(--color-text-tertiary)]">{t('dirPicker.noSubdirs')}</div>
                    ) : (
                      browseEntries.map((entry) => (
                        <div key={entry.path} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-[var(--color-surface-hover)]">
                          <button
                            onClick={() => loadBrowseDir(entry.path)}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          >
                            <span className="material-symbols-outlined text-[16px] text-[var(--color-text-tertiary)]">folder</span>
                            <span className="truncate text-xs text-[var(--color-text-primary)]">{entry.name}</span>
                          </button>
                          <button
                            onClick={() => handleSelect(entry.path)}
                            className="rounded px-2 py-0.5 text-[10px] font-semibold text-[var(--color-brand)] transition-colors hover:bg-[var(--color-primary-fixed)]"
                          >
                            {t('common.select')}
                          </button>
                        </div>
                      ))
                    )}
                  </>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-[var(--color-border)] px-3 py-2">
                <span className="truncate font-[var(--font-mono)] text-[10px] text-[var(--color-text-tertiary)]">
                  {browsePath === ROOTS_SENTINEL ? '此电脑' : browsePath}
                </span>
                {browsePath !== ROOTS_SENTINEL && (
                  <button onClick={() => handleSelect(browsePath)} className="rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
                    {t('dirPicker.useThisFolder')}
                  </button>
                )}
              </div>
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
