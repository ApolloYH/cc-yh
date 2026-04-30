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
  hidden?: boolean
  respectGitignore?: boolean
  excludeDefaultDirs?: boolean
  excludeGlobs?: string[]
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
  globs?: string[]
  type?: string
  caseInsensitive?: boolean
  multiline?: boolean
  limit?: number
  offset?: number
  hidden?: boolean
  respectGitignore?: boolean
  excludeDefaultDirs?: boolean
  excludeGlobs?: string[]
  maxColumns?: number
}

export type RuntimeGrepMatch = {
  filePath: string
  lineNumber: number
  line: string
  matchId?: string
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
  const files = await listSearchableFiles(cwd, options)
  const matched = files
    .filter(file => matcher(toSlash(path.relative(cwd, file))))
    .sort((a, b) => a.localeCompare(b))
  const selected = limit === 0
    ? matched.slice(offset)
    : matched.slice(offset, offset + limit)

  return {
    source: 'typescript',
    cwd,
    files: selected,
    total: matched.length,
    truncated: limit !== 0 && matched.length > offset + limit,
  }
}

export async function buildRuntimeGrep(
  options: RuntimeGrepOptions,
): Promise<RuntimeGrepResult> {
  const cwd = await canonicalCwd(options.cwd)
  const limit = options.limit ?? 100
  const offset = options.offset ?? 0
  const globPatterns = [
    ...(options.glob ? [options.glob] : []),
    ...(options.globs ?? []),
    ...typeGlobPatterns(options.type),
  ]
  const matchers = globPatterns.length
    ? globPatterns.map(pattern => picomatch(pattern, { dot: true }))
    : []
  const regex = new RegExp(
    options.pattern,
    `${options.caseInsensitive ? 'i' : ''}${options.multiline ? 'gs' : ''}`,
  )
  const files = await listSearchableFiles(cwd, options)
  const matches: RuntimeGrepMatch[] = []

  for (const file of files) {
    const rel = toSlash(path.relative(cwd, file))
    if (matchers.length && !matchers.some(matcher => matcher(rel))) continue

    let content: string
    try {
      content = await fs.readFile(file, 'utf-8')
    } catch {
      continue
    }
    if (content.includes('\u0000')) continue

    const lines = content.split(/\r?\n/)
    if (options.multiline) {
      for (const range of multilineMatchRanges(content, regex)) {
        for (let lineNumber = range.startLine; lineNumber <= range.endLine; lineNumber += 1) {
          const line = lines[lineNumber - 1] ?? ''
          if (options.maxColumns && line.length > options.maxColumns) continue
          matches.push({
            filePath: file,
            lineNumber,
            line,
            matchId: `${file}:${range.matchIndex}`,
          })
        }
      }
      continue
    }
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index] ?? ''
      regex.lastIndex = 0
      if (options.maxColumns && line.length > options.maxColumns) continue
      if (regex.test(line)) {
        matches.push({
          filePath: file,
          lineNumber: index + 1,
          line,
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
    matches: limit === 0
      ? matches.slice(offset)
      : matches.slice(offset, offset + limit),
    total: matches.length,
    truncated: limit !== 0 && matches.length > offset + limit,
  }
}

function multilineMatchRanges(content: string, regex: RegExp) {
  const lineStarts = [0]
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\n') lineStarts.push(index + 1)
  }
  const ranges: Array<{ startLine: number; endLine: number; matchIndex: number }> = []
  let matchIndex = 0
  regex.lastIndex = 0
  for (const match of content.matchAll(regex)) {
    const start = match.index ?? 0
    const end = Math.max(start, start + (match[0]?.length ?? 0) - 1)
    ranges.push({
      startLine: offsetToLineNumber(lineStarts, start),
      endLine: offsetToLineNumber(lineStarts, end),
      matchIndex,
    })
    matchIndex += 1
  }
  return ranges
}

function offsetToLineNumber(lineStarts: number[], offset: number): number {
  let low = 0
  let high = lineStarts.length - 1
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (lineStarts[mid]! <= offset) low = mid + 1
    else high = mid - 1
  }
  return Math.max(1, high + 1)
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

type SearchWalkOptions = Pick<
  RuntimeGlobOptions,
  'hidden' | 'respectGitignore' | 'excludeDefaultDirs' | 'excludeGlobs'
>

async function listSearchableFiles(
  root: string,
  options: SearchWalkOptions = {},
): Promise<string[]> {
  const includeHidden = options.hidden ?? true
  const respectGitignore = options.respectGitignore ?? true
  const excludeDefaultDirs = options.excludeDefaultDirs ?? true
  const ignored = respectGitignore ? await loadRootGitignore(root) : ignore()
  const excludeMatchers = buildExcludeMatchers(options.excludeGlobs)
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
      if (!includeHidden && isHiddenPath(rel)) continue
      if (matchesExcludeGlob(excludeMatchers, rel, entry.isDirectory())) continue
      if (entry.isDirectory()) {
        if (
          (excludeDefaultDirs && DEFAULT_EXCLUDED_DIRS.has(entry.name)) ||
          ignored.ignores(`${rel}/`)
        ) {
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

function buildExcludeMatchers(patterns: string[] | undefined) {
  return (patterns ?? [])
    .map(pattern => pattern.trim())
    .filter(Boolean)
    .map(pattern => pattern.startsWith('!') ? pattern.slice(1) : pattern)
    .map(pattern => picomatch(pattern, { dot: true }))
}

function matchesExcludeGlob(
  matchers: Array<(value: string) => boolean>,
  rel: string,
  isDirectory: boolean,
): boolean {
  if (matchers.length === 0) return false
  const dirRel = isDirectory && !rel.endsWith('/') ? `${rel}/` : rel
  return matchers.some(matcher => matcher(rel) || matcher(dirRel))
}

function isHiddenPath(rel: string): boolean {
  return rel.split('/').some(part => part.startsWith('.') && part !== '.')
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
    ...(typeof input.matchId === 'string' && { matchId: input.matchId }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toSlash(value: string): string {
  return value.replace(/\\/g, '/')
}

export function typeGlobPatterns(type: string | undefined): string[] {
  if (!type) return []
  const normalized = type.toLowerCase().replace(/^\./, '')
  const mapped: Record<string, string[]> = {
    js: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    javascript: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    jsx: ['**/*.jsx'],
    ts: ['**/*.ts', '**/*.mts', '**/*.cts'],
    typescript: ['**/*.ts', '**/*.mts', '**/*.cts'],
    tsx: ['**/*.tsx'],
    py: ['**/*.py', '**/*.pyw'],
    python: ['**/*.py', '**/*.pyw'],
    rs: ['**/*.rs'],
    rust: ['**/*.rs'],
    go: ['**/*.go'],
    java: ['**/*.java'],
    c: ['**/*.c', '**/*.h'],
    cpp: ['**/*.cpp', '**/*.cc', '**/*.cxx', '**/*.hpp', '**/*.hh', '**/*.hxx'],
    md: ['**/*.md', '**/*.mdx'],
    markdown: ['**/*.md', '**/*.mdx'],
    json: ['**/*.json', '**/*.jsonc', '**/*.json5'],
    yaml: ['**/*.yaml', '**/*.yml'],
    yml: ['**/*.yaml', '**/*.yml'],
    toml: ['**/*.toml'],
    html: ['**/*.html', '**/*.htm'],
    css: ['**/*.css'],
    scss: ['**/*.scss'],
    sh: ['**/*.sh', '**/*.bash', '**/*.zsh'],
    bash: ['**/*.sh', '**/*.bash'],
    ps1: ['**/*.ps1'],
    powershell: ['**/*.ps1', '**/*.psm1', '**/*.psd1'],
    xml: ['**/*.xml'],
    sql: ['**/*.sql'],
    rb: ['**/*.rb'],
    ruby: ['**/*.rb'],
    php: ['**/*.php'],
  }
  return mapped[normalized] ?? [`**/*.${normalized}`]
}
