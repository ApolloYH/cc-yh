import { logForDebugging } from '../utils/debug.js'
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
    return result
  } catch (error) {
    logForDebugging(`[memory-l1-l4] automation error: ${error}`)
    return {
      summaries: 0,
      stale: 0,
      candidates: 0,
      applied: 0,
      skills: 0,
    }
  }
}
