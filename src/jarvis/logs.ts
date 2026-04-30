import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

export type JarvisLogEvent = {
  createdAt?: string
  type: string
  ok?: boolean
  severity?: 'info' | 'warn' | 'error'
  data?: Record<string, unknown>
}

export async function appendJarvisTaskLog(
  taskId: string,
  event: JarvisLogEvent,
): Promise<void> {
  await appendJsonl(path.join(getClaudeConfigHomeDir(), 'logs', 'jarvis', 'tasks', `${safeName(taskId)}.jsonl`), event)
}

export async function appendJarvisManagerLog(
  sessionId: string,
  event: JarvisLogEvent,
): Promise<void> {
  await appendJsonl(path.join(getClaudeConfigHomeDir(), 'logs', 'jarvis', 'managers', `${safeName(sessionId)}.jsonl`), event)
}

async function appendJsonl(filePath: string, event: JarvisLogEvent): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.appendFile(
    filePath,
    JSON.stringify({
      createdAt: event.createdAt ?? new Date().toISOString(),
      ...event,
    }) + '\n',
    'utf-8',
  )
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'unknown'
}
