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
import { logDiagnosticEvent } from '../utils/diagnosticLog.js'

export function getMemoryV2Paths(memoryRoot = getAutoMemPath()) {
  const root = path.normalize(memoryRoot).replace(/[\\/]+$/, '')
  return {
    root,
    indexPath: path.join(root, 'MEMORY.md'),
    factsDir: path.join(root, 'facts'),
    sopsDir: path.join(root, 'sops'),
    skillsDir: path.join(root, 'sops', 'skills'),
    sessionsDir: path.join(root, 'sessions'),
    summariesDir: path.join(root, 'sessions'),
    vectorIndexPath: path.join(root, 'vectors.json'),
    embeddingCachePath: path.join(root, 'embedding-cache.json'),
    faissIndexPath: path.join(root, 'vectors.faiss'),
    faissMetaPath: path.join(root, 'vectors.faiss.json'),
    candidatePath: path.join(root, 'distill-candidates.json'),
  }
}

type MemoryV2Paths = ReturnType<typeof getMemoryV2Paths>

export async function getMemoryV2Status(): Promise<MemoryV2Status> {
  const paths = getMemoryV2Paths()
  await ensureMemoryV2Dirs(paths)
  const l1 = localizeMemoryEntry(await readIndexEntry(paths.indexPath))
  const facts = (await enrichStaleStatuses(
    (await listMarkdownEntries('L2', paths.factsDir)).filter(entry => !isLowValueMemory(entry)),
  )).map(localizeMemoryEntry)
  const sops = (await enrichStaleStatuses(
    (await listL3Entries(paths)).filter(entry => !isLowValueMemory(entry)),
  )).map(localizeMemoryEntry)
  const l4 = (await listL4Entries(30)).map(localizeMemoryEntry)
  const layers = localizeMemoryLayers(buildLayers(paths, l1, facts, sops, l4))
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
  await rewriteCompactIndex(paths)
  return entry
}

export async function writeMemorySop(
  input: MemoryV2WriteInput,
): Promise<MemoryV2Entry> {
  assertVerifiedPromotion(input, 'L3')
  const paths = getMemoryV2Paths()
  await ensureMemoryV2Dirs(paths)
  const entry = await writeEntry('L3', paths.sopsDir, input)
  await rewriteCompactIndex(paths)
  return entry
}

export async function readMemoryV2Entry(
  layer: MemoryLayer,
  id: string,
): Promise<MemoryV2Entry> {
  const paths = getMemoryV2Paths()
  await ensureMemoryV2Dirs(paths)
  if (layer === 'L1') return localizeMemoryEntry(await readIndexEntry(paths.indexPath))
  if (layer === 'L2') return localizeMemoryEntry(await readMarkdownEntry('L2', path.join(paths.factsDir, `${id}.md`)))
  if (layer === 'L3') return localizeMemoryEntry(await readL3Entry(paths, id))
  return localizeMemoryEntry(await readL4Entry(id))
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
    if (input.layer === 'L3' && input.id.startsWith('skill-')) {
      const skillName = input.id.slice('skill-'.length)
      const skillDir = path.join(paths.skillsDir, skillName)
      const skillFile = path.join(skillDir, 'SKILL.md')
      const existing = await readSkillEntry(paths.skillsDir, skillName).catch(() => null)
      const title = (input.title || existing?.title || skillName).replace(/^Skill:\s*/i, '')
      await fs.mkdir(skillDir, { recursive: true })
      await fs.writeFile(skillFile, [
        '---',
        `name: ${title}`,
        'version: "1.0.0"',
        'user-invocable: true',
        '---',
        '',
        `# ${title}`,
        '',
        input.content.trim(),
        '',
      ].join('\n'), 'utf-8')
      await rewriteCompactIndex(paths)
      return readSkillEntry(paths.skillsDir, skillName)
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
  const facts = (await listMarkdownEntries('L2', paths.factsDir)).filter(entry => !isLowValueMemory(entry))
  const sops = (await listL3Entries(paths)).filter(entry => !isLowValueMemory(entry))
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
  await fs.mkdir(paths.skillsDir, { recursive: true })
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
    const normalized = normalizeL1IndexContent(current, oldDefault)
    if (normalized !== current) {
      await fs.writeFile(paths.indexPath, normalized, 'utf-8')
    }
  } catch {
    await fs.writeFile(paths.indexPath, currentL1IndexContent(), 'utf-8')
  }
  if (process.env.CLAUDE_YH_IMPORT_LEGACY_MEMORY === '1') {
    await syncLegacyMemoryRoots(paths)
  }
  await deleteLegacyIndexFile(paths)
  await deleteLowValueMemories(paths)
  await deleteDuplicateSopsCoveredBySkills(paths)
  await rewriteCompactIndex(paths)
}

function defaultL1IndexContent(): string {
  return [
    '# 记忆索引',
    '',
    '我是 claude-yh 的全局长期记忆入口，只保留 L2/L3 的精炼摘要和检索路线，不保存原始会话内容。',
    '',
    '我在 L2 facts `facts/` 中保存长期事实、偏好和稳定规则。',
    '我在 L3 SOP `sops/` 中保存可复用流程。',
    '我在 L3 Skills `sops/skills/` 中保存 claude-yh 专属技能。',
    '',
  ].join('\n')
}

function currentL1IndexContent(): string {
  return [
    '# 记忆索引',
    '',
    '我是 claude-yh 的全局长期记忆入口，只保留 L2/L3 的精炼摘要和检索路线，不保存原始会话内容。',
    '',
    '- L2 稳定事实、偏好、项目规则放在 `facts/`。',
    '- L3 可复用 SOP 和 Skill 流程放在 `sops/`。',
    '- L4 原始会话和摘要只作为证据来源，不能直接污染 L1/L2/L3。',
    '',
  ].join('\n')
}

function isBrokenDefaultL1Index(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return true
  return trimmed.includes('璁板繂') || trimmed.includes('涓嶄繚瀛') || trimmed.includes('绱㈠紩')
}

function normalizeL1IndexContent(content: string, oldDefault: string): string {
  if (content.trim() === oldDefault.trim() || isBrokenDefaultL1Index(content)) {
    return currentL1IndexContent()
  }
  return content
}

async function rewriteCompactIndex(paths: MemoryV2Paths): Promise<void> {
  const facts = (await listMarkdownEntries('L2', paths.factsDir)).filter(entry => !isLowValueMemory(entry))
  const sops = (await listL3Entries(paths)).filter(entry => !isLowValueMemory(entry))
  const l4 = await listSummaryEntries(paths.summariesDir)
  await fs.writeFile(paths.indexPath, buildProseL1Index(paths, facts, sops, l4), 'utf-8')
}

function buildCompactL1Index(
  paths: MemoryV2Paths,
  facts: MemoryV2Entry[],
  sops: MemoryV2Entry[],
  l4: MemoryV2Entry[],
): string {
  const triggers = deriveL1Triggers([...facts, ...sops])
  return [
    '# 记忆索引',
    '',
    'L1 索引：只保存路由入口和高 ROI 触发词，不保存 L2/L3/L4 明细。',
    '',
    '## 层级入口',
    `- L2 facts/: ${facts.length} 条稳定事实、偏好、项目规则；需要具体内容时搜索或读取 \`${relativeMemoryPath(paths.root, paths.factsDir)}/\`。`,
    `- L3 sops/: ${sops.length} 条 SOP/Skill；遇到重复任务、浏览器、搜索、Jarvis、配置问题时先搜索 \`${relativeMemoryPath(paths.root, paths.sopsDir)}/\`。`,
    `- L4 sessions/: ${l4.length} 条会话摘要；只作为证据来源，不能直接当成长期事实。`,
    '',
    '## 触发词',
    `- ${triggers.length > 0 ? triggers.join(' / ') : '暂无高频触发词，优先使用语义搜索。'}`,
    '',
    '## 规则',
    '- No Execution, No Memory：写入 L2/L3 必须来自用户确认或成功工具结果。',
    '- L1 只写“哪里有知识”，不写“知识本身”；详细内容靠 embedding 检索、grep 或读取文件召回。',
    '- L4 只能经验证后沉淀到 L2/L3，不能直接污染长期记忆。',
    '',
  ].join('\n')
}

function deriveL1Triggers(entries: MemoryV2Entry[]): string[] {
  const ignored = /^(fact:\s*)?(你好|你是谁|只回答\s*ok|untitled session|年后|搜索北京的天气)$/i
  const usefulTechnicalSignal = /browser|browsercontrol|chrome|cdp|tmwd|jarvis|rust|runtime|provider|web\s*search|web搜索|浏览器|配置|设置|记忆|memory|skill|sop/i
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of entries) {
    const title = entry.title
      .replace(/^(Fact|SOP):\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!title || ignored.test(title)) continue
    if (/^(你|只|搜索北京)/.test(title)) continue
    if (/^workbench/i.test(title)) continue
    if (!usefulTechnicalSignal.test(title)) continue
    const trigger = title.length > 34 ? `${title.slice(0, 31)}...` : title
    const key = trigger.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trigger)
    if (result.length >= 10) break
  }
  return result
}

function relativeMemoryPath(root: string, target: string): string {
  return path.relative(root, target).replace(/\\/g, '/') || '.'
}

function buildProseL1Index(
  paths: MemoryV2Paths,
  facts: MemoryV2Entry[],
  sops: MemoryV2Entry[],
  _l4: MemoryV2Entry[],
): string {
  const skills = sops.filter(isSkillEntry)
  const regularSops = sops.filter(entry => !isSkillEntry(entry))
  const l2Summary = summarizeL1MemoryEntries(facts, {
    empty: '暂无长期事实、偏好或稳定规则。',
    prefix: '我记住了',
  })
  const l3Summary = summarizeL1MemoryEntries(regularSops, {
    empty: '暂无普通 SOP。',
    prefix: '我沉淀了',
  })
  const skillSummary = summarizeL1MemoryEntries(skills, {
    empty: '暂无 claude-yh 专属 Skill。',
    prefix: '我可以调用',
  })
  const l2Path = `${relativeMemoryPath(paths.root, paths.factsDir)}/`
  const sopPath = `${relativeMemoryPath(paths.root, paths.sopsDir)}/`
  const skillPath = `${relativeMemoryPath(paths.root, paths.skillsDir)}/`

  return [
    '# 记忆索引',
    '',
    '我是 claude-yh 的全局长期记忆摘要。对话开始时我会先读这里，具体事实、SOP 和 Skill 再按相对路径检索。',
    '',
    `我在 L2 facts \`${l2Path}\` 中保存长期事实、偏好和稳定规则：${l2Summary}`,
    '',
    `我在 L3 SOP \`${sopPath}\` 中保存可复用流程：${l3Summary}`,
    '',
    `我在 L3 Skills \`${skillPath}\` 中保存 claude-yh 专属技能：${skillSummary}`,
    '',
  ].join('\n')
}

function isSkillEntry(entry: MemoryV2Entry): boolean {
  return entry.id.startsWith('skill-') || entry.path.includes(`${path.sep}skills${path.sep}`)
}

function summarizeL1RoleAndPreferences(facts: MemoryV2Entry[]): string {
  const roleLike = facts.filter(entry =>
    /角色|定位|偏好|习惯|要求|规则|配置|provider|模型|web.?search|browser|浏览器|jarvis|rust|memory|记忆/i
      .test(`${entry.title}\n${entry.content}`),
  )
  const source = roleLike.length > 0 ? roleLike : facts
  const summary = summarizeEntryThemes(source, 5)
  if (!summary) {
    return 'claude-yh 应把这套记忆当作用户级长期记忆，而不是当前项目的私有偏好。进入任何新项目时都使用同一套全局记忆；项目本身的规则仍以仓库文件、AGENTS.md、CLAUDE.md 和用户当前指令为准。'
  }
  return `claude-yh 应把这套记忆当作用户级长期记忆，而不是当前项目的私有偏好。当前已知的长期画像和偏好可以概括为：${summary}。进入任何新项目时都使用同一套全局记忆；项目本身的规则仍以仓库文件、AGENTS.md、CLAUDE.md 和用户当前指令为准。`
}

function summarizeL1MemoryEntries(
  entries: MemoryV2Entry[],
  options: { prefix: string; empty: string },
): string {
  const summary = summarizeEntryThemes(entries, 8)
  if (!summary) return options.empty
  return `${options.prefix} ${summary}。`
}

function summarizeEntryThemes(entries: MemoryV2Entry[], limit: number): string {
  const useful = entries
    .filter(entry => !isLowValueMemory(entry))
    .map(entry => compactEntryTheme(entry))
    .filter(Boolean)
  const seen = new Set<string>()
  const selected: string[] = []
  for (const item of useful) {
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    selected.push(item)
    if (selected.length >= limit) break
  }
  return joinChineseProse(selected)
}

function compactEntryTheme(entry: MemoryV2Entry): string {
  const title = cleanMemoryTitle(entry.title)
  const body = firstUsefulSentence(entry.content || entry.summary || '')
  const titleOnly = title && !/^(fact|sop|skill)$/i.test(title) ? title : ''
  if (titleOnly && body && !body.toLowerCase().includes(titleOnly.toLowerCase())) {
    return truncateText(`${titleOnly}：${body}`, 90)
  }
  return truncateText(titleOnly || body, 90)
}

function cleanMemoryTitle(title: string): string {
  return title
    .replace(/^(Fact|SOP|Skill):\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstUsefulSentence(content: string): string {
  const normalized = content
    .replace(/^# .+$/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return ''
  const [sentence] = normalized.split(/(?<=[。！？.!?])\s+/u)
  return sentence?.trim() || ''
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim()
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 1)}…`
}

function joinChineseProse(items: string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]}，以及 ${items[1]}`
  return `${items.slice(0, -1).join('；')}；以及 ${items.at(-1)}`
}

async function deleteLowValueMemories(paths: MemoryV2Paths): Promise<void> {
  await deleteLowValueMarkdownEntries(paths.factsDir, 'facts')
  await deleteLowValueMarkdownEntries(paths.sopsDir, 'sops')
}

async function deleteDuplicateSopsCoveredBySkills(paths: MemoryV2Paths): Promise<void> {
  const [sops, skills] = await Promise.all([
    listMarkdownEntries('L3', paths.sopsDir),
    listSkillEntries(paths.skillsDir),
  ])
  if (sops.length === 0 || skills.length === 0) return

  const skillKeys = new Set(skills.flatMap(skill => memoryTopicKeys(skill)))
  for (const sop of sops) {
    const overlapsSkill = memoryTopicKeys(sop).some(key => skillKeys.has(key)) ||
      skills.some(skill => memoryEntriesLookDuplicated(sop, skill))
    if (!overlapsSkill) continue
    await removeMemoryFileBestEffort(sop.path)
  }
}

function memoryTopicKeys(entry: MemoryV2Entry): string[] {
  const values = [
    cleanMemoryTitle(entry.title),
    entry.id.replace(/^skill-/, ''),
    path.basename(entry.path, path.extname(entry.path)),
  ]
  return Array.from(new Set(values.map(normalizeMemoryTopicKey).filter(Boolean)))
}

function normalizeMemoryTopicKey(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/^(fact|sop|skill)\s*[:：]\s*/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase()
}

function memoryEntriesLookDuplicated(a: MemoryV2Entry, b: MemoryV2Entry): boolean {
  const aText = `${a.title}\n${a.content}`.toLowerCase()
  const bText = `${b.title}\n${b.content}`.toLowerCase()
  const aTokens = memorySignalTokens(aText)
  const bTokens = memorySignalTokens(bText)
  let common = 0
  for (const token of aTokens) {
    if (!bTokens.has(token)) continue
    common++
    if (common >= 2) return true
  }
  return false
}

function memorySignalTokens(text: string): Set<string> {
  const knownSignals = [
    'browsercontrol',
    'browser',
    'chrome',
    'cdp',
    'tmwd',
    'dom',
    'tab',
    'cookie',
    'screenshot',
    'click',
    'input',
    'console',
    'network',
    '浏览器',
    '标签页',
    '截图',
    '点击',
    '输入',
    '控制台',
    '网络',
    '登录态',
  ]
  return new Set(knownSignals.filter(signal => text.includes(signal)))
}

async function deleteLegacyIndexFile(paths: MemoryV2Paths): Promise<void> {
  const legacyIndexPath = path.join(paths.root, 'index.md')
  if (!(await pathExists(legacyIndexPath))) return
  await removeMemoryFileBestEffort(legacyIndexPath)
}

async function deleteLowValueMarkdownEntries(
  dir: string,
  kind: 'facts' | 'sops',
): Promise<void> {
  let files: string[]
  try {
    files = await fs.readdir(dir)
  } catch {
    return
  }

  for (const file of files.filter(item => item.endsWith('.md'))) {
    const fullPath = path.join(dir, file)
    const entry = await readMarkdownEntry(kind === 'facts' ? 'L2' : 'L3', fullPath).catch(() => null)
    if (!entry || !isLowValueMemory(entry)) continue
    await removeMemoryFileBestEffort(fullPath)
  }
}

async function removeMemoryFileBestEffort(filePath: string): Promise<void> {
  try {
    await fs.rm(filePath, { force: true })
  } catch (error) {
    logDiagnosticEvent({
      scope: 'memoryV2.cleanup',
      event: 'remove_failed',
      ok: false,
      severity: 'warn',
      data: {
        path: filePath,
        error: error instanceof Error ? error.message : String(error),
        code: error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code)
          : undefined,
      },
    })
  }
}

function isLowValueMemory(entry: MemoryV2Entry): boolean {
  const title = entry.title
    .replace(/^(Fact|SOP):\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  const body = (entry.content ?? '').replace(/\s+/g, ' ').trim()
  const exactLowValue = new Set([
    '你好',
    '你是谁',
    '只回答 ok',
    '只回答OK'.toLowerCase(),
    '年后',
    '搜索北京的天气',
    'untitled session',
    '你现在有什么记忆',
    '你现在能操作浏览器吗',
    '你现在都知道什么',
    '你去去知网搜一篇人工智能的论文',
    '去b站搜索可爱的小狗适配',
  ])
  if (exactLowValue.has(title)) return true
  if (/^(你好|你是谁|只回答\s*ok|年后)$/i.test(title)) return true
  if (/^(搜索|查询).{0,20}(天气|论文)$/i.test(title) && body.length < 500) return true
  if (/^你现在.*(记忆|知道|浏览器)/.test(title) && body.length < 500) return true
  if (/^workbench (runtime proof|smoke sop)/i.test(title)) return true
  return false
}

async function syncLegacyMemoryRoots(paths: MemoryV2Paths): Promise<void> {
  const roots = await findLegacyMemoryRoots(paths.root)
  for (const sourceRoot of roots) {
    await copyLegacyMarkdownEntries({
      layer: 'L2',
      sourceDir: path.join(sourceRoot, 'facts'),
      targetDir: paths.factsDir,
    })
    await copyLegacyMarkdownEntries({
      layer: 'L3',
      sourceDir: path.join(sourceRoot, 'sops'),
      targetDir: paths.sopsDir,
    })
    await copyLegacyMarkdownEntries({
      layer: 'L4',
      sourceDir: path.join(sourceRoot, 'sessions'),
      targetDir: paths.summariesDir,
    })
  }
}

async function findLegacyMemoryRoots(activeRoot: string): Promise<string[]> {
  const base = getMemoryBaseDir()
  const candidates = [
    path.join(base, 'memory'),
    ...(await listProjectMemoryRoots(path.join(base, 'projects'))),
  ]
  const activeKey = normalizePathKey(activeRoot)
  const seen = new Set<string>([activeKey])
  const roots: string[] = []
  for (const candidate of candidates) {
    const root = path.normalize(candidate).replace(/[\\/]+$/, '')
    const key = normalizePathKey(root)
    if (seen.has(key)) continue
    seen.add(key)
    if (await pathExists(root)) roots.push(root)
  }
  return roots
}

async function listProjectMemoryRoots(projectsDir: string): Promise<string[]> {
  try {
    const dirents = await fs.readdir(projectsDir, { withFileTypes: true })
    return dirents
      .filter(dirent => dirent.isDirectory())
      .map(dirent => path.join(projectsDir, dirent.name, 'memory'))
  } catch {
    return []
  }
}

async function copyLegacyMarkdownEntries(input: {
  layer: 'L2' | 'L3' | 'L4'
  sourceDir: string
  targetDir: string
}): Promise<void> {
  let files: string[]
  try {
    files = await fs.readdir(input.sourceDir)
  } catch {
    return
  }

  for (const file of files.filter(item => item.endsWith('.md'))) {
    const sourcePath = path.join(input.sourceDir, file)
    const sourceContent = await fs.readFile(sourcePath, 'utf-8').catch(() => null)
    if (sourceContent === null) continue
    const targetPath = await resolveLegacyCopyTarget({
      file,
      sourcePath,
      targetDir: input.targetDir,
      sourceContent,
    })
    if (!targetPath) continue

    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, sourceContent, 'utf-8')
  }
}

async function resolveLegacyCopyTarget(input: {
  file: string
  sourcePath: string
  targetDir: string
  sourceContent: string
}): Promise<string | null> {
  const initialPath = path.join(input.targetDir, input.file)
  const existingContent = await fs.readFile(initialPath, 'utf-8').catch(() => null)
  if (existingContent === null || existingContent === input.sourceContent) return initialPath

  const suffix = slugify(path.relative(getMemoryBaseDir(), path.dirname(input.sourcePath)) || 'legacy')
  const parsed = path.parse(input.file)
  const targetPath = path.join(input.targetDir, `${parsed.name}-${suffix}${parsed.ext}`)
  const targetContent = await fs.readFile(targetPath, 'utf-8').catch(() => null)
  return targetContent === input.sourceContent ? null : targetPath
}

function normalizePathKey(value: string): string {
  const normalized = path.normalize(value).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
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

async function listL3Entries(paths: MemoryV2Paths): Promise<MemoryV2Entry[]> {
  const sops = await listMarkdownEntries('L3', paths.sopsDir)
  const skills = await listSkillEntries(paths.skillsDir)
  const seen = new Set<string>()
  return [...sops, ...skills].filter(entry => {
    const key = `${entry.layer}:${entry.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function listSkillEntries(skillsDir: string): Promise<MemoryV2Entry[]> {
  let dirents: import('fs').Dirent[]
  try {
    dirents = await fs.readdir(skillsDir, { withFileTypes: true })
  } catch {
    return []
  }

  const entries = await Promise.all(
    dirents
      .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.'))
      .map(dirent => readSkillEntry(skillsDir, dirent.name).catch(() => null)),
  )
  return entries.filter((entry): entry is MemoryV2Entry => entry !== null)
}

async function readL3Entry(paths: MemoryV2Paths, id: string): Promise<MemoryV2Entry> {
  const regular = await readMarkdownEntry('L3', path.join(paths.sopsDir, `${id}.md`)).catch(() => null)
  if (regular) return regular
  const skillName = id.startsWith('skill-') ? id.slice('skill-'.length) : id
  return readSkillEntry(paths.skillsDir, skillName)
}

async function readSkillEntry(skillsDir: string, skillName: string): Promise<MemoryV2Entry> {
  const skillFile = path.join(skillsDir, skillName, 'SKILL.md')
  const content = await fs.readFile(skillFile, 'utf-8')
  const stat = await fs.stat(skillFile)
  const frontmatter = parseFrontmatter(content)
  const body = stripFrontmatter(content).replace(/^# .+\n\n/, '').trim()
  const title = frontmatter.title || frontmatter.name || skillName
  return {
    layer: 'L3',
    id: `skill-${skillName}`,
    title: `Skill: ${title}`,
    path: skillFile,
    source: path.dirname(skillFile),
    verified: frontmatter.verified ?? true,
    content: body,
    summary: summarizeText(body),
    updatedAt: stat.mtime.toISOString(),
    stale: staleStatus('L3', stat.mtime),
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

function localizeMemoryEntry(entry: MemoryV2Entry): MemoryV2Entry {
  if (entry.layer !== 'L1' && !entry.stale) return entry
  return {
    ...entry,
    title: entry.layer === 'L1' ? '记忆索引' : entry.title,
    stale: entry.stale ? localizeStaleStatus(entry.layer, entry.stale) : entry.stale,
  }
}

function localizeMemoryLayers(layers: MemoryV2LayerStatus[]): MemoryV2LayerStatus[] {
  const meta: Record<MemoryLayer, { title: string; description: string }> = {
    L1: {
      title: 'L1 索引',
      description: '全局会话入口，只保存角色定位、检索路线和边界规则，不保存 L2/L3 明细或原始会话。',
    },
    L2: {
      title: 'L2 事实',
      description: '全局稳定事实、偏好、角色定位和规则，存放在 ~/.claude-yh/memory/facts/。',
    },
    L3: {
      title: 'L3 SOP 和 Skill',
      description: '全局可复用 SOP 和 claude-yh 专属 Skill，存放在 ~/.claude-yh/memory/sops/ 与 sops/skills/。',
    },
    L4: {
      title: 'L4 会话归档',
      description: '全局会话摘要和证据归档，只能经过抽取后提升为 L2 或 L3。',
    },
  }
  return layers.map(layer => ({
    ...layer,
    title: meta[layer.layer].title,
    description: meta[layer.layer].description,
    entries: layer.entries.map(localizeMemoryEntry),
  }))
}

function localizeStaleStatus(
  layer: MemoryLayer,
  stale: MemoryV2StaleStatus,
): MemoryV2StaleStatus {
  if (stale.ageDays === undefined) return stale
  if (stale.severity === 'stale') {
    return {
      ...stale,
      reason: `${layer} 条目已经 ${stale.ageDays} 天未刷新。`,
    }
  }
  if (stale.severity === 'watch') {
    return {
      ...stale,
      reason: `${layer} 条目已有 ${stale.ageDays} 天，继续依赖前建议复核。`,
    }
  }
  return {
    ...stale,
    reason: `${layer} 条目是新鲜的。`,
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
      description: '全局会话入口，只保存角色定位、检索路线和边界规则，不保存 L2/L3 明细或原始会话。',
      path: paths.indexPath,
      entries: [l1],
    },
    {
      layer: 'L2',
      title: 'L2 事实',
      description: '全局稳定事实、偏好、角色定位和规则，存放在 ~/.claude-yh/memory/facts/。',
      path: paths.factsDir,
      entries: facts,
    },
    {
      layer: 'L3',
      title: 'L3 SOP 和 Skill',
      description: '全局可复用 SOP 和 claude-yh 专属 Skill，存放在 ~/.claude-yh/memory/sops/ 与 sops/skills/。',
      path: paths.sopsDir,
      entries: sops,
    },
    {
      layer: 'L4',
      title: 'L4 会话归档',
      description: '全局会话摘要和证据归档，只能经过抽取后提升为 L2 或 L3。',
      path: paths.sessionsDir,
      entries: l4,
    },
  ]
}

function parseFrontmatter(content: string): {
  title?: string
  name?: string
  source?: string
  verified?: boolean
} {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const result: {
    title?: string
    name?: string
    source?: string
    verified?: boolean
  } = {}
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    const raw = line.slice(separator + 1).trim()
    if (key === 'title') result.title = parseJsonString(raw) ?? raw
    if (key === 'name') result.name = parseJsonString(raw) ?? raw
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
