import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import ignore from 'ignore'
import picomatch from 'picomatch'

const DEFAULT_EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'dist', 'target'])

export type RuntimeGlobOptions = {
  cwd: string
  pattern: string
  limit?: number
  offset?: number
}

export type RuntimeGlobResult = {
  source: 'typescript' | 'rust'
  cwd: string
  files: string[]
  total: number
  truncated: boolean
}

export type RuntimeGrepOptions = {
  cwd: string
  pattern: string
  glob?: string
  caseInsensitive?: boolean
  limit?: number
  offset?: number
}

export type RuntimeGrepMatch = {
  filePath: string
  lineNumber: number
  line: string
}

export type RuntimeGrepResult = {
  source: 'typescript' | 'rust'
  cwd: string
  matches: RuntimeGrepMatch[]
  total: number
  truncated: boolean
}

export async function buildRuntimeGlob(
  options: RuntimeGlobOptions,
): Promise<RuntimeGlobResult> {
  const cwd = await canonicalCwd(options.cwd)
  const limit = options.limit ?? 100
  const offset = options.offset ?? 0
  const matcher = picomatch(options.pattern, { dot: true })
  const files = await listSearchableFiles(cwd)
  const matched = files
    .filter(file => matcher(toSlash(path.relative(cwd, file))))
    .sort((a, b) => a.localeCompare(b))
  const selected = matched.slice(offset, offset + limit)

  return {
    source: 'typescript',
    cwd,
    files: selected,
    total: matched.length,
    truncated: matched.length > offset + limit,
  }
}

export async function buildRuntimeGrep(
  options: RuntimeGrepOptions,
): Promise<RuntimeGrepResult> {
  const cwd = await canonicalCwd(options.cwd)
  const limit = options.limit ?? 100
  const offset = options.offset ?? 0
  const matcher = options.glob
    ? picomatch(options.glob, { dot: true })
    : null
  const regex = new RegExp(options.pattern, options.caseInsensitive ? 'i' : '')
  const files = await listSearchableFiles(cwd)
  const matches: RuntimeGrepMatch[] = []

  for (const file of files) {
    const rel = toSlash(path.relative(cwd, file))
    if (matcher && !matcher(rel)) continue

    let content: string
    try {
      content = await fs.readFile(file, 'utf-8')
    } catch {
      continue
    }
    if (content.includes('\u0000')) continue

    const lines = content.split(/\r?\n/)
    for (let index = 0; index < lines.length; index++) {
      if (regex.test(lines[index] ?? '')) {
        matches.push({
          filePath: file,
          lineNumber: index + 1,
          line: lines[index] ?? '',
        })
      }
    }
  }

  matches.sort((a, b) => {
    const pathCompare = a.filePath.localeCompare(b.filePath)
    return pathCompare || a.lineNumber - b.lineNumber
  })

  return {
    source: 'typescript',
    cwd,
    matches: matches.slice(offset, offset + limit),
    total: matches.length,
    truncated: matches.length > offset + limit,
  }
}

export function normalizeRuntimeGlobResult(
  input: unknown,
  source: RuntimeGlobResult['source'],
): RuntimeGlobResult {
  if (!isRecord(input)) throw new Error('fs.glob result must be an object')
  const files = Array.isArray(input.files)
    ? input.files.filter((file): file is string => typeof file === 'string')
    : []
  const total = typeof input.total === 'number' ? input.total : files.length
  return {
    source,
    cwd: typeof input.cwd === 'string' ? input.cwd : '',
    files,
    total,
    truncated: Boolean(input.truncated),
  }
}

export function normalizeRuntimeGrepResult(
  input: unknown,
  source: RuntimeGrepResult['source'],
): RuntimeGrepResult {
  if (!isRecord(input)) throw new Error('fs.grep result must be an object')
  const matches = Array.isArray(input.matches)
    ? input.matches.map(normalizeRuntimeGrepMatch).filter(Boolean)
    : []
  const total = typeof input.total === 'number' ? input.total : matches.length
  return {
    source,
    cwd: typeof input.cwd === 'string' ? input.cwd : '',
    matches,
    total,
    truncated: Boolean(input.truncated),
  }
}

async function canonicalCwd(cwd: string): Promise<string> {
  return fs.realpath(path.resolve(cwd))
}

async function listSearchableFiles(root: string): Promise<string[]> {
  const ignored = await loadRootGitignore(root)
  const files: string[] = []

  async function walk(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      const rel = toSlash(path.relative(root, fullPath))
      if (entry.isDirectory()) {
        if (DEFAULT_EXCLUDED_DIRS.has(entry.name) || ignored.ignores(`${rel}/`)) {
          continue
        }
        await walk(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      if (ignored.ignores(rel)) continue
      files.push(fullPath)
    }
  }

  await walk(root)
  files.sort((a, b) => a.localeCompare(b))
  return files
}

async function loadRootGitignore(root: string) {
  const ig = ignore()
  try {
    const content = await fs.readFile(path.join(root, '.gitignore'), 'utf-8')
    ig.add(content)
  } catch {
    // Missing or unreadable .gitignore means no project ignore patterns.
  }
  return ig
}

function normalizeRuntimeGrepMatch(input: unknown): RuntimeGrepMatch | null {
  if (!isRecord(input)) return null
  if (
    typeof input.filePath !== 'string' ||
    typeof input.lineNumber !== 'number' ||
    typeof input.line !== 'string'
  ) {
    return null
  }
  return {
    filePath: input.filePath,
    lineNumber: input.lineNumber,
    line: input.line,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toSlash(value: string): string {
  return value.replace(/\\/g, '/')
}
