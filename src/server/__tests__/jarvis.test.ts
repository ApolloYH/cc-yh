import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { JarvisService } from '../services/jarvisService.js'
import { enqueueJarvisTask, listJarvisQueue, updateJarvisQueueItem } from '../../jarvis/queue.js'
import { handleJarvisApi } from '../api/jarvis.js'
import type { CronService, CronTask } from '../services/cronService.js'
import type { SessionService } from '../services/sessionService.js'

let tmpDir: string
let originalConfigDir: string | undefined
let originalDisableMainModel: string | undefined

const tasks: CronTask[] = [
  {
    id: 'task-1',
    name: 'Daily report',
    cron: '* * * * *',
    prompt: 'report',
    createdAt: Date.now(),
    enabled: true,
  },
]

const cronService = {
  listTasks: async () => tasks,
} as unknown as CronService

const sessionService = {
  listSessions: async () => ({
    total: 1,
    sessions: [
      {
        id: 'session-1',
        title: 'Investigate bug',
        createdAt: '2026-04-25T00:00:00.000Z',
        modifiedAt: '2026-04-25T01:00:00.000Z',
        messageCount: 2,
        projectPath: tmpDir,
        workDir: tmpDir,
        workDirExists: true,
      },
    ],
  }),
} as unknown as SessionService

describe('JarvisService', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-service-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalDisableMainModel = process.env.CLAUDE_YH_DISABLE_MAIN_MODEL_AUTOMATION
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    process.env.CLAUDE_YH_DISABLE_MAIN_MODEL_AUTOMATION = '1'
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    if (originalDisableMainModel === undefined) delete process.env.CLAUDE_YH_DISABLE_MAIN_MODEL_AUTOMATION
    else process.env.CLAUDE_YH_DISABLE_MAIN_MODEL_AUTOMATION = originalDisableMainModel
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('starts only when enabled and records checkpoints', async () => {
    const service = new JarvisService({ cronService, sessionService })

    let status = await service.getStatus()
    expect(status.enabled).toBe(false)
    expect(status.running).toBe(false)

    status = await service.updateConfig({ enabled: true, intervalMs: 60_000 })
    expect(status.enabled).toBe(true)
    expect(status.running).toBe(true)

    const event = await service.tick('manual')
    expect(event.message).toContain('Scheduled tasks: 1/1 enabled')
    expect(event.message).toContain('Sessions: 1 indexed')

    status = await service.getStatus()
    expect(status.recentEvents[0]?.title).toBe('Manual checkpoint complete')
    expect(status.lastHeartbeatAt).not.toBeNull()

    service.stop()
    status = await service.getStatus()
    expect(status.running).toBe(false)
  })

  it('runs a configured continuous task in assisted mode', async () => {
    let executedPrompt = ''
    const service = new JarvisService({
      cronService,
      sessionService,
      runTask: async (task) => {
        executedPrompt = task.prompt
        return {
          id: 'run-1',
          taskId: task.id,
          taskName: task.name || 'task',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          status: 'completed',
          prompt: task.prompt,
          output: 'done',
        }
      },
    })

    await service.updateConfig({
      enabled: true,
      intervalMs: 60_000,
      riskMode: 'assisted',
      taskPrompt: 'watch project status',
    })
    await service.tick('manual')

    expect(executedPrompt).toContain('watch project status')
    const status = await service.getStatus()
    expect(status.recentEvents.some(event => event.title.includes('autonomous task completed'))).toBe(true)
    service.stop()
  })

  it('runs queued companion work even without a continuous prompt', async () => {
    let executedPrompt = ''
    const service = new JarvisService({
      cronService,
      sessionService,
      runTask: async (task) => {
        executedPrompt = task.prompt
        return {
          id: 'run-queue',
          taskId: task.id,
          taskName: task.name || 'task',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          status: 'completed',
          prompt: task.prompt,
          output: 'queue done',
        }
      },
    })

    await enqueueJarvisTask({ prompt: 'watch inbox and summarize', priority: 90 })
    await service.updateConfig({
      enabled: true,
      intervalMs: 60_000,
      riskMode: 'autonomous',
      companionModeEnabled: true,
    })
    await service.tick('manual')

    expect(executedPrompt).toContain('watch inbox and summarize')
    const status = await service.getStatus()
    expect(status.queue?.completed).toBe(1)
    expect(status.inboxMessages.some(message =>
      message.role === 'jarvis' &&
      message.title === '任务开始执行' &&
      message.message.includes('watch inbox and summarize'),
    )).toBe(true)
    expect(status.inboxMessages.some(message =>
      message.role === 'jarvis' &&
      message.title === '任务完成' &&
      message.message.includes('queue done'),
    )).toBe(true)
    service.stop()
  })

  it('accepts a Jarvis goal, plans queue work, and exposes boundaries', async () => {
    const service = new JarvisService({
      cronService,
      sessionService,
      runTask: async (task) => ({
        id: 'run-goal',
        taskId: task.id,
        taskName: task.name || 'task',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: 'completed',
        prompt: task.prompt,
        output: 'goal done',
      }),
    })

    await service.updateConfig({
      riskMode: 'observe',
      boundaries: {
        allowedWorkdirs: [tmpDir],
        allowedDomains: ['example.com'],
        blockedActions: ['payment'],
        budgetMinutes: 30,
        maxToolCalls: 20,
        pauseOnSecrets: true,
        pauseOnExternalSend: true,
        pauseOnPayment: true,
        pauseOnLogin: true,
      },
    })
    const status = await service.submitGoal('watch repo and report failures')

    expect(status.enabled).toBe(true)
    expect(status.config.boundaries.budgetMinutes).toBe(30)
    expect(status.queueItems?.[0]?.goal).toBe('watch repo and report failures')
    expect(status.queueItems?.[0]?.prompt).toContain('Jarvis background goal')
    expect(status.queueItems?.[0]?.prompt).toContain('Allowed domains: example.com')
    expect(status.inboxMessages.some(message =>
      message.role === 'user' &&
      message.source === 'desktop' &&
      message.message.includes('watch repo and report failures'),
    )).toBe(true)
    expect(status.inboxMessages.some(message =>
      message.role === 'jarvis' &&
      message.title === '任务已接收',
    )).toBe(true)
    service.stop()
  })

  it('answers lightweight Jarvis interactions without creating background queue work', async () => {
    let runCalled = false
    const service = new JarvisService({
      cronService,
      sessionService,
      runTask: async (task) => {
        runCalled = true
        return {
          id: 'run-unexpected',
          taskId: task.id,
          taskName: task.name || 'task',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          status: 'completed',
          prompt: task.prompt,
          output: 'should not run',
        }
      },
    })

    await service.updateConfig({ enabled: true, riskMode: 'autonomous' })
    const status = await service.submitGoal('介绍一下你自己')

    expect(runCalled).toBe(false)
    expect((await listJarvisQueue()).length).toBe(0)
    expect(status.queueItems?.length).toBe(0)
    expect(status.inboxMessages.some(message =>
      message.role === 'jarvis' &&
      message.title === 'Jarvis 回复' &&
      message.message.includes('轻量对话'),
    )).toBe(true)
    service.stop()
  })

  it('answers Jarvis task status directly from the queue summary', async () => {
    const service = new JarvisService({ cronService, sessionService })

    await enqueueJarvisTask({ prompt: 'queued background work', priority: 90 })
    await service.updateConfig({ enabled: true, riskMode: 'autonomous' })
    const status = await service.submitGoal('你现在有什么任务')

    expect((await listJarvisQueue()).length).toBe(1)
    expect(status.inboxMessages.some(message =>
      message.role === 'jarvis' &&
      message.title === '当前任务状态' &&
      message.message.includes('待处理 1'),
    )).toBe(true)
    service.stop()
  })

  it('lets users mute and resume progress reports for running tasks', async () => {
    const service = new JarvisService({ cronService, sessionService })
    const item = await enqueueJarvisTask({ prompt: 'long background work', priority: 90 })
    await updateJarvisQueueItem(item.id, { status: 'running' })
    await service.updateConfig({ enabled: true, riskMode: 'autonomous' })

    let status = await service.submitGoal('不要再报告中间进度了')
    expect((await listJarvisQueue()).length).toBe(1)
    expect(status.inboxMessages.some(message =>
      message.role === 'jarvis' &&
      message.title === '进度报告已关闭' &&
      message.message.includes('最终完成、暂停或失败时仍会通知'),
    )).toBe(true)

    status = await service.submitGoal('恢复进度报告')
    expect(status.inboxMessages.some(message =>
      message.role === 'jarvis' &&
      message.title === '进度报告已开启' &&
      message.message.includes('已恢复 1 个运行中任务'),
    )).toBe(true)
    service.stop()
  })

  it('surfaces approval requests in the Jarvis inbox and resumes after approval', async () => {
    let runCalled = false
    const service = new JarvisService({
      cronService,
      sessionService,
      runTask: async (task) => {
        runCalled = true
        return {
          id: 'run-approved',
          taskId: task.id,
          taskName: task.name || 'task',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          status: 'completed',
          prompt: task.prompt,
          output: 'approved work done',
        }
      },
    })

    const item = await enqueueJarvisTask({
      prompt: 'send an external update',
      priority: 90,
      checkpoint: 'Needs user confirmation before sending externally.',
    })
    await updateJarvisQueueItem(item.id, { approvalState: 'requested' })
    await service.updateConfig({
      enabled: true,
      intervalMs: 60_000,
      riskMode: 'assisted',
      requireApprovalForExternalActions: true,
    })

    await service.tick('manual')
    let status = await service.getStatus()
    const approval = status.approvals.find(entry => entry.taskId === item.id && entry.status === 'pending')
    expect(approval).toBeTruthy()
    expect(status.inboxMessages.some(message =>
      message.taskId === item.id &&
      message.title === 'Jarvis 等待确认',
    )).toBe(true)
    expect(runCalled).toBe(false)

    await service.resolveApproval(approval!.id, 'approved')
    status = await service.getStatus()
    const queueItem = status.queueItems?.find(entry => entry.id === item.id)
    expect(queueItem?.approvalState).toBe('approved')
    expect(queueItem?.status).toBe('pending')
    expect(status.inboxMessages.some(message =>
      message.taskId === item.id &&
      message.title === '审批已通过',
    )).toBe(true)
    service.stop()
  })

  it('supports authenticated cloud runner claim and report', async () => {
    const cloudReq = new Request('http://localhost/api/jarvis/cloud', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: true,
        endpoint: 'https://runner.example.com/jarvis',
        runnerId: 'cloud-1',
        token: 'cloud-secret',
      }),
    })
    const cloudRes = await handleJarvisApi(cloudReq, new URL(cloudReq.url), ['api', 'jarvis', 'cloud'])
    expect(cloudRes.status).toBe(200)
    expect(JSON.stringify(await cloudRes.json())).not.toContain('cloud-secret')

    await enqueueJarvisTask({ prompt: 'cloud work', priority: 90 })
    const denied = await handleJarvisApi(
      new Request('http://localhost/api/jarvis/cloud-claim', { method: 'POST' }),
      new URL('http://localhost/api/jarvis/cloud-claim'),
      ['api', 'jarvis', 'cloud-claim'],
    )
    expect(denied.status).toBe(401)

    const claimReq = new Request('http://localhost/api/jarvis/cloud-claim', {
      method: 'POST',
      headers: { authorization: 'Bearer cloud-secret' },
    })
    const claim = await handleJarvisApi(claimReq, new URL(claimReq.url), ['api', 'jarvis', 'cloud-claim'])
    const claimBody = await claim.json()
    expect(claimBody.item.prompt).toBe('cloud work')

    const reportReq = new Request('http://localhost/api/jarvis/cloud-report', {
      method: 'POST',
      headers: { authorization: 'Bearer cloud-secret' },
      body: JSON.stringify({
        id: claimBody.item.id,
        status: 'completed',
        checkpoint: 'cloud completed',
      }),
    })
    const report = await handleJarvisApi(reportReq, new URL(reportReq.url), ['api', 'jarvis', 'cloud-report'])
    const reportBody = await report.json()
    expect(reportBody.item.status).toBe('completed')
    expect(reportBody.item.checkpoint).toBe('cloud completed')
  })

  it('deletes queue items through the Jarvis API', async () => {
    const item = await enqueueJarvisTask({ prompt: 'delete through api', priority: 50 })
    const req = new Request('http://localhost/api/jarvis/queue-action', {
      method: 'POST',
      body: JSON.stringify({ id: item.id, action: 'delete' }),
    })
    const res = await handleJarvisApi(req, new URL(req.url), ['api', 'jarvis', 'queue-action'])
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.item.id).toBe(item.id)
    expect((await listJarvisQueue()).find(entry => entry.id === item.id)).toBeUndefined()
  })
})
