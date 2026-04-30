import type { LocalCommandCall } from '../../types/command.js'
import {
  DEFAULT_BROWSER_CONTROL_POLICY,
  executeBrowserControl,
  getBrowserControlAuditPath,
  getBrowserControlDiagnostics,
  getLocalTmwdBridge,
  readBrowserControlPolicy,
  smokeBrowserControlCurrentChrome,
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

  if (action === 'smoke' || action === 'test') {
    const viaServer = await executeSmokeViaServer()
    const result = viaServer ?? await smokeBrowserControlCurrentChrome()
    return text([
      `BrowserControl smoke: ${result.ok ? 'passed' : 'failed'}`,
      `Connected tabs: ${result.connectedTabs}`,
      '',
      ...result.checks.map(check =>
        `- ${check.name}: ${check.ok ? 'ok' : `failed (${check.error || 'unknown'})`}`,
      ),
      '',
      'TMWD guidance:',
      ...result.guidance.map(item => `- ${item}`),
    ].join('\n'))
  }

  if (action === 'allow' || action === 'deny') {
    return text([
      'Domain allow/deny policy has been removed.',
      'BrowserControl is controlled by the global enable switch, high-risk capability switch, sensitive-action confirmation, and human-only guardrails.',
      'Use /browser status or /browser confirm on|off instead.',
    ].join('\n'))
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
    '/browser smoke',
    '/browser high-risk on|off',
    '/browser confirm on|off',
    '',
    'Default policy is enabled, high-risk backend/capabilities on, with confirmation still required for sensitive actions.',
  ].join('\n'))
}

async function executeSmokeViaServer() {
  try {
    const health = await fetch(`${LOCAL_API}/health`, { signal: AbortSignal.timeout(700) })
    if (!health.ok) return null
    const response = await fetch(`${LOCAL_API}/api/browser-control/smoke`, {
      method: 'POST',
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
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
  const diagnostics = await getBrowserControlDiagnostics()
  const connected = state.status === 'running' ? bridge.hasClients() : false
  const serverBridgeActive = state.status !== 'running' && Boolean(serverStatus)
  return [
    ...(prefix ? [prefix, ''] : []),
    `BrowserControl: ${current.enabled ? 'on' : 'off'}`,
    `Backend: tmwd-cdp-bridge`,
    `Domain policy: removed`,
    `High-risk backends: ${current.allowHighRiskBackends ? 'on' : 'off'}`,
    `High-risk capabilities: ${current.allowHighRiskCapabilities ? 'on' : 'off'}`,
    `Sensitive confirmation: ${current.requireConfirmationForSensitiveActions ? 'on' : 'off'}`,
    `Local bridge: ${state.status === 'running' ? `ws://127.0.0.1:${state.port}` : serverBridgeActive ? `${LOCAL_API} owns ws://127.0.0.1:18765` : `unavailable (${state.error})`}`,
    `Extension connected: ${connected ? 'yes' : serverBridgeActive ? 'check with /browser tabs' : 'no'}`,
    `Current process tabs: ${bridge.listTabs().length}`,
    `Extension path: ${diagnostics.tmwd.installPath}`,
    `Audit log: ${getBrowserControlAuditPath()}`,
    '',
    'TMWD guidance:',
    ...diagnostics.tmwd.guidance.map(item => `- ${item}`),
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
