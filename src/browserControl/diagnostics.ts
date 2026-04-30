import * as path from 'node:path'
import { readBrowserTabRecoverySnapshots } from './tabRecovery.js'
import { getLocalTmwdBridge } from './tmwdBridgeServer.js'

export type BrowserControlDiagnostics = {
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

export async function getBrowserControlDiagnostics(): Promise<BrowserControlDiagnostics> {
  const bridge = getLocalTmwdBridge()
  const state = await bridge.ensureStarted()
  const recovery = await readBrowserTabRecoverySnapshots()
  const wsUrl = `ws://127.0.0.1:${state.port}`
  const connected = state.status === 'running' && bridge.hasClients()
  return {
    tmwd: {
      wsUrl,
      status: state.status,
      connected,
      connectedTabs: state.status === 'running' ? bridge.listTabs().length : 0,
      installPath: path.resolve(process.cwd(), 'extensions', 'tmwd_cdp_bridge'),
      extensionIdHint: 'Chrome extension ID changes when the local unpacked path changes.',
      guidance: buildGuidance({
        wsUrl,
        running: state.status === 'running',
        connected,
        error: state.error,
      }),
    },
    recovery: {
      savedTabs: recovery.length,
      lastUpdatedAt: recovery[0]?.updatedAt,
    },
  }
}

function buildGuidance(input: {
  wsUrl: string
  running: boolean
  connected: boolean
  error?: string
}): string[] {
  if (!input.running) {
    return [
      `Local TMWD WebSocket is not running: ${input.error ?? 'unknown'}`,
      'Start claude-yh CLI, web server, or desktop app first, then reload the Chrome extension.',
    ]
  }
  if (input.connected) {
    return [
      `TMWD extension is connected to ${input.wsUrl}`,
      'Use /browser tabs or the BrowserControl tool to inspect current Chrome tabs and login-state pages.',
    ]
  }
  return [
    'Chrome extension is not connected to claude-yh yet.',
    'Open chrome://extensions, enable Developer mode, and load extensions/tmwd_cdp_bridge.',
    'If the extension card shows errors, open Errors or Service Worker details, then click Reload.',
    `Confirm the extension connects to ${input.wsUrl}, and keep claude-yh running.`,
    'After connection, /browser tabs will show your current Chrome tabs and logged-in pages.',
  ]
}
