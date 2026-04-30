import type { BrowserControlExecuteRequest, BrowserControlExecution } from './types.js'
import { readBrowserControlOwnerUrl } from './ownerRegistry.js'

export type BrowserControlOwnerStatus = {
  diagnostics?: {
    tmwd?: {
      wsUrl: string
      status: 'running' | 'unavailable'
      connected: boolean
      connectedTabs: number
      installPath: string
      extensionIdHint: string
      guidance: string[]
    }
    recovery?: {
      savedTabs: number
      lastUpdatedAt?: string
    }
  }
}

export function isBridgePortInUse(error?: string): boolean {
  if (!error) return false
  return /EADDRINUSE|address already in use|port 18765|Failed to start server/i.test(error)
}

export async function executeViaBrowserControlOwner(
  input: BrowserControlExecuteRequest,
): Promise<BrowserControlExecution | null> {
  for (const baseUrl of await browserControlOwnerCandidates()) {
    const result = await postJson<BrowserControlExecution>(
      `${baseUrl}/api/browser-control/execute`,
      input,
    )
    if (result) return result
  }
  return null
}

export async function readBrowserControlOwnerStatus(): Promise<BrowserControlOwnerStatus | null> {
  for (const baseUrl of await browserControlOwnerCandidates()) {
    const result = await getJson<BrowserControlOwnerStatus>(`${baseUrl}/api/browser-control`)
    if (result?.diagnostics?.tmwd) return result
  }
  return null
}

async function browserControlOwnerCandidates(): Promise<string[]> {
  const explicit = [
    process.env.CLAUDE_YH_BROWSER_CONTROL_OWNER_URL,
    process.env.CLAUDE_YH_BROWSER_CONTROL_PROXY_URL,
  ].filter(Boolean) as string[]
  const defaults = ['http://127.0.0.1:3456']
  const currentPort = currentServerPort()
  const registered = await readBrowserControlOwnerUrl()
  return [registered, ...explicit, ...defaults]
    .filter((url): url is string => typeof url === 'string' && url.length > 0)
    .map(url => url.replace(/\/$/, ''))
    .filter((url, index, urls) => urls.indexOf(url) === index)
    .filter(url => {
      try {
        const parsed = new URL(url)
        return Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)) !== currentPort
      } catch {
        return false
      }
    })
}

function currentServerPort(): number | null {
  const portArg = readArgValue('--port')
  const raw = portArg || process.env.SERVER_PORT
  const port = Number.parseInt(raw || '', 10)
  return Number.isFinite(port) ? port : null
}

function readArgValue(flag: string): string | undefined {
  const args = process.argv.slice(2)
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(1500),
    })
    if (!response.ok) return null
    return await response.json() as T
  } catch {
    return null
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T | null> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Claude-YH-Browser-Proxy': '1',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
    return await response.json() as T
  } catch {
    return null
  }
}
