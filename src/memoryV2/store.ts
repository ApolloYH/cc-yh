import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { getSessionIndex } from '../runtime/sessionIndexService.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import type {
  MemoryLayer,
  MemoryV2DistillCandidate,
  MemoryV2Entry,
  MemoryV2LayerStatus,
  MemoryV2SearchResult,
  MemoryV2StaleStatus,
  MemoryV2Status,
  MemoryV2WriteInput,
} from './types.js'

const VECTOR_METHOD = 'local-token-vector' as const

export function getMemoryV2Paths(configDir = getClaudeConfigHomeDir()) {
  const root = path.join(configDir, 'memory')
  return {
    root,
    indexPath: path.join(root, 'index.md'),
    factsDir: path.join(root, 'facts'),
    sopsDir: path.join(root, 'sops'),
    sessionsDir: path.join(configDir, 'projects'),
    summariesDir: path.join(root, 'sessions'),
    vectorIndexPath: path.join(root, 'vectors.json'),
    candidatePath: path.join(root, 'distill-candidates.json'),
  }
}

export async function getMemoryV2Status(): Promise<MemoryV2Status> {
  const paths = getMemoryV2Paths()
  await ensureMemoryV2Dirs(paths)
  const l1 = await readIndexEntry(paths.indexPath)
  const facts = await listMarkdownEntries('L2', paths.factsDir)
  const sops = await listMarkdownEntries('L3', paths.sopsDir)
  const l4 = await listL4Entries(30)
  const layers = buildLayers(paths, l1, facts, sops, l4)
  const stale = [...facts, ...sops, ...l4].filter(entry => entry.stale?.stale)
  await writeVectorIndex([l1, ...facts, ...sops, ...l4])
  return {
    ...paths,
    entries: [...facts, ...sops],
    facts,
    sops,
    layers,
    stale,
  }
}

export async function writeMemoryFact(
  input: MemoryV2WriteInput,
): Promise<MemoryV2Entry> {
  assertVerifiedPromotion(input, 'L2')
  const paths = getMemoryV2Paths()
  await ensureMemoryV2Dirs(paths)
  const entry = await writeEntry('L2', paths.factsDir, input)
  await appendIndexPointer(paths.indexPath, entry)
  return entry
}

export async function writeMemorySop(
  input: MemoryV2WriteInput,
): Promise<MemoryV2Entry> {
  assertVerifiedPromotion(input, 'L3')
  const paths = getMemoryV2Paths()
  await ensureMemoryV2Dirs(paths)
  const entry = await writeEntry('L3', paths.sopsDir, input)
  await appendIndexPointer(paths.indexPath, entry)
  return entry
}

export async function readMemoryV2Entry(
  layer: MemoryLayer,
  id: string,
): Promise<MemoryV2Entry> {
  const paths = getMemoryV2Paths()
  await ensureMemoryV2Dirs(paths)
  if (layer === 'L1') return readIndexEntry(paths.indexPath)
  if (layer === 'L2') return readMarkdownEntry('L2', path.join(paths.factsDir, `${id}.md`))
  if (layer === 'L3') return readMarkdownEntry('L3', path.join(paths.sopsDir, `${id}.md`))
  return readL4Entry(id)
}

export async function updateMemoryV2Entry(input: {
  layer: MemoryLayer
  id: string
  title?: string
  content: string
  source?: string
  verified?: boolean
}): Promise<MemoryV2Entry> {
  const paths = getMemoryV2Paths()
  await ensureMemoryV2Dirs(paths)

  if (input.layer === 'L1') {
    await fs.writeFile(paths.indexPath, input.content.trimEnd() + '\n', 'utf-8')
    return readIndexEntry(paths.indexPath)
  }

  if (input.layer === 'L2' || input.layer === 'L3') {
    if (input.verified === false) {
      throw new Error(`${input.layer} update requires verified=true`)
    }
    const dir = input.layer === 'L2' ? paths.factsDir : paths.sopsDir
    const existing = await readMarkdownEntry(input.layer, path.join(dir, `${input.id}.md`)).catch(() => null)
    return writeEntryAtPath(input.layer, path.join(dir, `${input.id}.md`), {
      title: input.title || existing?.title || input.id,
      content: input.content,
      source: input.source || existing?.source,
      verified: true,
    })
  }

  const summaryPath = path.join(paths.summariesDir, `${input.id}.md`)
  return writeEntryAtPath('L4', summaryPath, {
    title: input.title || input.id,
    content: input.content,
    source: input.source,
    verified: true,
  })
}

export async function summarizeMemoryV2Sessions(limit = 20): Promise<MemoryV2Entry[]> {
  const paths = getMemoryV2Paths()
  await ensureMemoryV2Dirs(paths)
  const index = await getSessionIndex({ limit })
  const entries: MemoryV2Entry[] = []
  for (const session of index.sessions) {
    const id = `session-${session.id}`
    const content = [
      `Session: ${session.title}`,
      `Project: ${session.projectPath}`,
      `Messages: ${session.messageCount}`,
      `Created: ${session.createdAt || 'unknown'}`,
      `Modified: ${session.modifiedAt}`,
      `Source: ${session.filePath}`,
    ].join('\n')
    entries.push(await writeEntryAtPath('L4', path.join(paths.summariesDir, `${id}.md`), {
      title: session.title,
      content,
      source: session.filePath,
      verified: true,
    }))
  }
  return entries
}

export async function searchMemoryV2(query: string, limit = 20): Promise<MemoryV2SearchResult[]> {
  const normalized = query.trim()
  if (!normalized) return []
  const paths = getMemoryV2Paths()
  await ensureMemoryV2Dirs(paths)
  const l1 = await readIndexEntry(paths.indexPath)
  const facts = await listMarkdownEntries('L2', paths.factsDir)
  const sops = await listMarkdownEntries('L3', paths.sopsDir)
  const l4 = await listL4Entries(50)
  const queryVector = termVector(normalized)
  const results = [l1, ...facts, ...sops, ...l4]
    .map(entry => {
      const text = [entry.title, entry.source, entry.summary, entry.content].filter(Boolean).join('\n')
      const entryVector = termVector(text)
      const matchedTerms = [...queryVector.keys()].filter(term => entryVector.has(term))
      return {
        entry,
        score: cosine(queryVector, entryVector),
        matchedTerms,
        method: VECTOR_METHOD,
      }
    })
    .filter(result => result.score > 0 || result.matchedTerms.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
  await writeVectorIndex([l1, ...facts, ...sops, ...l4])
  return results
}

export async function detectMemoryV2Stale(): Promise<MemoryV2Entry[]> {
  const status = await getMemoryV2Status()
  return status.layers.flatMap(layer => layer.entries).filter(entry => entry.stale?.stale)
}

export async function generateMemoryV2DistillCandidates(limit = 10): Promise<MemoryV2DistillCandidate[]> {
  const summaries = await summarizeMemoryV2Sessions(limit)
  const candidates = summaries
    .filter(entry => {
      const text = `${entry.title}\n${entry.content ?? ''}`.toLowerCase()
      return /browser|memory|skill|配置|测试|搜索|权限|定时|away|jarvis|rust/.test(text)
    })
    .slice(0, limit)
    .map(entry => {
      const isProcedure = /怎么|如何|流程|测试|配置|步骤|smoke|browser|skill/i.test(`${entry.title}\n${entry.content ?? ''}`)
      return {
        id: `candidate-${entry.id}`,
        layer: isProcedure ? 'L3' as const : 'L2' as const,
        title: isProcedure ? `SOP: ${entry.title}` : `Fact: ${entry.title}`,
        content: [
          entry.summary || entry.content || entry.title,
          '',
          `Derived from ${entry.source || entry.path}. Review before relying on this memory.`,
        ].join('\n').trim(),
        source: entry.source || entry.path,
        confidence: 0.72,
        reason: 'Generated from verified L4 session summary; requires review before long-term use.',
        verified: true as const,
      }
    })
  const paths = getMemoryV2Paths()
  await ensureMemoryV2Dirs(paths)
  await fs.writeFile(paths.candidatePath, JSON.stringify(candidates, null, 2), 'utf-8')
  return candidates
}

export async function applyMemoryV2DistillCandidate(
  candidate: MemoryV2DistillCandidate,
): Promise<MemoryV2Entry> {
  return candidate.layer === 'L2'
    ? writeMemoryFact(candidate)
    : writeMemorySop(candidate)
}

async function ensureMemoryV2Dirs(paths = getMemoryV2Paths()): Promise<void> {
  await fs.mkdir(paths.factsDir, { recursive: true })
  await fs.mkdir(paths.sopsDir, { recursive: true })
  await fs.mkdir(paths.summariesDir, { recursive: true })
  try {
    await fs.access(paths.indexPath)
  } catch {
    await fs.writeFile(
      paths.indexPath,
      [
        '# Memory Index',
        '',
        'L1 index: short pointers only. Do not store raw session content here.',
        '',
      ].join('\n'),
      'utf-8',
    )
  }
}

async function writeEntry(
  layer: 'L2' | 'L3',
  dir: string,
  input: MemoryV2WriteInput,
): Promise<MemoryV2Entry> {
  const id = slugify(input.title)
  return writeEntryAtPath(layer, path.join(dir, `${id}.md`), input)
}

async function writeEntryAtPath(
  layer: MemoryLayer,
  filePath: string,
  input: MemoryV2WriteInput,
): Promise<MemoryV2Entry> {
  const id = path.basename(filePath, '.md')
  const markdown = [
    '---',
    `layer: ${layer}`,
    `title: ${JSON.stringify(input.title)}`,
    `verified: ${input.verified}`,
    input.source ? `source: ${JSON.stringify(input.source)}` : '',
    '---',
    '',
    `# ${input.title}`,
    '',
    input.content.trim(),
    '',
  ].filter(line => line !== '').join('\n')
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, markdown, 'utf-8')
  const stat = await fs.stat(filePath)
  return {
    layer,
    id,
    title: input.title,
    path: filePath,
    source: input.source,
    verified: input.verified,
    content: input.content.trim(),
    summary: summarizeText(input.content),
    updatedAt: stat.mtime.toISOString(),
    stale: staleStatus(layer, stat.mtime),
  }
}

async function appendIndexPointer(
  indexPath: string,
  entry: MemoryV2Entry,
): Promise<void> {
  const pointer = `- ${entry.layer}: [${entry.title}](${path.relative(path.dirname(indexPath), entry.path).replace(/\\/g, '/')})`
  const current = await fs.readFile(indexPath, 'utf-8').catch(() => '')
  if (current.includes(pointer)) return
  await fs.writeFile(indexPath, `${current.trimEnd()}\n${pointer}\n`, 'utf-8')
}

async function readIndexEntry(indexPath: string): Promise<MemoryV2Entry> {
  const content = await fs.readFile(indexPath, 'utf-8')
  const stat = await fs.stat(indexPath)
  return {
    layer: 'L1',
    id: 'index',
    title: 'Memory Index',
    path: indexPath,
    verified: true,
    content,
    summary: summarizeText(content),
    updatedAt: stat.mtime.toISOString(),
    stale: staleStatus('L1', stat.mtime),
  }
}

async function listMarkdownEntries(
  layer: 'L2' | 'L3',
  dir: string,
): Promise<MemoryV2Entry[]> {
  try {
    const files = await fs.readdir(dir)
    const entries = await Promise.all(
      files
        .filter(file => file.endsWith('.md'))
        .map(file => readMarkdownEntry(layer, path.join(dir, file)).catch(() => null)),
    )
    return entries.filter((entry): entry is MemoryV2Entry => entry !== null)
  } catch {
    return []
  }
}

async function listL4Entries(limit: number): Promise<MemoryV2Entry[]> {
  const paths = getMemoryV2Paths()
  const summaries = await listSummaryEntries(paths.summariesDir)
  const knownIds = new Set(summaries.map(entry => entry.id))
  const index = await getSessionIndex({ limit }).catch(() => null)
  const sessions = index
    ? index.sessions
        .filter(session => !knownIds.has(`session-${session.id}`))
        .map(session => ({
          layer: 'L4' as const,
          id: `raw-${session.id}`,
          title: session.title,
          path: session.filePath,
          source: session.projectPath,
          verified: true,
          summary: `${session.messageCount} messages; modified ${session.modifiedAt}`,
          updatedAt: session.modifiedAt,
          stale: staleStatus('L4', new Date(session.modifiedAt)),
        }))
    : []
  return [...summaries, ...sessions]
}

async function listSummaryEntries(dir: string): Promise<MemoryV2Entry[]> {
  try {
    const files = await fs.readdir(dir)
    const entries = await Promise.all(
      files
        .filter(file => file.endsWith('.md'))
        .map(file => readMarkdownEntry('L4', path.join(dir, file)).catch(() => null)),
    )
    return entries.filter((entry): entry is MemoryV2Entry => entry !== null)
  } catch {
    return []
  }
}

async function readL4Entry(id: string): Promise<MemoryV2Entry> {
  const paths = getMemoryV2Paths()
  const summaryPath = path.join(paths.summariesDir, `${id}.md`)
  const summary = await readMarkdownEntry('L4', summaryPath).catch(() => null)
  if (summary) return summary

  const rawId = id.startsWith('raw-') ? id.slice(4) : id.startsWith('session-') ? id.slice(8) : id
  const index = await getSessionIndex({ limit: 500 }).catch(() => null)
  const session = index?.sessions.find(item => item.id === rawId)
  if (!session) throw new Error(`L4 entry not found: ${id}`)
  return {
    layer: 'L4',
    id: `raw-${session.id}`,
    title: session.title,
    path: session.filePath,
    source: session.projectPath,
    verified: true,
    content: await fs.readFile(session.filePath, 'utf-8').catch(() => ''),
    summary: `${session.messageCount} messages; modified ${session.modifiedAt}`,
    updatedAt: session.modifiedAt,
    stale: staleStatus('L4', new Date(session.modifiedAt)),
  }
}

async function readMarkdownEntry(
  layer: MemoryLayer,
  filePath: string,
): Promise<MemoryV2Entry> {
  const content = await fs.readFile(filePath, 'utf-8')
  const stat = await fs.stat(filePath)
  const frontmatter = parseFrontmatter(content)
  const body = stripFrontmatter(content).replace(/^# .+\n\n/, '').trim()
  return {
    layer,
    id: path.basename(filePath, '.md'),
    title: frontmatter.title || path.basename(filePath, '.md').replace(/-/g, ' '),
    path: filePath,
    source: frontmatter.source,
    verified: frontmatter.verified ?? true,
    content: body,
    summary: summarizeText(body),
    updatedAt: stat.mtime.toISOString(),
    stale: staleStatus(layer, stat.mtime),
  }
}

function buildLayers(
  paths: ReturnType<typeof getMemoryV2Paths>,
  l1: MemoryV2Entry,
  facts: MemoryV2Entry[],
  sops: MemoryV2Entry[],
  l4: MemoryV2Entry[],
): MemoryV2LayerStatus[] {
  return [
    {
      layer: 'L1',
      title: 'L1 index',
      description: 'Short routing pointers only; no raw session content.',
      path: paths.indexPath,
      entries: [l1],
    },
    {
      layer: 'L2',
      title: 'L2 facts',
      description: 'Verified stable facts, preferences, and project rules.',
      path: paths.factsDir,
      entries: facts,
    },
    {
      layer: 'L3',
      title: 'L3 SOPs and skills',
      description: 'Verified reusable procedures and tool workflows.',
      path: paths.sopsDir,
      entries: sops,
    },
    {
      layer: 'L4',
      title: 'L4 archive',
      description: 'Raw sessions and compressed summaries; evidence only.',
      path: paths.sessionsDir,
      entries: l4,
    },
  ]
}

function parseFrontmatter(content: string): { title?: string; source?: string; verified?: boolean } {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const result: { title?: string; source?: string; verified?: boolean } = {}
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    const raw = line.slice(separator + 1).trim()
    if (key === 'title') result.title = parseJsonString(raw) ?? raw
    if (key === 'source') result.source = parseJsonString(raw) ?? raw
    if (key === 'verified') result.verified = raw === 'true'
  }
  return result
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n*/, '')
}

function parseJsonString(value: string): string | null {
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === 'string' ? parsed : null
  } catch {
    return null
  }
}

function assertVerifiedPromotion(
  input: MemoryV2WriteInput,
  layer: 'L2' | 'L3',
): void {
  if (!input.verified) {
    throw new Error(`${layer} promotion requires verified=true`)
  }
  if (!input.title.trim()) {
    throw new Error('title is required')
  }
  if (!input.content.trim()) {
    throw new Error('content is required')
  }
}

function staleStatus(layer: MemoryLayer, modifiedAt: Date): MemoryV2StaleStatus {
  const ageDays = Math.max(0, Math.floor((Date.now() - modifiedAt.getTime()) / 86_400_000))
  const threshold = layer === 'L2' ? 30 : layer === 'L3' ? 60 : layer === 'L4' ? 14 : 90
  if (ageDays >= threshold) {
    return {
      stale: true,
      reason: `${layer} entry has not been refreshed for ${ageDays} days.`,
      ageDays,
      severity: 'stale',
    }
  }
  if (ageDays >= Math.floor(threshold / 2)) {
    return {
      stale: false,
      reason: `${layer} entry is ${ageDays} days old; verify before relying on it.`,
      ageDays,
      severity: 'watch',
    }
  }
  return {
    stale: false,
    reason: `${layer} entry is fresh.`,
    ageDays,
    severity: 'fresh',
  }
}

function summarizeText(value: string, max = 220): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 3).trimEnd()}...`
}

function termVector(value: string): Map<string, number> {
  const vector = new Map<string, number>()
  const terms = value
    .toLowerCase()
    .normalize('NFKC')
    .match(/[\p{L}\p{N}_-]+/gu) ?? []
  for (const term of terms) {
    if (term.length <= 1) continue
    vector.set(term, (vector.get(term) ?? 0) + 1)
    if (/\p{Script=Han}/u.test(term)) {
      for (const cjkTerm of cjkBigrams(term)) {
        vector.set(cjkTerm, (vector.get(cjkTerm) ?? 0) + 1)
      }
    }
  }
  return vector
}

function cjkBigrams(value: string): string[] {
  const chars = [...value].filter(char => /\p{Script=Han}/u.test(char))
  const result: string[] = []
  for (let index = 0; index < chars.length - 1; index += 1) {
    result.push(`${chars[index]}${chars[index + 1]}`)
  }
  return result
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0
  let aLen = 0
  let bLen = 0
  for (const value of a.values()) aLen += value * value
  for (const value of b.values()) bLen += value * value
  for (const [term, value] of a) dot += value * (b.get(term) ?? 0)
  if (aLen === 0 || bLen === 0) return 0
  return dot / (Math.sqrt(aLen) * Math.sqrt(bLen))
}

async function writeVectorIndex(entries: MemoryV2Entry[]): Promise<void> {
  const paths = getMemoryV2Paths()
  const vectors = entries.map(entry => ({
    layer: entry.layer,
    id: entry.id,
    path: entry.path,
    title: entry.title,
    terms: Object.fromEntries(termVector([entry.title, entry.summary, entry.content].filter(Boolean).join('\n'))),
    updatedAt: entry.updatedAt,
  }))
  await fs.writeFile(paths.vectorIndexPath, JSON.stringify({
    method: VECTOR_METHOD,
    generatedAt: new Date().toISOString(),
    vectors,
  }, null, 2), 'utf-8')
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .toLowerCase()
  if (!slug) throw new Error('title is required')
  return slug
}
