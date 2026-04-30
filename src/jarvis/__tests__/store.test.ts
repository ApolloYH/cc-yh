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
import {
  buildWindowsStartupScript,
  buildWindowsWatchdogScript,
  getJarvisAutostartStatus,
  setJarvisAutostart,
} from '../autostart.js'

let tmpDir: string
let originalConfigDir: string | undefined
let originalAppData: string | undefined

describe('jarvis store', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-store-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalAppData = process.env.APPDATA
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    process.env.APPDATA = path.join(tmpDir, 'AppData', 'Roaming')
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    if (originalAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = originalAppData
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

  it('builds watchdog autostart scripts and reports status', async () => {
    const startup = buildWindowsStartupScript()
    const watchdog = buildWindowsWatchdogScript()
    expect(startup).toContain('claude-yh-jarvis-watchdog.ps1')
    expect(watchdog).toContain('while ($true)')
    expect(watchdog).toContain('restarting in $restartDelaySeconds seconds')
    expect(watchdog).toContain('bun run src/server/index.ts')

    const status = await getJarvisAutostartStatus()
    expect(status.watchdogPath).toBe(path.join(tmpDir, 'claude-yh-jarvis-watchdog.ps1'))
    expect(status.restartDelaySeconds).toBeGreaterThanOrEqual(1)

    if (process.platform === 'win32') {
      const enabled = await setJarvisAutostart(true)
      expect(enabled.enabled).toBe(true)
      await expect(fs.stat(enabled.watchdogPath)).resolves.toBeTruthy()
      const disabled = await setJarvisAutostart(false)
      expect(disabled.enabled).toBe(false)
    }
  })
})
