import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  flushScheduledMemoryV2Automation,
  hasPendingMemoryV2Automation,
  runMemoryV2Automation,
} from './automation.js'
import { logDiagnosticEvent } from '../utils/diagnosticLog.js'
import { getSessionIndex } from '../runtime/sessionIndexService.js'
import { getMemoryV2Paths } from './store.js'

type FinalizeSessionMemoryInput = {
  sessionId?: string
  reason: string
  timeoutMs?: number
}

const inFlight = new Map<string, Promise<void>>()

export async function finalizeSessionMemory(
  input: FinalizeSessionMemoryInput,
): Promise<void> {
  const sessionId = input.sessionId || 'unknown'
  if (!isFinalizableSessionId(sessionId)) return
  const key = sessionId
  const existing = inFlight.get(key)
  if (existing) return existing

  const work = finalizeSessionMemoryOnce(input).finally(() => {
    inFlight.delete(key)
  })
  inFlight.set(key, work)
  return work
}

async function finalizeSessionMemoryOnce(
  input: FinalizeSessionMemoryInput,
): Promise<void> {
  const startedAt = Date.now()
  const sessionId = input.sessionId || 'unknown'
  const timeoutMs = input.timeoutMs ?? 60_000
  const sessionMeta = await resolveSessionMeta(sessionId)
  if (
    !hasPendingMemoryV2Automation() &&
    await hasFreshSessionSummary(sessionId, sessionMeta)
  ) {
    return
  }

  logDiagnosticEvent({
    scope: 'memoryV2.session',
    event: 'finalize_started',
    ok: true,
    data: { sessionId, ...sessionMeta, reason: input.reason, timeoutMs },
  })

  try {
    const flushed = await flushScheduledMemoryV2Automation(timeoutMs, sessionId)
    const result = flushed ?? await withTimeout(
      runMemoryV2Automation({ sessionId }),
      timeoutMs,
    )
    logDiagnosticEvent({
      scope: 'memoryV2.session',
      event: 'finalize_completed',
      ok: true,
      durationMs: Date.now() - startedAt,
      data: { sessionId, ...sessionMeta, reason: input.reason, result },
    })
  } catch (error) {
    logDiagnosticEvent({
      scope: 'memoryV2.session',
      event: 'finalize_failed',
      ok: false,
      severity: 'error',
      durationMs: Date.now() - startedAt,
      data: {
        sessionId,
        ...sessionMeta,
        reason: input.reason,
        error: error instanceof Error ? error.message : String(error),
      },
    })
    throw error
  }
}

function isFinalizableSessionId(sessionId: string): boolean {
  return Boolean(sessionId && sessionId !== 'unknown' && !sessionId.startsWith('__'))
}

async function resolveSessionMeta(sessionId: string): Promise<Record<string, unknown>> {
  if (!sessionId || sessionId === 'unknown' || sessionId.startsWith('__')) {
    return {}
  }
  try {
    const index = await getSessionIndex({ limit: 500 })
    const session = index.sessions.find(item => item.id === sessionId)
    if (!session) return {}
    return {
      sessionTitle: session.title,
      projectPath: session.projectPath,
      messageCount: session.messageCount,
      modifiedAt: session.modifiedAt,
      modifiedAtMs: session.modifiedAtMs,
    }
  } catch {
    return {}
  }
}

async function hasFreshSessionSummary(
  sessionId: string,
  sessionMeta: Record<string, unknown>,
): Promise<boolean> {
  const modifiedAtMs = typeof sessionMeta.modifiedAtMs === 'number'
    ? sessionMeta.modifiedAtMs
    : Date.parse(String(sessionMeta.modifiedAt ?? ''))
  if (!Number.isFinite(modifiedAtMs)) return false
  const summaryPath = path.join(getMemoryV2Paths().summariesDir, `session-${sessionId}.md`)
  const summary = await fs.stat(summaryPath).catch(() => null)
  return Boolean(summary && summary.mtimeMs >= modifiedAtMs)
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>(resolve => setTimeout(resolve, timeoutMs).unref()),
  ])
}
