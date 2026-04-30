import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  RustSidecarClient,
  RustSidecarRequestError,
} from '../rustSidecarClient.js'
import { runRustSidecarParityHarness } from '../rustParityHarness.js'

let tmpRoot = ''

async function createMockSidecar(): Promise<string> {
  tmpRoot = await mkdtemp(join(tmpdir(), 'claude-yh-rust-sidecar-'))
  const scriptPath = join(tmpRoot, 'mock-sidecar.mjs')
  await writeFile(
    scriptPath,
    `
import readline from 'node:readline'

const lines = readline.createInterface({ input: process.stdin })
lines.on('line', line => {
  const request = JSON.parse(line)
  if (request.method === 'runtime.hello') {
    console.log(JSON.stringify({
      protocolVersion: 1,
      id: request.id,
      ok: true,
          result: {
            name: 'mock-sidecar',
            capabilities: [
              'runtime.hello',
              'runtime.echo',
              'session.index',
              'session.index.incremental',
              'fs.glob',
              'fs.grep',
              'fs.validateWrite',
              'fs.write',
              'jarvis.queue.enqueue',
              'jarvis.queue.claim',
              'jarvis.queue.recover'
            ]
          }
        }))
        return
      }
  if (request.method === 'runtime.echo') {
    console.log(JSON.stringify({
      protocolVersion: 1,
      id: request.id,
      ok: true,
      result: request.params
    }))
    return
  }
  if (request.method === 'session.index') {
    console.log(JSON.stringify({
      protocolVersion: 1,
      id: request.id,
      ok: true,
      result: {
        source: 'mock',
        sessions: [],
        total: 0
      }
    }))
    return
  }
  if (request.method === 'session.index.incremental') {
    console.log(JSON.stringify({
      protocolVersion: 1,
      id: request.id,
      ok: true,
      result: {
        source: 'mock',
        sessions: [],
        total: 0,
        incremental: true
      }
    }))
    return
  }
  if (request.method === 'fs.glob') {
    console.log(JSON.stringify({
      protocolVersion: 1,
      id: request.id,
      ok: true,
      result: {
        source: 'mock',
        cwd: request.params?.cwd ?? '',
        files: [],
        total: 0,
        truncated: false
      }
    }))
    return
  }
  if (request.method === 'fs.grep') {
    console.log(JSON.stringify({
      protocolVersion: 1,
      id: request.id,
      ok: true,
      result: {
        source: 'mock',
        cwd: request.params?.cwd ?? '',
        matches: [],
        total: 0,
        truncated: false
      }
    }))
    return
  }
  if (request.method === 'fs.write') {
    if (request.params?.path === '../blocked.txt') {
      console.log(JSON.stringify({
        protocolVersion: 1,
        id: request.id,
        ok: false,
        error: {
          code: 'fs_write_failed',
          message: 'write target is outside the allowed root'
        }
      }))
      return
    }
    console.log(JSON.stringify({
      protocolVersion: 1,
      id: request.id,
      ok: true,
      result: {
        source: 'mock',
        path: request.params?.path ?? '',
        bytes: 2,
        validated: true
      }
    }))
    return
  }
  if (request.method === 'jarvis.queue.enqueue') {
    globalThis.__queueItem = request.params?.item
    console.log(JSON.stringify({
      protocolVersion: 1,
      id: request.id,
      ok: true,
      result: { source: 'mock', item: globalThis.__queueItem }
    }))
    return
  }
  if (request.method === 'jarvis.queue.claim') {
    const item = { ...globalThis.__queueItem, status: 'running' }
    console.log(JSON.stringify({
      protocolVersion: 1,
      id: request.id,
      ok: true,
      result: { source: 'mock', item }
    }))
    return
  }
  if (request.method === 'jarvis.queue.recover') {
    console.log(JSON.stringify({
      protocolVersion: 1,
      id: request.id,
      ok: true,
      result: { source: 'mock', recovered: 1 }
    }))
    return
  }
  console.log(JSON.stringify({
    protocolVersion: 1,
    id: request.id,
    ok: false,
    error: {
      code: 'method_not_found',
      message: 'missing method'
    }
  }))
})
`,
    'utf-8',
  )
  return scriptPath
}

describe('RustSidecarClient', () => {
  beforeEach(() => {
    tmpRoot = ''
  })

  afterEach(async () => {
    if (tmpRoot) {
      await rm(tmpRoot, { recursive: true, force: true })
    }
  })

  it('roundtrips requests over a newline-delimited sidecar process', async () => {
    const scriptPath = await createMockSidecar()
    const client = new RustSidecarClient({
      command: process.execPath,
      args: [scriptPath],
      timeoutMs: 2_000,
    })

    try {
      await expect(client.hello()).resolves.toEqual({
        name: 'mock-sidecar',
        capabilities: [
          'runtime.hello',
          'runtime.echo',
          'session.index',
          'session.index.incremental',
          'fs.glob',
          'fs.grep',
          'fs.validateWrite',
          'fs.write',
          'jarvis.queue.enqueue',
          'jarvis.queue.claim',
          'jarvis.queue.recover',
        ],
      })
      await expect(client.request('runtime.echo', { value: 42 })).resolves.toEqual(
        { value: 42 },
      )
    } finally {
      client.close()
    }
  })

  it('surfaces structured sidecar errors', async () => {
    const scriptPath = await createMockSidecar()
    const client = new RustSidecarClient({
      command: process.execPath,
      args: [scriptPath],
      timeoutMs: 2_000,
    })

    try {
      await expect(client.request('missing.method', {})).rejects.toBeInstanceOf(
        RustSidecarRequestError,
      )
    } finally {
      client.close()
    }
  })

  it('runs the reusable parity harness against a sidecar', async () => {
    const scriptPath = await createMockSidecar()

    const result = await runRustSidecarParityHarness({
      command: process.execPath,
      args: [scriptPath],
      timeoutMs: 2_000,
    })

    expect(result.ok).toBe(true)
    expect(result.scenarios.map(scenario => scenario.id)).toEqual([
      'sidecar_hello',
      'echo_roundtrip',
      'unknown_method_error',
      'session_index_smoke',
      'session_index_incremental_cache',
      'fs_glob_smoke',
      'fs_grep_smoke',
      'fs_write_boundary',
      'jarvis_queue_atomic_claim',
    ])
  })
})
