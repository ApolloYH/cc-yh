import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import type {
  BrowserControlAction,
  BrowserControlDecision,
} from './types.js'

export type BrowserControlAuditEvent = {
  id?: string
  timestamp?: string
  backendId: string
  action: BrowserControlAction
  decision: BrowserControlDecision
  ok: boolean
  error?: string
  dataSummary?: Record<string, unknown>
}

export async function appendBrowserControlAuditEvent(
  event: BrowserControlAuditEvent,
): Promise<string> {
  const auditId = event.id ?? createAuditId()
  const payload = {
    ...event,
    id: auditId,
    timestamp: event.timestamp ?? new Date().toISOString(),
    action: sanitizeAction(event.action),
  }
  const filePath = getBrowserControlAuditPath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.appendFile(filePath, `${JSON.stringify(payload)}\n`, 'utf-8')
  return auditId
}

export function getBrowserControlAuditPath(): string {
  return path.join(getClaudeConfigHomeDir(), 'browser_control_events.jsonl')
}

function createAuditId(): string {
  return `bc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function sanitizeAction(action: BrowserControlAction): BrowserControlAction {
  return {
    ...action,
    description: action.description
      ? truncate(action.description, 240)
      : action.description,
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`
}
