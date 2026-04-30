import {
  buildSessionIndex,
  normalizeSessionIndexResult,
  type BuildSessionIndexOptions,
  type SessionIndexResult,
} from './sessionIndex.js'
import { RustSidecarClient } from './rustSidecarClient.js'
import { getRustSidecarLaunchConfig } from './rustSidecarProtocol.js'

export type SessionIndexServiceResult = SessionIndexResult & {
  fallbackReason?: string
}

export async function getSessionIndex(
  options: BuildSessionIndexOptions = {},
): Promise<SessionIndexServiceResult> {
  const launch = getRustSidecarLaunchConfig()
  if (!launch) {
    return buildSessionIndex(options)
  }

  const client = new RustSidecarClient({
    command: launch.command,
    args: launch.args,
    timeoutMs: 10_000,
  })
  try {
    const result = await client.request('session.index.incremental', options, 10_000)
    const normalized = normalizeSessionIndexResult(result, 'rust')
    return options.query
      ? {
          ...normalized,
          sessions: normalized.sessions.filter(session =>
            [
              session.id,
              session.title,
              session.projectPath,
              session.filePath,
            ].some(value =>
              value.toLowerCase().includes(options.query!.trim().toLowerCase()),
            ),
          ),
        }
      : normalized
  } catch (error) {
    const fallback = await buildSessionIndex(options)
    return {
      ...fallback,
      fallbackReason:
        error instanceof Error ? error.message : 'rust sidecar unavailable',
    }
  } finally {
    client.close()
  }
}
