import {
  buildSessionIndex,
  normalizeSessionIndexResult,
  type BuildSessionIndexOptions,
  type SessionIndexResult,
} from './sessionIndex.js'
import { logDiagnosticEvent } from '../utils/diagnosticLog.js'
import { tryRustSidecarRequest } from './rustSidecarService.js'

export type SessionIndexServiceResult = SessionIndexResult & {
  fallbackReason?: string
}

export async function getSessionIndex(
  options: BuildSessionIndexOptions = {},
): Promise<SessionIndexServiceResult> {
  const rust = await tryRustSidecarRequest('session.index.incremental', options, {
    component: 'runtime.session.index',
  })
  if (rust.ok) {
    const normalized = normalizeSessionIndexResult(rust.result, 'rust')
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
  }
  const fallback = await buildSessionIndex(options)
  logDiagnosticEvent({
    scope: 'runtime.session',
    event: 'fallback',
    ok: true,
    data: {
      reason: rust.reason,
      total: fallback.total,
      query: options.query,
      project: options.project,
    },
  })
  return {
    ...fallback,
    fallbackReason: rust.reason,
  }
}
