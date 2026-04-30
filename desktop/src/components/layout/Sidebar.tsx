import {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useUIStore } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'
import { ProjectFilter } from './ProjectFilter'
import type { SessionListItem } from '../../types/session'
import { useTabStore, SETTINGS_TAB_ID, SCHEDULED_TAB_ID } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
const isWindows = typeof navigator !== 'undefined' && /Win/.test(navigator.platform)

type TimeGroup = 'today' | 'yesterday' | 'last7days' | 'last30days' | 'older'

const TIME_GROUP_ORDER: TimeGroup[] = ['today', 'yesterday', 'last7days', 'last30days', 'older']

export function Sidebar() {
  const sessions = useSessionStore((s) => s.sessions)
  const selectedProjects = useSessionStore((s) => s.selectedProjects)
  const error = useSessionStore((s) => s.error)
  const fetchSessions = useSessionStore((s) => s.fetchSessions)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const renameSession = useSessionStore((s) => s.renameSession)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const addToast = useUIStore((s) => s.addToast)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const [searchQuery, setSearchQuery] = useState('')
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [contextMenu])

  // Filter by selected projects, then by search query
  const filteredSessions = useMemo(() => {
    let result = sessions
    if (selectedProjects.length > 0) {
      result = result.filter((s) => selectedProjects.includes(s.projectPath))
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter((s) => s.title.toLowerCase().includes(q))
    }
    return result
  }, [sessions, selectedProjects, searchQuery])

  // Group by time
  const timeGroups = useMemo(() => groupByTime(filteredSessions), [filteredSessions])

  const handleContextMenu = useCallback((e: MouseEvent, id: string) => {
    e.preventDefault()
    setContextMenu({ id, x: e.clientX, y: e.clientY })
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    setContextMenu(null)
    await deleteSession(id)
  }, [deleteSession])

  const handleStartRename = useCallback((id: string, currentTitle: string) => {
    setContextMenu(null)
    setRenamingId(id)
    setRenameValue(currentTitle)
  }, [])

  const handleFinishRename = useCallback(async () => {
    if (renamingId && renameValue.trim()) {
      await renameSession(renamingId, renameValue.trim())
    }
    setRenamingId(null)
    setRenameValue('')
  }, [renamingId, renameValue, renameSession])

  const startDraggingRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    if (!isTauri) return
    import(/* @vite-ignore */ '@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        const win = getCurrentWindow()
        startDraggingRef.current = () => win.startDragging()
      })
      .catch(() => {})
  }, [])

  const handleSidebarDrag = useCallback((e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, textarea, select, a, [role="button"]')) return
    startDraggingRef.current?.()
  }, [])

  const t = useTranslation()

  const TIME_GROUP_LABELS: Record<TimeGroup, string> = {
    today: t('sidebar.timeGroup.today'),
    yesterday: t('sidebar.timeGroup.yesterday'),
    last7days: t('sidebar.timeGroup.last7days'),
    last30days: t('sidebar.timeGroup.last30days'),
    older: t('sidebar.timeGroup.older'),
  }

  const newSessionLabel = t('sidebar.newSession')
  const scheduledLabel = t('sidebar.scheduled')
  const settingsLabel = t('sidebar.settings')
  const sidebarToggleLabel = sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')

  return (
    <aside onMouseDown={handleSidebarDrag} className="w-[var(--sidebar-width)] h-full flex flex-col bg-[var(--color-surface-sidebar)] border-r border-[var(--color-border)] select-none transition-[width] duration-200">
      {/* Brand logo — extra top padding in desktop to clear macOS traffic lights (not needed on Windows) */}
      <div className={`px-3 pb-1.5 flex items-center ${sidebarOpen ? 'justify-between gap-2' : 'justify-center'} ${isTauri && !isWindows ? 'pt-[44px]' : 'pt-3'}`}>
        {sidebarOpen && (
          <div className="flex items-center gap-2.5 min-w-0">
            <img src="/app-icon.svg" alt="" className="h-8 w-8 rounded-lg flex-shrink-0" />
            <span className="text-[13px] font-semibold tracking-tight text-[var(--color-text-primary)] truncate" style={{ fontFamily: "'Manrope', sans-serif" }}>
              Claude <span className="text-[#D97757]">YH</span>
            </span>
          </div>
        )}
        <button
          type="button"
          onClick={toggleSidebar}
          className="flex h-10 w-10 items-center justify-center rounded-md p-1 text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
          title={sidebarToggleLabel}
          aria-label={sidebarToggleLabel}
          aria-expanded={sidebarOpen}
        >
          <SidebarToggleIcon collapsed={!sidebarOpen} />
        </button>
      </div>
      {/* Navigation */}
      <div className="px-3 pb-3 flex flex-col gap-0.5">
        <NavItem
          active={false}
          collapsed={!sidebarOpen}
          label={newSessionLabel}
          onClick={async () => {
            try {
              // Use current active session's workDir as default for new session
              const currentTabId = useTabStore.getState().activeTabId
              const currentSession = currentTabId
                ? useSessionStore.getState().sessions.find((s) => s.id === currentTabId)
                : null
              const workDir = currentSession?.workDir || undefined
              const sessionId = await useSessionStore.getState().createSession(workDir)
              useTabStore.getState().openTab(sessionId, newSessionLabel)
              useChatStore.getState().connectToSession(sessionId)
            } catch (error) {
              addToast({
                type: 'error',
                message:
                  error instanceof Error ? error.message : t('sidebar.sessionListFailed'),
              })
            }
          }}
          icon={<PlusIcon />}
        >
          {newSessionLabel}
        </NavItem>
        <NavItem
          active={activeTabId === SCHEDULED_TAB_ID}
          collapsed={!sidebarOpen}
          label={scheduledLabel}
          onClick={() => useTabStore.getState().openTab(SCHEDULED_TAB_ID, t('sidebar.scheduled'), 'scheduled')}
          icon={<ClockIcon />}
        >
          {scheduledLabel}
        </NavItem>
      </div>

      {/* Project filter */}
      {sidebarOpen && (
        <div className="px-3 pb-1 flex items-center justify-between">
          <ProjectFilter />
        </div>
      )}

      {/* Search */}
      {sidebarOpen && (
        <div className="px-3 pb-2">
          <input
            id="sidebar-search"
            type="text"
            placeholder={t('sidebar.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-7 px-2 text-xs rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none focus:border-[var(--color-border-focus)]"
          />
        </div>
      )}

      {/* Session list — grouped by time */}
      <div className="flex-1 overflow-y-auto px-3">
        {sidebarOpen && (
          <>
        {error && (
          <div className="mx-1 mt-2 rounded-[var(--radius-md)] border border-[var(--color-error)]/20 bg-[var(--color-error)]/5 px-3 py-2">
            <div className="text-xs font-medium text-[var(--color-error)]">{t('sidebar.sessionListFailed')}</div>
            <div className="mt-1 text-[11px] text-[var(--color-text-secondary)] break-words">{error}</div>
            <button
              onClick={() => fetchSessions()}
              className="mt-2 text-[11px] font-medium text-[var(--color-brand)] hover:underline"
            >
              {t('common.retry')}
            </button>
          </div>
        )}
        {filteredSessions.length === 0 && (
          <div className="px-3 py-4 text-xs text-[var(--color-text-tertiary)] text-center">
            {searchQuery ? t('sidebar.noMatching') : t('sidebar.noSessions')}
          </div>
        )}
        {TIME_GROUP_ORDER.map((group) => {
          const items = timeGroups.get(group)
          if (!items || items.length === 0) return null
          return (
            <div key={group} className="mb-1">
              <div className="px-2 pt-3 pb-1 text-[11px] font-semibold text-[var(--color-text-tertiary)] tracking-wide">
                {TIME_GROUP_LABELS[group]}
              </div>
              {items.map((session) => (
                <div key={session.id} className="relative">
                  {renamingId === session.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={handleFinishRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleFinishRename()
                        if (e.key === 'Escape') { setRenamingId(null); setRenameValue('') }
                      }}
                      className="w-full px-3 py-2 text-sm rounded-[var(--radius-md)] border border-[var(--color-border-focus)] bg-[var(--color-surface)] text-[var(--color-text-primary)] outline-none ml-1"
                    />
                  ) : (
                    <button
                      onClick={() => {
                        useTabStore.getState().openTab(session.id, session.title)
                        useChatStore.getState().connectToSession(session.id)
                      }}
                      onContextMenu={(e) => handleContextMenu(e, session.id)}
                      className={`
                        w-full flex items-center gap-2 pl-4 pr-3 py-1.5 text-sm text-left rounded-[var(--radius-md)] transition-colors duration-200 group
                        ${session.id === activeTabId
                          ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]'
                          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                        }
                      `}
                    >
                      <span className="w-1 h-1 rounded-full flex-shrink-0" style={{
                        backgroundColor: session.id === activeTabId ? 'var(--color-brand)' : 'var(--color-text-tertiary)',
                        opacity: session.id === activeTabId ? 1 : 0.5,
                      }} />
                      <span className="truncate flex-1">{session.title || 'Untitled'}</span>
                      {!session.workDirExists && (
                        <span
                          className="text-[10px] text-[var(--color-warning)] flex-shrink-0"
                          title={session.workDir ?? ''}
                        >
                          {t('sidebar.missingDir')}
                        </span>
                      )}
                      <span className="text-[10px] text-[var(--color-text-tertiary)] flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        {formatRelativeTime(session.modifiedAt)}
                      </span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )
        })}
          </>
        )}
      </div>

      {/* Settings button at bottom */}
      <div className="p-3 border-t border-[var(--color-border)]">
        <NavItem
          active={activeTabId === SETTINGS_TAB_ID}
          collapsed={!sidebarOpen}
          label={settingsLabel}
          onClick={() => useTabStore.getState().openTab(SETTINGS_TAB_ID, t('sidebar.settings'), 'settings')}
          icon={<span className="material-symbols-outlined text-[18px]">settings</span>}
        >
          {settingsLabel}
        </NavItem>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y, boxShadow: 'var(--shadow-dropdown)' }}
        >
          <button
            onClick={() => {
              const session = sessions.find(s => s.id === contextMenu.id)
              handleStartRename(contextMenu.id, session?.title || '')
            }}
            className="w-full px-3 py-1.5 text-xs text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            {t('common.rename')}
          </button>
          <button
            onClick={() => handleDelete(contextMenu.id)}
            className="w-full px-3 py-1.5 text-xs text-left text-[var(--color-error)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            {t('common.delete')}
          </button>
        </div>
      )}
    </aside>
  )
}

function groupByTime(sessions: SessionListItem[]): Map<TimeGroup, SessionListItem[]> {
  const groups = new Map<TimeGroup, SessionListItem[]>()
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 86400000
  const sevenDaysAgo = startOfToday - 7 * 86400000
  const thirtyDaysAgo = startOfToday - 30 * 86400000

  for (const session of sessions) {
    const ts = new Date(session.modifiedAt).getTime()
    let group: TimeGroup
    if (ts >= startOfToday) group = 'today'
    else if (ts >= startOfYesterday) group = 'yesterday'
    else if (ts >= sevenDaysAgo) group = 'last7days'
    else if (ts >= thirtyDaysAgo) group = 'last30days'
    else group = 'older'

    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push(session)
  }

  return groups
}

function NavItem({
  active,
  collapsed,
  label,
  onClick,
  icon,
  children,
}: {
  active: boolean
  collapsed: boolean
  label: string
  onClick: () => void
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-label={label}
      className={`
        w-full flex items-center px-3 py-2 text-sm rounded-[var(--radius-md)] transition-colors duration-200
        ${collapsed ? 'justify-center' : 'gap-2.5'}
        ${active
          ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)] font-medium'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
        }
      `}
    >
      {icon}
      <span className={collapsed ? 'sr-only' : 'truncate'}>{children}</span>
    </button>
  )
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d`
  return `${Math.floor(day / 30)}mo`
}

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8 4v16" />
      {collapsed ? <path d="M12 9l4 3-4 3" /> : <path d="M15 9l-4 3 4 3" />}
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}
