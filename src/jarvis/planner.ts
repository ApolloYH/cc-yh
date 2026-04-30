import {
  callConfiguredMainModel,
  parseJsonFromModelText,
} from '../services/model/mainModelClient.js'
import { logDiagnosticEvent } from '../utils/diagnosticLog.js'
import { enqueueJarvisTask, type JarvisQueueItem } from './queue.js'
import type { JarvisModeConfig } from './types.js'

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
}): Promise<JarvisPlanResult> {
  const startedAt = Date.now()
  const goal = params.goal.trim()
  if (!goal) throw new Error('goal is required')
  const planned = await planWithMainModel(goal, params.config).catch(() => null)
  const title = planned?.title || goal.slice(0, 80)
  const steps = planned?.steps?.length
    ? planned.steps.slice(0, 8)
    : [goal]
  const boundarySummary = summarizeBoundaries(params.config)

  const items: JarvisQueueItem[] = []
  for (const [index, step] of steps.entries()) {
    const prompt = buildStepPrompt({
      goal,
      title,
      step,
      stepNumber: index + 1,
      totalSteps: steps.length,
      config: params.config,
      boundarySummary,
    })
    items.push(await enqueueJarvisTask({
      title: steps.length === 1 ? title : `${title} / ${index + 1}`,
      goal,
      plan: steps,
      boundarySummary,
      prompt,
      priority: Math.max(0, Math.min(100, (params.priority ?? 70) - index)),
      maxAttempts: 3,
      checkpoint: `Planned by Jarvis. Step ${index + 1}/${steps.length}: ${step}`,
    }))
  }

  const result = {
    goal,
    title,
    steps,
    items,
    modelUsed: planned?.modelUsed === true,
  }
  logDiagnosticEvent({
    scope: 'jarvis.planner',
    event: 'submit_goal',
    ok: true,
    durationMs: Date.now() - startedAt,
    data: {
      goalHash: hashGoal(goal),
      title,
      steps: steps.length,
      queuedItems: items.length,
      modelUsed: result.modelUsed,
      riskMode: params.config.riskMode,
      priority: params.priority,
    },
  })
  return result
}

async function planWithMainModel(
  goal: string,
  config: JarvisModeConfig,
): Promise<{ title: string; steps: string[]; modelUsed: boolean } | null> {
  const result = await callConfiguredMainModel({
    maxTokens: 1000,
    systemPrompt: [
      'You are the Jarvis background planner for claude-yh.',
      'Turn a user goal into a short executable background plan.',
      'Return JSON only: {"title":"...","steps":["..."]}.',
      'Steps must be safe, checkpointable, and respect the provided boundaries.',
      'Do not plan payment, captcha bypass, credential extraction, or irreversible external sending.',
    ].join(' '),
    userPrompt: JSON.stringify({
      goal,
      mode: config.riskMode,
      boundaries: config.boundaries,
    }),
  })
  if (!result) return null
  const parsed = parseJsonFromModelText(result.content)
  const title = typeof parsed?.title === 'string' && parsed.title.trim()
    ? parsed.title.trim()
    : goal.slice(0, 80)
  const steps = Array.isArray(parsed?.steps)
    ? parsed.steps.filter((step): step is string => typeof step === 'string' && step.trim().length > 0)
    : []
  return steps.length > 0
    ? { title, steps, modelUsed: true }
    : null
}

function buildStepPrompt(input: {
  goal: string
  title: string
  step: string
  stepNumber: number
  totalSteps: number
  config: JarvisModeConfig
  boundarySummary: string
}): string {
  return [
    `Jarvis background goal: ${input.goal}`,
    `Plan title: ${input.title}`,
    `Current step: ${input.stepNumber}/${input.totalSteps} - ${input.step}`,
    '',
    'Run this as a background Jarvis task. Make progress independently, write a checkpoint, and stop when a boundary requires user approval.',
    input.boundarySummary,
    '',
    `Risk mode: ${input.config.riskMode}`,
    `Budget: ${input.config.boundaries.budgetMinutes} minutes, max ${input.config.boundaries.maxToolCalls} tool calls.`,
  ].join('\n')
}

function summarizeBoundaries(config: JarvisModeConfig): string {
  const boundaries = config.boundaries
  return [
    'Jarvis boundaries:',
    `- Allowed workdirs: ${boundaries.allowedWorkdirs.join(', ') || 'current configured workspace only'}`,
    `- Allowed domains: ${boundaries.allowedDomains.join(', ') || 'none'}`,
    `- Blocked actions: ${boundaries.blockedActions.join(', ') || 'none'}`,
    `- Pause on secrets: ${boundaries.pauseOnSecrets ? 'yes' : 'no'}`,
    `- Pause on login: ${boundaries.pauseOnLogin ? 'yes' : 'no'}`,
    `- Pause on payment: ${boundaries.pauseOnPayment ? 'yes' : 'no'}`,
    `- Pause on external send: ${boundaries.pauseOnExternalSend ? 'yes' : 'no'}`,
  ].join('\n')
}

function hashGoal(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = Math.imul(31, hash) + value.charCodeAt(i) | 0
  }
  return Math.abs(hash).toString(16)
}
