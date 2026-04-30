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
  const steps = normalizeJarvisPlanSteps(goal, planned?.steps)
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
      'Follow the same task breakdown standard as native Claude TodoWrite and TaskCreate.',
      'Split only when the goal requires 3 or more distinct executable steps/actions, is non-trivial and complex, or the user explicitly provides multiple tasks.',
      'Do not split when there is only a single straightforward task, the task is trivial, it can be completed in fewer than 3 simple steps, or it is purely conversational or informational.',
      'For simple conversational, status, or one-shot goals, return exactly one step equal to the user goal.',
      'Never split a simple answer into rhetorical substeps such as style, abilities, role, summary, or final response.',
      'Prefer 1 step. Use 3-6 steps only for genuinely complex background work.',
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

export function normalizeJarvisPlanSteps(goal: string, plannedSteps: string[] | undefined): string[] {
  const cleaned = (plannedSteps ?? [])
    .map(step => step.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const deduped: string[] = []
  for (const step of cleaned) {
    if (deduped.some(existing => sameStep(existing, step))) continue
    deduped.push(step)
  }

  if (shouldKeepSingleStep(goal, deduped)) return [goal]

  return deduped.length > 0
    ? deduped.slice(0, 6)
    : [goal]
}

function shouldKeepSingleStep(goal: string, steps: string[]): boolean {
  const normalizedGoal = goal.replace(/\s+/g, ' ').trim()
  if (!normalizedGoal) return true
  if (steps.length < 3) return true

  const lower = normalizedGoal.toLowerCase()
  const simpleGoalPatterns = [
    '自我介绍',
    '介绍一下你自己',
    '介绍你自己',
    '你是谁',
    '你叫什么',
    '你的名字',
    '当前任务状态',
    '查询任务状态',
    '查看任务状态',
    '任务列表',
    'queue status',
    'status',
    'who are you',
    'introduce yourself',
  ]
  if (simpleGoalPatterns.some(pattern => lower.includes(pattern))) return true

  const isShort = normalizedGoal.length <= 40
  const hasComplexSignals = [
    '然后',
    '同时',
    '并且',
    '再',
    '持续',
    '监控',
    '修复',
    '实现',
    '整理',
    '测试',
    '部署',
    '对比',
    '分析',
    '计划',
    '长期',
    '24小时',
    '24 小时',
  ].some(signal => normalizedGoal.includes(signal))

  if (isShort && !hasComplexSignals) return true

  const allStepsAreTiny = steps.every(step => step.length <= 30)
  const looksLikeRhetoricalSplit = steps.every(step =>
    /介绍|说明|返回|总结|检查|查询|查看|列出|answer|respond|describe|summarize/i.test(step),
  )
  return isShort && allStepsAreTiny && looksLikeRhetoricalSplit
}

function sameStep(left: string, right: string): boolean {
  const normalize = (value: string) => value
    .toLowerCase()
    .replace(/[，。！？；：、,.!?;:\s]/g, '')
  return normalize(left) === normalize(right)
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
