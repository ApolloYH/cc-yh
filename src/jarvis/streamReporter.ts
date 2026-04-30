import { recordJarvisRuntimeEvent } from './eventRouter.js'
import { appendJarvisManagerLog, appendJarvisTaskLog } from './logs.js'
import type { JarvisQueueItem } from './queue.js'

type ReporterState = {
  announcedScan: boolean
  announcedCollection: boolean
  announcedCommand: boolean
  announcedInsight: boolean
  readCount: number
  lastReadReportAt: number
}

type StreamReport = {
  kind: 'progress' | 'blocked' | 'error' | 'final'
  title: string
  message: string
  severity: 'info' | 'warn' | 'error'
}

const reporterStates = new Map<string, ReporterState>()
const READ_REPORT_INTERVAL_MS = 20_000

export async function handleJarvisManagerStreamLine(input: {
  item: JarvisQueueItem
  sessionId: string
  line: string
}): Promise<void> {
  const text = input.line.trim()
  if (!text) return

  await appendJarvisManagerLog(input.sessionId, {
    type: 'stream_json_raw',
    data: { taskId: input.item.id, line: text.slice(0, 20_000) },
  })
  await appendJarvisTaskLog(input.item.id, {
    type: 'manager_stream_line',
    data: { sessionId: input.sessionId, line: text.slice(0, 20_000) },
  })

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return
  }

  const report = summarizeStreamEvent(parsed, getReporterState(input.item.id), input.item)
  if (!report) return

  await appendJarvisTaskLog(input.item.id, {
    type: 'reporter_summary',
    data: report,
  })

  if (report.kind === 'final') {
    reporterStates.delete(input.item.id)
    return
  }

  await recordJarvisRuntimeEvent({
    kind: report.kind === 'blocked'
      ? 'task_blocked'
      : report.kind === 'error'
        ? 'task_error'
        : 'task_progress',
    title: report.title,
    message: report.message,
    taskId: input.item.id,
    severity: report.severity,
    muted: input.item.reportMuted && report.kind === 'progress',
    metadata: {
      reportKind: report.kind,
      sessionId: input.sessionId,
    },
  })

  if (report.kind === 'error') reporterStates.delete(input.item.id)
}

function getReporterState(taskId: string): ReporterState {
  let state = reporterStates.get(taskId)
  if (!state) {
    state = {
      announcedScan: false,
      announcedCollection: false,
      announcedCommand: false,
      announcedInsight: false,
      readCount: 0,
      lastReadReportAt: 0,
    }
    reporterStates.set(taskId, state)
  }
  return state
}

function summarizeStreamEvent(parsed: unknown, state: ReporterState, item: JarvisQueueItem): StreamReport | null {
  const event = parsed as any
  const type = event?.type
  if (type === 'result') {
    const result = typeof event.result === 'string' ? event.result.trim() : ''
    const error = typeof event.error === 'string' ? event.error.trim() : ''
    const isError = event.is_error === true || Boolean(error)
    return {
      kind: isError ? 'error' : 'final',
      title: error ? '任务异常' : '任务完成',
      message: result || error || 'Manager CLI 已结束。',
      severity: isError ? 'error' : 'info',
    }
  }

  if (type === 'assistant') {
    const blocks = Array.isArray(event?.message?.content) ? event.message.content : []
    const toolUses = blocks.filter((block: any) => block?.type === 'tool_use')
    if (toolUses.length > 0) {
      return summarizeToolUse(String(toolUses[0]?.name || 'tool'), state, item, toolUses.length)
    }

    const text = blocks
      .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
      .map((block: any) => block.text.trim())
      .filter(Boolean)
      .join('\n\n')
    if (!text) return null
    if (/^##\s/.test(text) || text.includes('TaskId')) return summarizeAssistantInsight(text, state, item)
    if (/(blocked|等待|确认|approval|permission|失败|error|报错)/i.test(text)) {
      return {
        kind: /(失败|error|报错)/i.test(text) ? 'error' : 'blocked',
        title: /(失败|error|报错)/i.test(text) ? '任务异常' : '需要关注',
        message: compactText(text, 4000),
        severity: /(失败|error|报错)/i.test(text) ? 'error' : 'warn',
      }
    }
    return summarizeAssistantInsight(text, state, item)
  }

  if (type === 'stream_event' && typeof event.event === 'string') {
    return {
      kind: 'progress',
      title: '任务进展',
      message: event.event,
      severity: 'info',
    }
  }

  return null
}

function summarizeToolUse(
  toolName: string,
  state: ReporterState,
  item: JarvisQueueItem,
  toolCount: number,
): StreamReport | null {
  const name = toolName.toLowerCase()
  if (['glob', 'grep', 'ls', 'find'].some(tool => name.includes(tool))) {
    if (state.announcedScan) return null
    state.announcedScan = true
    return {
      kind: 'progress',
      title: '开始扫描项目结构',
      message: `${taskLabel(item)}：正在定位目录、入口文件和关键实现位置。`,
      severity: 'info',
    }
  }

  if (name.includes('read')) {
    state.readCount += toolCount
    const now = Date.now()
    const shouldReport =
      state.readCount === 1 ||
      state.readCount === 3 ||
      state.readCount === 6 ||
      (state.readCount % 10 === 0 && now - state.lastReadReportAt > READ_REPORT_INTERVAL_MS)
    if (!shouldReport) return null
    state.lastReadReportAt = now
    state.announcedCollection = true
    return {
      kind: 'progress',
      title: `已读取 ${state.readCount} 个关键文件`,
      message: `${taskLabel(item)}：正在分析实现链路、入口关系和可复用结论。`,
      severity: 'info',
    }
  }

  if (name.includes('browser') || name.includes('websearch') || name.includes('webfetch')) {
    if (state.announcedCollection) return null
    state.announcedCollection = true
    return {
      kind: 'progress',
      title: '正在收集外部信息',
      message: `${taskLabel(item)}：正在通过浏览器或网页搜索补充证据。`,
      severity: 'info',
    }
  }

  if (name.includes('bash') || name.includes('powershell')) {
    if (state.announcedCommand) return null
    state.announcedCommand = true
    return {
      kind: 'progress',
      title: '正在检查运行环境',
      message: `${taskLabel(item)}：正在执行命令确认项目状态或验证发现。`,
      severity: 'info',
    }
  }

  return null
}

function summarizeAssistantInsight(text: string, state: ReporterState, item: JarvisQueueItem): StreamReport | null {
  const trimmed = text.trim()
  if (!trimmed || state.announcedInsight) return null
  if (!/(入口|entry|签名|sign|代理|proxy|api|路由|route|server|client|关键|发现)/i.test(trimmed)) {
    return null
  }
  state.announcedInsight = true
  return {
    kind: 'progress',
    title: '发现关键线索',
    message: `${taskLabel(item)}：${compactText(trimmed, 240)}\n\n正在继续追踪实现链路。`,
    severity: 'info',
  }
}

function taskLabel(item: JarvisQueueItem): string {
  return item.title || item.goal || item.prompt || '当前任务'
}

function compactText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1)}…`
}
