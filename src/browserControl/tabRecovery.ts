import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

export type BrowserTabRecoverySnapshot = {
  id: string
  backendId: string
  tabId?: string
  url?: string
  title?: string
  active?: boolean
  updatedAt: string
}

type BrowserTabRecoveryStore = {
  version: 1
  tabs: BrowserTabRecoverySnapshot[]
}

export async function recordBrowserTabRecoverySnapshot(input: {
  backendId: string
  tabs?: Array<{ id?: unknown; url?: unknown; title?: unknown; active?: unknown }>
  tabId?: string
  url?: string
}): Promise<void> {
  const current = await readStore()
  const updatedAt = new Date().toISOString()
  const incoming = input.tabs?.length
    ? input.tabs.map(tab => ({
        id: `${input.backendId}:${String(tab.id ?? tab.url ?? Math.random())}`,
        backendId: input.backendId,
        tabId: tab.id === undefined ? undefined : String(tab.id),
        url: typeof tab.url === 'string' ? tab.url : undefined,
        title: typeof tab.title === 'string' ? tab.title : undefined,
        active: typeof tab.active === 'boolean' ? tab.active : undefined,
        updatedAt,
      }))
    : [{
        id: `${input.backendId}:${input.tabId ?? input.url ?? 'last'}`,
        backendId: input.backendId,
        tabId: input.tabId,
        url: input.url,
        updatedAt,
      }]
  const byId = new Map(current.tabs.map(tab => [tab.id, tab]))
  for (const tab of incoming) byId.set(tab.id, { ...byId.get(tab.id), ...tab })
  const tabs = [...byId.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 200)
  await writeStore({ version: 1, tabs })
}

export async function readBrowserTabRecoverySnapshots(): Promise<BrowserTabRecoverySnapshot[]> {
  return (await readStore()).tabs
}

async function readStore(): Promise<BrowserTabRecoveryStore> {
  try {
    const raw = await fs.readFile(getStorePath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<BrowserTabRecoveryStore>
    return {
      version: 1,
      tabs: Array.isArray(parsed.tabs) ? parsed.tabs.filter(isSnapshot) : [],
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, tabs: [] }
    }
    throw error
  }
}

async function writeStore(store: BrowserTabRecoveryStore): Promise<void> {
  const filePath = getStorePath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(store, null, 2) + '\n', 'utf-8')
}

function getStorePath(): string {
  return path.join(getClaudeConfigHomeDir(), 'browser-control', 'tab-recovery.json')
}

function isSnapshot(value: unknown): value is BrowserTabRecoverySnapshot {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as BrowserTabRecoverySnapshot).id === 'string' &&
      typeof (value as BrowserTabRecoverySnapshot).backendId === 'string' &&
      typeof (value as BrowserTabRecoverySnapshot).updatedAt === 'string',
  )
}
