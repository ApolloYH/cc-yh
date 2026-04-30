import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  appendJarvisEvent,
  getJarvisSettingsPath,
  readJarvisConfig,
  readJarvisEvents,
  updateJarvisConfig,
} from '../store.js'

let tmpDir: string
let originalConfigDir: string | undefined

describe('jarvis store', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-store-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('stores config under the shared settings file', async () => {
    const config = await updateJarvisConfig({
      enabled: true,
      intervalMs: 30_000,
      sources: { git: true },
    })

    expect(config.enabled).toBe(true)
    expect(config.intervalMs).toBe(60_000)
    expect(config.sources.git).toBe(true)
    expect(getJarvisSettingsPath()).toBe(path.join(tmpDir, 'settings.json'))

    const raw = JSON.parse(await fs.readFile(getJarvisSettingsPath(), 'utf-8'))
    expect(raw.jarvisMode.enabled).toBe(true)

    const reread = await readJarvisConfig()
    expect(reread.enabled).toBe(true)
  })

  it('persists events as latest-first reads', async () => {
    await appendJarvisEvent({
      type: 'config',
      title: 'Configured',
      message: 'first',
    })
    await appendJarvisEvent({
      type: 'checkpoint',
      title: 'Checkpoint',
      message: 'second',
    })

    const events = await readJarvisEvents(2)
    expect(events).toHaveLength(2)
    expect(events[0]?.title).toBe('Checkpoint')
    expect(events[1]?.title).toBe('Configured')
  })
})
