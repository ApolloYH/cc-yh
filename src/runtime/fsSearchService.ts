import {
  buildRuntimeGlob,
  buildRuntimeGrep,
  normalizeRuntimeGlobResult,
  normalizeRuntimeGrepResult,
  type RuntimeGlobOptions,
  type RuntimeGlobResult,
  type RuntimeGrepOptions,
  type RuntimeGrepResult,
} from './fsSearch.js'
import { RustSidecarClient } from './rustSidecarClient.js'
import { getRustSidecarLaunchConfig } from './rustSidecarProtocol.js'

export type RuntimeFsResult<T> = T & {
  fallbackReason?: string
}

export async function runtimeGlob(
  options: RuntimeGlobOptions,
): Promise<RuntimeFsResult<RuntimeGlobResult>> {
  const launch = getRustSidecarLaunchConfig()
  if (!launch) return buildRuntimeGlob(options)

  const client = new RustSidecarClient({
    command: launch.command,
    args: launch.args,
    timeoutMs: 10_000,
  })
  try {
    const result = await client.request('fs.glob', options, 10_000)
    return normalizeRuntimeGlobResult(result, 'rust')
  } catch (error) {
    return {
      ...(await buildRuntimeGlob(options)),
      fallbackReason:
        error instanceof Error ? error.message : 'rust sidecar unavailable',
    }
  } finally {
    client.close()
  }
}

export async function runtimeGrep(
  options: RuntimeGrepOptions,
): Promise<RuntimeFsResult<RuntimeGrepResult>> {
  const launch = getRustSidecarLaunchConfig()
  if (!launch) return buildRuntimeGrep(options)

  const client = new RustSidecarClient({
    command: launch.command,
    args: launch.args,
    timeoutMs: 10_000,
  })
  try {
    const result = await client.request('fs.grep', options, 10_000)
    return normalizeRuntimeGrepResult(result, 'rust')
  } catch (error) {
    return {
      ...(await buildRuntimeGrep(options)),
      fallbackReason:
        error instanceof Error ? error.message : 'rust sidecar unavailable',
    }
  } finally {
    client.close()
  }
}
