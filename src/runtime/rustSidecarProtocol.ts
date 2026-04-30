import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const RUST_SIDECAR_PROTOCOL_VERSION = 1

export type RustSidecarMethod =
  | 'runtime.hello'
  | 'runtime.echo'
  | 'session.index'
  | 'session.index.incremental'
  | 'fs.glob'
  | 'fs.grep'
  | 'fs.read'
  | 'fs.validateWrite'
  | 'fs.write'
  | 'shell.classify'
  | 'jarvis.queue.enqueue'
  | 'jarvis.queue.claim'
  | 'jarvis.queue.update'
  | 'jarvis.queue.delete'
  | 'jarvis.queue.recover'
  | 'parity.manifest'
  | (string & {})

export type RustSidecarRequest = {
  protocolVersion: typeof RUST_SIDECAR_PROTOCOL_VERSION
  id: string
  method: RustSidecarMethod
  params?: unknown
}

export type RustSidecarError = {
  code: string
  message: string
  details?: unknown
}

export type RustSidecarSuccess = {
  protocolVersion: typeof RUST_SIDECAR_PROTOCOL_VERSION
  id: string
  ok: true
  result: unknown
}

export type RustSidecarFailure = {
  protocolVersion: typeof RUST_SIDECAR_PROTOCOL_VERSION
  id: string
  ok: false
  error: RustSidecarError
}

export type RustSidecarResponse = RustSidecarSuccess | RustSidecarFailure

export type RustSidecarLaunchConfig = {
  command: string
  args: string[]
}

const SIDECAR_BASENAME =
  process.platform === 'win32'
    ? 'claude-yh-runtime-sidecar.exe'
    : 'claude-yh-runtime-sidecar'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRustSidecarError(value: unknown): value is RustSidecarError {
  return (
    isRecord(value) &&
    typeof value.code === 'string' &&
    typeof value.message === 'string'
  )
}

export function createRustSidecarRequest(
  id: string,
  method: RustSidecarMethod,
  params?: unknown,
): RustSidecarRequest {
  return {
    protocolVersion: RUST_SIDECAR_PROTOCOL_VERSION,
    id,
    method,
    ...(params === undefined ? {} : { params }),
  }
}

export function parseRustSidecarResponse(raw: string): RustSidecarResponse {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Rust sidecar response was not valid JSON')
  }

  if (!isRecord(parsed)) {
    throw new Error('Rust sidecar response must be an object')
  }
  if (parsed.protocolVersion !== RUST_SIDECAR_PROTOCOL_VERSION) {
    throw new Error('Rust sidecar response used an unsupported protocol')
  }
  if (typeof parsed.id !== 'string' || parsed.id.length === 0) {
    throw new Error('Rust sidecar response must include a string id')
  }
  if (parsed.ok === true) {
    return {
      protocolVersion: RUST_SIDECAR_PROTOCOL_VERSION,
      id: parsed.id,
      ok: true,
      result: parsed.result,
    }
  }
  if (parsed.ok === false && isRustSidecarError(parsed.error)) {
    return {
      protocolVersion: RUST_SIDECAR_PROTOCOL_VERSION,
      id: parsed.id,
      ok: false,
      error: parsed.error,
    }
  }
  throw new Error('Rust sidecar response must be either success or failure')
}

export function encodeRustSidecarRequest(request: RustSidecarRequest): string {
  return `${JSON.stringify(request)}\n`
}

export function getRustSidecarLaunchConfig(
  env: NodeJS.ProcessEnv = process.env,
  searchRoots = defaultRustSidecarSearchRoots(),
): RustSidecarLaunchConfig | null {
  const command = env.CLAUDE_YH_RUST_SIDECAR_PATH?.trim()
  if (command) return { command, args: [] }

  if (env.CLAUDE_YH_DISABLE_RUST_SIDECAR === '1') return null

  for (const root of searchRoots) {
    const found = findRustSidecarUnder(root)
    if (found) return { command: found, args: [] }
  }
  return null
}

function defaultRustSidecarSearchRoots(): string[] {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const packageRoot = resolve(moduleDir, '..', '..')
  return Array.from(new Set([process.cwd(), packageRoot]))
}

function findRustSidecarUnder(root: string): string | null {
  const candidates = [
    join(root, 'native', `${process.platform}-${process.arch}`, SIDECAR_BASENAME),
    join(root, 'bin', 'native', `${process.platform}-${process.arch}`, SIDECAR_BASENAME),
    join(root, 'rust', 'target', 'release', SIDECAR_BASENAME),
    join(root, 'rust', 'target', 'debug', SIDECAR_BASENAME),
  ]
  return candidates.find(candidate => existsSync(candidate)) ?? null
}
