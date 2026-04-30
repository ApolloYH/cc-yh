import { createHash } from 'node:crypto'
import { logDiagnosticEvent } from '../utils/diagnosticLog.js'
import { RustSidecarClient } from './rustSidecarClient.js'
import {
  getRustSidecarLaunchConfig,
  type RustSidecarMethod,
} from './rustSidecarProtocol.js'

export type RustSidecarAttempt =
  {
    ok: boolean
    result?: unknown
    reason: string
    sidecarAvailable: boolean
  }

export async function tryRustSidecarRequest(
  method: RustSidecarMethod,
  params: unknown,
  options: {
    component: string
    timeoutMs?: number
    logSuccess?: boolean
  },
): Promise<RustSidecarAttempt> {
  const startedAt = Date.now()
  const launch = getRustSidecarLaunchConfig()
  if (!launch) {
    logDiagnosticEvent({
      scope: 'runtime.sidecar',
      event: 'unavailable',
      ok: false,
      severity: 'debug',
      durationMs: Date.now() - startedAt,
      data: {
        component: options.component,
        method,
      },
    })
    return {
      ok: false,
      reason: 'rust sidecar unavailable',
      sidecarAvailable: false,
    }
  }

  const client = new RustSidecarClient({
    command: launch.command,
    args: launch.args,
    timeoutMs: options.timeoutMs ?? 10_000,
  })
  try {
    const result = await client.request(method, params, options.timeoutMs ?? 10_000)
    logDiagnosticEvent({
      scope: 'runtime.sidecar',
      event: 'request',
      ok: true,
      severity: options.logSuccess === true ? 'info' : 'debug',
      durationMs: Date.now() - startedAt,
      data: {
        component: options.component,
        method,
        sidecarAvailable: true,
        commandPath: launch.command,
        result: summarizeSidecarResult(result),
        params: summarizeSidecarParams(params),
      },
    })
    return {
      ok: true,
      result,
      reason: 'ok',
      sidecarAvailable: true,
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logDiagnosticEvent({
      scope: 'runtime.sidecar',
      event: 'request',
      ok: false,
      severity: 'warn',
      durationMs: Date.now() - startedAt,
      data: {
        component: options.component,
        method,
        reason,
        code: error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code)
          : undefined,
        sidecarAvailable: true,
        commandPath: launch.command,
        params: summarizeSidecarParams(params),
      },
    })
    return {
      ok: false,
      reason,
      sidecarAvailable: true,
    }
  } finally {
    client.close()
  }
}

function summarizeSidecarParams(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { type: typeof value }
  }
  const record = value as Record<string, unknown>
  const command = typeof record.command === 'string' ? record.command : undefined
  const content = typeof record.content === 'string' ? record.content : undefined
  const prompt = typeof record.prompt === 'string' ? record.prompt : undefined
  return {
    cwd: stringOrUndefined(record.cwd),
    root: stringOrUndefined(record.root),
    path: stringOrUndefined(record.path),
    queuePath: stringOrUndefined(record.queuePath),
    shell: stringOrUndefined(record.shell),
    pattern: stringOrUndefined(record.pattern),
    limit: typeof record.limit === 'number' ? record.limit : undefined,
    commandHash: command ? shortHash(command) : undefined,
    commandLength: command?.length,
    contentLength: content?.length,
    promptHash: prompt ? shortHash(prompt) : undefined,
    keys: Object.keys(record).slice(0, 20),
  }
}

function summarizeSidecarResult(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { type: typeof value }
  }
  const record = value as Record<string, unknown>
  return {
    source: stringOrUndefined(record.source),
    total: typeof record.total === 'number' ? record.total : undefined,
    files: Array.isArray(record.files) ? record.files.length : undefined,
    matches: Array.isArray(record.matches) ? record.matches.length : undefined,
    sessions: Array.isArray(record.sessions) ? record.sessions.length : undefined,
    risk: stringOrUndefined(record.risk),
    action: stringOrUndefined(record.action),
    bytes: typeof record.bytes === 'number' ? record.bytes : undefined,
    truncated: typeof record.truncated === 'boolean' ? record.truncated : undefined,
    keys: Object.keys(record).slice(0, 20),
  }
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}
