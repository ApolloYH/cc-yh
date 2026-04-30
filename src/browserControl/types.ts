export const BROWSER_CONTROL_CONTRACT_VERSION = 1

export type BrowserControlBackendKind =
  | 'mcp'
  | 'chrome-devtools'
  | 'chrome-extension'
  | 'tmwd-cdp-bridge'
  | 'computer-use'
  | 'playwright'

export type BrowserControlRisk = 'low' | 'medium' | 'high'

export type BrowserControlCapability =
  | 'tabs.read'
  | 'page.navigate'
  | 'page.screenshot'
  | 'page.read_dom'
  | 'page.click'
  | 'page.type'
  | 'page.read_console'
  | 'page.read_network'
  | 'files.upload'
  | 'downloads.save'
  | 'storage.read_cookies'
  | 'cdp.call'
  | 'headers.modify'
  | 'extensions.manage'

export type BrowserPageSignal =
  | 'login'
  | 'captcha'
  | 'two_factor'
  | 'payment'
  | 'sensitive_confirmation'

export type BrowserControlBackend = {
  id: string
  kind: BrowserControlBackendKind
  displayName: string
  capabilities: readonly BrowserControlCapability[]
  risk: BrowserControlRisk
  requiresExplicitInstall: boolean
}

export type BrowserControlAction = {
  capability: BrowserControlCapability
  url?: string
  domain?: string
  description?: string
  userConfirmed?: boolean
  pageSignals?: readonly BrowserPageSignal[]
}

export type BrowserControlPolicy = {
  enabled: boolean
  allowedDomains: readonly string[]
  deniedDomains?: readonly string[]
  allowHighRiskBackends?: boolean
  allowHighRiskCapabilities?: boolean
  requireConfirmationForSensitiveActions?: boolean
}

export type BrowserControlDecision =
  | {
      decision: 'allow'
      reason: string
    }
  | {
      decision: 'confirm'
      reason: string
      confirmation: string
    }
  | {
      decision: 'deny'
      reason: string
    }

export type BrowserControlDevtoolsOptions = {
  endpoint?: string
  port?: number
  launch?: boolean
  chromePath?: string
  userDataDir?: string
  timeoutMs?: number
}

export type BrowserControlTmwdOptions = {
  endpoint?: string
  timeoutMs?: number
  sessionId?: string
}

export type BrowserControlExecuteRequest = {
  backendId: string
  action: BrowserControlAction
  tabId?: string
  selector?: string
  filePath?: string
  downloadPath?: string
  text?: string
  submit?: boolean
  fullPage?: boolean
  screenshotFormat?: 'png' | 'jpeg'
  maxContentLength?: number
  cdp?: {
    method: string
    params?: Record<string, unknown>
  }
  devtools?: BrowserControlDevtoolsOptions
  tmwd?: BrowserControlTmwdOptions
}

export type BrowserControlExecution =
  | {
      ok: true
      backendId: string
      decision: BrowserControlDecision
      auditId: string
      data: unknown
    }
  | {
      ok: false
      backendId: string
      decision: BrowserControlDecision
      auditId: string
      error: string
      statusCode?: number
      recovery?: {
        summary: string
        nextActions: string[]
      }
    }
