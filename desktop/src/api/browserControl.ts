import { api } from './client'
import type {
  BrowserControlExecutionResult,
  BrowserControlPolicy,
} from './agentWorkbench'

export type BrowserControlStatus = {
  policy: BrowserControlPolicy
  backends: Array<{
    id: string
    displayName: string
    kind: string
    risk: 'low' | 'medium' | 'high'
    capabilities: string[]
  }>
  diagnostics?: {
    tmwd: {
      wsUrl: string
      status: 'running' | 'unavailable'
      connected: boolean
      connectedTabs: number
      installPath: string
      extensionIdHint: string
      guidance: string[]
    }
    recovery: {
      savedTabs: number
      lastUpdatedAt?: string
    }
  }
}

export const browserControlApi = {
  status() {
    return api.get<BrowserControlStatus>('/api/browser-control')
  },

  updatePolicy(policy: Partial<BrowserControlPolicy>) {
    return api.put<BrowserControlStatus>('/api/browser-control/policy', policy)
  },

  readTabs() {
    return api.post<BrowserControlExecutionResult>(
      '/api/browser-control/execute',
      {
        backendId: 'tmwd-cdp-bridge',
        action: { capability: 'tabs.read', userConfirmed: true },
      },
      { timeout: 20_000 },
    )
  },
}
