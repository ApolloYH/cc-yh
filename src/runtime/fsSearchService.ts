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
import { logDiagnosticEvent } from '../utils/diagnosticLog.js'
import { tryRustSidecarRequest } from './rustSidecarService.js'

export type RuntimeFsResult<T> = T & {
  fallbackReason?: string
}

export async function runtimeGlob(
  options: RuntimeGlobOptions,
): Promise<RuntimeFsResult<RuntimeGlobResult>> {
  const rust = await tryRustSidecarRequest('fs.glob', options, {
    component: 'runtime.fs.glob',
  })
  if (rust.ok) return normalizeRuntimeGlobResult(rust.result, 'rust')
  const fallback = await buildRuntimeGlob(options)
  logDiagnosticEvent({
    scope: 'runtime.fs',
    event: 'fallback',
    ok: true,
    data: {
      operation: 'glob',
      reason: rust.reason,
      cwd: options.cwd,
      pattern: options.pattern,
      fileCount: fallback.files.length,
      truncated: fallback.truncated,
      source: fallback.source,
    },
  })
  return {
    ...fallback,
    fallbackReason: rust.reason,
  }
}

export async function runtimeGrep(
  options: RuntimeGrepOptions,
): Promise<RuntimeFsResult<RuntimeGrepResult>> {
  const rust = await tryRustSidecarRequest('fs.grep', options, {
    component: 'runtime.fs.grep',
  })
  if (rust.ok) return normalizeRuntimeGrepResult(rust.result, 'rust')
  const fallback = await buildRuntimeGrep(options)
  logDiagnosticEvent({
    scope: 'runtime.fs',
    event: 'fallback',
    ok: true,
    data: {
      operation: 'grep',
      reason: rust.reason,
      cwd: options.cwd,
      pattern: options.pattern,
      matchCount: fallback.matches.length,
      truncated: fallback.truncated,
      source: fallback.source,
    },
  })
  return {
    ...fallback,
    fallbackReason: rust.reason,
  }
}
