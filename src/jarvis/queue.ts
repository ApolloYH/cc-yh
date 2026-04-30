import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { logDiagnosticEvent } from '../utils/diagnosticLog.js'
import { tryRustSidecarRequest } from '../runtime/rustSidecarService.js'
import type { RustSidecarMethod } from '../runtime/rustSidecarProtocol.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

export type JarvisQueueItemStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'stalled'

export type JarvisQueueLane =
  | 'none'
  | 'read_only'
  | 'write'
  | 'external'

export type JarvisQueuePermissionMode =
  | 'observe'
  | 'assisted'
  | 'autonomous'
  | 'full_autonomous'

export type JarvisQueueItem = {
  id: string
  prompt: string
  title?: string
  goal?: string
  plan?: string[]
  lane?: JarvisQueueLane
  workdir?: string
  permissionMode?: JarvisQueuePermissionMode
  sessionId?: string
  pid?: number
  lastEventAt?: string
  exitCode?: number
  reportMuted?: boolean
  supplementSummary?: string
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
  lane?: JarvisQueueLane
  workdir?: string
  permissionMode?: JarvisQueuePermissionMode
  reportMuted?: boolean
  supplementSummary?: string
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
    lane: input.lane,
    workdir: input.workdir,
    permissionMode: input.permissionMode,
    reportMuted: input.reportMuted,
    supplementSummary: input.supplementSummary,
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
    logQueueDiagnostic('enqueue', true, { itemId: item.id, source: 'rust' })
    return normalizeQueueItem(runtimeResult.item)
  }
  const store = await readJarvisQueue()
  await writeJarvisQueue({ version: 1, items: [item, ...store.items] })
  logQueueDiagnostic('enqueue', true, { itemId: item.id, source: 'typescript' })
  return item
}

export async function listJarvisQueue(): Promise<JarvisQueueItem[]> {
  return (await readJarvisQueue()).items
}

export async function claimNextJarvisTask(): Promise<JarvisQueueItem | null> {
  const runtimeResult = await runtimeQueueRequest('jarvis.queue.claim', {})
  if (isRecord(runtimeResult)) {
    const item = isQueueItem(runtimeResult.item)
      ? normalizeQueueItem(runtimeResult.item)
      : null
    logQueueDiagnostic('claim', true, { itemId: item?.id ?? null, source: 'rust' })
    return item
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
  logQueueDiagnostic('claim', true, { itemId: next.id, source: 'typescript' })
  return next
}

export async function updateJarvisQueueItem(
  id: string,
  patch: Partial<Omit<JarvisQueueItem, 'id' | 'createdAt'>>,
): Promise<JarvisQueueItem | null> {
  const runtimeResult = await runtimeQueueRequest('jarvis.queue.update', { id, patch })
  if (isRecord(runtimeResult)) {
    const item = isQueueItem(runtimeResult.item)
      ? normalizeQueueItem(runtimeResult.item)
      : null
    logQueueDiagnostic('update', Boolean(item), {
      itemId: id,
      source: 'rust',
      patchKeys: Object.keys(patch),
    })
    return item
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
  logQueueDiagnostic('update', true, {
    itemId: id,
    source: 'typescript',
    patchKeys: Object.keys(patch),
  })
  return next
}

export async function deleteJarvisQueueItem(id: string): Promise<JarvisQueueItem | null> {
  const runtimeResult = await runtimeQueueRequest('jarvis.queue.delete', { id })
  if (isRecord(runtimeResult)) {
    const item = isQueueItem(runtimeResult.item)
      ? normalizeQueueItem(runtimeResult.item)
      : null
    logQueueDiagnostic('delete', Boolean(item), {
      itemId: id,
      source: 'rust',
    })
    return item
  }
  const store = await readJarvisQueue()
  const current = store.items.find(item => item.id === id)
  if (!current) {
    logQueueDiagnostic('delete', false, {
      itemId: id,
      source: 'typescript',
      reason: 'not_found',
    })
    return null
  }
  await writeJarvisQueue({
    version: 1,
    items: store.items.filter(item => item.id !== id),
  })
  logQueueDiagnostic('delete', true, {
    itemId: id,
    source: 'typescript',
    status: current.status,
  })
  return current
}

export async function recoverInterruptedJarvisQueue(): Promise<number> {
  const runtimeResult = await runtimeQueueRequest('jarvis.queue.recover', {})
  if (isRecord(runtimeResult) && typeof runtimeResult.recovered === 'number') {
    logQueueDiagnostic('recover', true, {
      recovered: runtimeResult.recovered,
      source: 'rust',
    })
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
  logQueueDiagnostic('recover', true, { recovered, source: 'typescript' })
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
  const filePath = getJarvisQueuePath()
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
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
    if (error instanceof SyntaxError) {
      const raw = await fs.readFile(filePath, 'utf-8').catch(() => '')
      const items = salvageQueueItems(raw)
      await backupCorruptQueue(filePath, raw)
      const recovered: JarvisQueueStore = { version: 1, items }
      await writeJarvisQueue(recovered)
      logQueueDiagnostic('read_repaired', true, {
        source: 'typescript',
        recoveredItems: items.length,
        reason: error.message,
      })
      return recovered
    }
    throw error
  }
}

async function writeJarvisQueue(store: JarvisQueueStore): Promise<void> {
  const filePath = getJarvisQueuePath()
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(
    tempPath,
    JSON.stringify({ version: 1, items: store.items.slice(0, 500) }, null, 2) + '\n',
    'utf-8',
  )
  await fs.rename(tempPath, filePath)
}

async function backupCorruptQueue(filePath: string, raw: string): Promise<void> {
  if (!raw.trim()) return
  const backupPath = `${filePath}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
  await fs.writeFile(backupPath, raw, 'utf-8').catch(() => {})
}

function salvageQueueItems(raw: string): JarvisQueueItem[] {
  const itemsStart = raw.indexOf('"items"')
  const arrayStart = itemsStart >= 0 ? raw.indexOf('[', itemsStart) : -1
  if (arrayStart < 0) return []

  const items: JarvisQueueItem[] = []
  let depth = 0
  let objectStart = -1
  let inString = false
  let escaped = false

  for (let index = arrayStart + 1; index < raw.length; index++) {
    const char = raw[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\' && inString) {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (char === '{') {
      if (depth === 0) objectStart = index
      depth++
      continue
    }
    if (char !== '}') continue
    depth--
    if (depth !== 0 || objectStart < 0) continue

    const chunk = raw.slice(objectStart, index + 1)
    objectStart = -1
    try {
      const parsed = JSON.parse(chunk) as unknown
      if (isQueueItem(parsed)) items.push(normalizeQueueItem(parsed))
    } catch {
      // Ignore a partially written final item.
    }
  }

  return items
}

export function getJarvisQueuePath(): string {
  return path.join(getClaudeConfigHomeDir(), 'jarvis_queue.json')
}

async function runtimeQueueRequest(
  method: RustSidecarMethod,
  params: Record<string, unknown>,
): Promise<unknown | null> {
  const result = await tryRustSidecarRequest(method, {
    queuePath: getJarvisQueuePath(),
    ...params,
  }, {
    component: 'jarvis.queue',
    logSuccess: true,
  })
  return result.ok ? result.result : null
}

function logQueueDiagnostic(
  operation: string,
  ok: boolean,
  data: Record<string, unknown>,
): void {
  logDiagnosticEvent({
    scope: 'jarvis.queue',
    event: operation,
    ok,
    data,
  })
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
    lane: isQueueLane(item.lane) ? item.lane : undefined,
    permissionMode: isQueuePermissionMode(item.permissionMode) ? item.permissionMode : undefined,
    reportMuted: item.reportMuted === true,
  }
}

function isQueueLane(value: unknown): value is JarvisQueueLane {
  return value === 'none' ||
    value === 'read_only' ||
    value === 'write' ||
    value === 'external'
}

function isQueuePermissionMode(value: unknown): value is JarvisQueuePermissionMode {
  return value === 'observe' ||
    value === 'assisted' ||
    value === 'autonomous' ||
    value === 'full_autonomous'
}
