import {
  RustSidecarClient,
  RustSidecarRequestError,
  type RustSidecarClientOptions,
} from './rustSidecarClient.js'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

export type RustParityScenarioResult = {
  id: string
  ok: boolean
  message: string
}

export type RustParityHarnessResult = {
  ok: boolean
  scenarios: RustParityScenarioResult[]
}

type HelloResult = {
  capabilities?: unknown
}

function hasCapability(result: unknown, capability: string): boolean {
  const hello = result as HelloResult
  return (
    Array.isArray(hello.capabilities) &&
    hello.capabilities.some(item => item === capability)
  )
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableJson(item)).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

async function runScenario(
  id: string,
  fn: () => Promise<void>,
): Promise<RustParityScenarioResult> {
  try {
    await fn()
    return { id, ok: true, message: 'passed' }
  } catch (error) {
    return {
      id,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function runRustSidecarParityHarness(
  options: RustSidecarClientOptions,
): Promise<RustParityHarnessResult> {
  const client = new RustSidecarClient(options)

  try {
    const scenarios = await Promise.all([
      runScenario('sidecar_hello', async () => {
        const result = await client.hello()
        if (!hasCapability(result, 'runtime.echo')) {
          throw new Error('hello response did not advertise runtime.echo')
        }
        if (!hasCapability(result, 'session.index')) {
          throw new Error('hello response did not advertise session.index')
        }
        if (!hasCapability(result, 'fs.glob')) {
          throw new Error('hello response did not advertise fs.glob')
        }
        if (!hasCapability(result, 'fs.grep')) {
          throw new Error('hello response did not advertise fs.grep')
        }
        if (!hasCapability(result, 'fs.validateWrite')) {
          throw new Error('hello response did not advertise fs.validateWrite')
        }
        if (!hasCapability(result, 'jarvis.queue.claim')) {
          throw new Error('hello response did not advertise jarvis.queue.claim')
        }
      }),
      runScenario('echo_roundtrip', async () => {
        const expected = {
          nested: { value: 42 },
          list: ['a', 'b'],
        }
        const result = await client.request('runtime.echo', expected)
        if (stableJson(result) !== stableJson(expected)) {
          throw new Error('echo response did not roundtrip params')
        }
      }),
      runScenario('unknown_method_error', async () => {
        try {
          await client.request('__claude_yh_missing_method__', {})
        } catch (error) {
          if (
            error instanceof RustSidecarRequestError &&
            error.code === 'method_not_found'
          ) {
            return
          }
          throw error
        }
        throw new Error('unknown method unexpectedly succeeded')
      }),
      runScenario('session_index_smoke', async () => {
        const result = await client.request('session.index', {})
        const index = result as { sessions?: unknown; total?: unknown }
        if (!Array.isArray(index.sessions)) {
          throw new Error('session.index did not return a sessions array')
        }
        if (typeof index.total !== 'number') {
          throw new Error('session.index did not return a numeric total')
        }
      }),
      runScenario('session_index_incremental_cache', async () => {
        const result = await client.request('session.index.incremental', {})
        const index = result as { sessions?: unknown; total?: unknown; incremental?: unknown }
        if (!Array.isArray(index.sessions) || typeof index.total !== 'number') {
          throw new Error('session.index.incremental did not return a valid index')
        }
        if (index.incremental !== true) {
          throw new Error('session.index.incremental did not mark incremental=true')
        }
      }),
      runScenario('fs_glob_smoke', async () => {
        const result = await client.request('fs.glob', {
          cwd: process.cwd(),
          pattern: '**/*',
          limit: 1,
        })
        const glob = result as { files?: unknown; total?: unknown }
        if (!Array.isArray(glob.files)) {
          throw new Error('fs.glob did not return a files array')
        }
        if (typeof glob.total !== 'number') {
          throw new Error('fs.glob did not return a numeric total')
        }
      }),
      runScenario('fs_grep_smoke', async () => {
        const result = await client.request('fs.grep', {
          cwd: process.cwd(),
          pattern: '__claude_yh_unlikely_search_pattern__',
          limit: 1,
        })
        const grep = result as { matches?: unknown; total?: unknown }
        if (!Array.isArray(grep.matches)) {
          throw new Error('fs.grep did not return a matches array')
        }
        if (typeof grep.total !== 'number') {
          throw new Error('fs.grep did not return a numeric total')
        }
      }),
      runScenario('fs_write_boundary', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rust-parity-fs-'))
        try {
          const result = await client.request('fs.write', {
            cwd: tmpDir,
            root: tmpDir,
            path: 'safe.txt',
            content: 'ok',
            overwrite: true,
          }) as { validated?: unknown }
          if (result.validated !== true) {
            throw new Error('fs.write did not report validated=true')
          }
          try {
            await client.request('fs.write', {
              cwd: tmpDir,
              root: tmpDir,
              path: '../blocked.txt',
              content: 'blocked',
              overwrite: true,
            })
          } catch (error) {
            if (error instanceof RustSidecarRequestError) return
            throw error
          }
          throw new Error('fs.write allowed a path outside root')
        } finally {
          await fs.rm(tmpDir, { recursive: true, force: true })
        }
      }),
      runScenario('jarvis_queue_atomic_claim', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rust-parity-jarvis-'))
        const queuePath = path.join(tmpDir, 'jarvis_queue.json')
        try {
          const item = {
            id: 'parity-item',
            prompt: 'parity',
            priority: 50,
            status: 'pending',
            approvalState: 'none',
            attempts: 0,
            maxAttempts: 3,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
          await client.request('jarvis.queue.enqueue', { queuePath, item })
          const claimed = await client.request('jarvis.queue.claim', { queuePath }) as { item?: { id?: string; status?: string } }
          if (claimed.item?.id !== item.id || claimed.item.status !== 'running') {
            throw new Error('jarvis.queue.claim did not atomically claim the pending item')
          }
          const recovered = await client.request('jarvis.queue.recover', { queuePath }) as { recovered?: unknown }
          if (recovered.recovered !== 1) {
            throw new Error('jarvis.queue.recover did not recover the running item')
          }
        } finally {
          await fs.rm(tmpDir, { recursive: true, force: true })
        }
      }),
    ])

    return {
      ok: scenarios.every(scenario => scenario.ok),
      scenarios,
    }
  } finally {
    client.close()
  }
}
