import type { ReactNode } from 'react'
import { useTabStore } from '../../stores/tabStore'
import { EmptySession } from '../../pages/EmptySession'
import { ActiveSession } from '../../pages/ActiveSession'
import { ScheduledTasks } from '../../pages/ScheduledTasks'
import { JarvisMode } from '../../pages/JarvisMode'
import { Settings } from '../../pages/Settings'

export function ContentRouter() {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const activeTabType = useTabStore((s) => s.tabs.find((t) => t.sessionId === s.activeTabId)?.type)
  const renderPage = (page: ReactNode, key: string) => (
    <div key={key} className="cc-page-transition flex min-h-0 flex-1 flex-col overflow-hidden">
      {page}
    </div>
  )

  // No tabs open — show empty session
  if (!activeTabId || !activeTabType) {
    return renderPage(<EmptySession />, 'empty')
  }

  // Special tabs
  if (activeTabType === 'settings') {
    return renderPage(<Settings />, activeTabId)
  }

  if (activeTabType === 'scheduled') {
    return renderPage(<ScheduledTasks />, activeTabId)
  }

  if (activeTabType === 'jarvis') {
    return renderPage(<JarvisMode />, activeTabId)
  }

  // Session tab — ActiveSession handles both regular and member sessions
  return renderPage(<ActiveSession />, activeTabId)
}
