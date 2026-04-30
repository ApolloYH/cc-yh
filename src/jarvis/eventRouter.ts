import { appendJarvisInboxMessage } from './inbox.js'
import { appendJarvisTaskLog } from './logs.js'
import { appendJarvisTranscriptEntry } from './transcript.js'
import type {
  JarvisEventSeverity,
  JarvisInboxSource,
} from './types.js'

export type JarvisRuntimeEventKind =
  | 'reminder_fired'
  | 'task_started'
  | 'task_progress'
  | 'task_blocked'
  | 'task_error'
  | 'task_completed'
  | 'approval_required'
  | 'tool_event'
  | 'system_note'

export type JarvisRuntimeEventPriority = 'interrupt' | 'digest' | 'silent'

export type JarvisRuntimeEventInput = {
  kind: JarvisRuntimeEventKind
  title: string
  message: string
  taskId?: string
  source?: JarvisInboxSource
  severity?: JarvisEventSeverity
  priority?: JarvisRuntimeEventPriority
  muted?: boolean
  metadata?: Record<string, unknown>
}

export async function recordJarvisRuntimeEvent(input: JarvisRuntimeEventInput): Promise<void> {
  const priority = input.priority ?? inferPriority(input.kind, input.severity)
  await appendJarvisTranscriptEntry({
    type: input.kind === 'tool_event' ? 'tool_event' : 'system_event',
    source: input.source ?? 'system',
    title: input.title,
    message: input.message,
    taskId: input.taskId,
    severity: input.severity,
    metadata: {
      ...input.metadata,
      kind: input.kind,
      priority,
    },
  })
  if (input.taskId) {
    await appendJarvisTaskLog(input.taskId, {
      type: 'runtime_event',
      data: {
        kind: input.kind,
        priority,
        title: input.title,
        message: input.message,
        severity: input.severity,
        metadata: input.metadata,
      },
    }).catch(() => {})
  }
  if (priority === 'silent' || input.muted) return
  await appendJarvisInboxMessage({
    role: 'jarvis',
    source: input.source ?? 'system',
    title: input.title,
    message: input.message,
    taskId: input.taskId,
    severity: input.severity,
    metadata: {
      ...input.metadata,
      kind: input.kind,
      priority,
    },
  })
}

function inferPriority(
  kind: JarvisRuntimeEventKind,
  severity?: JarvisEventSeverity,
): JarvisRuntimeEventPriority {
  if (severity === 'error') return 'interrupt'
  if (kind === 'reminder_fired' || kind === 'approval_required' || kind === 'task_blocked' || kind === 'task_error') {
    return 'interrupt'
  }
  if (kind === 'task_completed' || kind === 'task_started' || kind === 'task_progress') return 'digest'
  return 'silent'
}
