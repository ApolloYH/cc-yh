import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { JarvisService } from '../services/jarvisService.js'
import { listJarvisQueue } from '../../jarvis/queue.js'
import type { CronService, CronTask } from '../services/cronService.js'
import type { SessionService } from '../services/sessionService.js'
import type { JarvisRouterDecision } from '../../jarvis/router.js'

let tmpDir: string
let originalConfigDir: string | undefined
let originalDisableMainModel: string | undefined

const cronService = {
  listTasks: async () => [{
    id: 'task-1',
    name: 'Daily report',
    cron: '* * * * *',
    prompt: 'report',
    createdAt: Date.now(),
    enabled: true,
  }],
  createTask: async (task: Omit<CronTask, 'id' | 'createdAt'>) => ({
    ...task,
    id: 'created-schedule',
    createdAt: Date.now(),
  }),
} as unknown as CronService

const sessionService = {
  listSessions: async () => ({
    total: 1,
    sessions: [{
      id: 'session-1',
      title: 'Investigate bug',
      createdAt: '2026-04-25T00:00:00.000Z',
      modifiedAt: '2026-04-25T01:00:00.000Z',
      messageCount: 2,
      projectPath: tmpDir,
      workDir: tmpDir,
      workDirExists: true,
    }],
  }),
} as unknown as SessionService

function route(decision: Partial<JarvisRouterDecision>): JarvisRouterDecision {
  return {
    intent: 'new_task',
    lane: 'read_only',
    permissionMode: 'autonomous',
    confidence: 0.95,
    reason: 'test',
    ...decision,
  }
}

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
    expect(event.message).toContain('Scheduled tasks: 1.')
    expect(event.message).toContain('Latest session: Investigate bug.')
  })

  it('creates one Manager task for one user goal', async () => {
    let executed: CronTask | null = null
    const service = new JarvisService({
      cronService,
      sessionService,
      routeInput: async () => route({ intent: 'new_task', lane: 'read_only' }),
      runTask: async (task) => {
        executed = task
        return {
          id: 'run-1',
          taskId: task.id,
          taskName: task.name || task.id,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          status: 'completed',
          prompt: task.prompt,
          output: 'taskId=ok final report',
          durationMs: 10,
          exitCode: 0,
          sessionId: 'session-1',
        }
      },
    })

    await service.updateConfig({ enabled: true, riskMode: 'autonomous' })
    await service.submitGoal('研究这个项目')
    await waitForAsyncWork()
    const status = await service.getStatus()

    expect(status.queue?.completed).toBe(1)
    expect(status.queueItems?.[0]?.goal).toBe('研究这个项目')
    expect(status.queueItems?.[0]?.lane).toBe('read_only')
    expect(executed?.prompt).toContain('You are Jarvis Manager')
    expect(executed?.prompt).toContain('"originalGoal": "研究这个项目"')
  })

  it('handles status immediately without Manager CLI', async () => {
    let ran = false
    const service = new JarvisService({
      cronService,
      sessionService,
      routeInput: async () => route({ intent: 'status', lane: 'none' }),
      runTask: async (task) => {
        ran = true
        return {
          id: 'run-1',
          taskId: task.id,
          taskName: task.name || task.id,
          startedAt: new Date().toISOString(),
          status: 'completed',
          prompt: task.prompt,
        }
      },
    })

    const status = await service.submitGoal('现在有什么任务')

    expect(ran).toBe(false)
    expect(status.inboxMessages.some(message => message.title === '当前任务状态')).toBe(true)
  })

  it('creates a real scheduled task for reminder requests instead of a Manager queue item', async () => {
    let created: Omit<CronTask, 'id' | 'createdAt'> | null = null
    let ran = false
    const service = new JarvisService({
      cronService: {
        listTasks: async () => [],
        createTask: async (task: Omit<CronTask, 'id' | 'createdAt'>) => {
          created = task
          return {
            ...task,
            id: 'reminder-1',
            createdAt: Date.now(),
          }
        },
      } as unknown as CronService,
      sessionService,
      routeInput: async () => route({
        intent: 'schedule',
        lane: 'none',
        schedule: {
          cron: '3 9 29 4 *',
          prompt: '发送你好',
          name: '3 分钟后提醒',
          recurring: false,
        },
      }),
      runTask: async (task) => {
        ran = true
        return {
          id: 'run-1',
          taskId: task.id,
          taskName: task.name || task.id,
          startedAt: new Date().toISOString(),
          status: 'completed',
          prompt: task.prompt,
        }
      },
    })

    const status = await service.submitGoal('3 分钟后提醒我发送你好')

    expect(ran).toBe(false)
    expect(created?.cron).toBe('3 9 29 4 *')
    expect(created?.prompt).toBe('发送你好')
    expect(created?.recurring).toBe(false)
    expect(created?.origin).toBe('jarvis')
    expect(created?.jarvisTaskType).toBe('reminder')
    expect(created?.jarvisReminderMessage).toBe('发送你好')
    expect(status.queue?.pending).toBe(0)
    expect(status.inboxMessages.some(message => message.title === '定时任务已创建')).toBe(true)
  })

  it('queues supplement into the existing task inbox', async () => {
    const service = new JarvisService({
      cronService,
      sessionService,
      routeInput: async ({ activeTasks }) => activeTasks.length === 0
        ? route({ intent: 'new_task', lane: 'read_only' })
        : route({ intent: 'supplement', lane: 'none', targetTaskId: activeTasks[0]?.id }),
      runTask: async (task) => ({
        id: 'run-1',
        taskId: task.id,
        taskName: task.name || task.id,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: 'completed',
        prompt: task.prompt,
        output: 'ok',
      }),
    })
    await service.updateConfig({ enabled: true, riskMode: 'observe' })
    await service.submitGoal('持续观察项目')
    const before = (await listJarvisQueue())[0]
    expect(before).toBeTruthy()

    await service.submitGoal('补充：重点看日志')
    const after = (await listJarvisQueue())[0]

    expect(after?.supplementSummary).toContain('重点看日志')
  })

  it('mutes progress reports as control instead of injecting into the Manager task', async () => {
    const service = new JarvisService({
      cronService,
      sessionService,
      routeInput: async ({ activeTasks }) => activeTasks.length === 0
        ? route({ intent: 'new_task', lane: 'read_only' })
        : route({ intent: 'control', lane: 'none', controlAction: 'mute_reports', targetTaskId: activeTasks[0]?.id }),
      runTask: async (task) => ({
        id: 'run-1',
        taskId: task.id,
        taskName: task.name || task.id,
        startedAt: new Date().toISOString(),
        status: 'completed',
        prompt: task.prompt,
      }),
    })
    await service.updateConfig({ enabled: true, riskMode: 'observe' })
    await service.submitGoal('analyze project')
    const before = (await listJarvisQueue())[0]
    expect(before).toBeTruthy()

    await service.submitGoal('do not report intermediate progress')
    const after = (await listJarvisQueue())[0]

    expect(after?.reportMuted).toBe(true)
    expect(after?.supplementSummary).toBeUndefined()
  })

  it('maps autonomous mode to bypassPermissions for Manager CLI', async () => {
    let permissionMode: string | undefined
    const service = new JarvisService({
      cronService,
      sessionService,
      routeInput: async () => route({ intent: 'new_task', lane: 'write', permissionMode: 'autonomous' }),
      runTask: async (task) => {
        permissionMode = task.permissionMode
        return {
          id: 'run-1',
          taskId: task.id,
          taskName: task.name || task.id,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          status: 'completed',
          prompt: task.prompt,
          output: 'ok',
        }
      },
    })
    await service.updateConfig({ enabled: true, riskMode: 'autonomous' })
    await service.submitGoal('修改文件')
    await waitForAsyncWork()

    expect(permissionMode).toBe('bypassPermissions')
  })
})

async function waitForAsyncWork(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 600))
}
