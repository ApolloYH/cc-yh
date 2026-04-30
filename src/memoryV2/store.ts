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
  semanticTerms,
  keywordScore,
} from './keywordSearch.js'
import type {
  MemoryLayer,
  MemoryV2DistillCandidate,
  MemoryV2Entry,
  MemoryV2LayerStatus,
  MemoryV2SearchResult,
  MemoryV2Status,
  MemoryV2WriteInput,
} from './types.js'
import { logDiagnosticEvent } from '../utils/diagnosticLog.js'

const L1_INDEX_MAX_LINES = 30
const L1_INDEX_MAX_CHARS = 2500
const L1_SECTION_MAX_CHARS = 520

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
    candidatePath: path.join(root, 'distill-candidates.json'),
  }
}

type MemoryV2Paths = ReturnType<typeof getMemoryV2Paths>

export async function getMemoryV2Status(): Promise<MemoryV2Status> {
  const paths = getMemoryV2Paths()
  await ensureMemoryV2Dirs(paths)
  const l1 = localizeMemoryEntry(await readIndexEntry(paths.indexPath))
  const facts = (await listMarkdownEntries('L2', paths.factsDir))
    .filter(entry => !isLowValueMemory(entry))
    .map(localizeMemoryEntry)
  const sops = (await listL3Entries(paths))
    .filter(entry => !isLowValueMemory(entry))
    .map(localizeMemoryEntry)
  const l4 = (await listL4Entries(30)).map(localizeMemoryEntry)
  const layers = localizeMemoryLayers(buildLayers(paths, l1, facts, sops, l4))
  return {
    ...paths,
    entries: [...facts, ...sops],
    facts,
    sops,
    layers,
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
    await fs.writeFile(paths.indexPath, enforceL1IndexBounds(input.content), 'utf-8')
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
        `# ${title}`,
        compactMarkdownBlankLines(input.content),
      ].join('\n').trimEnd() + '\n', 'utf-8')
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

export async function summarizeMemoryV2Sessions(
  options: number | { limit?: number; sessionId?: string } = 20,
): Promise<MemoryV2Entry[]> {
  const limit = typeof options === 'number' ? options : options.limit ?? 20
  const sessionId = typeof options === 'number' ? undefined : options.sessionId
  const paths = getMemoryV2Paths()
  await ensureMemoryV2Dirs(paths)
  const index = await getSessionIndex({ limit: sessionId ? Math.max(limit, 500) : limit })
  const sessions = sessionId
    ? index.sessions.filter(session => session.id === sessionId)
    : index.sessions
  const entries: MemoryV2Entry[] = []
  for (const session of sessions) {
    const id = `session-${session.id}`
    const summaryPath = path.join(paths.summariesDir, `${id}.md`)
    const existing = await fs.stat(summaryPath).catch(() => null)
    const existingSummary = existing
      ? await readMarkdownEntry('L4', summaryPath).catch(() => null)
      : null
    if (
      existing &&
      existing.mtimeMs >= session.modifiedAtMs &&
      existingSummary?.title === session.title
    ) {
      continue
    }
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
    entries.push(await writeEntryAtPath('L4', summaryPath, {
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
  const entries = [l1, ...facts, ...sops, ...l4]
  const texts = entries.map(entry => [entry.title, entry.source, entry.summary, entry.content].filter(Boolean).join('\n'))
  return entries
    .map((entry, index) => {
      const { score, matchedTerms } = keywordScore(normalized, texts[index])
      return {
        entry,
        score,
        matchedTerms,
        method: 'keyword' as const,
      }
    })
    .filter(result => result.score > 0 || result.matchedTerms.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

export async function generateMemoryV2DistillCandidates(
  limit = 10,
  sourceSummaries?: MemoryV2Entry[],
): Promise<MemoryV2DistillCandidate[]> {
  let summaries = sourceSummaries ?? await summarizeMemoryV2Sessions(limit)
  if (!sourceSummaries && summaries.length === 0) {
    summaries = await listL4Entries(limit)
  }
  const candidates: MemoryV2DistillCandidate[] = []
  for (const entry of summaries) {
    if (candidates.length >= limit) break
    const extracted = await extractMemoryCandidatesWithModel(entry)
    for (const candidate of extracted) {
      if (candidates.length >= limit) break
      candidates.push(candidate)
    }
  }
  const paths = getMemoryV2Paths()
  await ensureMemoryV2Dirs(paths)
  await fs.writeFile(paths.candidatePath, JSON.stringify(candidates, null, 2), 'utf-8')
  return candidates
}

async function extractMemoryCandidatesWithModel(entry: MemoryV2Entry): Promise<MemoryV2DistillCandidate[]> {
  const modelResult = await callConfiguredMainModel({
    maxTokens: 1400,
    timeoutMs: 120_000,
    systemPrompt: [
      '你是 claude-yh 的长期记忆抽取子智能体。',
      '只根据给定 L4 会话摘要判断是否值得沉淀长期记忆。',
      '必须返回 JSON，不要输出解释。',
      'JSON 格式：{"decision":"promote|skip","reason":"...","candidates":[{"layer":"L2|L3","title":"...","content":"...","confidence":0.0,"reason":"...","evidence":"..."}]}。',
      'L2 只保存长期稳定事实：用户明确表达的长期偏好、身份定位、稳定配置、长期规则、全局约束。',
      'L3 只保存抽象可复用流程：必须有适用触发条件、可复用步骤、验证/回退方式。',
      '必须区分“用户本人身份”和“助手/产品身份”：用户说“你是 claude-yh”“你改名字了”“你是我基于 claude-code 开发的智能体”时，指的是助手或产品 claude-yh，不是用户本人。',
      '除非用户明确说“我叫 claude-yh”“称呼我为 claude-yh”，否则绝不能写“用户身份是 claude-yh”或“称呼用户为 claude-yh”。',
      '如果身份归属不确定，返回空 candidates，不要猜测。',
      '不要把一次性任务、搜索请求、天气查询、论文查询、B 站/CNKI/网页搜索、问候、工具询问、当前会话标题沉淀为记忆。',
      'SOP 标题必须是抽象流程名，不能是“去某网站搜索某内容”这种具体任务。',
      '如果没有长期价值，返回 {"decision":"skip","reason":"没有可沉淀的长期事实、偏好、稳定规则、SOP 或 Skill","candidates":[]}。',
      '不要保存密钥、token、cookie、账号密码等敏感内容。',
    ].join('\n'),
    userPrompt: JSON.stringify({
      l4: {
        id: entry.id,
        title: entry.title,
        source: entry.source || entry.path,
        summary: entry.summary,
        content: entry.content?.slice(0, 10_000),
      },
    }),
  }).catch(error => {
    logDiagnosticEvent({
      scope: 'memoryV2.distill',
      event: 'model_extract_failed',
      ok: false,
      severity: 'warn',
      data: {
        entryId: entry.id,
        sessionTitle: entry.title,
        entryTitle: entry.title,
        title: entry.title,
        error: error instanceof Error ? error.message : String(error),
      },
    })
    return null
  })
  if (!modelResult) {
    logDiagnosticEvent({
      scope: 'memoryV2.distill',
      event: 'model_extract_skipped',
      ok: true,
      severity: 'info',
      data: {
        entryId: entry.id,
        sessionTitle: entry.title,
        entryTitle: entry.title,
        title: entry.title,
        reason: 'main_model_unavailable_or_disabled',
      },
    })
    return []
  }

  const parsed = parseJsonFromModelText(modelResult.content)
  const rawCandidates = Array.isArray(parsed?.candidates) ? parsed.candidates : []
  const candidates = rawCandidates
    .map((item, index) => normalizeModelMemoryCandidate(item, entry, index))
    .filter((candidate): candidate is MemoryV2DistillCandidate => candidate !== null)
  const decision = typeof parsed?.decision === 'string'
    ? parsed.decision
    : candidates.length > 0 ? 'promote' : 'skip'
  const reason = typeof parsed?.reason === 'string'
    ? parsed.reason
    : candidates.length > 0
      ? '模型返回了可沉淀候选。'
      : '模型未返回可沉淀候选。'
  logDiagnosticEvent({
    scope: 'memoryV2.distill',
    event: 'model_extract_completed',
    ok: true,
    severity: 'info',
    data: {
      entryId: entry.id,
      sessionTitle: entry.title,
      entryTitle: entry.title,
      title: entry.title,
      model: modelResult.model,
      modelSource: modelResult.source,
      decision,
      reason,
      modelOutput: truncateDiagnosticText(modelResult.content, 1800),
      parsedJson: parsed ? truncateDiagnosticText(JSON.stringify(parsed, null, 2), 1800) : null,
      rawCandidates: rawCandidates.length,
      acceptedCandidates: candidates.length,
      acceptedTitles: candidates.map(candidate => candidate.title),
      rejectedCandidates: Math.max(0, rawCandidates.length - candidates.length),
      candidateDetails: candidates.map(candidate => ({
        layer: candidate.layer,
        title: candidate.title,
        confidence: candidate.confidence,
        reason: candidate.reason,
      })),
    },
  })
  return candidates
}

function truncateDiagnosticText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+$/g, '')
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 3)}...`
}

function normalizeModelMemoryCandidate(
  value: unknown,
  entry: MemoryV2Entry,
  index: number,
): MemoryV2DistillCandidate | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const layer = record.layer === 'L2' || record.layer === 'L3' ? record.layer : null
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const content = typeof record.content === 'string' ? record.content.trim() : ''
  const reason = typeof record.reason === 'string' ? record.reason.trim() : ''
  const evidence = typeof record.evidence === 'string' ? record.evidence.trim() : ''
  const confidence = typeof record.confidence === 'number' ? record.confidence : 0
  if (!layer || !title || !content || confidence < 0.78) return null
  if (isLikelyInvertedAssistantIdentity(title, content)) return null

  return {
    id: `candidate-${entry.id}-${index + 1}`,
    layer,
    title: normalizeModelMemoryTitle(title, layer),
    content: [
      content,
      '',
      '## 溯源',
      '',
      `- L4: ${relativeMemoryPath(getMemoryV2Paths().root, entry.path)}`,
      `- Source: ${entry.source || entry.path}`,
      evidence ? `- Evidence: ${evidence}` : '',
    ].filter(Boolean).join('\n'),
    source: entry.source || entry.path,
    confidence,
    reason: reason || '由长期记忆抽取子智能体判定为可沉淀内容。',
    verified: true as const,
  }
}

function normalizeModelMemoryTitle(title: string, layer: 'L2' | 'L3'): string {
  const factPrefix = 'Fact: '
  const sopPrefix = 'SOP: '
  if (layer === 'L2') {
    if (title.startsWith(factPrefix)) return title
    if (title.startsWith(sopPrefix)) return factPrefix + title.slice(sopPrefix.length).trim()
    return factPrefix + title
  }
  if (title.startsWith(sopPrefix)) return title
  if (title.startsWith(factPrefix)) return sopPrefix + title.slice(factPrefix.length).trim()
  return sopPrefix + title
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
  await ensureCoreMemorySops(paths)
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
  return currentL1IndexContent()
}

function currentL1IndexContent(): string {
  return [
    '# 记忆索引',
    '我是 claude-yh 的 L1 存在性索引，只保存 L2/L3 的入口、主题和触发词；具体内容按相对路径检索读取。',
    '- L2 facts/：长期事实、偏好、稳定规则。',
    '- L3 sops/：可复用 SOP；sops/skills/：claude-yh 专属 Skill。',
    '- L4 sessions/：会话摘要和证据归档，只用于溯源，不直接注入上下文。',
  ].join('\n') + '\n'
}

function isBrokenDefaultL1Index(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return true
  return (
    trimmed.includes('Memory Index') ||
    trimmed.includes('鐠佹澘') ||
    trimmed.includes('记忆') ||
    trimmed.includes('我是') ||
    trimmed.includes('L1 index: short pointers only')
  )
}

function normalizeL1IndexContent(content: string, oldDefault: string): string {
  if (content.trim() === oldDefault.trim() || isBrokenDefaultL1Index(content)) {
    return currentL1IndexContent()
  }
  return content
}

async function ensureCoreMemorySops(paths: MemoryV2Paths): Promise<void> {
  if (
    process.env.CLAUDE_YH_DISABLE_CORE_MEMORY_SOPS === '1' ||
    process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
  ) {
    return
  }

  const coreSops: Array<{ file: string; title: string; source: string; content: string }> = [
    {
      file: 'memory-management.md',
      title: 'Memory management SOP',
      source: 'builtin:ga-memory-management-sop',
      content: [
        'claude-yh 的长期记忆遵守 Action-Verified Memory：只有用户明确表达的长期偏好、稳定事实、配置约束，或已经被工具结果验证过的经验，才能写入 L2/L3。',
        '',
        '- L1 只做存在性索引和检索路线，不罗列完整文件清单，不保存原始会话。',
        '- L2 facts/ 保存长期事实、偏好、角色定位和稳定规则，必须能追溯到 source。',
        '- L3 sops/ 保存可复用流程；sops/skills/ 保存可被模型主动调用的 claude-yh 专属 Skill。',
        '- L4 sessions/ 保存原始会话摘要、证据和来源，只能作为溯源材料。',
        '- 同一经验在 L3 内二选一：适合主动调用写 Skill，否则写 SOP，不能重复保存。',
        '- 会话关闭、切换会话、应用退出或长时间空闲后统一抽取；L2/L3 变化后再重写 L1。',
      ].join('\n'),
    },
    {
      file: 'verification.md',
      title: 'Verification SOP',
      source: 'builtin:ga-verification-sop',
      content: [
        '完成任务前必须尽量给出真实验证证据，而不是只做静态编译或口头判断。',
        '',
        '- 代码改动优先运行相关单测、类型检查、构建或实际交互 smoke test。',
        '- UI/浏览器能力优先用真实页面、截图、DOM、控制台或网络日志验证。',
        '- 输出结论必须区分 PASS、PARTIAL、FAIL，并记录未验证的残余风险。',
        '- 失败时保留错误原文、命令、时间和可复现入口，方便后续分析。',
      ].join('\n'),
    },
    {
      file: 'jarvis-autonomous-operation.md',
      title: 'Jarvis autonomous operation SOP',
      source: 'builtin:ga-proactive-agent-sop',
      content: [
        'Jarvis 是 24 小时常驻的主动型智能体，不是普通定时任务包装。它应接收目标、拆解计划、排队执行、记录 checkpoint，并在风险边界内主动推进。',
        '',
        '- 每个 Jarvis 任务需要 goal、边界、预算、停止条件和恢复 checkpoint。',
        '- 遇到登录、验证码、支付、外部发送、不可逆操作或密钥隐私风险时暂停并请求确认。',
        '- 每次执行后写 TODO、history 和 report，记录做了什么、结果如何、下一步是什么。',
        '- 进程重启后从 checkpoint 和队列恢复，不能重复 claim 同一任务。',
      ].join('\n'),
    },
  ]

  for (const sop of coreSops) {
    const targetPath = path.join(paths.sopsDir, sop.file)
    if (await pathExists(targetPath)) continue
    await writeEntryAtPath('L3', targetPath, {
      title: sop.title,
      content: sop.content,
      verified: true,
      source: sop.source,
    })
  }
}

async function rewriteCompactIndex(paths: MemoryV2Paths): Promise<void> {
  const facts = (await listMarkdownEntries('L2', paths.factsDir)).filter(entry => !isLowValueMemory(entry))
  const sops = (await listL3Entries(paths)).filter(entry => !isLowValueMemory(entry))
  const l4 = await listSummaryEntries(paths.summariesDir)
  await fs.writeFile(paths.indexPath, buildProseL1Index(paths, facts, sops, l4), 'utf-8')
}

function relativeMemoryPath(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/') || '.'
}

function isLikelyInvertedAssistantIdentity(title: string, content: string): boolean {
  const text = `${title}\n${content}`.toLowerCase()
  const mentionsClaudeYh = text.includes('claude-yh') || text.includes('claude yh')
  if (!mentionsClaudeYh) return false
  if (text.includes('称呼用户为 claude-yh') || text.includes('用户身份') || text.includes('用户本人')) {
    const explicitUserSelfName = text.includes('我叫 claude-yh') || text.includes('称呼我为 claude-yh')
    return !explicitUserSelfName
  }
  return false
}

function buildProseL1Index(
  paths: MemoryV2Paths,
  facts: MemoryV2Entry[],
  sops: MemoryV2Entry[],
  l4: MemoryV2Entry[],
): string {
  const regularSops = sops.filter(entry => !isSkillEntry(entry))
  const userSummary = summarizeL1MemoryEntries(facts, '暂无长期偏好、角色定位或稳定事实')
  const l2Summary = summarizeL1MemoryEntries(facts, '暂无 L2 主题')
  const l3Summary = summarizeL1MemoryEntries(regularSops, '暂无普通 SOP')
  const l2Path = `${relativeMemoryPath(paths.root, paths.factsDir)}/`
  const sopPath = `${relativeMemoryPath(paths.root, paths.sopsDir)}/`
  const l4Path = `${relativeMemoryPath(paths.root, paths.summariesDir)}/`

  return enforceL1IndexBounds([
    '# 记忆索引',
    '角色定位：暂无已沉淀的长期角色定位。',
    `用户长期偏好：${withChinesePeriod(userSummary)}`,
    `L2 facts：${withChinesePeriod(l2Summary)} 细节见 \`${l2Path}\`。`,
    `L3 SOP：${withChinesePeriod(l3Summary)} 细节见 \`${sopPath}\`。`,
    `溯源：会话摘要见 \`${l4Path}\`，当前 ${l4.length} 条。`,
  ].join('\n'))
}

function isSkillEntry(entry: MemoryV2Entry): boolean {
  return entry.id.startsWith('skill-') || entry.path.includes(`${path.sep}skills${path.sep}`)
}

function withChinesePeriod(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return '。'
  return /[。！？!?]$/u.test(trimmed) ? trimmed : `${trimmed}。`
}

function trimTrailingSentencePunctuation(value: string): string {
  return value.trim().replace(/[。！？!?]+$/u, '')
}

function summarizeL1MemoryEntries(entries: MemoryV2Entry[], empty: string): string {
  const summary = summarizeEntryThemes(entries, 5)
  return truncateText(summary || empty, L1_SECTION_MAX_CHARS)
}

function enforceL1IndexBounds(content: string): string {
  let lines = compactMarkdownBlankLines(content).split(/\r?\n/).slice(0, L1_INDEX_MAX_LINES)
  let bounded = `${lines.join('\n').trimEnd()}\n`
  if (bounded.length <= L1_INDEX_MAX_CHARS) return bounded

  lines = lines.map((line, index) => {
    if (index <= 2 || line.length <= 180) return line
    return truncateText(line, 180)
  })
  bounded = `${lines.join('\n').trimEnd()}\n`
  if (bounded.length <= L1_INDEX_MAX_CHARS) return bounded

  return `${bounded.slice(0, L1_INDEX_MAX_CHARS - 4).trimEnd()}...\n`
}

function compactMarkdownBlankLines(content: string): string {
  return content
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.trim().length > 0)
    .join('\n')
    .trim()
}

function summarizeEntryThemes(entries: MemoryV2Entry[], limit: number): string {
  const useful = entries
    .filter(entry => !isLowValueMemory(entry))
    .map(entry => compactEntryTheme(entry))
    .filter(Boolean)
  const seen = new Set<string>()
  const selected: string[] = []
  for (const item of useful) {
    const key = normalizeL1ThemeKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    selected.push(item)
    if (selected.length >= limit) break
  }
  return joinChineseProse(selected)
}

function compactEntryTheme(entry: MemoryV2Entry): string {
  const title = normalizeL1ThemeDisplay(cleanMemoryTitle(entry.title))
  const body = normalizeL1ThemeDisplay(firstUsefulSentence(entry.content || entry.summary || ''))
  const titleOnly = title && !/^(fact|sop|skill)$/i.test(title) ? title : ''
  const bodyTheme = stripGenericL1ThemePrefix(body)
  if (bodyTheme) {
    if (!titleOnly || isGenericL1ThemeTitle(titleOnly) || bodyTheme.toLowerCase().includes(titleOnly.toLowerCase())) {
      return truncateText(bodyTheme, 90)
    }
    return truncateText(`${titleOnly}：${bodyTheme}`, 90)
  }
  if (!titleOnly || isGenericL1ThemeTitle(titleOnly)) return ''
  return truncateText(titleOnly, 90)
}

function normalizeL1ThemeKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\b\d+\b/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function normalizeL1ThemeDisplay(value: string): string {
  return stripGenericL1ThemePrefix(value)
    .replace(/\s+\d+$/u, '')
    .replace(/([\p{Script=Han}A-Za-z_-]+)\s+\d+\s*[:：]/gu, '$1：')
    .replace(/[:：]\s*[:：]+/g, '：')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripGenericL1ThemePrefix(value: string): string {
  let text = value.replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 3; i++) {
    const next = text
      .replace(/^(长期偏好与事实|用户长期偏好|可复用流程|流程)\s*\d*\s*[:：]\s*/u, '')
      .replace(/^(长期偏好|用户偏好|稳定事实|事实|偏好)\s*\d*\s*[:：]\s*/u, '')
      .replace(/^(Fact|SOP|Skill)\s*[:：]\s*/i, '')
      .trim()
    if (next === text) break
    text = next
  }
  return text
}

function isGenericL1ThemeTitle(title: string): boolean {
  return /^(长期偏好与事实|用户长期偏好|长期偏好|用户偏好|稳定事实|事实|偏好|可复用流程|流程)$/u.test(title.trim())
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
  const sentences = (normalized.match(/[^。！？!?]+[。！？!?]?/gu) ?? [normalized])
    .map(sentence => sentence.trim())
    .filter(Boolean)
    .filter(sentence => !isL1SummaryNoiseSentence(sentence))
  return sentences[0] || ''
}

function isL1SummaryNoiseSentence(sentence: string): boolean {
  return /这里故意|故意写|用来测试|测试 L1|测试 L3|压测|demo/i.test(sentence)
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim()
  if (trimmed.length <= maxLength) return trimmed
  const candidate = trimmed.slice(0, maxLength)
  const punctuationCut = Math.max(
    candidate.lastIndexOf('。'),
    candidate.lastIndexOf('；'),
    candidate.lastIndexOf(';'),
    candidate.lastIndexOf('，'),
    candidate.lastIndexOf(','),
  )
  if (punctuationCut >= 20) return candidate.slice(0, punctuationCut)
  const spaceCut = candidate.lastIndexOf(' ')
  if (spaceCut >= 20) return candidate.slice(0, spaceCut)
  return candidate
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
    `# ${input.title}`,
    compactMarkdownBlankLines(input.content),
  ].filter(line => line !== '').join('\n').trimEnd() + '\n'
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
    content: compactMarkdownBlankLines(input.content),
    summary: summarizeText(input.content),
    updatedAt: stat.mtime.toISOString(),
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
  }
}

function localizeMemoryEntry(entry: MemoryV2Entry): MemoryV2Entry {
  if (entry.layer !== 'L1') return entry
  return {
    ...entry,
    title: entry.layer === 'L1' ? '\u8bb0\u5fc6\u7d22\u5f15' : entry.title,
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
  const normalized = content.replace(/^\uFEFF/, '')
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---/)
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
  return content.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n*/, '')
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

function summarizeText(value: string, max = 220): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 3).trimEnd()}...`
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
    '## Semantic Summary',
    `Goal and context: ${excerpts}`,
    `Reusable signals: ${reusableSignals.join(', ') || 'none detected'}`,
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
  if (!summary) return compactMarkdownBlankLines(fallback)

  const outcome = typeof parsed?.outcome === 'string' ? parsed.outcome.trim() : ''
  const modelSignals = Array.isArray(parsed?.reusable_signals)
    ? parsed.reusable_signals.filter((item): item is string => typeof item === 'string')
    : []
  const risks = Array.isArray(parsed?.risks)
    ? parsed.risks.filter((item): item is string => typeof item === 'string')
    : []

  const summaryMarkdown = [
    `Session: ${input.title}`,
    `Project: ${input.projectPath}`,
    `Messages: ${input.messageCount}`,
    `Created: ${input.createdAt}`,
    `Modified: ${input.modifiedAt}`,
    `Source: ${input.filePath}`,
    '## Semantic Summary',
    summary,
    '## Outcome',
    outcome || 'Model summary did not provide a separate outcome.',
    '## Reusable Signals',
    ...(modelSignals.length > 0 ? modelSignals.map(item => `- ${item}`) : [`- ${reusableSignals.join(', ') || 'none detected'}`]),
    '## Risks And Promotion Rules',
    ...(risks.length > 0 ? risks.map(item => `- ${item}`) : ['- This L4 entry is evidence only. Promote to L2/L3 only through verified automation rules.']),
  ].join('\n')
  return compactMarkdownBlankLines(summaryMarkdown)
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
