import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { existsSync } from 'node:fs'
import { getClaudeConfigHomeDir, isEnvTruthy } from './envUtils.js'

export type DiagnosticSeverity = 'debug' | 'info' | 'warn' | 'error'

export type DiagnosticEvent = {
  scope: string
  event: string
  severity?: DiagnosticSeverity
  ok?: boolean
  durationMs?: number
  data?: Record<string, unknown>
}

const REDACTED = '[redacted]'
const MAX_FIELD_LENGTH = 600
const MAX_DEPTH = 4

export function getLogRootPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.CLAUDE_YH_LOG_DIR?.trim()
  if (explicit) return path.resolve(explicit)

  const cwdLogDir = path.join(process.cwd(), 'logs')
  if (existsSync(path.join(process.cwd(), 'package.json'))) return cwdLogDir

  return path.join(getClaudeConfigHomeDir(), 'logs')
}

export function getDiagnosticLogPath(date = new Date(), channel = 'diagnostics'): string {
  const day = date.toISOString().slice(0, 10)
  const safeChannel = channel.replace(/[^a-zA-Z0-9._-]/g, '-')
  return path.join(getLogRootPath(), safeChannel, `${day}.jsonl`)
}

export function logDiagnosticEvent(event: DiagnosticEvent): void {
  if (process.env.CLAUDE_YH_DIAGNOSTICS === '0') return
  const payload = {
    timestamp: new Date().toISOString(),
    pid: process.pid,
    severity: event.severity ?? (event.ok === false ? 'warn' : 'info'),
    scope: event.scope,
    event: event.event,
    ...(typeof event.ok === 'boolean' ? { ok: event.ok } : {}),
    ...(typeof event.durationMs === 'number'
      ? { durationMs: Math.round(event.durationMs) }
      : {}),
    ...(event.data ? { data: sanitizeDiagnosticValue(event.data) } : {}),
  }
  const line = `${JSON.stringify(payload)}\n`
  const filePaths = [
    getDiagnosticLogPath(),
    ...getAdditionalDiagnosticLogPaths(event),
  ]
  void Promise.all(filePaths.map(async filePath => {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.appendFile(filePath, line, 'utf-8')
  }))
    .catch(() => {})
}

export function isVerboseDiagnosticsEnabled(): boolean {
  return isEnvTruthy(process.env.CLAUDE_YH_DIAGNOSTICS_VERBOSE)
}

function sanitizeDiagnosticValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[max-depth]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return truncate(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(item => sanitizeDiagnosticValue(item, depth + 1))
  }
  if (typeof value !== 'object') return String(value)

  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isSensitiveDiagnosticKey(key)
      ? REDACTED
      : sanitizeDiagnosticValue(item, depth + 1)
  }
  return output
}

function isSensitiveDiagnosticKey(key: string): boolean {
  if (/^(commandHash|commandLength|commandPath|contentLength|promptHash)$/i.test(key)) {
    return false
  }
  return /token|secret|password|api.?key|authorization|cookie|credential|content|prompt|command/i.test(key)
}

function getAdditionalDiagnosticLogPaths(event: DiagnosticEvent): string[] {
  if (isRustRuntimeScope(event.scope)) {
    return [getDiagnosticLogPath(new Date(), 'rust-runtime')]
  }
  return []
}

function isRustRuntimeScope(scope: string): boolean {
  return scope === 'jarvis.queue' || scope.startsWith('runtime.')
}

function truncate(value: string): string {
  return value.length <= MAX_FIELD_LENGTH
    ? value
    : `${value.slice(0, MAX_FIELD_LENGTH)}...`
}
