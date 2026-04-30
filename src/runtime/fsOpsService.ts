import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { logDiagnosticEvent } from '../utils/diagnosticLog.js'
import { tryRustSidecarRequest } from './rustSidecarService.js'

export type RuntimeReadFileOptions = {
  cwd?: string
  path: string
  maxBytes?: number
}

export type RuntimeReadFileResult = {
  source: 'rust' | 'typescript'
  path: string
  content: string
  bytes: number
  truncated: boolean
  fallbackReason?: string
}

export type RuntimeWriteFileOptions = {
  cwd?: string
  root?: string
  path: string
  content: string
  createDirs?: boolean
  overwrite?: boolean
  allowOutsideRoot?: boolean
  atomic?: boolean
}

export type RuntimeWriteFileResult = {
  source: 'rust' | 'typescript'
  path: string
  root?: string
  bytes: number
  validated?: boolean
  atomic?: boolean
  fallbackReason?: string
}

export async function runtimeReadFile(
  options: RuntimeReadFileOptions,
): Promise<RuntimeReadFileResult> {
  const rust = await tryRustSidecarRequest('fs.read', options, {
    component: 'runtime.fs.read',
  })
  if (rust.ok) return normalizeReadResult(rust.result)
  const fallback = await readFileWithTypescript(options)
  logDiagnosticEvent({
    scope: 'runtime.fs',
    event: 'fallback',
    ok: true,
    data: {
      operation: 'read',
      reason: rust.reason,
      path: options.path,
      source: fallback.source,
    },
  })
  return {
    ...fallback,
    fallbackReason: rust.reason,
  }
}

export async function runtimeWriteFile(
  options: RuntimeWriteFileOptions,
): Promise<RuntimeWriteFileResult> {
  const rust = await tryRustSidecarRequest('fs.write', options, {
    component: 'runtime.fs.write',
    logSuccess: true,
  })
  if (rust.ok) return normalizeWriteResult(rust.result)
  const fallback = await writeFileWithTypescript(options)
  logDiagnosticEvent({
    scope: 'runtime.fs',
    event: 'fallback',
    ok: true,
    data: {
      operation: 'write',
      reason: rust.reason,
      path: options.path,
      root: options.root,
      source: fallback.source,
      atomic: fallback.atomic,
    },
  })
  return {
    ...fallback,
    fallbackReason: rust.reason,
  }
}

async function readFileWithTypescript(
  options: RuntimeReadFileOptions,
): Promise<RuntimeReadFileResult> {
  const filePath = resolvePath(options)
  const content = await fs.readFile(filePath)
  const maxBytes = options.maxBytes ?? 1024 * 1024
  const selected = content.subarray(0, maxBytes)
  return {
    source: 'typescript',
    path: filePath,
    content: selected.toString('utf-8'),
    bytes: content.byteLength,
    truncated: content.byteLength > maxBytes,
  }
}

async function writeFileWithTypescript(
  options: RuntimeWriteFileOptions,
): Promise<RuntimeWriteFileResult> {
  const { filePath, root } = await validateWritePathWithTypescript(options)
  if (options.overwrite !== true) {
    await fs.access(filePath).then(
      () => {
        throw new Error('target file already exists and overwrite=false')
      },
      () => {},
    )
  }
  if (options.createDirs !== false) {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
  }
  if (options.atomic === false) {
    await fs.writeFile(filePath, options.content, 'utf-8')
  } else {
    const tempPath = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
    )
    await fs.writeFile(tempPath, options.content, 'utf-8')
    await fs.rename(tempPath, filePath)
  }
  return {
    source: 'typescript',
    path: filePath,
    root,
    bytes: Buffer.byteLength(options.content),
    validated: true,
    atomic: options.atomic !== false,
  }
}

function resolvePath(options: { cwd?: string; path: string }): string {
  return path.resolve(options.cwd || process.cwd(), options.path)
}

async function validateWritePathWithTypescript(
  options: RuntimeWriteFileOptions,
): Promise<{ filePath: string; root?: string }> {
  rejectSuspiciousWritePath(options.path)
  const filePath = resolvePath(options)
  const root = path.resolve(options.cwd || process.cwd(), options.root || options.cwd || process.cwd())
  if (options.allowOutsideRoot === true) {
    return { filePath, root }
  }
  const realRoot = await fs.realpath(root)
  const parent = await firstExistingAncestor(path.dirname(filePath))
  const realParent = await fs.realpath(parent)
  const relative = path.relative(realRoot, realParent)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('write target is outside the allowed root')
  }
  return { filePath, root: realRoot }
}

async function firstExistingAncestor(filePath: string): Promise<string> {
  let current = filePath
  while (current && current !== path.dirname(current)) {
    try {
      await fs.access(current)
      return current
    } catch {
      current = path.dirname(current)
    }
  }
  return current
}

function rejectSuspiciousWritePath(value: string): void {
  const normalized = value.trim().replaceAll('\\', '/')
  if (normalized.startsWith('//')) {
    throw new Error('UNC/provider paths are not allowed for runtime writes')
  }
  if (normalized.includes('::')) {
    throw new Error('provider-qualified paths are not allowed for runtime writes')
  }
  const colon = value.indexOf(':')
  if (colon > 0 && !(colon === 1 && /^[A-Za-z]$/.test(value[0] ?? ''))) {
    throw new Error('URI-like paths are not allowed for runtime writes')
  }
}

function normalizeReadResult(value: unknown): RuntimeReadFileResult {
  if (!isRecord(value)) throw new Error('fs.read result must be an object')
  return {
    source: value.source === 'rust' ? 'rust' : 'typescript',
    path: String(value.path ?? ''),
    content: String(value.content ?? ''),
    bytes: typeof value.bytes === 'number' ? value.bytes : 0,
    truncated: value.truncated === true,
  }
}

function normalizeWriteResult(value: unknown): RuntimeWriteFileResult {
  if (!isRecord(value)) throw new Error('fs.write result must be an object')
  return {
    source: value.source === 'rust' ? 'rust' : 'typescript',
    path: String(value.path ?? ''),
    root: typeof value.root === 'string' ? value.root : undefined,
    bytes: typeof value.bytes === 'number' ? value.bytes : 0,
    validated: value.validated === true,
    atomic: value.atomic === true,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
