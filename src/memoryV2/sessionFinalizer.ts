import { flushScheduledMemoryV2Automation, runMemoryV2Automation } from './automation.js'
import { logDiagnosticEvent } from '../utils/diagnosticLog.js'

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
  const key = `${sessionId}:${input.reason}`
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
  logDiagnosticEvent({
    scope: 'memoryV2.session',
    event: 'finalize_started',
    ok: true,
    data: { sessionId, reason: input.reason, timeoutMs },
  })

  try {
    const flushed = await flushScheduledMemoryV2Automation(timeoutMs)
    const result = flushed ?? await withTimeout(
      runMemoryV2Automation(),
      timeoutMs,
    )
    logDiagnosticEvent({
      scope: 'memoryV2.session',
      event: 'finalize_completed',
      ok: true,
      durationMs: Date.now() - startedAt,
      data: { sessionId, reason: input.reason, result },
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
        reason: input.reason,
        error: error instanceof Error ? error.message : String(error),
      },
    })
    throw error
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>(resolve => setTimeout(resolve, timeoutMs).unref()),
  ])
}
