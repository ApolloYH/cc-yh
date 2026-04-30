import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { RustSidecarClient } from '../rustSidecarClient.js'
import { getRustSidecarLaunchConfig } from '../rustSidecarProtocol.js'

let tmpDir = ''

describe('Rust runtime production boundaries', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rust-runtime-integration-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('enforces write roots and classifies shell commands inside the sidecar', async () => {
    const client = createClient()
    if (!client) return
    try {
      const write = await client.request('fs.write', {
        cwd: tmpDir,
        root: tmpDir,
        path: 'safe/file.txt',
        content: 'ok',
        overwrite: true,
      }) as Record<string, unknown>
      expect(write.source).toBe('rust')
      expect(write.validated).toBe(true)
      expect(write.atomic).toBe(true)

      let blockedMessage = ''
      try {
        await client.request('fs.write', {
          cwd: tmpDir,
          root: tmpDir,
          path: '../outside.txt',
          content: 'blocked',
          overwrite: true,
        })
      } catch (error) {
        blockedMessage = error instanceof Error ? error.message : String(error)
      }
      expect(blockedMessage).toContain('outside the allowed root')

      const shell = await client.request('shell.classify', {
        shell: 'powershell',
        command: 'Format C:',
      }) as Record<string, unknown>
      expect(shell.source).toBe('rust')
      expect(shell.action).toBe('deny')
    } finally {
      client.close()
    }
  })

  it('serves session indexes from the incremental cache after the first scan', async () => {
    const client = createClient()
    if (!client) return
    const projectDir = path.join(tmpDir, 'projects', '-repo')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(
      path.join(projectDir, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl'),
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'Index me' },
        timestamp: '2026-04-26T00:00:00.000Z',
      }) + '\n',
      'utf-8',
    )
    try {
      const first = await client.request('session.index.incremental', {
        configDir: tmpDir,
      }) as Record<string, unknown>
      expect(first.source).toBe('rust')
      expect(first.cacheHit).toBe(false)
      expect(first.total).toBe(1)

      const second = await client.request('session.index.incremental', {
        configDir: tmpDir,
        query: 'Index me',
      }) as Record<string, unknown>
      expect(second.source).toBe('rust')
      expect(second.cacheHit).toBe(true)
      expect(second.total).toBe(1)
    } finally {
      client.close()
    }
  })
})

function createClient(): RustSidecarClient | null {
  const launch = getRustSidecarLaunchConfig()
  if (!launch) return null
  return new RustSidecarClient({
    command: launch.command,
    args: launch.args,
    timeoutMs: 10_000,
  })
}
