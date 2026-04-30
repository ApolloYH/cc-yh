import { executeBrowserControl } from './executor.js'
import { getBrowserControlDiagnostics } from './diagnostics.js'

export type BrowserControlSmokeResult = {
  ok: boolean
  backendId: 'tmwd-cdp-bridge'
  connectedTabs: number
  checks: Array<{
    name: string
    ok: boolean
    detail?: unknown
    error?: string
  }>
  guidance: string[]
}

export async function smokeBrowserControlCurrentChrome(): Promise<BrowserControlSmokeResult> {
  const diagnostics = await getBrowserControlDiagnostics()
  const checks: BrowserControlSmokeResult['checks'] = []

  const tabs = await executeBrowserControl({
    backendId: 'tmwd-cdp-bridge',
    action: {
      capability: 'tabs.read',
      description: 'Smoke test current Chrome TMWD extension tabs.',
      userConfirmed: true,
    },
  })
  checks.push({
    name: 'tabs.read',
    ok: tabs.ok,
    detail: tabs.ok ? tabs.data : undefined,
    error: tabs.ok ? undefined : ('error' in tabs ? tabs.error : 'unknown'),
  })

  if (tabs.ok) {
    const firstTab = Array.isArray((tabs.data as { tabs?: unknown }).tabs)
      ? ((tabs.data as { tabs: Array<{ url?: string }> }).tabs[0])
      : undefined
    const url = firstTab?.url
    const domain = safeDomain(url)
    if (!firstTab || !url || !domain) {
      checks.push({
        name: 'cdp.call Runtime.evaluate',
        ok: false,
        error: 'tmwd_no_connected_http_tab',
      })
      return {
        ok: false,
        backendId: 'tmwd-cdp-bridge',
        connectedTabs: diagnostics.tmwd.connectedTabs,
        checks,
        guidance: diagnostics.tmwd.guidance,
      }
    }
    const version = await executeBrowserControl({
      backendId: 'tmwd-cdp-bridge',
      action: {
        capability: 'cdp.call',
        url,
        domain,
        description: 'Smoke test raw CDP over the current Chrome extension.',
        userConfirmed: true,
      },
      cdp: {
        method: 'Runtime.evaluate',
        params: {
          expression: 'location.href',
          returnByValue: true,
        },
      },
    })
    checks.push({
      name: 'cdp.call Runtime.evaluate',
      ok: version.ok,
      detail: version.ok ? version.data : undefined,
      error: version.ok ? undefined : ('error' in version ? version.error : 'unknown'),
    })
  }

  return {
    ok: checks.length > 0 && checks.every(check => check.ok),
    backendId: 'tmwd-cdp-bridge',
    connectedTabs: diagnostics.tmwd.connectedTabs,
    checks,
    guidance: diagnostics.tmwd.guidance,
  }
}

function safeDomain(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    return parsed.hostname || undefined
  } catch {
    return undefined
  }
}
