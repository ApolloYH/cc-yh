import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { RustSidecarClient } from '../runtime/rustSidecarClient.js'
import { getRustSidecarLaunchConfig, type RustSidecarMethod } from '../runtime/rustSidecarProtocol.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

export type JarvisQueueItemStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'

export type JarvisQueueItem = {
  id: string
  prompt: string
  title?: string
  goal?: string
  plan?: string[]
  boundarySummary?: string
  priority: number
  status: JarvisQueueItemStatus
  approvalState: 'none' | 'requested' | 'approved'
  attempts: number
  maxAttempts: number
  createdAt: string
  updatedAt: string
  runId?: string
  checkpoint?: string
  error?: string
}

type JarvisQueueStore = {
  version: 1
  items: JarvisQueueItem[]
}

export async function enqueueJarvisTask(input: {
  prompt: string
  title?: string
  goal?: string
  plan?: string[]
  boundarySummary?: string
  priority?: number
  maxAttempts?: number
  checkpoint?: string
}): Promise<JarvisQueueItem> {
  const now = new Date().toISOString()
  const item: JarvisQueueItem = {
    id: crypto.randomUUID(),
    prompt: input.prompt,
    title: input.title,
    goal: input.goal,
    plan: input.plan,
    boundarySummary: input.boundarySummary,
    priority: clampPriority(input.priority),
    status: 'pending',
    approvalState: 'none',
    attempts: 0,
    maxAttempts: Math.max(1, Math.min(10, input.maxAttempts ?? 3)),
    createdAt: now,
    updatedAt: now,
    checkpoint: input.checkpoint,
  }
  const runtimeResult = await runtimeQueueRequest('jarvis.queue.enqueue', { item })
  if (isRecord(runtimeResult) && isQueueItem(runtimeResult.item)) {
    return normalizeQueueItem(runtimeResult.item)
  }
  const store = await readJarvisQueue()
  await writeJarvisQueue({ version: 1, items: [item, ...store.items] })
  return item
}

export async function listJarvisQueue(): Promise<JarvisQueueItem[]> {
  return (await readJarvisQueue()).items
}

export async function claimNextJarvisTask(): Promise<JarvisQueueItem | null> {
  const runtimeResult = await runtimeQueueRequest('jarvis.queue.claim', {})
  if (isRecord(runtimeResult)) {
    return isQueueItem(runtimeResult.item)
      ? normalizeQueueItem(runtimeResult.item)
      : null
  }
  const store = await readJarvisQueue()
  const candidate = store.items
    .filter(item => item.status === 'pending' || item.status === 'failed')
    .filter(item => item.attempts < item.maxAttempts)
    .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt))[0]
  if (!candidate) return null
  const now = new Date().toISOString()
  const next = {
    ...candidate,
    status: 'running' as const,
    attempts: candidate.attempts + 1,
    updatedAt: now,
  }
  await replaceQueueItem(next)
  return next
}

export async function updateJarvisQueueItem(
  id: string,
  patch: Partial<Omit<JarvisQueueItem, 'id' | 'createdAt'>>,
): Promise<JarvisQueueItem | null> {
  const runtimeResult = await runtimeQueueRequest('jarvis.queue.update', { id, patch })
  if (isRecord(runtimeResult)) {
    return isQueueItem(runtimeResult.item)
      ? normalizeQueueItem(runtimeResult.item)
      : null
  }
  const store = await readJarvisQueue()
  const current = store.items.find(item => item.id === id)
  if (!current) return null
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  await replaceQueueItem(next)
  return next
}

export async function recoverInterruptedJarvisQueue(): Promise<number> {
  const runtimeResult = await runtimeQueueRequest('jarvis.queue.recover', {})
  if (isRecord(runtimeResult) && typeof runtimeResult.recovered === 'number') {
    return runtimeResult.recovered
  }
  const store = await readJarvisQueue()
  let recovered = 0
  const items = store.items.map(item => {
    if (item.status !== 'running') return item
    recovered++
    return {
      ...item,
      status: 'pending' as const,
      checkpoint: item.checkpoint ?? `Recovered after process exit at ${new Date().toISOString()}`,
      updatedAt: new Date().toISOString(),
    }
  })
  if (recovered > 0) await writeJarvisQueue({ version: 1, items })
  return recovered
}

async function replaceQueueItem(next: JarvisQueueItem): Promise<void> {
  const store = await readJarvisQueue()
  await writeJarvisQueue({
    version: 1,
    items: store.items.map(item => item.id === next.id ? next : item),
  })
}

async function readJarvisQueue(): Promise<JarvisQueueStore> {
  try {
    const raw = await fs.readFile(getJarvisQueuePath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<JarvisQueueStore>
    return {
      version: 1,
      items: Array.isArray(parsed.items)
        ? parsed.items.filter(isQueueItem).map(normalizeQueueItem)
        : [],
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, items: [] }
    }
    throw error
  }
}

async function writeJarvisQueue(store: JarvisQueueStore): Promise<void> {
  const filePath = getJarvisQueuePath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(
    filePath,
    JSON.stringify({ version: 1, items: store.items.slice(0, 500) }, null, 2) + '\n',
    'utf-8',
  )
}

function getJarvisQueuePath(): string {
  return path.join(getClaudeConfigHomeDir(), 'jarvis_queue.json')
}

async function runtimeQueueRequest(
  method: RustSidecarMethod,
  params: Record<string, unknown>,
): Promise<unknown | null> {
  const launch = getRustSidecarLaunchConfig()
  if (!launch) return null
  const client = new RustSidecarClient({
    command: launch.command,
    args: launch.args,
    timeoutMs: 10_000,
  })
  try {
    return await client.request(method, {
      queuePath: getJarvisQueuePath(),
      ...params,
    }, 10_000)
  } catch {
    return null
  } finally {
    client.close()
  }
}

function clampPriority(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : 50
}

function isQueueItem(value: unknown): value is JarvisQueueItem {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as JarvisQueueItem).id === 'string' &&
      typeof (value as JarvisQueueItem).prompt === 'string' &&
      typeof (value as JarvisQueueItem).priority === 'number' &&
      typeof (value as JarvisQueueItem).status === 'string' &&
      typeof (value as JarvisQueueItem).attempts === 'number' &&
      typeof (value as JarvisQueueItem).maxAttempts === 'number',
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeQueueItem(item: JarvisQueueItem): JarvisQueueItem {
  const approvalState = item.approvalState === 'requested' || item.approvalState === 'approved'
    ? item.approvalState
    : 'none'
  return {
    ...item,
    approvalState,
    plan: Array.isArray(item.plan)
      ? item.plan.filter((step): step is string => typeof step === 'string')
      : undefined,
  }
}
