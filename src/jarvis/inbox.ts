import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import type {
  JarvisApprovalRequest,
  JarvisApprovalStatus,
  JarvisEventSeverity,
  JarvisInboxMessage,
  JarvisInboxRole,
  JarvisInboxSource,
} from './types.js'

const INBOX_FILE = 'jarvis_inbox.jsonl'
const APPROVALS_FILE = 'jarvis_approvals.jsonl'
const MAX_INBOX_MESSAGES = 500
const MAX_APPROVALS = 300

export function getJarvisInboxPath(): string {
  return path.join(getClaudeConfigHomeDir(), INBOX_FILE)
}

export function getJarvisApprovalsPath(): string {
  return path.join(getClaudeConfigHomeDir(), APPROVALS_FILE)
}

export async function appendJarvisInboxMessage(input: {
  role: JarvisInboxRole
  source: JarvisInboxSource
  message: string
  title?: string
  taskId?: string
  severity?: JarvisEventSeverity
  metadata?: Record<string, unknown>
}): Promise<JarvisInboxMessage> {
  const message: JarvisInboxMessage = {
    id: randomUUID(),
    role: input.role,
    source: input.source,
    createdAt: new Date().toISOString(),
    title: input.title,
    message: input.message,
    taskId: input.taskId,
    severity: input.severity,
    metadata: input.metadata,
  }
  const messages = await readJarvisInboxMessages(MAX_INBOX_MESSAGES - 1)
  await writeJsonl(getJarvisInboxPath(), [...messages.reverse(), message].slice(-MAX_INBOX_MESSAGES))
  return message
}

export async function readJarvisInboxMessages(limit = 100): Promise<JarvisInboxMessage[]> {
  return (await readJsonl(getJarvisInboxPath(), isInboxMessage))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)
}

export async function createJarvisApproval(input: {
  taskId?: string
  source?: JarvisInboxSource
  title: string
  message: string
  risk?: JarvisApprovalRequest['risk']
}): Promise<JarvisApprovalRequest> {
  const now = new Date().toISOString()
  const approval: JarvisApprovalRequest = {
    id: randomUUID(),
    taskId: input.taskId,
    source: input.source ?? 'system',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    title: input.title,
    message: input.message,
    risk: input.risk ?? 'other',
  }
  const approvals = await readAllApprovals()
  await writeJsonl(getJarvisApprovalsPath(), [...approvals, approval].slice(-MAX_APPROVALS))
  await appendJarvisInboxMessage({
    role: 'jarvis',
    source: approval.source,
    title: approval.title,
    message: approval.message,
    taskId: approval.taskId,
    severity: 'warn',
    metadata: { approvalId: approval.id, risk: approval.risk },
  })
  return approval
}

export async function readJarvisApprovals(limit = 100): Promise<JarvisApprovalRequest[]> {
  return (await readAllApprovals())
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limit)
}

export async function updateJarvisApproval(
  id: string,
  patch: {
    status?: JarvisApprovalStatus
    resolutionNote?: string
  },
): Promise<JarvisApprovalRequest | null> {
  const approvals = await readAllApprovals()
  const current = approvals.find(approval => approval.id === id)
  if (!current) return null
  const next: JarvisApprovalRequest = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  await writeJsonl(
    getJarvisApprovalsPath(),
    approvals.map(approval => approval.id === id ? next : approval).slice(-MAX_APPROVALS),
  )
  await appendJarvisInboxMessage({
    role: 'system',
    source: next.source,
    title: next.status === 'approved' ? '审批已通过' : next.status === 'rejected' ? '审批已拒绝' : '审批已更新',
    message: `${next.title}${next.resolutionNote ? `：${next.resolutionNote}` : ''}`,
    taskId: next.taskId,
    severity: next.status === 'rejected' ? 'warn' : 'info',
    metadata: { approvalId: next.id, status: next.status },
  })
  return next
}

async function readAllApprovals(): Promise<JarvisApprovalRequest[]> {
  return readJsonl(getJarvisApprovalsPath(), isApproval)
}

async function readJsonl<T>(filePath: string, guard: (value: unknown) => value is T): Promise<T[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line) as unknown
        } catch {
          return null
        }
      })
      .filter(guard)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function writeJsonl<T>(filePath: string, items: T[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(
    filePath,
    items.map(item => JSON.stringify(item)).join('\n') + (items.length ? '\n' : ''),
    'utf-8',
  )
}

function isInboxMessage(value: unknown): value is JarvisInboxMessage {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as JarvisInboxMessage).id === 'string' &&
      isInboxRole((value as JarvisInboxMessage).role) &&
      isInboxSource((value as JarvisInboxMessage).source) &&
      typeof (value as JarvisInboxMessage).createdAt === 'string' &&
      typeof (value as JarvisInboxMessage).message === 'string',
  )
}

function isApproval(value: unknown): value is JarvisApprovalRequest {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as JarvisApprovalRequest).id === 'string' &&
      typeof (value as JarvisApprovalRequest).title === 'string' &&
      typeof (value as JarvisApprovalRequest).message === 'string' &&
      isApprovalStatus((value as JarvisApprovalRequest).status),
  )
}

function isInboxRole(value: unknown): value is JarvisInboxRole {
  return value === 'user' || value === 'jarvis' || value === 'system'
}

function isInboxSource(value: unknown): value is JarvisInboxSource {
  return (
    value === 'desktop' ||
    value === 'web' ||
    value === 'cli' ||
    value === 'telegram' ||
    value === 'feishu' ||
    value === 'dingtalk' ||
    value === 'wecom' ||
    value === 'system'
  )
}

function isApprovalStatus(value: unknown): value is JarvisApprovalStatus {
  return value === 'pending' || value === 'approved' || value === 'rejected'
}
