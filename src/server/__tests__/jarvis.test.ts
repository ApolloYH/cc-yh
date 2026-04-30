import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { JarvisService } from '../services/jarvisService.js'
import type { CronService, CronTask } from '../services/cronService.js'
import type { SessionService } from '../services/sessionService.js'

let tmpDir: string
let originalConfigDir: string | undefined

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
    process.env.CLAUDE_CONFIG_DIR = tmpDir
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
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
})
