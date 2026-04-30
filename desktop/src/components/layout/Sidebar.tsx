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
import { useTabStore, SETTINGS_TAB_ID, SCHEDULED_TAB_ID, JARVIS_TAB_ID, WORKBENCH_TAB_ID } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'
import { sessionsApi } from '../../api/sessions'

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
  const disconnectSession = useChatStore((s) => s.disconnectSession)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const addToast = useUIStore((s) => s.addToast)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const closeTab = useTabStore((s) => s.closeTab)
  const t = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [pinnedSessionIds, setPinnedSessionIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('claude-yh:pinned-sessions') || '[]') as string[]
    } catch {
      return []
    }
  })
  const [batchMode, setBatchMode] = useState(false)
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(() => new Set())

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
    const pinned = new Set(pinnedSessionIds)
    return [...result].sort((a, b) => {
      const pinDelta = Number(pinned.has(b.id)) - Number(pinned.has(a.id))
      if (pinDelta !== 0) return pinDelta
      return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
    })
  }, [sessions, selectedProjects, searchQuery, pinnedSessionIds])

  // Group by time
  const pinnedSessions = useMemo(() => {
    const pinned = new Set(pinnedSessionIds)
    return filteredSessions.filter((session) => pinned.has(session.id))
  }, [filteredSessions, pinnedSessionIds])
  const timeGroups = useMemo(() => {
    const pinned = new Set(pinnedSessionIds)
    return groupByTime(filteredSessions.filter((session) => !pinned.has(session.id)))
  }, [filteredSessions, pinnedSessionIds])

  const handleContextMenu = useCallback((e: MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ id, x: e.clientX, y: e.clientY })
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    setContextMenu(null)
    try {
      await deleteSession(id)
      disconnectSession(id)
      closeTab(id)
    } catch (error) {
      addToast({
        type: 'error',
        message:
          error instanceof Error ? error.message : t('sidebar.sessionListFailed'),
      })
    }
  }, [addToast, closeTab, deleteSession, disconnectSession, t])

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

  const setPinnedSessions = useCallback((next: string[]) => {
    setPinnedSessionIds(next)
    localStorage.setItem('claude-yh:pinned-sessions', JSON.stringify(next))
  }, [])

  const handleTogglePinned = useCallback((id: string) => {
    setContextMenu(null)
    setPinnedSessions(
      pinnedSessionIds.includes(id)
        ? pinnedSessionIds.filter((item) => item !== id)
        : [id, ...pinnedSessionIds],
    )
  }, [pinnedSessionIds, setPinnedSessions])

  const downloadJson = useCallback((filename: string, data: unknown) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }, [])

  const handleExport = useCallback(async (id: string) => {
    setContextMenu(null)
    const session = sessions.find((item) => item.id === id)
    const { messages } = await sessionsApi.getMessages(id)
    downloadJson(`claude-yh-session-${id}.json`, { session, messages })
  }, [downloadJson, sessions])

  const handleBatchExport = useCallback(async () => {
    const ids = [...selectedSessionIds]
    const exported = []
    for (const id of ids) {
      const session = sessions.find((item) => item.id === id)
      const { messages } = await sessionsApi.getMessages(id)
      exported.push({ session, messages })
    }
    downloadJson(`claude-yh-sessions-${new Date().toISOString().slice(0, 10)}.json`, exported)
  }, [downloadJson, selectedSessionIds, sessions])

  const handleBatchDelete = useCallback(async () => {
    const ids = [...selectedSessionIds]
    if (ids.length === 0) return
    if (!window.confirm(`删除选中的 ${ids.length} 个对话？此操作不可撤销。`)) return
    for (const id of ids) {
      await handleDelete(id)
    }
    setSelectedSessionIds(new Set())
    setBatchMode(false)
  }, [handleDelete, selectedSessionIds])

  const toggleBatchSelection = useCallback((id: string) => {
    setSelectedSessionIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const openSessionFromHistory = useCallback((session: SessionListItem) => {
    const tabStore = useTabStore.getState()
    const chatStore = useChatStore.getState()
    const activeTab = tabStore.tabs.find((tab) => tab.sessionId === tabStore.activeTabId)
    const activeSession = activeTab?.type === 'session'
      ? useSessionStore.getState().sessions.find((item) => item.id === activeTab.sessionId)
      : null
    const activeChat = activeTab?.type === 'session'
      ? chatStore.sessions[activeTab.sessionId]
      : null
    const activeSessionIsDisposable =
      !!activeTab &&
      activeTab.type === 'session' &&
      activeTab.sessionId !== session.id &&
      (activeSession?.messageCount ?? activeChat?.messages.length ?? 0) === 0 &&
      activeChat?.chatState !== 'thinking' &&
      activeChat?.chatState !== 'streaming' &&
      activeChat?.chatState !== 'tool_executing' &&
      activeChat?.chatState !== 'permission_pending'

    if (activeSessionIsDisposable) {
      chatStore.disconnectSession(activeTab.sessionId)
      tabStore.replaceTabSession(activeTab.sessionId, session.id)
      tabStore.updateTabTitle(session.id, session.title || 'Untitled')
    } else {
      tabStore.openTab(session.id, session.title || 'Untitled')
    }

    useSessionStore.getState().setActiveSession(session.id)
    chatStore.connectToSession(session.id)
  }, [])

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

  const TIME_GROUP_LABELS: Record<TimeGroup, string> = {
    today: t('sidebar.timeGroup.today'),
    yesterday: t('sidebar.timeGroup.yesterday'),
    last7days: t('sidebar.timeGroup.last7days'),
    last30days: t('sidebar.timeGroup.last30days'),
    older: t('sidebar.timeGroup.older'),
  }

  const newSessionLabel = t('sidebar.newSession')
  const scheduledLabel = t('sidebar.scheduled')
  const jarvisLabel = t('sidebar.jarvis')
  const workbenchLabel = t('sidebar.workbench')
  const settingsLabel = t('sidebar.settings')
  const sidebarToggleLabel = sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')
  const renderSessionRow = (session: SessionListItem) => {
    const selected = selectedSessionIds.has(session.id)
    const pinned = pinnedSessionIds.includes(session.id)
    return (
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
          <div className="group relative">
            <button
              onClick={() => {
                if (batchMode) {
                  toggleBatchSelection(session.id)
                  return
                }
                openSessionFromHistory(session)
              }}
              onContextMenu={(e) => handleContextMenu(e, session.id)}
              className={`
                cc-soft-item w-full flex items-center gap-2 pl-4 pr-14 py-1.5 text-sm text-left rounded-[var(--radius-md)]
                ${session.id === activeTabId
                  ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                }
              `}
            >
              {batchMode ? (
                <span className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] ${selected ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-white' : 'border-[var(--color-border)]'}`}>
                  {selected ? '✓' : ''}
                </span>
              ) : (
                <span className="w-1 h-1 rounded-full flex-shrink-0" style={{
                  backgroundColor: session.id === activeTabId ? 'var(--color-brand)' : 'var(--color-text-tertiary)',
                  opacity: session.id === activeTabId ? 1 : 0.5,
                }} />
              )}
              <span className="truncate flex-1">{session.title || 'Untitled'}</span>
              {pinned && (
                <span className="material-symbols-outlined text-[12px] text-[var(--color-brand)]">push_pin</span>
              )}
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
            {!batchMode && (
              <button
                type="button"
                aria-label={`打开 ${session.title || 'Untitled'} 的更多操作`}
                title="更多"
                onClick={(e) => handleContextMenu(e, session.id)}
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] opacity-0 transition-all hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] group-hover:opacity-100 focus:opacity-100"
              >
                <MoreIcon />
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <aside onMouseDown={handleSidebarDrag} className="w-[var(--sidebar-width)] h-full flex flex-col bg-[var(--color-surface-sidebar)] border-r border-[var(--color-border)] shadow-[1px_0_18px_rgba(15,23,42,0.045)] select-none transition-[width] duration-300 ease-[var(--ease-out-quint)]">
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
        <NavItem
          active={activeTabId === JARVIS_TAB_ID}
          collapsed={!sidebarOpen}
          label={jarvisLabel}
          onClick={() => useTabStore.getState().openTab(JARVIS_TAB_ID, t('sidebar.jarvis'), 'jarvis')}
          icon={<span className="material-symbols-outlined text-[18px]">sensors</span>}
        >
          {jarvisLabel}
        </NavItem>
        <NavItem
          active={activeTabId === WORKBENCH_TAB_ID}
          collapsed={!sidebarOpen}
          label={workbenchLabel}
          onClick={() => useTabStore.getState().openTab(WORKBENCH_TAB_ID, workbenchLabel, 'workbench')}
          icon={<span className="material-symbols-outlined text-[18px]">hub</span>}
        >
          {workbenchLabel}
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
        {pinnedSessions.length > 0 && (
          <div className="mb-1">
            <div className="px-2 pt-3 pb-1 text-[11px] font-semibold text-[var(--color-text-tertiary)] tracking-wide">
              已置顶
            </div>
            {pinnedSessions.map(renderSessionRow)}
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
              {items.map(renderSessionRow)}
            </div>
          )
        })}
          </>
        )}
      </div>

      {sidebarOpen && batchMode && (
        <div className="border-t border-[var(--color-border)] px-3 py-2">
          <div className="mb-2 text-xs text-[var(--color-text-tertiary)]">
            已选择 {selectedSessionIds.size} 个对话
          </div>
          <div className="grid grid-cols-3 gap-1">
            <button
              type="button"
              onClick={() => setSelectedSessionIds(new Set(filteredSessions.map((session) => session.id)))}
              className="rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-xs hover:bg-[var(--color-surface-hover)]"
            >
              全选
            </button>
            <button
              type="button"
              onClick={() => void handleBatchExport()}
              disabled={selectedSessionIds.size === 0}
              className="rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-xs hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
            >
              导出
            </button>
            <button
              type="button"
              onClick={() => void handleBatchDelete()}
              disabled={selectedSessionIds.size === 0}
              className="rounded-lg border border-red-200 px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              删除
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setBatchMode(false)
              setSelectedSessionIds(new Set())
            }}
            className="mt-2 w-full rounded-lg px-2 py-1.5 text-xs text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]"
          >
            退出批量管理
          </button>
        </div>
      )}

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
          className="cc-surface-pop fixed z-50 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl py-2 min-w-[220px]"
          style={{ left: contextMenu.x, top: contextMenu.y, boxShadow: 'var(--shadow-dropdown)' }}
        >
          <MenuButton
            icon="edit"
            onClick={() => {
              const session = sessions.find(s => s.id === contextMenu.id)
              handleStartRename(contextMenu.id, session?.title || '')
            }}
          >
            {t('common.rename')}
          </MenuButton>
          <MenuButton icon="push_pin" onClick={() => handleTogglePinned(contextMenu.id)}>
            {pinnedSessionIds.includes(contextMenu.id) ? '取消置顶' : '置顶此对话'}
          </MenuButton>
          <MenuButton icon="download" onClick={() => void handleExport(contextMenu.id)}>
            导出对话 JSON
          </MenuButton>
          <MenuButton
            icon="tune"
            onClick={() => {
              setContextMenu(null)
              setBatchMode(true)
              setSelectedSessionIds(new Set([contextMenu.id]))
            }}
          >
            批量管理
          </MenuButton>
          <div className="my-2 h-px bg-[var(--color-border)]" />
          <MenuButton
            icon="delete"
            danger
            onClick={() => void handleDelete(contextMenu.id)}
          >
            {t('common.delete')}
          </MenuButton>
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

function MenuButton({
  icon,
  danger,
  onClick,
  children,
}: {
  icon: string
  danger?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-[var(--color-surface-hover)] ${
        danger ? 'text-red-500' : 'text-[var(--color-text-primary)]'
      }`}
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
      <span>{children}</span>
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

function MoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  )
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
