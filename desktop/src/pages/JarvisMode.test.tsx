import '../test/setupDom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '../test/testingLibrary'
import '@testing-library/jest-dom'
import { JarvisMode } from './JarvisMode'
import { useJarvisStore } from '../stores/jarvisStore'
import type { JarvisStatus } from '../types/jarvis'

const baseStatus: JarvisStatus = {
  enabled: true,
  running: true,
  lastHeartbeatAt: '2026-04-28T10:00:00.000Z',
  nextHeartbeatAt: '2026-04-28T10:05:00.000Z',
  uptimeMs: 12_000,
  summary: 'Jarvis is active.',
  config: {
    enabled: true,
    intervalMs: 300_000,
    riskMode: 'assisted',
    companionModeEnabled: true,
    autoResumeQueue: true,
    watchdogEnabled: true,
    sources: {
      scheduledTasks: true,
      sessions: true,
      git: false,
    },
    notificationChannels: ['desktop'],
    maxEventsPerHour: 24,
    requireApprovalForExternalActions: true,
    taskPrompt: '',
    boundaries: {
      allowedWorkdirs: [],
      allowedDomains: [],
      blockedActions: [],
      budgetMinutes: 60,
      maxToolCalls: 80,
      pauseOnSecrets: true,
      pauseOnExternalSend: true,
      pauseOnPayment: true,
      pauseOnLogin: true,
    },
    cloud: {
      enabled: false,
      runnerId: 'local',
      syncQueue: false,
      heartbeatIntervalMs: 300_000,
      tokenSet: false,
    },
  },
  cloud: {
    enabled: false,
    runnerId: 'local',
    syncQueue: false,
    heartbeatIntervalMs: 300_000,
    tokenSet: false,
  },
  recentEvents: [],
  inboxMessages: [
    {
      id: 'message-1',
      role: 'jarvis',
      source: 'system',
      title: '任务已接收',
      message: '已创建一个 Manager CLI 任务。',
      createdAt: '2026-04-28T10:00:01.000Z',
    },
  ],
  approvals: [
    {
      id: 'approval-1',
      taskId: 'task-1',
      source: 'system',
      status: 'pending',
      createdAt: '2026-04-28T10:00:02.000Z',
      updatedAt: '2026-04-28T10:00:02.000Z',
      title: '需要你确认',
      message: '需要用户确认后继续。',
      risk: 'external-send',
    },
  ],
  metrics: {
    heartbeatCount: 1,
    eventsToday: 1,
    enabledSince: '2026-04-28T10:00:00.000Z',
  },
  queue: {
    pending: 1,
    running: 0,
    paused: 0,
    failed: 0,
    completed: 0,
  },
  queueItems: [
    {
      id: 'task-1',
      prompt: '持续观察项目',
      title: '持续观察项目',
      goal: '持续观察项目',
      lane: 'read_only',
      permissionMode: 'assisted',
      status: 'pending',
      priority: 75,
      attempts: 0,
      maxAttempts: 3,
      approvalState: 'requested',
      checkpoint: '等待用户确认',
      createdAt: '2026-04-28T10:00:00.000Z',
      updatedAt: '2026-04-28T10:00:00.000Z',
    },
  ],
}

const autostart = {
  supported: true,
  enabled: true,
  targetPath: 'C:/Users/y1513/.claude-yh/jarvis-autostart.ps1',
  watchdogPath: 'C:/Users/y1513/.claude-yh/jarvis-watchdog.ps1',
  command: 'claude-yh jarvis',
  restartDelaySeconds: 10,
}

describe('JarvisMode', () => {
  beforeEach(() => {
    useJarvisStore.setState({
      status: null,
      autostart: null,
      isLoading: false,
      isSaving: false,
      error: null,
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/jarvis/autostart')) {
        return jsonResponse(autostart)
      }
      if (url.endsWith('/api/jarvis/task') && init?.method === 'POST') {
        return jsonResponse({ status: baseStatus }, 202)
      }
      if (url.endsWith('/api/jarvis/queue-action') && init?.method === 'POST') {
        return jsonResponse({
          status: {
            ...baseStatus,
            queueItems: [],
            queue: { pending: 0, running: 0, paused: 0, failed: 0, completed: 0 },
          },
        })
      }
      if (url.endsWith('/api/jarvis/approval') && init?.method === 'POST') {
        return jsonResponse({
          status: {
            ...baseStatus,
            approvals: [{ ...baseStatus.approvals[0], status: 'approved' }],
          },
        })
      }
      if (url.endsWith('/api/jarvis')) {
        return jsonResponse(baseStatus)
      }
      return jsonResponse({}, 404)
    }))
  })

  it('renders chat-first Jarvis UI with approval actions and submits goals', async () => {
    render(<JarvisMode />)

    await screen.findByText('Jarvis 对话')
    expect(screen.getByText('任务已接收')).toBeInTheDocument()
    expect(screen.getByText('需要你确认')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批准' })).toBeInTheDocument()
    expect(screen.getByText(/任务队列/)).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText(/把目标交给 Jarvis/), {
      target: { value: '持续观察项目状态' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/jarvis/task'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('持续观察项目状态'),
        }),
      )
    })

    fireEvent.click(screen.getByText('持续观察项目'))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/jarvis/queue-action'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"action":"delete"'),
        }),
      )
    })
  })

  it('reconciles optimistic user messages by clientMessageId without merging repeated text', async () => {
    const sentMessages: JarvisStatus['inboxMessages'] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/jarvis/autostart')) {
        return jsonResponse(autostart)
      }
      if (url.endsWith('/api/jarvis/task') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as {
          goal: string
          clientMessageId?: string
        }
        sentMessages.push({
          id: `server-${body.clientMessageId}`,
          role: 'user',
          source: 'desktop',
          title: '交给 Jarvis 的消息',
          message: body.goal,
          createdAt: new Date(2026, 3, 28, 10, sentMessages.length).toISOString(),
          metadata: { clientMessageId: body.clientMessageId },
        })
        return jsonResponse({
          status: {
            ...baseStatus,
            inboxMessages: [...baseStatus.inboxMessages, ...sentMessages],
          },
        }, 202)
      }
      if (url.endsWith('/api/jarvis')) {
        return jsonResponse({
          ...baseStatus,
          inboxMessages: [...baseStatus.inboxMessages, ...sentMessages],
        })
      }
      return jsonResponse(baseStatus)
    }))

    render(<JarvisMode />)
    await screen.findByText('Jarvis 对话')

    const textbox = screen.getByRole('textbox')
    fireEvent.change(textbox, { target: { value: 'same text' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => {
      expect(screen.getAllByText('same text')).toHaveLength(1)
    })

    fireEvent.change(textbox, { target: { value: 'same text' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => {
      expect(screen.getAllByText('same text')).toHaveLength(2)
    })

    const taskCalls = vi.mocked(globalThis.fetch).mock.calls
      .filter(([url, init]) => String(url).endsWith('/api/jarvis/task') && init?.method === 'POST')
    const clientMessageIds = taskCalls.map(([, init]) => {
      const body = JSON.parse(String(init?.body)) as { clientMessageId?: string }
      return body.clientMessageId
    })
    expect(new Set(clientMessageIds).size).toBe(2)
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
