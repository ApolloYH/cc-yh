import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { getFsImplementation } from '../utils/fsOperations.js'
import { toRelativePath } from '../utils/path.js'
import { runtimeGrep } from './fsSearchService.js'

export type RuntimeGrepToolMode = 'content' | 'files_with_matches' | 'count'

export type RuntimeGrepToolOptions = {
  cwd: string
  pattern: string
  globPatterns?: string[]
  type?: string
  outputMode: RuntimeGrepToolMode
  beforeContext?: number
  afterContext?: number
  showLineNumbers?: boolean
  caseInsensitive?: boolean
  multiline?: boolean
  headLimit?: number
  offset?: number
  hidden?: boolean
  respectGitignore?: boolean
  excludeDefaultDirs?: boolean
  excludeGlobs?: string[]
  maxColumns?: number
}

export type RuntimeGrepToolOutput = {
  mode: RuntimeGrepToolMode
  numFiles: number
  filenames: string[]
  content?: string
  numLines?: number
  numMatches?: number
  appliedLimit?: number
  appliedOffset?: number
}

const DEFAULT_HEAD_LIMIT = 250

export async function buildRuntimeGrepToolOutput(
  options: RuntimeGrepToolOptions,
): Promise<RuntimeGrepToolOutput> {
  const result = await runtimeGrep({
    cwd: options.cwd,
    pattern: options.pattern,
    globs: options.globPatterns,
    type: options.type,
    caseInsensitive: options.caseInsensitive,
    multiline: options.multiline,
    limit: 0,
    hidden: options.hidden,
    respectGitignore: options.respectGitignore,
    excludeDefaultDirs: options.excludeDefaultDirs,
    excludeGlobs: options.excludeGlobs,
    maxColumns: options.maxColumns,
  })

  if (options.outputMode === 'content') {
    return buildContentOutput(result.matches, options)
  }
  if (options.outputMode === 'count') {
    return buildCountOutput(result.matches, options)
  }
  return buildFilesOutput(result.matches.map(match => match.filePath), options)
}

async function buildFilesOutput(
  filePaths: string[],
  options: RuntimeGrepToolOptions,
): Promise<RuntimeGrepToolOutput> {
  const uniqueFiles = Array.from(new Set(filePaths))
  const sortedFiles = await sortFilesForGrepTool(uniqueFiles)
  const { items, appliedLimit } = applyHeadLimit(
    sortedFiles,
    options.headLimit,
    options.offset,
  )
  const filenames = items.map(toRelativePath)
  return {
    mode: 'files_with_matches',
    filenames,
    numFiles: filenames.length,
    ...(appliedLimit !== undefined && { appliedLimit }),
    ...((options.offset ?? 0) > 0 && { appliedOffset: options.offset }),
  }
}

async function sortFilesForGrepTool(files: string[]): Promise<string[]> {
  if (process.env.NODE_ENV === 'test') {
    return [...files].sort((a, b) => a.localeCompare(b))
  }

  const stats = await Promise.allSettled(
    files.map(file => getFsImplementation().stat(file)),
  )
  return files
    .map((file, index) => {
      const result = stats[index]!
      return [
        file,
        result.status === 'fulfilled' ? (result.value.mtimeMs ?? 0) : 0,
      ] as const
    })
    .sort((a, b) => {
      const timeComparison = b[1] - a[1]
      return timeComparison || a[0].localeCompare(b[0])
    })
    .map(([file]) => file)
}

function buildCountOutput(
  matches: Array<{ filePath: string; lineNumber?: number; matchId?: string }>,
  options: RuntimeGrepToolOptions,
): RuntimeGrepToolOutput {
  const counts = new Map<string, number>()
  const seen = new Set<string>()
  for (const match of matches) {
    const key = match.matchId ?? `${match.filePath}:${match.lineNumber ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    counts.set(match.filePath, (counts.get(match.filePath) ?? 0) + 1)
  }
  const countLines = Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([filePath, count]) => `${toRelativePath(filePath)}:${count}`)
  const { items, appliedLimit } = applyHeadLimit(
    countLines,
    options.headLimit,
    options.offset,
  )

  let totalMatches = 0
  for (const line of items) {
    const count = Number.parseInt(line.slice(line.lastIndexOf(':') + 1), 10)
    if (!Number.isNaN(count)) totalMatches += count
  }

  return {
    mode: 'count',
    numFiles: items.length,
    filenames: [],
    content: items.join('\n'),
    numMatches: totalMatches,
    ...(appliedLimit !== undefined && { appliedLimit }),
    ...((options.offset ?? 0) > 0 && { appliedOffset: options.offset }),
  }
}

async function buildContentOutput(
  matches: Array<{ filePath: string; lineNumber: number }>,
  options: RuntimeGrepToolOptions,
): Promise<RuntimeGrepToolOutput> {
  const byFile = new Map<string, Set<number>>()
  for (const match of matches) {
    const lines = byFile.get(match.filePath) ?? new Set<number>()
    lines.add(match.lineNumber)
    byFile.set(match.filePath, lines)
  }

  const rendered: string[] = []
  let needsSeparator = false
  for (const [filePath, matchLines] of Array.from(byFile.entries()).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    const lines = await readTextLines(filePath)
    if (!lines) continue

    const ranges = mergeContextRanges(
      Array.from(matchLines).sort((a, b) => a - b),
      lines.length,
      options.beforeContext ?? 0,
      options.afterContext ?? 0,
    )
    for (const range of ranges) {
      if (needsSeparator) rendered.push('--')
      needsSeparator = true
      for (let lineNumber = range.start; lineNumber <= range.end; lineNumber += 1) {
        const line = lines[lineNumber - 1] ?? ''
        const isMatch = matchLines.has(lineNumber)
        rendered.push(formatContentLine(
          filePath,
          lineNumber,
          line,
          isMatch,
          options.showLineNumbers !== false,
        ))
      }
    }
  }

  const { items, appliedLimit } = applyHeadLimit(
    rendered,
    options.headLimit,
    options.offset,
  )
  return {
    mode: 'content',
    numFiles: 0,
    filenames: [],
    content: items.join('\n'),
    numLines: items.length,
    ...(appliedLimit !== undefined && { appliedLimit }),
    ...((options.offset ?? 0) > 0 && { appliedOffset: options.offset }),
  }
}

async function readTextLines(filePath: string): Promise<string[] | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    if (content.includes('\u0000')) return null
    return content.split(/\r?\n/)
  } catch {
    return null
  }
}

function mergeContextRanges(
  matchLines: number[],
  lineCount: number,
  beforeContext: number,
  afterContext: number,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  for (const line of matchLines) {
    const start = Math.max(1, line - beforeContext)
    const end = Math.min(lineCount, line + afterContext)
    const previous = ranges[ranges.length - 1]
    if (previous && start <= previous.end + 1) {
      previous.end = Math.max(previous.end, end)
    } else {
      ranges.push({ start, end })
    }
  }
  return ranges
}

function formatContentLine(
  filePath: string,
  lineNumber: number,
  line: string,
  isMatch: boolean,
  showLineNumbers: boolean,
): string {
  const relative = toRelativePath(filePath)
  if (!showLineNumbers) return `${relative}:${line}`
  const separator = isMatch ? ':' : '-'
  return `${relative}${separator}${lineNumber}${separator}${line}`
}

function applyHeadLimit<T>(
  items: T[],
  limit: number | undefined,
  offset: number = 0,
): { items: T[]; appliedLimit: number | undefined } {
  if (limit === 0) {
    return { items: items.slice(offset), appliedLimit: undefined }
  }
  const effectiveLimit = limit ?? DEFAULT_HEAD_LIMIT
  const sliced = items.slice(offset, offset + effectiveLimit)
  return {
    items: sliced,
    appliedLimit: items.length - offset > effectiveLimit
      ? effectiveLimit
      : undefined,
  }
}

export function splitGrepGlobPatterns(glob: string | undefined): string[] {
  if (!glob) return []
  const patterns: string[] = []
  for (const rawPattern of glob.split(/\s+/)) {
    if (rawPattern.includes('{') && rawPattern.includes('}')) {
      patterns.push(rawPattern)
    } else {
      patterns.push(...rawPattern.split(',').filter(Boolean))
    }
  }
  return patterns.filter(Boolean)
}

export function normalizeRuntimeGrepExcludeGlob(pattern: string): string {
  const normalized = pattern.replace(/^!/, '').replace(/\\/g, '/')
  return normalized.startsWith('/') ? normalized.slice(1) : normalized
}
