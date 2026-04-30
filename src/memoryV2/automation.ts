import { logForDebugging } from '../utils/debug.js'
import { logDiagnosticEvent } from '../utils/diagnosticLog.js'
import { autoDistillSkillFromMemoryCandidate } from '../skills/autoDistill.js'
import {
  applyMemoryV2DistillCandidate,
  detectMemoryV2Stale,
  generateMemoryV2DistillCandidates,
  getMemoryV2Status,
  summarizeMemoryV2Sessions,
} from './store.js'

type MemoryV2AutomationResult = {
  summaries: number
  stale: number
  candidates: number
  applied: number
  skills: number
}

let inProgress: Promise<MemoryV2AutomationResult> | null = null
let scheduledTimer: ReturnType<typeof setTimeout> | null = null
let hasScheduledRun = false
let scheduledReason = 'idle'
let scheduledStartedAt = 0

function getMemoryAutomationIdleDelayMs(): number {
  const raw = Number(
    process.env.CLAUDE_YH_MEMORY_V2_IDLE_MS ??
      process.env.CLAUDE_YH_MEMORY_IDLE_MS,
  )
  if (Number.isFinite(raw) && raw > 0) return Math.max(1_000, Math.round(raw))
  return 15 * 60 * 1_000
}

function getMemoryAutomationMaxDelayMs(): number {
  const raw = Number(
    process.env.CLAUDE_YH_MEMORY_V2_MAX_MS ??
      process.env.CLAUDE_YH_MEMORY_CHECKPOINT_MS,
  )
  if (Number.isFinite(raw) && raw > 0) return Math.max(1_000, Math.round(raw))
  return 30 * 60 * 1_000
}

export function scheduleMemoryV2Automation(
  reason = 'turn-end',
  delayMs?: number,
): void {
  if (process.env.CLAUDE_YH_DISABLE_MEMORY_IDLE_AUTOMATION === '1') return
  scheduledReason = reason
  hasScheduledRun = true
  if (!scheduledStartedAt) scheduledStartedAt = Date.now()
  if (scheduledTimer) clearTimeout(scheduledTimer)
  const idleDelayMs = delayMs ?? getMemoryAutomationIdleDelayMs()
  const maxDelayMs = getMemoryAutomationMaxDelayMs()
  const elapsedMs = Date.now() - scheduledStartedAt
  const nextDelayMs = Math.max(1_000, Math.min(idleDelayMs, maxDelayMs - elapsedMs))
  scheduledTimer = setTimeout(() => {
    scheduledTimer = null
    hasScheduledRun = false
    scheduledStartedAt = 0
    void runMemoryV2Automation().catch(() => {})
  }, nextDelayMs)
  scheduledTimer.unref?.()
  logDiagnosticEvent({
    scope: 'memoryV2.automation',
    event: 'scheduled',
    ok: true,
    data: {
      reason,
      delayMs: nextDelayMs,
      idleDelayMs,
      maxDelayMs,
    },
  })
}

export async function flushScheduledMemoryV2Automation(
  timeoutMs = 60_000,
): Promise<MemoryV2AutomationResult | null> {
  if (scheduledTimer) {
    clearTimeout(scheduledTimer)
    scheduledTimer = null
  }
  if (!hasScheduledRun && !inProgress) return null
  const reason = scheduledReason
  hasScheduledRun = false
  scheduledStartedAt = 0
  logDiagnosticEvent({
    scope: 'memoryV2.automation',
    event: 'flush_scheduled',
    ok: true,
    data: { reason, timeoutMs },
  })
  const run = runMemoryV2Automation()
  return Promise.race([
    run,
    new Promise<null>(resolve => setTimeout(resolve, timeoutMs).unref()),
  ])
}

export async function runMemoryV2Automation(
  limit = 12,
): Promise<MemoryV2AutomationResult> {
  if (inProgress) return inProgress

  inProgress = runMemoryV2AutomationOnce(limit).finally(() => {
    inProgress = null
  })
  return inProgress
}

async function runMemoryV2AutomationOnce(
  limit: number,
): Promise<MemoryV2AutomationResult> {
  const startedAt = Date.now()
  try {
    const summaries = await summarizeMemoryV2Sessions(limit)
    await getMemoryV2Status()
    const stale = await detectMemoryV2Stale()
    const candidates = await generateMemoryV2DistillCandidates(limit)
    let applied = 0
    let skills = 0
    for (const candidate of candidates) {
      await applyMemoryV2DistillCandidate(candidate)
      applied += 1
      const skill = await autoDistillSkillFromMemoryCandidate(candidate)
      if (skill) skills += 1
    }
    await getMemoryV2Status()
    const result = {
      summaries: summaries.length,
      stale: stale.length,
      candidates: candidates.length,
      applied,
      skills,
    }
    logForDebugging(
      `[memory-l1-l4] automation completed summaries=${result.summaries} stale=${result.stale} candidates=${result.candidates} applied=${result.applied} skills=${result.skills}`,
    )
    logDiagnosticEvent({
      scope: 'memoryV2.automation',
      event: 'completed',
      ok: true,
      durationMs: Date.now() - startedAt,
      data: result,
    })
    return result
  } catch (error) {
    logForDebugging(`[memory-l1-l4] automation error: ${error}`)
    logDiagnosticEvent({
      scope: 'memoryV2.automation',
      event: 'failed',
      ok: false,
      severity: 'error',
      durationMs: Date.now() - startedAt,
      data: {
        error: error instanceof Error ? error.message : String(error),
      },
    })
    return {
      summaries: 0,
      stale: 0,
      candidates: 0,
      applied: 0,
      skills: 0,
    }
  }
}
