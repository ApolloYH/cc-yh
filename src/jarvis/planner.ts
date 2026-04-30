import { callConfiguredMainModel, parseJsonFromModelText } from '../services/model/mainModelClient.js'
import { logDiagnosticEvent } from '../utils/diagnosticLog.js'
import { enqueueJarvisTask, type JarvisQueueItem } from './queue.js'
import { buildJarvisManagerPrompt } from './taskEnvelope.js'
import type { JarvisModeConfig } from './types.js'
import type { JarvisLane } from './router.js'

export type JarvisPlanResult = {
  goal: string
  title: string
  steps: string[]
  items: JarvisQueueItem[]
  modelUsed: boolean
}

export async function submitJarvisGoal(params: {
  goal: string
  config: JarvisModeConfig
  priority?: number
  lane?: JarvisLane
  workdir?: string
  permissionMode?: JarvisModeConfig['riskMode']
}): Promise<JarvisPlanResult> {
  const startedAt = Date.now()
  const goal = params.goal.trim()
  if (!goal) throw new Error('goal is required')

  const titleResult = await titleWithMainModel(goal).catch(() => null)
  const title = titleResult?.title || goal.slice(0, 80)
  const lane = params.lane ?? 'read_only'
  const permissionMode = params.permissionMode ?? params.config.riskMode

  const provisional = await enqueueJarvisTask({
    title,
    goal,
    plan: [goal],
    lane,
    workdir: params.workdir,
    permissionMode,
    reportMuted: false,
    priority: Math.max(0, Math.min(100, params.priority ?? 70)),
    maxAttempts: 3,
    checkpoint: `Manager CLI task created for: ${goal}`,
    prompt: goal,
  })
  const prompt = buildJarvisManagerPrompt(provisional)
  const item = await import('./queue.js').then(mod =>
    mod.updateJarvisQueueItem(provisional.id, { prompt }),
  )

  const finalItem = item ?? provisional
  const result = {
    goal,
    title,
    steps: [goal],
    items: [finalItem],
    modelUsed: titleResult?.modelUsed === true,
  }
  logDiagnosticEvent({
    scope: 'jarvis.planner',
    event: 'submit_goal',
    ok: true,
    durationMs: Date.now() - startedAt,
    data: {
      goalHash: hashGoal(goal),
      title,
      queuedItems: 1,
      modelUsed: result.modelUsed,
      riskMode: permissionMode,
      lane,
      workdir: params.workdir ?? null,
      priority: params.priority,
    },
  })
  return result
}

async function titleWithMainModel(goal: string): Promise<{ title: string; modelUsed: boolean } | null> {
  const result = await callConfiguredMainModel({
    maxTokens: 300,
    timeoutMs: 12_000,
    systemPrompt: [
      'Name one Jarvis task. Return JSON only: {"title":"short title"}.',
      'Do not plan steps. Do not summarize into multiple tasks.',
      'Use the user language. Keep title under 32 Chinese characters or 80 ASCII chars.',
    ].join(' '),
    userPrompt: JSON.stringify({ goal }),
  })
  if (!result?.content.trim()) return null
  const parsed = parseJsonFromModelText(result.content)
  const title = typeof parsed?.title === 'string' && parsed.title.trim()
    ? parsed.title.trim()
    : ''
  return title ? { title, modelUsed: true } : null
}

function hashGoal(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = Math.imul(31, hash) + value.charCodeAt(i) | 0
  }
  return Math.abs(hash).toString(16)
}
