import { useEffect, useState, type CSSProperties } from 'react'
import { Sidebar } from './Sidebar'
import { ContentRouter } from './ContentRouter'
import { ToastContainer } from '../shared/Toast'
import { UpdateChecker } from '../shared/UpdateChecker'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore, type SettingsTab } from '../../stores/uiStore'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { initializeDesktopServerUrl } from '../../lib/desktopRuntime'
import { TabBar } from './TabBar'
import { useTabStore, SETTINGS_TAB_ID } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'
import { useTranslation } from '../../i18n'

const APP_MIN_WIDTH = 1120
const APP_MIN_HEIGHT = 720
const APP_DEFAULT_WIDTH = 1440
const APP_DEFAULT_HEIGHT = 900
const APP_BOOT_WIDTH = 620
const APP_BOOT_HEIGHT = 360
const APP_EXPAND_DURATION_MS = 520

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
    if (!ready && !startupError) return
    let cancelled = false
    const timers: number[] = []

    const easeInOutCubic = (value: number) =>
      value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2

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

    const animateWindowSize = async () => {
      const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      if (await win.isMaximized()) {
        await win.unmaximize()
      }
      await win.show()
      await win.setFocus()

      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        await applyFinalWindowSize()
        return
      }

      const start = performance.now()
      const frameMs = 1000 / 45
      let lastFrame = 0
      const animate = async (now: number): Promise<void> => {
        if (cancelled) return
        if (now - lastFrame < frameMs) {
          requestAnimationFrame((time) => void animate(time))
          return
        }
        lastFrame = now
        const progress = Math.min(1, (now - start) / APP_EXPAND_DURATION_MS)
        const eased = easeInOutCubic(progress)
        const width = APP_BOOT_WIDTH + (APP_DEFAULT_WIDTH - APP_BOOT_WIDTH) * eased
        const height = APP_BOOT_HEIGHT + (APP_DEFAULT_HEIGHT - APP_BOOT_HEIGHT) * eased
        await win.setSize(new LogicalSize(Math.round(width), Math.round(height)))
        if (progress < 1) {
          requestAnimationFrame((time) => void animate(time))
          return
        }
        await win.center()
        await win.setMinSize(new LogicalSize(APP_MIN_WIDTH, APP_MIN_HEIGHT))
      }
      requestAnimationFrame((time) => void animate(time))
    }

    animateWindowSize().catch((error) => {
      console.warn('Failed to animate desktop window size', error)
      applyFinalWindowSize().catch(() => {})
    })

    for (const delay of [APP_EXPAND_DURATION_MS + 220, 1200]) {
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
        <div className="grid h-[170px] w-[380px] place-items-center rounded-[28px] border border-[#e5e7eb] bg-white shadow-[0_18px_55px_rgba(15,23,42,0.12)]">
          <img src="/app-icon.svg" alt="Claude YH" className="h-[76px] w-[76px]" />
        </div>
      </div>
    )
  }

  const shellStyle = {
    '--sidebar-width': sidebarOpen ? '280px' : '72px',
  } as CSSProperties

  return (
    <div className="flex h-screen min-h-0 min-w-0 overflow-hidden" style={shellStyle}>
      <Sidebar />
      <main id="content-area" className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TabBar />
        <ContentRouter />
      </main>
      <ToastContainer />
      <UpdateChecker />
    </div>
  )
}
