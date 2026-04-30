import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { call } from '../jarvis.js'

let tmpDir: string
let originalConfigDir: string | undefined

describe('/jarvis command', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-command-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
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
})
