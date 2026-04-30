import { logForDebugging } from '../utils/debug.js'
import { logDiagnosticEvent } from '../utils/diagnosticLog.js'
import { autoDistillSkillFromMemoryCandidate } from '../skills/autoDistill.js'
import {
  applyMemoryV2DistillCandidate,
  generateMemoryV2DistillCandidates,
  getMemoryV2Status,
  summarizeMemoryV2Sessions,
} from './store.js'

type MemoryV2AutomationResult = {
  summaries: number
  candidates: number
  applied: number
  skills: number
  summaryTitles?: string[]
  candidateTitles?: string[]
  appliedTitles?: string[]
  skipped?: string
}

let inProgress: Promise<MemoryV2AutomationResult> | null = null
let inProgressKey: string | null = null
let scheduledTimer: ReturnType<typeof setTimeout> | null = null
let hasScheduledRun = false
let scheduledReason = 'idle'
let scheduledStartedAt = 0

export function hasPendingMemoryV2Automation(): boolean {
  return Boolean(hasScheduledRun || inProgress)
}

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
  sessionId?: string,
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
    data: { reason, timeoutMs, sessionId },
  })
  const run = sessionId
    ? runMemoryV2Automation({ sessionId })
    : runMemoryV2Automation()
  return Promise.race([
    run,
    new Promise<null>(resolve => setTimeout(resolve, timeoutMs).unref()),
  ])
}

export async function runMemoryV2Automation(
  options: number | { limit?: number; sessionId?: string } = 12,
): Promise<MemoryV2AutomationResult> {
  const normalized = typeof options === 'number' ? { limit: options } : options
  const limit = normalized.limit ?? 12
  const key = normalized.sessionId ? `session:${normalized.sessionId}` : `global:${limit}`
  while (inProgress) {
    if (inProgressKey === key) return inProgress
    await inProgress.catch(() => undefined)
  }

  inProgressKey = key
  inProgress = runMemoryV2AutomationOnce(limit, normalized.sessionId).finally(() => {
    inProgress = null
    inProgressKey = null
  })
  return inProgress
}

async function runMemoryV2AutomationOnce(
  limit: number,
  sessionId?: string,
): Promise<MemoryV2AutomationResult> {
  const startedAt = Date.now()
  try {
    const summaries = await summarizeMemoryV2Sessions({ limit, sessionId })
    await getMemoryV2Status()
    const candidates = await generateMemoryV2DistillCandidates(limit, summaries)
    let applied = 0
    let skills = 0
    const appliedTitles: string[] = []
    for (const candidate of candidates) {
      await applyMemoryV2DistillCandidate(candidate)
      applied += 1
      appliedTitles.push(candidate.title)
      const skill = await autoDistillSkillFromMemoryCandidate(candidate)
      if (skill) skills += 1
    }
    await getMemoryV2Status()
    const result = {
      summaries: summaries.length,
      candidates: candidates.length,
      applied,
      skills,
      summaryTitles: summaries.map(entry => entry.title).slice(0, 12),
      candidateTitles: candidates.map(candidate => candidate.title).slice(0, 12),
      appliedTitles: appliedTitles.slice(0, 12),
      skipped: summaries.length === 0 && candidates.length === 0
        ? 'No changed sessions or new memory candidates.'
        : undefined,
    }
    logForDebugging(
      `[memory-l1-l4] automation completed summaries=${result.summaries} candidates=${result.candidates} applied=${result.applied} skills=${result.skills}`,
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
      candidates: 0,
      applied: 0,
      skills: 0,
    }
  }
}
