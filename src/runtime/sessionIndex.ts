import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'

export type SessionIndexItem = {
  id: string
  projectPath: string
  filePath: string
  createdAt: string | null
  modifiedAt: string
  modifiedAtMs: number
  messageCount: number
  title: string
}

export type SessionIndexResult = {
  source: 'typescript' | 'rust'
  configDir: string
  sessions: SessionIndexItem[]
  total: number
}

type RawSessionEntry = {
  type?: string
  isMeta?: boolean
  timestamp?: string
  customTitle?: string
  aiTitle?: string
  message?: {
    role?: string
    content?: unknown
  }
}

export type BuildSessionIndexOptions = {
  configDir?: string
  limit?: number
  project?: string
  query?: string
}

export async function buildSessionIndex(
  options: BuildSessionIndexOptions = {},
): Promise<SessionIndexResult> {
  const configDir = options.configDir || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude-yh')
  const projectsDir = path.join(configDir, 'projects')
  const sessions: SessionIndexItem[] = []

  let projectDirents: string[]
  try {
    projectDirents = await fs.readdir(projectsDir)
  } catch {
    return { source: 'typescript', configDir, sessions: [], total: 0 }
  }

  for (const projectPath of projectDirents) {
    if (options.project && projectPath !== options.project) continue

    const projectDir = path.join(projectsDir, projectPath)
    const stat = await safeStat(projectDir)
    if (!stat?.isDirectory()) continue

    let files: string[]
    try {
      files = await fs.readdir(projectDir)
    } catch {
      continue
    }

    for (const file of files) {
      if (!file.endsWith('.jsonl') || file.startsWith('agent-')) continue
      const filePath = path.join(projectDir, file)
      const fileStat = await safeStat(filePath)
      if (!fileStat?.isFile()) continue
      const entries = await readJsonlEntries(filePath)
      sessions.push({
        id: file.slice(0, -'.jsonl'.length),
        projectPath,
        filePath,
        createdAt: firstTimestamp(entries),
        modifiedAt: fileStat.mtime.toISOString(),
        modifiedAtMs: fileStat.mtimeMs,
        messageCount: countMessages(entries),
        title: extractTitle(entries),
      })
    }
  }

  const filteredSessions = filterSessions(sessions, options.query)
  filteredSessions.sort((a, b) => b.modifiedAtMs - a.modifiedAtMs)
  const total = filteredSessions.length
  return {
    source: 'typescript',
    configDir,
    sessions: filteredSessions.slice(0, options.limit ?? filteredSessions.length),
    total,
  }
}

export function normalizeSessionIndexResult(
  input: unknown,
  source: SessionIndexResult['source'],
): SessionIndexResult {
  if (!isRecord(input)) {
    throw new Error('session index result must be an object')
  }
  const sessions = Array.isArray(input.sessions)
    ? input.sessions.map(normalizeSessionIndexItem).filter(Boolean)
    : []
  const configDir =
    typeof input.configDir === 'string' ? input.configDir : ''
  const total =
    typeof input.total === 'number' && Number.isFinite(input.total)
      ? input.total
      : sessions.length
  return { source, configDir, sessions, total }
}

async function safeStat(filePath: string) {
  try {
    return await fs.stat(filePath)
  } catch {
    return null
  }
}

async function readJsonlEntries(filePath: string): Promise<RawSessionEntry[]> {
  let content: string
  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch {
    return []
  }

  const entries: RawSessionEntry[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      entries.push(JSON.parse(trimmed) as RawSessionEntry)
    } catch {
      // Keep indexing resilient to partially written or corrupt JSONL lines.
    }
  }
  return entries
}

function firstTimestamp(entries: RawSessionEntry[]): string | null {
  for (const entry of entries) {
    if (typeof entry.timestamp === 'string' && entry.timestamp) {
      return entry.timestamp
    }
  }
  return null
}

function countMessages(entries: RawSessionEntry[]): number {
  return entries.filter(
    entry =>
      (entry.type === 'user' || entry.type === 'assistant') &&
      typeof entry.message?.role === 'string',
  ).length
}

function extractTitle(entries: RawSessionEntry[]): string {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (entry?.type === 'custom-title' && typeof entry.customTitle === 'string' && entry.customTitle.trim()) {
      return truncateTitle(entry.customTitle)
    }
  }

  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (entry?.type === 'ai-title' && typeof entry.aiTitle === 'string' && entry.aiTitle.trim()) {
      return truncateTitle(entry.aiTitle)
    }
  }

  for (const entry of entries) {
    if (entry.type !== 'user' || entry.isMeta || entry.message?.role !== 'user') continue
    const text = textFromContent(entry.message.content)
    if (text) return truncateTitle(text)
  }
  return 'Untitled Session'
}

function truncateTitle(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}...` : trimmed
}

function textFromContent(content: unknown): string | null {
  if (typeof content === 'string') return content.trim() || null
  if (!Array.isArray(content)) return null
  for (const block of content) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as Record<string, unknown>).type === 'text' &&
      typeof (block as Record<string, unknown>).text === 'string'
    ) {
      const text = ((block as Record<string, unknown>).text as string).trim()
      if (text) return text
    }
  }
  return null
}

function filterSessions(
  sessions: SessionIndexItem[],
  query: string | undefined,
): SessionIndexItem[] {
  const normalized = query?.trim().toLowerCase()
  if (!normalized) return sessions
  return sessions.filter(session =>
    [
      session.id,
      session.title,
      session.projectPath,
      session.filePath,
    ].some(value => value.toLowerCase().includes(normalized)),
  )
}

function normalizeSessionIndexItem(input: unknown): SessionIndexItem | null {
  if (!isRecord(input)) return null
  if (
    typeof input.id !== 'string' ||
    typeof input.projectPath !== 'string' ||
    typeof input.filePath !== 'string' ||
    typeof input.modifiedAt !== 'string' ||
    typeof input.messageCount !== 'number' ||
    typeof input.title !== 'string'
  ) {
    return null
  }
  return {
    id: input.id,
    projectPath: input.projectPath,
    filePath: input.filePath,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : null,
    modifiedAt: input.modifiedAt,
    modifiedAtMs:
      typeof input.modifiedAtMs === 'number'
        ? input.modifiedAtMs
        : new Date(input.modifiedAt).getTime(),
    messageCount: input.messageCount,
    title: input.title,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
