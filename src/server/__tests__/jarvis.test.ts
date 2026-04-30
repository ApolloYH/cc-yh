import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { JarvisService } from '../services/jarvisService.js'
import { enqueueJarvisTask } from '../../jarvis/queue.js'
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
})
