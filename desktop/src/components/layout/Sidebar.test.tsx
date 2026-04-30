import '../../test/setupDom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '../../test/testingLibrary'
import '@testing-library/jest-dom'

vi.mock('./ProjectFilter', () => ({
  ProjectFilter: () => <div data-testid="project-filter" />,
}))

vi.mock('../../i18n', () => ({
  useTranslation: () => (key: string) => {
    const translations: Record<string, string> = {
      'sidebar.newSession': 'New Session',
      'sidebar.scheduled': 'Scheduled',
      'sidebar.settings': 'Settings',
      'sidebar.collapse': 'Collapse sidebar',
      'sidebar.expand': 'Expand sidebar',
      'sidebar.searchPlaceholder': 'Search sessions',
      'sidebar.noSessions': 'No sessions',
      'sidebar.noMatching': 'No matching sessions',
      'sidebar.sessionListFailed': 'Session list failed',
      'common.retry': 'Retry',
      'common.delete': 'Delete',
      'common.rename': 'Rename',
      'sidebar.timeGroup.today': 'Today',
      'sidebar.timeGroup.yesterday': 'Yesterday',
      'sidebar.timeGroup.last7days': 'Last 7 Days',
      'sidebar.timeGroup.last30days': 'Last 30 Days',
      'sidebar.timeGroup.older': 'Older',
      'sidebar.missingDir': 'Missing',
    }

    return translations[key] ?? key
  },
}))

import { Sidebar } from './Sidebar'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'

describe('Sidebar', () => {
  const connectToSession = vi.fn()
  const disconnectSession = vi.fn()
  const fetchSessions = vi.fn()
  const createSession = vi.fn()
  const deleteSession = vi.fn()
  const addToast = vi.fn()

  beforeEach(() => {
    connectToSession.mockReset()
    disconnectSession.mockReset()
    fetchSessions.mockReset()
    createSession.mockReset()
    deleteSession.mockReset()
    addToast.mockReset()

    useTabStore.setState({ tabs: [], activeTabId: null })
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      isLoading: false,
      error: null,
      selectedProjects: [],
      availableProjects: [],
      fetchSessions,
      createSession,
      deleteSession,
    })
    useChatStore.setState({
      connectToSession,
      disconnectSession,
    } as Partial<ReturnType<typeof useChatStore.getState>>)
    useUIStore.setState({
      sidebarOpen: true,
      addToast,
    } as Partial<ReturnType<typeof useUIStore.getState>>)
  })

  afterEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null })
  })

  it('opens a new tab when creating a session from the sidebar', async () => {
    createSession.mockResolvedValue('session-new-1')

    render(<Sidebar />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    })

    await waitFor(() => {
      expect(createSession).toHaveBeenCalled()
      expect(connectToSession).toHaveBeenCalledWith('session-new-1')
    })

    expect(useTabStore.getState().tabs).toEqual([
      { sessionId: 'session-new-1', title: 'New Session', type: 'session', status: 'idle' },
    ])
    expect(useTabStore.getState().activeTabId).toBe('session-new-1')
    expect(screen.getByRole('complementary')).not.toHaveAttribute('data-tauri-drag-region')
  })

  it('shows a toast when session creation fails', async () => {
    createSession.mockRejectedValue(new Error('boom'))

    render(<Sidebar />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    })

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith({
        type: 'error',
        message: 'boom',
      })
    })

    expect(useTabStore.getState().tabs).toEqual([])
  })

  it('toggles sidebar collapsed state', async () => {
    render(<Sidebar />)

    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    await act(async () => {
      fireEvent.click(toggle)
    })

    expect(useUIStore.getState().sidebarOpen).toBe(false)
  })

  it('deletes a session from the history list via the session action menu', async () => {
    deleteSession.mockResolvedValue(undefined)

    useSessionStore.setState({
      sessions: [{
        id: 'session-delete-1',
        title: 'Delete Me',
        createdAt: '2026-04-24T00:00:00.000Z',
        modifiedAt: '2026-04-24T00:00:00.000Z',
        messageCount: 1,
        projectPath: 'C:/Users/y1513/Desktop/cc/cc-yh',
        workDir: 'C:/Users/y1513/Desktop/cc/cc-yh',
        workDirExists: true,
      }],
      activeSessionId: 'session-delete-1',
      isLoading: false,
      error: null,
      selectedProjects: [],
      availableProjects: [],
      fetchSessions,
      createSession,
      deleteSession,
    })
    useTabStore.setState({
      tabs: [{ sessionId: 'session-delete-1', title: 'Delete Me', type: 'session', status: 'idle' }],
      activeTabId: 'session-delete-1',
    })

    render(<Sidebar />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '打开 Delete Me 的更多操作' }))
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'delete Delete' }))
    })

    await waitFor(() => {
      expect(deleteSession).toHaveBeenCalledWith('session-delete-1')
      expect(disconnectSession).toHaveBeenCalledWith('session-delete-1')
    })

    expect(useTabStore.getState().tabs).toEqual([])
    expect(useTabStore.getState().activeTabId).toBeNull()
  })
})
