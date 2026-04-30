import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import type {
  JarvisEvent,
  JarvisEventSeverity,
  JarvisEventType,
  JarvisModeConfig,
  JarvisNotificationChannel,
  JarvisRiskMode,
  JarvisSourceKey,
} from './types.js'

export type JarvisConfigPatch = Partial<Omit<JarvisModeConfig, 'sources'>> & {
  sources?: Partial<Record<JarvisSourceKey, boolean>>
}

const SETTINGS_FILE = 'settings.json'
const EVENTS_FILE = 'jarvis_events.jsonl'
const SETTINGS_KEY = 'jarvisMode'
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000
const MIN_INTERVAL_MS = 60 * 1000
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000
const MAX_EVENTS = 200

export const DEFAULT_JARVIS_CONFIG: JarvisModeConfig = {
  enabled: false,
  intervalMs: DEFAULT_INTERVAL_MS,
  riskMode: 'observe',
  sources: {
    scheduledTasks: true,
    sessions: true,
    git: false,
  },
  notificationChannels: ['desktop'],
  maxEventsPerHour: 12,
  requireApprovalForExternalActions: true,
}

export function getJarvisSettingsPath(): string {
  return path.join(getClaudeConfigHomeDir(), SETTINGS_FILE)
}

export function getJarvisEventsPath(): string {
  return path.join(getClaudeConfigHomeDir(), EVENTS_FILE)
}

export function normalizeJarvisConfig(input: unknown): JarvisModeConfig {
  const raw = isRecord(input) ? input : {}
  const sources = isRecord(raw.sources) ? raw.sources : {}
  const notificationChannels = Array.isArray(raw.notificationChannels)
    ? raw.notificationChannels.filter(isNotificationChannel)
    : DEFAULT_JARVIS_CONFIG.notificationChannels

  return {
    enabled:
      typeof raw.enabled === 'boolean'
        ? raw.enabled
        : DEFAULT_JARVIS_CONFIG.enabled,
    intervalMs: clampInterval(raw.intervalMs),
    riskMode: isRiskMode(raw.riskMode)
      ? raw.riskMode
      : DEFAULT_JARVIS_CONFIG.riskMode,
    sources: {
      scheduledTasks: readSourceFlag(sources, 'scheduledTasks'),
      sessions: readSourceFlag(sources, 'sessions'),
      git: readSourceFlag(sources, 'git'),
    },
    notificationChannels:
      notificationChannels.length > 0
        ? notificationChannels
        : DEFAULT_JARVIS_CONFIG.notificationChannels,
    maxEventsPerHour: clampNumber(raw.maxEventsPerHour, 1, 120, 12),
    requireApprovalForExternalActions:
      typeof raw.requireApprovalForExternalActions === 'boolean'
        ? raw.requireApprovalForExternalActions
        : DEFAULT_JARVIS_CONFIG.requireApprovalForExternalActions,
  }
}

export async function readJarvisConfig(): Promise<JarvisModeConfig> {
  const settings = await readSettings()
  return normalizeJarvisConfig(settings[SETTINGS_KEY])
}

export async function writeJarvisConfig(
  config: JarvisModeConfig,
): Promise<JarvisModeConfig> {
  const settings = await readSettings()
  const normalized = normalizeJarvisConfig(config)
  await writeSettings({ ...settings, [SETTINGS_KEY]: normalized })
  return normalized
}

export async function updateJarvisConfig(
  patch: JarvisConfigPatch,
): Promise<JarvisModeConfig> {
  const current = await readJarvisConfig()
  const merged = normalizeJarvisConfig({
    ...current,
    ...patch,
    sources: patch.sources
      ? { ...current.sources, ...patch.sources }
      : current.sources,
    notificationChannels:
      patch.notificationChannels ?? current.notificationChannels,
  })
  return writeJarvisConfig(merged)
}

export async function appendJarvisEvent(input: {
  type: JarvisEventType
  severity?: JarvisEventSeverity
  title: string
  message: string
}): Promise<JarvisEvent> {
  const event: JarvisEvent = {
    id: randomUUID(),
    type: input.type,
    severity: input.severity ?? 'info',
    createdAt: new Date().toISOString(),
    title: input.title,
    message: input.message,
  }
  const events = await readJarvisEvents(MAX_EVENTS - 1)
  await writeEvents([...events.reverse(), event])
  return event
}

export async function readJarvisEvents(limit = 50): Promise<JarvisEvent[]> {
  const eventsPath = getJarvisEventsPath()
  try {
    const raw = await fs.readFile(eventsPath, 'utf-8')
    const events = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseEventLine)
      .filter((event): event is JarvisEvent => event !== null)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
    return events.slice(0, limit)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function readSettings(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(getJarvisSettingsPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

async function writeSettings(settings: Record<string, unknown>): Promise<void> {
  const filePath = getJarvisSettingsPath()
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const tmpFile = `${filePath}.tmp.${process.pid}.${Date.now()}`
  try {
    await fs.writeFile(tmpFile, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
    await fs.rename(tmpFile, filePath)
  } catch (error) {
    await fs.unlink(tmpFile).catch(() => {})
    throw error
  }
}

async function writeEvents(events: JarvisEvent[]): Promise<void> {
  const filePath = getJarvisEventsPath()
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const trimmed = events
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
    .slice(-MAX_EVENTS)
  const contents = trimmed.map((event) => JSON.stringify(event)).join('\n')
  await fs.writeFile(filePath, contents ? `${contents}\n` : '', 'utf-8')
}

function parseEventLine(line: string): JarvisEvent | null {
  try {
    const parsed = JSON.parse(line)
    if (!isRecord(parsed)) return null
    if (
      typeof parsed.id !== 'string' ||
      !isEventType(parsed.type) ||
      !isSeverity(parsed.severity) ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.title !== 'string' ||
      typeof parsed.message !== 'string'
    ) {
      return null
    }
    return parsed as JarvisEvent
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readSourceFlag(
  sources: Record<string, unknown>,
  key: JarvisSourceKey,
): boolean {
  return typeof sources[key] === 'boolean'
    ? sources[key]
    : DEFAULT_JARVIS_CONFIG.sources[key]
}

function clampInterval(value: unknown): number {
  return clampNumber(value, MIN_INTERVAL_MS, MAX_INTERVAL_MS, DEFAULT_INTERVAL_MS)
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function isRiskMode(value: unknown): value is JarvisRiskMode {
  return value === 'observe' || value === 'assisted'
}

function isNotificationChannel(
  value: unknown,
): value is JarvisNotificationChannel {
  return (
    value === 'desktop' ||
    value === 'telegram' ||
    value === 'feishu' ||
    value === 'dingtalk' ||
    value === 'wecom'
  )
}

function isEventType(value: unknown): value is JarvisEventType {
  return (
    value === 'heartbeat' ||
    value === 'checkpoint' ||
    value === 'config' ||
    value === 'paused' ||
    value === 'error'
  )
}

function isSeverity(value: unknown): value is JarvisEventSeverity {
  return value === 'info' || value === 'warn' || value === 'error'
}
