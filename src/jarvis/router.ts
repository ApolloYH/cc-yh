import {
  callConfiguredMainModel,
  parseJsonFromModelText,
} from '../services/model/mainModelClient.js'
import { logDiagnosticEvent } from '../utils/diagnosticLog.js'
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

  let modelDecision: JarvisRouterDecision | null = null
  try {
    modelDecision = await routeWithModel(input)
  } catch (error) {
    logDiagnosticEvent({
      scope: 'jarvis.router',
      event: 'model_route_failed',
      ok: false,
      data: {
        messagePreview: message.slice(0, 160),
        error: stringifyError(error),
      },
    })
  }
  if (modelDecision) return modelDecision

  const fallbackDecision = routeDeterministicFallback(input)
  if (fallbackDecision) return fallbackDecision

  return {
    intent: 'clarify',
    lane: 'none',
    permissionMode: input.config.riskMode,
    confidence: 0.4,
    reason: 'Router model unavailable or returned invalid JSON; asking for clarification instead of guessing.',
  }
}

export function routeDeterministicFallback(input: {
  message: string
  config: JarvisModeConfig
}): JarvisRouterDecision | null {
  const message = input.message.trim()
  const schedule = parseRelativeReminder(message)
  if (!schedule) return null
  return {
    intent: 'schedule',
    lane: 'none',
    permissionMode: input.config.riskMode,
    confidence: 0.78,
    reason: 'Router model unavailable or invalid; deterministic fallback recognized an explicit relative reminder.',
    schedule,
  }
}

function parseRelativeReminder(message: string): JarvisScheduleSpec | null {
  const normalized = message.replace(/\s+/g, '')
  const match = normalized.match(/^(.{0,12}?)(\d+|[\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e]+)(\u79d2|\u5206\u949f|\u5206|\u5c0f\u65f6|\u5929)\u540e(.+)$/)
  if (!match) return null
  const amount = parseChineseOrArabicNumber(match[2])
  if (!amount || amount <= 0) return null
  const unit = match[3]
  const tail = match[4]?.trim() ?? ''
  if (!tail) return null
  if (!/(\u63d0\u9192|\u901a\u77e5|\u544a\u8bc9|\u558a|\u53eb|\u8bf4|\u53d1\u9001|\u53d1)/.test(tail)) return null

  const delayMs = unit === '\u79d2'
    ? amount * 1000
    : unit === '\u5206\u949f' || unit === '\u5206'
      ? amount * 60_000
      : unit === '\u5c0f\u65f6'
        ? amount * 60 * 60_000
        : amount * 24 * 60 * 60_000
  const fireAt = new Date(Date.now() + delayMs)
  const prompt = cleanReminderPrompt(tail)
  return {
    fireAtIso: fireAt.toISOString(),
    prompt,
    name: buildFallbackScheduleName(prompt),
    description: message,
    recurring: false,
    mode: 'reminder',
  }
}

function parseChineseOrArabicNumber(value: string | undefined): number | null {
  if (!value) return null
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10)
  const digitMap: Record<string, number> = {
    '\u4e00': 1,
    '\u4e8c': 2,
    '\u4e24': 2,
    '\u4e09': 3,
    '\u56db': 4,
    '\u4e94': 5,
    '\u516d': 6,
    '\u4e03': 7,
    '\u516b': 8,
    '\u4e5d': 9,
  }
  if (value === '\u5341') return 10
  const tenIndex = value.indexOf('\u5341')
  if (tenIndex >= 0) {
    const left = value.slice(0, tenIndex)
    const right = value.slice(tenIndex + 1)
    const tens = left ? digitMap[left] ?? null : 1
    const ones = right ? digitMap[right] ?? null : 0
    return tens === null || ones === null ? null : tens * 10 + ones
  }
  return digitMap[value] ?? null
}

function cleanReminderPrompt(tail: string): string {
  const cleaned = tail
    .replace(/^(\u63d0\u9192\u6211|\u901a\u77e5\u6211|\u544a\u8bc9\u6211|\u558a\u6211|\u53eb\u6211|\u7ed9\u6211|\u548c\u6211|\u5411\u6211)/, '')
    .replace(/^(\u8bf4|\u53d1\u9001|\u53d1|\u63d0\u9192|\u901a\u77e5|\u544a\u8bc9|\u558a|\u53eb)/, '')
    .trim()
  return cleaned || tail
}

function buildFallbackScheduleName(prompt: string): string {
  const trimmed = prompt.replace(/\s+/g, ' ').trim()
  return trimmed ? '\u63d0\u9192\uff1a' + trimmed.slice(0, 24) : 'Jarvis \u63d0\u9192'
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
    maxTokens: 1800,
    timeoutMs: 45_000,
    disableThinking: true,
    systemPrompt: [
      'You are Jarvis Router for claude-yh.',
      'Think as little as possible. Output the final JSON immediately.',
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
      '"What tasks are running?" => {"intent":"status","lane":"none"}',
      '"Current queue status" => {"intent":"status","lane":"none"}',
      '"C:\\Users\\me\\Desktop\\project analyze this project" => {"intent":"new_task","lane":"read_only","workdir":"C:\\Users\\me\\Desktop\\project"}',
      '"Research how this repository implements login" => {"intent":"new_task","lane":"read_only"}',
      '"Fix this project login bug" => {"intent":"new_task","lane":"write"}',
      '"Remind me to drink water in three minutes" => {"intent":"schedule","lane":"none","schedule":{"mode":"reminder"}}',
      '"Stop reporting progress" => {"intent":"control","lane":"none","controlAction":"mute_reports"}',
      '"Only final result" => {"intent":"control","lane":"none","controlAction":"mute_reports"}',
      '"Resume progress reports" => {"intent":"control","lane":"none","controlAction":"unmute_reports"}',
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
  if (!result?.content.trim()) {
    logDiagnosticEvent({
      scope: 'jarvis.router',
      event: 'model_route_empty',
      ok: false,
      data: { messagePreview: input.message.slice(0, 160) },
    })
    return null
  }
  const parsed = parseJsonFromModelText(result.content)
  if (!parsed || typeof parsed !== 'object') {
    logDiagnosticEvent({
      scope: 'jarvis.router',
      event: 'model_route_invalid_json',
      ok: false,
      data: {
        messagePreview: input.message.slice(0, 160),
        modelOutputPreview: result.content.slice(0, 600),
      },
    })
    return null
  }

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

function stringifyError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
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
