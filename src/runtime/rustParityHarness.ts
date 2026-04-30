import {
  RustSidecarClient,
  RustSidecarRequestError,
  type RustSidecarClientOptions,
} from './rustSidecarClient.js'

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
    ])

    return {
      ok: scenarios.every(scenario => scenario.ok),
      scenarios,
    }
  } finally {
    client.close()
  }
}
