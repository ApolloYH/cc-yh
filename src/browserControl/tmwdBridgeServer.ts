import WebSocket, { WebSocketServer } from 'ws'

type BridgeTab = {
  id: number
  url?: string
  title?: string
  active?: boolean
  windowId?: number
}

type BridgeClient = {
  ws: WebSocket
  tabs: BridgeTab[]
}

type PendingCommand = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type BridgeCommand = {
  tabId?: number
  code: string | Record<string, unknown>
  timeoutMs?: number
}

type BridgeState = {
  status: 'running' | 'unavailable'
  port: number
  error?: string
}

const DEFAULT_TMWD_WS_PORT = 18765

let singleton: LocalTmwdBridge | null = null
let singletonPort = 0

export function getLocalTmwdBridge(): LocalTmwdBridge {
  const port = readBridgePort()
  if (!singleton || singletonPort !== port) {
    singleton?.close()
    singleton = new LocalTmwdBridge(port)
    singletonPort = port
  }
  return singleton
}

export class LocalTmwdBridge {
  private server: WebSocketServer | null = null
  private serverError: string | undefined
  private readonly clients = new Set<BridgeClient>()
  private readonly pending = new Map<string, PendingCommand>()

  constructor(private readonly port: number) {}

  async ensureStarted(): Promise<BridgeState> {
    if (this.server) return { status: 'running', port: this.port }
    if (this.serverError) {
      return { status: 'unavailable', port: this.port, error: this.serverError }
    }

    try {
      this.server = await new Promise<WebSocketServer>((resolve, reject) => {
        const wss = new WebSocketServer({
          host: '127.0.0.1',
          port: this.port,
        })
        wss.once('listening', () => resolve(wss))
        wss.once('error', reject)
      })
    } catch (error) {
      this.serverError = error instanceof Error ? error.message : String(error)
      return { status: 'unavailable', port: this.port, error: this.serverError }
    }

    this.server.on('connection', ws => this.attachClient(ws))
    return { status: 'running', port: this.port }
  }

  listTabs(): BridgeTab[] {
    return [...this.clients].flatMap(client => client.tabs)
  }

  hasClients(): boolean {
    return this.clients.size > 0
  }

  async waitForClient(timeoutMs = 7_000): Promise<boolean> {
    if (this.hasClients()) return true
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      await sleep(200)
      if (this.hasClients()) return true
    }
    return false
  }

  findTab(url?: string, tabId?: number): BridgeTab | null {
    const tabs = this.listTabs()
    if (typeof tabId === 'number') {
      return tabs.find(tab => tab.id === tabId) ?? null
    }
    if (url) {
      const exact = tabs.find(tab => tab.url === url)
      if (exact) return exact
      const host = safeHostname(url)
      if (host) {
        const sameHost = tabs.find(tab => safeHostname(tab.url) === host)
        if (sameHost) return sameHost
      }
    }
    return tabs.find(tab => tab.active) ?? tabs[0] ?? null
  }

  async execute(command: BridgeCommand): Promise<unknown> {
    await this.ensureStarted()
    const client = this.findClientForTab(command.tabId) ?? [...this.clients][0]
    if (!client) throw new Error('tmwd_extension_not_connected')
    if (client.ws.readyState !== WebSocket.OPEN) {
      throw new Error('tmwd_extension_not_connected')
    }

    const id = `cyh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('tmwd_command_timeout'))
      }, command.timeoutMs ?? 15_000)
      this.pending.set(id, { resolve, reject, timer })
      client.ws.send(JSON.stringify({
        id,
        tabId: command.tabId,
        code: command.code,
      }), error => {
        if (!error) return
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  close(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('tmwd_bridge_closed'))
    }
    this.pending.clear()
    for (const client of this.clients) {
      client.ws.close()
    }
    this.clients.clear()
    this.server?.close()
    this.server = null
    this.serverError = undefined
  }

  private attachClient(ws: WebSocket): void {
    const client: BridgeClient = { ws, tabs: [] }
    this.clients.add(client)
    ws.on('message', raw => this.handleMessage(client, raw.toString()))
    ws.on('close', () => this.clients.delete(client))
    ws.on('error', () => this.clients.delete(client))
  }

  private handleMessage(client: BridgeClient, raw: string): void {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }

    if (
      (message.type === 'ext_ready' || message.type === 'tabs_update') &&
      Array.isArray(message.tabs)
    ) {
      client.tabs = message.tabs.filter(isBridgeTab)
      return
    }

    if (message.type === 'ack') return
    if (typeof message.id !== 'string') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(message.id)

    if (message.type === 'error') {
      pending.reject(new Error(formatBridgeError(message.error)))
      return
    }
    pending.resolve(message.result)
  }

  private findClientForTab(tabId?: number): BridgeClient | null {
    if (typeof tabId !== 'number') return null
    return [...this.clients].find(client =>
      client.tabs.some(tab => tab.id === tabId),
    ) ?? null
  }
}

function isBridgeTab(value: unknown): value is BridgeTab {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  return typeof (value as BridgeTab).id === 'number'
}

function safeHostname(url?: string): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function formatBridgeError(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message)
  }
  return String(error ?? 'tmwd_bridge_error')
}

function readBridgePort(): number {
  const configured = Number(process.env.CLAUDE_YH_TMWD_WS_PORT || 0)
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_TMWD_WS_PORT
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
