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
