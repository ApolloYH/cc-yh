import {
  callConfiguredMainModel,
  parseJsonFromModelText,
} from '../services/model/mainModelClient.js'
import type { JarvisModeConfig } from './types.js'

export type JarvisIntent =
  | 'control'
  | 'status'
  | 'chat'
  | 'supplement'
  | 'schedule'
  | 'new_task'
  | 'clarify'

export type JarvisLane =
  | 'none'
  | 'read_only'
  | 'write'
  | 'external'

export type JarvisControlAction =
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'delete'
  | 'kill'
  | 'mute_reports'
  | 'unmute_reports'
  | 'stop_all'

export type JarvisRouterDecision = {
  intent: JarvisIntent
  lane: JarvisLane
  targetTaskId?: string
  workdir?: string
  permissionMode: JarvisModeConfig['riskMode']
  confidence: number
  reason: string
  controlAction?: JarvisControlAction
  schedule?: JarvisScheduleSpec
}

export type JarvisScheduleSpec = {
  cron?: string
  fireAtIso?: string
  prompt?: string
  name?: string
  description?: string
  recurring?: boolean
  mode?: 'reminder' | 'task'
}

export async function routeJarvisInput(input: {
  message: string
  config: JarvisModeConfig
  activeTasks: Array<{
    id: string
    title?: string
    goal?: string
    status: string
    lane?: JarvisLane
    workdir?: string
  }>
}): Promise<JarvisRouterDecision> {
  const message = input.message.trim()
  if (!message) {
    return {
      intent: 'clarify',
      lane: 'none',
      permissionMode: input.config.riskMode,
      confidence: 1,
      reason: 'empty input',
    }
  }

  const modelDecision = await routeWithModel(input).catch(() => null)
  if (modelDecision) return modelDecision

  return {
    intent: 'clarify',
    lane: 'none',
    permissionMode: input.config.riskMode,
    confidence: 0.4,
    reason: 'Router model unavailable or returned invalid JSON; asking for clarification instead of guessing.',
  }
}

async function routeWithModel(input: {
  message: string
  config: JarvisModeConfig
  activeTasks: Array<{
    id: string
    title?: string
    goal?: string
    status: string
    lane?: JarvisLane
    workdir?: string
  }>
}): Promise<JarvisRouterDecision | null> {
  const result = await callConfiguredMainModel({
    maxTokens: 800,
    timeoutMs: 20_000,
      systemPrompt: [
      'You are Jarvis Router for claude-yh.',
      'Classify exactly one user message. Do not execute, plan, answer, inspect files, or break down the task.',
      'Return JSON only with this schema:',
      '{"intent":"control|status|chat|supplement|schedule|new_task|clarify","lane":"none|read_only|write|external","targetTaskId":"optional","workdir":"optional","permissionMode":"observe|assisted|autonomous|full_autonomous","confidence":0.0,"reason":"short reason","controlAction":"pause|resume|cancel|delete|kill|mute_reports|unmute_reports|stop_all|none","schedule":{"cron":"optional 5-field cron","fireAtIso":"optional ISO time","prompt":"prompt/message to run or send when fired","name":"short name","description":"optional","recurring":false,"mode":"reminder|task"}}.',
      'Router must not output steps, todos, plans, or task breakdown.',
      'control changes Jarvis runtime state: pause, resume, cancel, delete, kill, mute/unmute reports.',
      'If the user asks to stop/disable/hide/silence progress reports, intermediate updates, process updates, or only wants the final result for an active task, classify as control with controlAction="mute_reports". This is not supplement.',
      'If the user asks to resume progress reports or continue reporting intermediate updates, classify as control with controlAction="unmute_reports". This is not supplement.',
      'status is ONLY for Jarvis runtime/task state: queue, running Jarvis tasks, task errors, progress, logs, checkpoints, or whether Jarvis is idle. It is NOT for analyzing a codebase, project, directory, repository, website, document, file, or external system.',
      'chat is lightweight conversation that should be answered immediately without a Manager CLI. It must not require reading files, browsing, searching, running commands, inspecting a local path, or analyzing a project.',
      'supplement adds instructions to an existing active task; choose targetTaskId when clear.',
      'schedule creates a real global scheduled task/reminder visible in the desktop Scheduled Tasks page, such as "in 3 minutes remind me", "tomorrow run this", or "every day at 9". Use schedule instead of new_task for delayed or recurring execution. Use schedule.mode="reminder" when the user only wants Jarvis to notify/say/remind at that time; use "task" when a CLI task should execute at that time.',
      'new_task is a complete user goal that should create exactly one Jarvis task and one Manager CLI.',
      'Choose new_task/read_only when the user asks to analyze, inspect, research, summarize, explain, review, audit, compare, search, read, or understand a local path, project, repo, codebase, file, website, paper, or document without editing.',
      'Choose new_task/write when the user asks to implement, modify, fix, refactor, delete, generate files, change config, or run a workflow that may write state.',
      'Choose new_task/external when the user asks Jarvis to interact with websites, browser sessions, IM, email, payments, accounts, or other outside systems.',
      'clarify means the message is ambiguous or confidence is low.',
      'Hard invariant: chat/status/control/schedule MUST use lane="none" and MUST NOT include workdir. If lane is read_only/write/external or workdir is present, the intent is normally new_task or supplement, not status/chat.',
      'Lane rules: chat/status/control/schedule use none. read_only is research/search/analysis without edits. write modifies files/state. external contacts websites, IM, payments, sends messages, or depends on external side effects.',
      'Examples:',
      '"现在有什么任务" => {"intent":"status","lane":"none"}',
      '"当前队列状态" => {"intent":"status","lane":"none"}',
      '"C:\\Users\\me\\Desktop\\project 分析这个项目" => {"intent":"new_task","lane":"read_only","workdir":"C:\\Users\\me\\Desktop\\project"}',
      '"研究一下这个仓库怎么实现登录" => {"intent":"new_task","lane":"read_only"}',
      '"修复这个项目的登录 bug" => {"intent":"new_task","lane":"write"}',
      '"三分钟后提醒我喝水" => {"intent":"schedule","lane":"none","schedule":{"mode":"reminder"}}',
      '"不要报告过程了" => {"intent":"control","lane":"none","controlAction":"mute_reports"}',
      '"只要最后结果" => {"intent":"control","lane":"none","controlAction":"mute_reports"}',
      '"恢复进度汇报" => {"intent":"control","lane":"none","controlAction":"unmute_reports"}',
      'If unsure whether the user is supplementing an active task or creating a new task, choose clarify.',
    ].join(' '),
    userPrompt: JSON.stringify({
      message: input.message,
      currentPermissionMode: input.config.riskMode,
      activeTasks: input.activeTasks.slice(0, 20),
      nowIso: new Date().toISOString(),
      localTime: new Date().toString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  })
  if (!result?.content.trim()) return null
  const parsed = parseJsonFromModelText(result.content)
  if (!parsed || typeof parsed !== 'object') return null

  const intent = readIntent(parsed.intent)
  const lane = readLane(parsed.lane)
  if (!intent || !lane) return null
  const confidence = typeof parsed.confidence === 'number'
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0
  if (confidence < 0.62) {
    return {
      intent: 'clarify',
      lane: 'none',
      permissionMode: input.config.riskMode,
      confidence,
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'low confidence',
    }
  }

  const decision: JarvisRouterDecision = {
    intent,
    lane,
    targetTaskId: typeof parsed.targetTaskId === 'string' && parsed.targetTaskId.trim()
      ? parsed.targetTaskId.trim()
      : undefined,
    workdir: typeof parsed.workdir === 'string' && parsed.workdir.trim()
      ? parsed.workdir.trim()
      : undefined,
    permissionMode: readPermissionMode(parsed.permissionMode) ?? input.config.riskMode,
    confidence,
    reason: typeof parsed.reason === 'string' ? parsed.reason : 'model classified',
    controlAction: readControlAction(parsed.controlAction),
    schedule: readScheduleSpec(parsed.schedule),
  }
  return enforceRouterInvariants(decision, input.config)
}

export function enforceRouterInvariants(
  decision: JarvisRouterDecision,
  config: JarvisModeConfig,
): JarvisRouterDecision {
  const hasTaskLane = decision.lane === 'read_only' || decision.lane === 'write' || decision.lane === 'external'
  const hasWorkdir = Boolean(decision.workdir?.trim())
  if (
    decision.intent === 'supplement' &&
    (decision.controlAction === 'mute_reports' || decision.controlAction === 'unmute_reports')
  ) {
    return {
      ...decision,
      intent: 'control',
      lane: 'none',
      workdir: undefined,
      permissionMode: decision.permissionMode ?? config.riskMode,
      reason: `${decision.reason}; normalized from supplement because progress-report controls must be handled by Jarvis Service, not injected into the Manager CLI.`,
    }
  }

  if ((decision.intent === 'status' || decision.intent === 'chat') && (hasTaskLane || hasWorkdir)) {
    return {
      ...decision,
      intent: 'new_task',
      lane: hasTaskLane ? decision.lane : 'read_only',
      permissionMode: decision.permissionMode ?? config.riskMode,
      reason: `${decision.reason}; normalized from ${decision.intent} because the router returned a task lane/workdir, which is incompatible with ${decision.intent}.`,
    }
  }

  if (decision.intent === 'control' || decision.intent === 'status' || decision.intent === 'chat' || decision.intent === 'schedule') {
    return {
      ...decision,
      lane: 'none',
      workdir: undefined,
      permissionMode: decision.permissionMode ?? config.riskMode,
    }
  }

  if (decision.intent === 'new_task' && decision.lane === 'none') {
    return {
      ...decision,
      lane: 'read_only',
      permissionMode: decision.permissionMode ?? config.riskMode,
      reason: `${decision.reason}; normalized new_task lane from none to read_only.`,
    }
  }

  return {
    ...decision,
    permissionMode: decision.permissionMode ?? config.riskMode,
  }
}

function readIntent(value: unknown): JarvisIntent | null {
  return value === 'control' ||
    value === 'status' ||
    value === 'chat' ||
    value === 'supplement' ||
    value === 'schedule' ||
    value === 'new_task' ||
    value === 'clarify'
    ? value
    : null
}

function readLane(value: unknown): JarvisLane | null {
  return value === 'none' ||
    value === 'read_only' ||
    value === 'write' ||
    value === 'external'
    ? value
    : null
}

function readPermissionMode(value: unknown): JarvisModeConfig['riskMode'] | null {
  return value === 'observe' ||
    value === 'assisted' ||
    value === 'autonomous' ||
    value === 'full_autonomous'
    ? value
    : null
}

function readControlAction(value: unknown): JarvisControlAction | undefined {
  return value === 'pause' ||
    value === 'resume' ||
    value === 'cancel' ||
    value === 'delete' ||
    value === 'kill' ||
    value === 'mute_reports' ||
    value === 'unmute_reports' ||
    value === 'stop_all'
    ? value
    : undefined
}

function readScheduleSpec(value: unknown): JarvisScheduleSpec | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const spec: JarvisScheduleSpec = {}
  if (typeof record.cron === 'string' && record.cron.trim()) {
    spec.cron = record.cron.trim()
  }
  if (typeof record.fireAtIso === 'string' && record.fireAtIso.trim()) {
    spec.fireAtIso = record.fireAtIso.trim()
  }
  if (typeof record.prompt === 'string' && record.prompt.trim()) {
    spec.prompt = record.prompt.trim()
  }
  if (typeof record.name === 'string' && record.name.trim()) {
    spec.name = record.name.trim()
  }
  if (typeof record.description === 'string' && record.description.trim()) {
    spec.description = record.description.trim()
  }
  if (typeof record.recurring === 'boolean') {
    spec.recurring = record.recurring
  }
  if (record.mode === 'reminder' || record.mode === 'task') {
    spec.mode = record.mode
  }
  return Object.keys(spec).length > 0 ? spec : undefined
}
