import { api } from './client'

export type BrowserControlDecision = {
  decision: 'allow' | 'confirm' | 'deny'
  reason: string
  confirmation?: string
}

export type BrowserControlExecutionResult = {
  ok: boolean
  backendId: string
  decision: BrowserControlDecision
  auditId: string
  data?: unknown
  error?: string
}

export type BrowserControlPolicy = {
  enabled: boolean
  allowedDomains: string[]
  deniedDomains?: string[]
  allowHighRiskBackends?: boolean
  allowHighRiskCapabilities?: boolean
  requireConfirmationForSensitiveActions?: boolean
}

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
