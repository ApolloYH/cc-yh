import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  getAutoMemPath,
  getMemoryBaseDir,
} from '../memdir/paths.js'
import { getSessionIndex } from '../runtime/sessionIndexService.js'
import {
  callConfiguredMainModel,
  parseJsonFromModelText,
} from '../services/model/mainModelClient.js'
import {
  embedMemoryTexts,
  getMemoryEmbeddingConfig,
  semanticTerms,
} from './embeddingProvider.js'
import {
  getMemoryVectorProvider,
  searchFaissVectorIndex,
  writeFaissVectorIndex,
  type MemoryVectorRecord,
} from './faissProvider.js'
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

export function getMemoryV2Paths(memoryRoot = getAutoMemPath()) {
  const root = path.normalize(memoryRoot).replace(/[\\/]+$/, '')
  return {
    root,
    indexPath: path.join(root, 'MEMORY.md'),
    factsDir: path.join(root, 'facts'),
    sopsDir: path.join(root, 'sops'),
    sessionsDir: path.join(getMemoryBaseDir(), 'projects'),
    summariesDir: path.join(root, 'sessions'),
    vectorIndexPath: path.join(root, 'vectors.json'),
    embeddingCachePath: path.join(root, 'embedding-cache.json'),
    faissIndexPath: path.join(root, 'vectors.faiss'),
    faissMetaPath: path.join(root, 'vectors.faiss.json'),
    candidatePath: path.join(root, 'distill-candidates.json'),
  }
}

export async function getMemoryV2Status(): Promise<MemoryV2Status> {
  const paths = getMemoryV2Paths()
  await ensureMemoryV2Dirs(paths)
  const l1 = await readIndexEntry(paths.indexPath)
  const facts = await enrichStaleStatuses(await listMarkdownEntries('L2', paths.factsDir))
  const sops = await enrichStaleStatuses(await listMarkdownEntries('L3', paths.sopsDir))
  const l4 = await listL4Entries(30)
  const layers = buildLayers(paths, l1, facts, sops, l4)
  const stale = [...facts, ...sops, ...l4].filter(entry => entry.stale?.stale)
  await writeVectorIndex([l1, ...facts, ...sops, ...l4])
  const embedding = await getMemoryEmbeddingConfig()
  return {
    ...paths,
    vectorProvider: getMemoryVectorProvider(),
    embeddingProvider: embedding.provider,
    embeddingModel: embedding.model,
    embeddingBaseUrl: embedding.baseUrl,
    embeddingDimensions: embedding.dimensions,
    embeddingRemote: embedding.provider !== 'local',
    embeddingHasApiKey: embedding.hasApiKey,
    embeddingMethod: embedding.method,
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
    const transcript = await readSessionTranscriptText(session.filePath)
    const content = await deepSessionSummary({
      title: session.title,
      projectPath: session.projectPath,
      messageCount: session.messageCount,
      createdAt: session.createdAt || 'unknown',
      modifiedAt: session.modifiedAt,
      filePath: session.filePath,
      transcript,
    })
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
  const queryTerms = semanticTerms(normalized)
  const entries = [l1, ...facts, ...sops, ...l4]
  await writeVectorIndex(entries)
  const texts = entries.map(entry => [entry.title, entry.source, entry.summary, entry.content].filter(Boolean).join('\n'))
  const embeddings = await embedMemoryTexts({
    texts: [normalized, ...texts],
    cachePath: paths.embeddingCachePath,
  })
  const queryVector = embeddings.embeddings[0] ?? []
  const nativeMatches = await searchFaissVectorIndex({
    indexPath: paths.faissIndexPath,
    metaPath: paths.faissMetaPath,
    queryEmbedding: queryVector,
    limit,
  })
  if (nativeMatches.length > 0) {
    const byKey = new Map(entries.map((entry, index) => [`${entry.layer}:${entry.id}`, { entry, text: texts[index] }]))
    const nativeResults = nativeMatches
      .map(match => {
        const item = byKey.get(`${match.layer}:${match.id}`)
        if (!item) return null
        const entryTerms = semanticTerms(item.text)
        return {
          entry: item.entry,
          score: match.score,
          matchedTerms: queryTerms.filter(term => entryTerms.includes(term)),
          method: embeddings.config.method,
        }
      })
      .filter((result): result is NonNullable<typeof result> => result !== null)
      .filter(result => result.score > 0 || result.matchedTerms.length > 0)
      .slice(0, limit)
    if (nativeResults.length > 0) return nativeResults
  }
  const results = entries
    .map((entry, index) => {
      const text = texts[index]
      const entryVector = embeddings.embeddings[index + 1] ?? []
      const entryTerms = semanticTerms(text)
      const matchedTerms = queryTerms.filter(term => entryTerms.includes(term))
      return {
        entry,
        score: cosineArray(queryVector, entryVector),
        matchedTerms,
        method: embeddings.config.method,
      }
    })
    .filter(result => result.score > 0 || result.matchedTerms.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
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
      const text = (entry.title + '\n' + (entry.content ?? '')).toLowerCase()
      return /browser|memory|skill|配置|测试|搜索|权限|定时|away|jarvis|rust/.test(text)
    })
    .slice(0, limit)
    .map(entry => {
      const text = entry.title + '\n' + (entry.content ?? '')
      const isProcedure = /怎么|如何|流程|测试|配置|步骤|smoke|browser|skill/i.test(text)
      return {
        id: 'candidate-' + entry.id,
        layer: isProcedure ? 'L3' as const : 'L2' as const,
        title: isProcedure ? 'SOP: ' + entry.title : 'Fact: ' + entry.title,
        content: [
          entry.summary || entry.content || entry.title,
          '',
          'Derived from ' + (entry.source || entry.path) + '. Review before relying on this memory.',
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
    const current = await fs.readFile(paths.indexPath, 'utf-8')
    const oldDefault = [
      '# Memory Index',
      '',
      'L1 index: short pointers only. Do not store raw session content here.',
      '',
    ].join('\n')
    if (current.trim() === oldDefault.trim()) {
      await fs.writeFile(paths.indexPath, defaultL1IndexContent(), 'utf-8')
    }
  } catch {
    await fs.writeFile(paths.indexPath, defaultL1IndexContent(), 'utf-8')
  }
}

function defaultL1IndexContent(): string {
  return [
    '# 记忆索引',
    '',
    'L1 索引：这里只保存简短指针，不保存原始会话内容。',
    '',
    '- L2 稳定事实、偏好、项目规则放在 `facts/`。',
    '- L3 可复用 SOP 和 Skill 流程放在 `sops/`。',
    '- L4 原始会话和摘要只作为证据来源，不能直接提升到 L1/L2/L3。',
    '',
  ].join('\n')
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
    title: '记忆索引',
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
      title: 'L1 索引',
      description: '使用旧系统 MEMORY.md 作为主索引，只保存简短路由指针，不保存原始会话内容。',
      path: paths.indexPath,
      entries: [l1],
    },
    {
      layer: 'L2',
      title: 'L2 事实',
      description: '已经验证的稳定事实、偏好和项目规则，存放在旧 memory 主目录下的 facts/。',
      path: paths.factsDir,
      entries: facts,
    },
    {
      layer: 'L3',
      title: 'L3 SOP 和 Skill',
      description: '已经验证的可复用流程、工具工作流和 Skill 沉淀，存放在旧 memory 主目录下的 sops/。',
      path: paths.sopsDir,
      entries: sops,
    },
    {
      layer: 'L4',
      title: 'L4 会话归档',
      description: '原始会话和压缩摘要只作为证据来源，经过验证后才能提升为 L2 或 L3。',
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
      reason: layer + ' 条目已经 ' + ageDays + ' 天未刷新。',
      ageDays,
      severity: 'stale',
    }
  }
  if (ageDays >= Math.floor(threshold / 2)) {
    return {
      stale: false,
      reason: layer + ' 条目已有 ' + ageDays + ' 天，依赖前建议复核。',
      ageDays,
      severity: 'watch',
    }
  }
  return {
    stale: false,
    reason: layer + ' 条目是新鲜的。',
    ageDays,
    severity: 'fresh',
  }
}

function summarizeText(value: string, max = 220): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 3).trimEnd()}...`
}

function legacySemanticTerms(value: string): string[] {
  const tokens = value
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\p{L}\p{N}_-]+/gu) ?? []
  const expanded = tokens.flatMap(token => {
    if (token.length <= 1) return []
    const synonyms: Record<string, string[]> = {
      browser: ['chrome', 'tab', 'cdp', 'tmwd'],
      chrome: ['browser', 'tab', 'cdp'],
      memory: ['remember', 'recall', 'knowledge'],
      skill: ['workflow', 'sop', 'procedure'],
      test: ['verify', 'validation', 'check'],
      error: ['failure', 'bug', 'exception'],
      search: ['find', 'lookup', 'query'],
      浏览器: ['browser', 'chrome', 'tab'],
      记忆: ['memory', 'remember', 'recall'],
      技能: ['skill', 'workflow', 'sop'],
      测试: ['test', 'verify', 'check'],
    }
    return [token, ...(synonyms[token] ?? []), ...cjkBigrams(token)]
  })
  return [...new Set(expanded)]
}

function cjkBigrams(value: string): string[] {
  const chars = [...value].filter(char => /\p{Script=Han}/u.test(char))
  const result: string[] = []
  for (let index = 0; index < chars.length - 1; index += 1) {
    result.push(`${chars[index]}${chars[index + 1]}`)
  }
  return result
}

function cosineArray(a: readonly number[], b: readonly number[]): number {
  let dot = 0
  let aLen = 0
  let bLen = 0
  const length = Math.min(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const left = a[index] ?? 0
    const right = b[index] ?? 0
    dot += left * right
    aLen += left * left
    bLen += right * right
  }
  if (aLen === 0 || bLen === 0) return 0
  return dot / (Math.sqrt(aLen) * Math.sqrt(bLen))
}

async function readSessionTranscriptText(filePath: string): Promise<string> {
  const raw = await fs.readFile(filePath, 'utf-8').catch(() => '')
  const parts: string[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const item = JSON.parse(line) as Record<string, unknown>
      const message = item.message as { content?: unknown } | undefined
      const content = message?.content
      if (typeof content === 'string') parts.push(content)
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string') {
            parts.push((block as { text: string }).text)
          }
        }
      }
    } catch {
      // Ignore malformed transcript lines.
    }
  }
  return parts.join('\n').slice(0, 20_000)
}

async function deepSessionSummary(input: {
  title: string
  projectPath: string
  messageCount: number
  createdAt: string
  modifiedAt: string
  filePath: string
  transcript: string
}): Promise<string> {
  const transcript = input.transcript.replace(/\s+/g, ' ').trim()
  const excerpts = transcript ? summarizeText(transcript, 900) : 'No transcript text extracted.'
  const reusableSignals = semanticTerms(transcript)
    .filter(term => ['browser', 'memory', 'skill', 'workflow', 'test', 'verify', 'rust', 'jarvis', 'tmwd'].includes(term))
    .slice(0, 12)
  const fallback = [
    `Session: ${input.title}`,
    `Project: ${input.projectPath}`,
    `Messages: ${input.messageCount}`,
    `Created: ${input.createdAt}`,
    `Modified: ${input.modifiedAt}`,
    `Source: ${input.filePath}`,
    '',
    '## Semantic Summary',
    '',
    `Goal and context: ${excerpts}`,
    '',
    `Reusable signals: ${reusableSignals.join(', ') || 'none detected'}`,
    '',
    'Outcome: This L4 entry is evidence only. Promote to L2/L3 only through verified automation rules.',
  ].join('\n')
  const modelSummary = await callConfiguredMainModel({
    maxTokens: 1800,
    systemPrompt: [
      'You write deep semantic L4 memory summaries for claude-yh.',
      'Summaries are evidence archives, not direct long-term facts.',
      'Return JSON only: {"summary":"markdown","outcome":"...","reusable_signals":["..."],"risks":["..."]}.',
      'Focus on user goal, decisions, verified outcomes, failures/blockers, reusable workflows, and what must not be promoted without verification.',
      'Do not include secrets or raw credentials.',
    ].join(' '),
    userPrompt: JSON.stringify({
      session: {
        title: input.title,
        projectPath: input.projectPath,
        messageCount: input.messageCount,
        createdAt: input.createdAt,
        modifiedAt: input.modifiedAt,
        filePath: input.filePath,
      },
      transcriptExcerpt: transcript.slice(0, 12_000),
      fallback,
    }),
    timeoutMs: 120_000,
  }).catch(() => null)
  const parsed = modelSummary ? parseJsonFromModelText(modelSummary.content) : null
  const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : ''
  if (!summary) return fallback

  const outcome = typeof parsed?.outcome === 'string' ? parsed.outcome.trim() : ''
  const modelSignals = Array.isArray(parsed?.reusable_signals)
    ? parsed.reusable_signals.filter((item): item is string => typeof item === 'string')
    : []
  const risks = Array.isArray(parsed?.risks)
    ? parsed.risks.filter((item): item is string => typeof item === 'string')
    : []

  return [
    `Session: ${input.title}`,
    `Project: ${input.projectPath}`,
    `Messages: ${input.messageCount}`,
    `Created: ${input.createdAt}`,
    `Modified: ${input.modifiedAt}`,
    `Source: ${input.filePath}`,
    '',
    '## Semantic Summary',
    '',
    summary,
    '',
    '## Outcome',
    '',
    outcome || 'Model summary did not provide a separate outcome.',
    '',
    '## Reusable Signals',
    '',
    ...(modelSignals.length > 0 ? modelSignals.map(item => `- ${item}`) : [`- ${reusableSignals.join(', ') || 'none detected'}`]),
    '',
    '## Risks And Promotion Rules',
    '',
    ...(risks.length > 0 ? risks.map(item => `- ${item}`) : ['- This L4 entry is evidence only. Promote to L2/L3 only through verified automation rules.']),
  ].join('\n')
}

async function enrichStaleStatuses(entries: MemoryV2Entry[]): Promise<MemoryV2Entry[]> {
  const titleCounts = new Map<string, number>()
  for (const entry of entries) {
    const key = entry.title.toLowerCase().trim()
    titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1)
  }

  return Promise.all(entries.map(async entry => {
    const sourceChanged = await sourceIsNewer(entry)
    const hasConflict = (titleCounts.get(entry.title.toLowerCase().trim()) ?? 0) > 1
    if (sourceChanged || hasConflict) {
      return {
        ...entry,
        stale: {
          stale: true,
          severity: 'stale' as const,
          ageDays: entry.stale?.ageDays,
          reason: sourceChanged
            ? 'Source file changed after this memory entry was written.'
            : 'Possible fact conflict: another memory entry has the same title.',
        },
      }
    }
    return entry
  }))
}

async function sourceIsNewer(entry: MemoryV2Entry): Promise<boolean> {
  if (!entry.source || !entry.updatedAt) return false
  try {
    const sourceStat = await fs.stat(entry.source)
    return sourceStat.mtime.getTime() > new Date(entry.updatedAt).getTime() + 1000
  } catch {
    return false
  }
}

async function writeVectorIndex(entries: MemoryV2Entry[]): Promise<void> {
  const paths = getMemoryV2Paths()
  const texts = entries.map(entry => [entry.title, entry.summary, entry.content].filter(Boolean).join('\n'))
  const embeddings = await embedMemoryTexts({
    texts,
    cachePath: paths.embeddingCachePath,
  })
  const vectors: MemoryVectorRecord[] = entries.map((entry, index) => ({
    layer: entry.layer,
    id: entry.id,
    path: entry.path,
    title: entry.title,
    embedding: embeddings.embeddings[index] ?? [],
    dimensions: embeddings.config.dimensions,
    updatedAt: entry.updatedAt,
  }))
  await fs.writeFile(paths.vectorIndexPath, JSON.stringify({
    method: embeddings.config.method,
    provider: getMemoryVectorProvider(),
    embeddingProvider: embeddings.config.provider,
    embeddingModel: embeddings.config.model,
    embeddingRemote: embeddings.remote,
    embeddingError: embeddings.error,
    dimensions: embeddings.config.dimensions,
    generatedAt: new Date().toISOString(),
    vectors,
  }, null, 2), 'utf-8')
  await writeFaissVectorIndex({
    indexPath: paths.faissIndexPath,
    metaPath: paths.faissMetaPath,
    records: vectors,
    dimensions: embeddings.config.dimensions,
  })
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
