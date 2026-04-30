import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { callConfiguredMainModel } from '../services/model/mainModelClient.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import type {
  JarvisEventSeverity,
  JarvisInboxMessage,
  JarvisInboxRole,
  JarvisInboxSource,
} from './types.js'

const TRANSCRIPT_FILE = 'jarvis_transcript.jsonl'
const SUMMARY_FILE = 'jarvis_transcript_summary.md'
const MAX_CONTEXT_CHARS = 18_000
const MAX_SUMMARY_CHARS = 2_000
const COMPACT_AFTER_CHARS = 40_000
const KEEP_TAIL_ENTRIES = 80

export type JarvisTranscriptEntryType =
  | 'message'
  | 'system_event'
  | 'tool_event'
  | 'compaction'

export type JarvisTranscriptEntry = {
  id: string
  type: JarvisTranscriptEntryType
  role?: JarvisInboxRole
  source: JarvisInboxSource
  createdAt: string
  title?: string
  message: string
  taskId?: string
  severity?: JarvisEventSeverity
  metadata?: Record<string, unknown>
}

export function getJarvisTranscriptPath(): string {
  return path.join(getClaudeConfigHomeDir(), TRANSCRIPT_FILE)
}

export function getJarvisTranscriptSummaryPath(): string {
  return path.join(getClaudeConfigHomeDir(), SUMMARY_FILE)
}

export async function appendJarvisMessageToTranscript(
  message: JarvisInboxMessage,
): Promise<JarvisTranscriptEntry> {
  return appendJarvisTranscriptEntry({
    type: 'message',
    role: message.role,
    source: message.source,
    title: message.title,
    message: message.message,
    taskId: message.taskId,
    severity: message.severity,
    metadata: {
      ...message.metadata,
      inboxMessageId: message.id,
    },
  })
}

export async function appendJarvisTranscriptEntry(input: {
  type: JarvisTranscriptEntryType
  role?: JarvisInboxRole
  source?: JarvisInboxSource
  title?: string
  message: string
  taskId?: string
  severity?: JarvisEventSeverity
  metadata?: Record<string, unknown>
}): Promise<JarvisTranscriptEntry> {
  const entry: JarvisTranscriptEntry = {
    id: randomUUID(),
    type: input.type,
    role: input.role,
    source: input.source ?? 'system',
    createdAt: new Date().toISOString(),
    title: input.title,
    message: input.message,
    taskId: input.taskId,
    severity: input.severity,
    metadata: input.metadata,
  }
  await appendJsonl(getJarvisTranscriptPath(), entry)
  return entry
}

export async function readJarvisTranscriptEntries(limit = 300): Promise<JarvisTranscriptEntry[]> {
  const entries = await readJsonl(getJarvisTranscriptPath(), isJarvisTranscriptEntry)
  return entries
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)
}

export async function backupAndClearJarvisTranscript(): Promise<string> {
  const transcriptPath = getJarvisTranscriptPath()
  const summaryPath = getJarvisTranscriptSummaryPath()
  const backupDir = path.join(getClaudeConfigHomeDir(), 'backups', 'jarvis')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(backupDir, `jarvis_transcript.${stamp}.jsonl`)
  await fs.mkdir(backupDir, { recursive: true })
  try {
    await fs.copyFile(transcriptPath, backupPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await fs.writeFile(backupPath, '', 'utf-8')
  }
  await writeJsonl(transcriptPath, [])
  await fs.rm(summaryPath, { force: true })
  return backupPath
}

export async function buildJarvisTranscriptContext(options: {
  maxChars?: number
  tailLimit?: number
} = {}): Promise<{
  summary: string
  recent: string
  entryCount: number
}> {
  const maxChars = options.maxChars ?? MAX_CONTEXT_CHARS
  const tailLimit = options.tailLimit ?? 80
  await maybeCompactJarvisTranscript()

  const summary = await readSummary()
  const entries = (await readJarvisTranscriptEntries(tailLimit)).reverse()
  const visible = entries.filter(entry => entry.type === 'message' || entry.type === 'system_event')
  const rendered = visible
    .map(renderEntryForPrompt)
    .filter(Boolean)
    .join('\n\n')
  return {
    summary: compactForContext(summary, Math.min(MAX_SUMMARY_CHARS, Math.floor(maxChars / 3))),
    recent: compactForContext(rendered, maxChars),
    entryCount: visible.length,
  }
}

export async function maybeCompactJarvisTranscript(): Promise<void> {
  const entries = (await readJsonl(getJarvisTranscriptPath(), isJarvisTranscriptEntry))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  const visible = entries.filter(entry => entry.type === 'message' || entry.type === 'system_event')
  const totalChars = visible.reduce((sum, entry) => sum + entry.message.length + (entry.title?.length ?? 0), 0)
  if (totalChars < COMPACT_AFTER_CHARS || visible.length <= KEEP_TAIL_ENTRIES) return

  const oldEntries = visible.slice(0, Math.max(0, visible.length - KEEP_TAIL_ENTRIES))
  if (oldEntries.length === 0) return
  const previousSummary = await readSummary()
  const source = compactForContext(oldEntries.map(renderEntryForPrompt).join('\n\n'), 28_000)
  const generated = await callConfiguredMainModel({
    maxTokens: 900,
    timeoutMs: 30_000,
    systemPrompt: [
      'You compress a long Jarvis conversation transcript into durable conversational memory.',
      'Write Chinese unless user content is mostly another language.',
      'Keep user goals, decisions, unresolved tasks, reminders, preferences, and active context.',
      'Drop raw tool logs, repeated progress reports, and transient UI chatter.',
      'Return concise Markdown, under 1200 Chinese characters.',
    ].join(' '),
    userPrompt: JSON.stringify({
      previousSummary,
      transcriptSlice: source,
    }),
  }).catch(() => null)

  const summary = generated?.content.trim() || fallbackSummary(previousSummary, oldEntries)
  await writeSummary(summary)
  await appendJarvisTranscriptEntry({
    type: 'compaction',
    title: 'Jarvis 对话已压缩',
    message: summary,
    metadata: {
      compactedEntries: oldEntries.length,
      upTo: oldEntries.at(-1)?.createdAt,
    },
  })
}

async function readSummary(): Promise<string> {
  try {
    return stripBom(await fs.readFile(getJarvisTranscriptSummaryPath(), 'utf-8')).trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

async function writeSummary(summary: string): Promise<void> {
  const filePath = getJarvisTranscriptSummaryPath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, summary.trim() + '\n', 'utf-8')
}

function renderEntryForPrompt(entry: JarvisTranscriptEntry): string {
  const actor = entry.role
    ? entry.role === 'user'
      ? `用户(${entry.source})`
      : entry.role === 'jarvis'
        ? 'Jarvis'
        : '系统'
    : entry.type === 'tool_event'
      ? '工具事件'
      : '系统事件'
  const title = entry.title ? ` ${entry.title}` : ''
  const task = entry.taskId ? ` task=${entry.taskId}` : ''
  return `[${entry.createdAt}] ${actor}${title}${task}\n${entry.message}`
}

function fallbackSummary(previousSummary: string, entries: JarvisTranscriptEntry[]): string {
  const tail = entries
    .slice(-20)
    .map(entry => `- ${entry.title || entry.message.slice(0, 80)}`)
    .join('\n')
  return compactForContext([previousSummary, tail].filter(Boolean).join('\n'), MAX_SUMMARY_CHARS)
}

function compactForContext(text: string, maxChars: number): string {
  const normalized = text.replace(/\n{3,}/g, '\n\n').trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 20)).trim()}\n...已截断`
}

async function appendJsonl<T>(filePath: string, item: T): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.appendFile(filePath, `${JSON.stringify(item)}\n`, 'utf-8')
}

async function readJsonl<T>(filePath: string, guard: (value: unknown) => value is T): Promise<T[]> {
  try {
    const raw = stripBom(await fs.readFile(filePath, 'utf-8'))
    return raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line) as unknown
        } catch {
          return null
        }
      })
      .filter(guard)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function writeJsonl<T>(filePath: string, items: T[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(
    filePath,
    items.map(item => JSON.stringify(item)).join('\n') + (items.length ? '\n' : ''),
    'utf-8',
  )
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function isJarvisTranscriptEntry(value: unknown): value is JarvisTranscriptEntry {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as JarvisTranscriptEntry).id === 'string' &&
      isTranscriptEntryType((value as JarvisTranscriptEntry).type) &&
      typeof (value as JarvisTranscriptEntry).createdAt === 'string' &&
      typeof (value as JarvisTranscriptEntry).message === 'string',
  )
}

function isTranscriptEntryType(value: unknown): value is JarvisTranscriptEntryType {
  return value === 'message' || value === 'system_event' || value === 'tool_event' || value === 'compaction'
}
