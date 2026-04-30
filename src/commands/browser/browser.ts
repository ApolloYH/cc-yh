import type { LocalCommandCall } from '../../types/command.js'
import {
  DEFAULT_BROWSER_CONTROL_POLICY,
  executeBrowserControl,
  getBrowserControlAuditPath,
  getLocalTmwdBridge,
  readBrowserControlPolicy,
  updateBrowserControlPolicy,
  type BrowserControlPolicy,
} from '../../browserControl/index.js'

const LOCAL_API = process.env.CLAUDE_YH_SERVER_URL ?? 'http://127.0.0.1:3456'

export const call: LocalCommandCall = async (args) => {
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const [action, ...rest] = tokens

  if (!action || action === 'status') {
    return text(await formatStatus())
  }

  if (action === 'on' || action === 'enable') {
    const policy = await updateBrowserControlPolicy(DEFAULT_BROWSER_CONTROL_POLICY)
    return text(await formatStatus('BrowserControl enabled with default full-access policy.', policy))
  }

  if (action === 'off' || action === 'disable') {
    const policy = await updateBrowserControlPolicy({ enabled: false })
    return text(await formatStatus('BrowserControl disabled.', policy))
  }

  if (action === 'defaults' || action === 'reset') {
    const policy = await updateBrowserControlPolicy(DEFAULT_BROWSER_CONTROL_POLICY)
    return text(await formatStatus('BrowserControl defaults restored.', policy))
  }

  if (action === 'tabs') {
    const result = await executeTabsRead()
    if (!result.ok) {
      return text(`Browser tabs read failed: ${result.error}`)
    }
    const data = result.data as { tabs?: Array<{ id: number; title?: string; url?: string }> }
    const tabs = data.tabs ?? []
    return text([
      `Browser bridge: ${result.backendId}`,
      `Tabs: ${tabs.length}`,
      '',
      ...tabs.map((tab, index) => `${index + 1}. [${tab.id}] ${tab.title || '(untitled)'}\n   ${tab.url || ''}`),
    ].join('\n'))
  }

  if (action === 'allow') {
    const domains = rest.filter(Boolean)
    if (domains.length === 0) return text('Usage: /browser allow <domain...>')
    const current = await readBrowserControlPolicy()
    const policy = await updateBrowserControlPolicy({
      allowedDomains: unique([...current.allowedDomains, ...domains]),
    })
    return text(await formatStatus(`Allowed domains updated: ${domains.join(', ')}`, policy))
  }

  if (action === 'deny') {
    const domains = rest.filter(Boolean)
    if (domains.length === 0) return text('Usage: /browser deny <domain...>')
    const current = await readBrowserControlPolicy()
    const policy = await updateBrowserControlPolicy({
      deniedDomains: unique([...(current.deniedDomains ?? []), ...domains]),
    })
    return text(await formatStatus(`Denied domains updated: ${domains.join(', ')}`, policy))
  }

  if (action === 'high-risk') {
    const value = rest[0]
    if (value !== 'on' && value !== 'off') return text('Usage: /browser high-risk on|off')
    const enabled = value === 'on'
    const policy = await updateBrowserControlPolicy({
      allowHighRiskBackends: enabled,
      allowHighRiskCapabilities: enabled,
    })
    return text(await formatStatus(`High-risk browser capabilities ${enabled ? 'enabled' : 'disabled'}.`, policy))
  }

  if (action === 'confirm') {
    const value = rest[0]
    if (value !== 'on' && value !== 'off') return text('Usage: /browser confirm on|off')
    const policy = await updateBrowserControlPolicy({
      requireConfirmationForSensitiveActions: value === 'on',
    })
    return text(await formatStatus(`Sensitive action confirmation ${value}.`, policy))
  }

  return text([
    'Usage:',
    '/browser status',
    '/browser on',
    '/browser off',
    '/browser defaults',
    '/browser tabs',
    '/browser allow <domain...>',
    '/browser deny <domain...>',
    '/browser high-risk on|off',
    '/browser confirm on|off',
    '',
    'Default policy is enabled, allowedDomains=["*"], high-risk backend/capabilities on, with confirmation still required for sensitive actions.',
  ].join('\n'))
}

async function executeTabsRead() {
  const viaServer = await executeTabsReadViaServer()
  if (viaServer) return viaServer

  return executeBrowserControl({
    backendId: 'tmwd-cdp-bridge',
    action: { capability: 'tabs.read', userConfirmed: true },
  })
}

async function executeTabsReadViaServer() {
  try {
    const health = await fetch(`${LOCAL_API}/health`, { signal: AbortSignal.timeout(700) })
    if (!health.ok) return null
    const response = await fetch(`${LOCAL_API}/api/browser-control/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        backendId: 'tmwd-cdp-bridge',
        action: { capability: 'tabs.read', userConfirmed: true },
      }),
      signal: AbortSignal.timeout(5_000),
    })
    return await response.json()
  } catch {
    return null
  }
}

async function formatStatus(prefix?: string, policy?: BrowserControlPolicy): Promise<string> {
  const serverStatus = await readStatusViaServer()
  const current = policy ?? serverStatus?.policy ?? await readBrowserControlPolicy()
  const bridge = getLocalTmwdBridge()
  const state = await bridge.ensureStarted()
  const connected = state.status === 'running' ? bridge.hasClients() : false
  const serverBridgeActive = state.status !== 'running' && Boolean(serverStatus)
  return [
    ...(prefix ? [prefix, ''] : []),
    `BrowserControl: ${current.enabled ? 'on' : 'off'}`,
    `Backend: tmwd-cdp-bridge`,
    `Allowed domains: ${current.allowedDomains.join(', ') || '(none)'}`,
    `Denied domains: ${(current.deniedDomains ?? []).join(', ') || '(none)'}`,
    `High-risk backends: ${current.allowHighRiskBackends ? 'on' : 'off'}`,
    `High-risk capabilities: ${current.allowHighRiskCapabilities ? 'on' : 'off'}`,
    `Sensitive confirmation: ${current.requireConfirmationForSensitiveActions ? 'on' : 'off'}`,
    `Local bridge: ${state.status === 'running' ? `ws://127.0.0.1:${state.port}` : serverBridgeActive ? `${LOCAL_API} owns ws://127.0.0.1:18765` : `unavailable (${state.error})`}`,
    `Extension connected: ${connected ? 'yes' : serverBridgeActive ? 'check with /browser tabs' : 'no'}`,
    `Current process tabs: ${bridge.listTabs().length}`,
    `Audit log: ${getBrowserControlAuditPath()}`,
  ].join('\n')
}

async function readStatusViaServer(): Promise<{ policy: BrowserControlPolicy } | null> {
  try {
    const health = await fetch(`${LOCAL_API}/health`, { signal: AbortSignal.timeout(700) })
    if (!health.ok) return null
    const response = await fetch(`${LOCAL_API}/api/browser-control`, { signal: AbortSignal.timeout(2_000) })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

function text(value: string) {
  return { type: 'text' as const, value }
}

function unique(values: readonly string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}
