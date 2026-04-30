import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { RustSidecarClient } from './rustSidecarClient.js'
import { getRustSidecarLaunchConfig } from './rustSidecarProtocol.js'

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
  path: string
  content: string
  createDirs?: boolean
  overwrite?: boolean
}

export type RuntimeWriteFileResult = {
  source: 'rust' | 'typescript'
  path: string
  bytes: number
  fallbackReason?: string
}

export async function runtimeReadFile(
  options: RuntimeReadFileOptions,
): Promise<RuntimeReadFileResult> {
  const launch = getRustSidecarLaunchConfig()
  if (!launch) return readFileWithTypescript(options)

  const client = new RustSidecarClient({
    command: launch.command,
    args: launch.args,
    timeoutMs: 10_000,
  })
  try {
    return normalizeReadResult(await client.request('fs.read', options, 10_000))
  } catch (error) {
    return {
      ...(await readFileWithTypescript(options)),
      fallbackReason:
        error instanceof Error ? error.message : 'rust sidecar unavailable',
    }
  } finally {
    client.close()
  }
}

export async function runtimeWriteFile(
  options: RuntimeWriteFileOptions,
): Promise<RuntimeWriteFileResult> {
  const launch = getRustSidecarLaunchConfig()
  if (!launch) return writeFileWithTypescript(options)

  const client = new RustSidecarClient({
    command: launch.command,
    args: launch.args,
    timeoutMs: 10_000,
  })
  try {
    return normalizeWriteResult(await client.request('fs.write', options, 10_000))
  } catch (error) {
    return {
      ...(await writeFileWithTypescript(options)),
      fallbackReason:
        error instanceof Error ? error.message : 'rust sidecar unavailable',
    }
  } finally {
    client.close()
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
  const filePath = resolvePath(options)
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
  await fs.writeFile(filePath, options.content, 'utf-8')
  return {
    source: 'typescript',
    path: filePath,
    bytes: Buffer.byteLength(options.content),
  }
}

function resolvePath(options: { cwd?: string; path: string }): string {
  return path.resolve(options.cwd || process.cwd(), options.path)
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
    bytes: typeof value.bytes === 'number' ? value.bytes : 0,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
