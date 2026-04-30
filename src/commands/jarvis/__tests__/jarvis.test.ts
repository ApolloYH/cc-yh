import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { call } from '../jarvis.js'

let tmpDir: string
let originalConfigDir: string | undefined
let originalDisableMainModel: string | undefined

describe('/jarvis command', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-command-'))
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

  it('enables and configures Jarvis Mode from the CLI', async () => {
    const enabled = await call('on', {} as never)
    expect(enabled.type).toBe('text')
    if (enabled.type === 'text') {
      expect(enabled.value).toContain('Jarvis Mode: on')
    }

    const interval = await call('interval 10', {} as never)
    expect(interval.type).toBe('text')
    if (interval.type === 'text') {
      expect(interval.value).toContain('Interval: 10 minute(s)')
    }

    const settings = JSON.parse(
      await fs.readFile(path.join(tmpDir, 'settings.json'), 'utf-8'),
    )
    expect(settings.jarvisMode.enabled).toBe(true)
    expect(settings.jarvisMode.intervalMs).toBe(600_000)
  })

  it('configures autonomous mode and submits a Jarvis goal', async () => {
    const mode = await call('mode autonomous', {} as never)
    expect(mode.type).toBe('text')
    if (mode.type === 'text') {
      expect(mode.value).toContain('Mode: autonomous')
    }

    const task = await call('enqueue summarize new sessions', {} as never)
    expect(task.type).toBe('text')
    if (task.type === 'text') {
      expect(task.value).toContain('Jarvis accepted the goal')
    }

    const settings = JSON.parse(
      await fs.readFile(path.join(tmpDir, 'settings.json'), 'utf-8'),
    )
    expect(settings.jarvisMode.riskMode).toBe('autonomous')
    const queue = JSON.parse(await fs.readFile(path.join(tmpDir, 'jarvis_queue.json'), 'utf-8'))
    expect(queue.items[0].goal).toBe('summarize new sessions')
  })

  it('enables companion mode from the CLI', async () => {
    const result = await call('companion on', {} as never)
    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.value).toContain('Companion: on')
      expect(result.value).toContain('Mode: autonomous')
    }

    const settings = JSON.parse(
      await fs.readFile(path.join(tmpDir, 'settings.json'), 'utf-8'),
    )
    expect(settings.jarvisMode.enabled).toBe(true)
    expect(settings.jarvisMode.companionModeEnabled).toBe(true)
    expect(settings.jarvisMode.riskMode).toBe('autonomous')
  })
})
