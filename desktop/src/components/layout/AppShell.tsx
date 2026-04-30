import { useEffect, useState, type CSSProperties } from 'react'
import { Sidebar } from './Sidebar'
import { ContentRouter } from './ContentRouter'
import { ToastContainer } from '../shared/Toast'
import { UpdateChecker } from '../shared/UpdateChecker'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore, type SettingsTab } from '../../stores/uiStore'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { initializeDesktopServerUrl } from '../../lib/desktopRuntime'
import { WindowControls, showWindowControls } from './WindowControls'
import { useTabStore, SETTINGS_TAB_ID } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'
import { useTranslation } from '../../i18n'
import { sessionsApi } from '../../api/sessions'

const APP_MIN_WIDTH = 1120
const APP_MIN_HEIGHT = 720
const APP_DEFAULT_WIDTH = 1440
const APP_DEFAULT_HEIGHT = 900
const APP_EXPAND_SETTLE_DELAY_MS = 520

export function AppShell() {
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const [ready, setReady] = useState(false)
  const [startupError, setStartupError] = useState<string | null>(null)
  const t = useTranslation()

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      try {
        await initializeDesktopServerUrl()
        await fetchSettings()

        // Restore tabs from localStorage
        await useTabStore.getState().restoreTabs()
        const activeId = useTabStore.getState().activeTabId
        if (activeId) {
          useChatStore.getState().connectToSession(activeId)
        }
        if (!cancelled) {
          setReady(true)
        }
      } catch (error) {
        if (!cancelled) {
          setStartupError(error instanceof Error ? error.message : String(error))
          setReady(false)
        }
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [fetchSettings])

  // Listen for macOS native menu navigation events (About / Settings)
  useEffect(() => {
    let unlisten: (() => void) | undefined
    import(/* @vite-ignore */ '@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<string>('native-menu-navigate', (event) => {
          const target = event.payload as SettingsTab | 'settings'
          if (target === 'about') {
            useUIStore.getState().setPendingSettingsTab('about')
          }
          useTabStore.getState().openTab(SETTINGS_TAB_ID, 'Settings', 'settings')
        }),
      )
      .then((fn) => { unlisten = fn })
      .catch(() => {})
    return () => { unlisten?.() }
  }, [])

  useKeyboardShortcuts()

  useEffect(() => {
    const unsubscribe = useTabStore.subscribe((state, previousState) => {
      const previousId = previousState.activeTabId
      if (!previousId || previousId === state.activeTabId) return
      const previousTab = previousState.tabs.find((tab) => tab.sessionId === previousId)
      if (previousTab?.type !== 'session') return

      useChatStore.getState().disconnectSession(previousId)
      sessionsApi.finalize(previousId, 'desktop-tab-left')
        .catch((error) => {
          console.warn('Failed to finalize memory after leaving session tab', error)
        })
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!ready && !startupError) return
    let cancelled = false
    const timers: number[] = []

    const applyFinalWindowSize = async () => {
      const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      if (await win.isMaximized()) {
        await win.unmaximize()
      }
      await win.setMinSize(new LogicalSize(APP_MIN_WIDTH, APP_MIN_HEIGHT))
      await win.setSize(new LogicalSize(APP_DEFAULT_WIDTH, APP_DEFAULT_HEIGHT))
      await win.center()
      await win.show()
      await win.setFocus()
    }

    const openWindowAtFinalSize = async () => {
      const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      if (await win.isMaximized()) {
        await win.unmaximize()
      }
      await win.setMinSize(null)
      await win.setSize(new LogicalSize(APP_DEFAULT_WIDTH, APP_DEFAULT_HEIGHT))
      await win.center()
      await win.show()
      await win.setFocus()
      timers.push(window.setTimeout(() => {
        if (cancelled) return
        win.setMinSize(new LogicalSize(APP_MIN_WIDTH, APP_MIN_HEIGHT)).catch(() => {})
      }, APP_EXPAND_SETTLE_DELAY_MS))
    }

    openWindowAtFinalSize().catch((error) => {
      console.warn('Failed to open desktop window at final size', error)
      applyFinalWindowSize().catch(() => {})
    })

    for (const delay of [APP_EXPAND_SETTLE_DELAY_MS + 260, 1200]) {
      timers.push(window.setTimeout(() => {
        if (!cancelled) {
          applyFinalWindowSize().catch((error) => {
            console.warn('Failed to apply desktop window size', error)
          })
        }
      }, delay))
    }

    return () => {
      cancelled = true
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [ready, startupError])

  if (startupError) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--color-surface)] px-6">
        <div className="max-w-xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-6">
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
            {t('app.serverFailed')}
          </h1>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            {startupError}
          </p>
        </div>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#f7f7f8]">
        <img src="/app-icon.svg" alt="Claude YH" className="h-[76px] w-[76px]" />
      </div>
    )
  }

  const shellStyle = {
    '--sidebar-width': sidebarOpen ? '280px' : '72px',
  } as CSSProperties

  const appContent = (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <Sidebar />
      <main id="content-area" className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {showWindowControls && (
          <div
            data-tauri-drag-region
            className="flex h-[28px] flex-shrink-0 items-stretch bg-[var(--color-surface)] select-none"
          >
            <div className="min-w-0 flex-1" data-tauri-drag-region />
            <WindowControls />
          </div>
        )}
        <ContentRouter />
      </main>
    </div>
  )

  return (
    <div className="cc-app-shell-enter flex h-screen min-h-0 min-w-0 flex-col overflow-hidden" style={shellStyle}>
      {appContent}
      <ToastContainer />
      <UpdateChecker />
    </div>
  )
}
