/**
 * Status REST API
 *
 * GET /api/status              — 健康检查
 * GET /api/status/diagnostics  — 系统诊断信息
 * GET /api/status/usage        — Token 用量（当前会话累计）
 * GET /api/status/user         — 用户信息
 */

import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs/promises'
import { PRODUCT_DISPLAY_VERSION } from '../../utils/branding.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { sessionService, type MessageEntry } from '../services/sessionService.js'
import { ModelPricingService } from '../services/modelPricingService.js'

// 服务器启动时间（用于计算 uptime）
const startedAt = Date.now()

// 会话级别的 token 用量累计（进程生命周期内）
const usage = {
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCacheReadTokens: 0,
  totalCacheCreationTokens: 0,
  totalCost: 0,
}

const modelPricingService = new ModelPricingService()

/** 供外部累加 token 用量 */
export function addUsage(
  input: number,
  output: number,
  cost: number,
  cacheRead = 0,
  cacheCreation = 0,
) {
  usage.totalInputTokens += input
  usage.totalOutputTokens += output
  usage.totalCacheReadTokens += cacheRead
  usage.totalCacheCreationTokens += cacheCreation
  usage.totalCost += cost
}

/** 重置用量（测试用） */
export function resetUsage() {
  usage.totalInputTokens = 0
  usage.totalOutputTokens = 0
  usage.totalCacheReadTokens = 0
  usage.totalCacheCreationTokens = 0
  usage.totalCost = 0
}

// ─── Router ───────────────────────────────────────────────────────────────────

export async function handleStatusApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const sub = segments[2] // 'diagnostics' | 'usage' | 'user' | undefined

    if (sub === 'model-pricing') {
      return await handleModelPricing(req)
    }

    if (req.method !== 'GET') {
      throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
    }

    switch (sub) {
      case undefined:
        return handleHealthCheck()

      case 'diagnostics':
        return handleDiagnostics()

      case 'usage':
        return handleUsage()

      case 'usage-detail':
        return await handleUsageDetail(_url)

      case 'user':
        return await handleUser()

      default:
        throw ApiError.notFound(`Unknown status endpoint: ${sub}`)
    }
  } catch (error) {
    return errorResponse(error)
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

function handleHealthCheck(): Response {
  return Response.json({
    status: 'ok',
    version: getVersion(),
    uptime: Date.now() - startedAt,
  })
}

function handleDiagnostics(): Response {
  return Response.json({
    nodeVersion: process.version,
    bunVersion: typeof Bun !== 'undefined' ? Bun.version : 'N/A',
    platform: process.platform,
    arch: process.arch,
    configDir: getConfigDir(),
    memory: {
      rss: process.memoryUsage.rss(),
      heapUsed: process.memoryUsage().heapUsed,
      heapTotal: process.memoryUsage().heapTotal,
    },
  })
}

function handleUsage(): Response {
  return Response.json({
    totalInputTokens: usage.totalInputTokens,
    totalOutputTokens: usage.totalOutputTokens,
    totalCacheReadTokens: usage.totalCacheReadTokens,
    totalCacheCreationTokens: usage.totalCacheCreationTokens,
    totalTokens:
      usage.totalInputTokens +
      usage.totalOutputTokens +
      usage.totalCacheReadTokens +
      usage.totalCacheCreationTokens,
    totalCost: usage.totalCost,
  })
}

async function handleUsageDetail(url: URL): Promise<Response> {
  const range = url.searchParams.get('range') || 'today'
  const { startMs, endMs } = resolveUsageRange(range)
  const { sessions } = await sessionService.listSessions({ limit: 10000 })
  type UsageLogCandidate = {
    requestId: string
    sessionId: string
    sessionTitle: string
    providerName: string
    billingModel: string
    status: string
    source: string
    latencyMs: number | null
    firstTokenMs: number | null
    model: string
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    totalTokens: number
    totalCostUsd: string
    createdAt: number
  }
  const logCandidates = new Map<string, UsageLogCandidate>()
  const modelStats = new Map<string, {
    model: string
    requestCount: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    totalTokens: number
    totalCostUsd: number
  }>()
  const providerStats = new Map<string, {
    providerName: string
    requestCount: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    totalTokens: number
    totalCostUsd: number
    successRate: number
  }>()

  for (const session of sessions) {
    const messages = await sessionService.getSessionMessages(session.id)
    for (const message of messages) {
      const normalized = normalizeMessageUsage(message)
      if (!normalized) continue
      const createdAt = new Date(message.timestamp).getTime()
      if (createdAt < startMs || createdAt > endMs) continue

      const model = message.model || 'unknown'
      const totalTokens =
        normalized.inputTokens +
        normalized.outputTokens +
        normalized.cacheReadTokens +
        normalized.cacheCreationTokens
      const cost = await modelPricingService.calculateCost(model, normalized)
      const providerName = inferProviderName(model)
      const candidate = {
        requestId: message.id,
        sessionId: session.id,
        sessionTitle: session.title,
        providerName,
        billingModel: cost.matchedPricing?.modelId ?? model,
        status: '成功',
        source: '会话记录',
        latencyMs: null,
        firstTokenMs: null,
        model,
        ...normalized,
        totalTokens,
        totalCostUsd: cost.totalCostUsd.toFixed(6),
        createdAt,
      }
      const dedupeKey = `${session.id}:${Math.floor(createdAt / 1000)}:${model}`
      const existing = logCandidates.get(dedupeKey)
      if (!existing || candidate.totalTokens > existing.totalTokens) {
        logCandidates.set(dedupeKey, candidate)
      }
    }
  }

  const logs = [...logCandidates.values()]
  logs.sort((a, b) => b.createdAt - a.createdAt)
  const trendStats = createEmptyTrendBuckets(logs, startMs, endMs, range)

  for (const log of logs) {
    const existingModel = modelStats.get(log.model) ?? {
      model: log.model,
      requestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      totalCostUsd: 0,
    }
    existingModel.requestCount += 1
    existingModel.inputTokens += log.inputTokens
    existingModel.outputTokens += log.outputTokens
    existingModel.cacheReadTokens += log.cacheReadTokens
    existingModel.cacheCreationTokens += log.cacheCreationTokens
    existingModel.totalTokens += log.totalTokens
    existingModel.totalCostUsd += Number(log.totalCostUsd) || 0
    modelStats.set(log.model, existingModel)

    const existingProvider = providerStats.get(log.providerName) ?? {
      providerName: log.providerName,
      requestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      successRate: 100,
    }
    existingProvider.requestCount += 1
    existingProvider.inputTokens += log.inputTokens
    existingProvider.outputTokens += log.outputTokens
    existingProvider.cacheReadTokens += log.cacheReadTokens
    existingProvider.cacheCreationTokens += log.cacheCreationTokens
    existingProvider.totalTokens += log.totalTokens
    existingProvider.totalCostUsd += Number(log.totalCostUsd) || 0
    providerStats.set(log.providerName, existingProvider)

    const bucket = getTrendBucket(log.createdAt, range)
    const existingTrend = trendStats.get(bucket) ?? emptyTrendBucket(bucket)
    existingTrend.requestCount += 1
    existingTrend.totalInputTokens += log.inputTokens
    existingTrend.totalOutputTokens += log.outputTokens
    existingTrend.totalCacheReadTokens += log.cacheReadTokens
    existingTrend.totalCacheCreationTokens += log.cacheCreationTokens
    existingTrend.totalTokens += log.totalTokens
    existingTrend.totalCostUsd += Number(log.totalCostUsd) || 0
    trendStats.set(bucket, existingTrend)
  }

  const summary = logs.reduce(
    (acc, log) => {
      acc.totalRequests += 1
      acc.totalInputTokens += log.inputTokens
      acc.totalOutputTokens += log.outputTokens
      acc.totalCacheReadTokens += log.cacheReadTokens
      acc.totalCacheCreationTokens += log.cacheCreationTokens
      acc.totalTokens += log.totalTokens
      acc.totalCostValue += Number(log.totalCostUsd) || 0
      return acc
    },
    {
      totalRequests: 0,
      totalCost: '0.000000',
      totalCostValue: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheCreationTokens: 0,
      totalTokens: 0,
      successRate: logs.length > 0 ? 100 : 0,
    },
  )
  summary.totalCost = summary.totalCostValue.toFixed(6)
  const { totalCostValue: _totalCostValue, ...summaryResponse } = summary

  return Response.json({
    range,
    summary: summaryResponse,
    trends: [...trendStats.values()].sort((a, b) => a.date.localeCompare(b.date)),
    providers: [...providerStats.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    models: [...modelStats.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    logs: logs.slice(0, 100),
  })
}

async function handleModelPricing(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    return Response.json({ pricing: await modelPricingService.listPricing() })
  }

  if (req.method === 'PUT') {
    const body = await req.json().catch(() => null) as { pricing?: unknown } | null
    if (!body || !Array.isArray(body.pricing)) {
      throw ApiError.badRequest('pricing array is required')
    }
    return Response.json({ pricing: await modelPricingService.savePricing(body.pricing) })
  }

  throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
}

async function handleUser(): Promise<Response> {
  const configDir = getConfigDir()
  const projects = await discoverProjects(configDir)

  return Response.json({
    configDir,
    projects,
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeMessageUsage(message: MessageEntry): {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
} | null {
  const usage = message.usage
  if (!usage) return null

  const inputTokens = Math.max(0, Number(usage.input_tokens ?? 0))
  const outputTokens = Math.max(0, Number(usage.output_tokens ?? 0))
  const cacheReadTokens = Math.max(0, Number(
    usage.cache_read_input_tokens ??
    usage.cache_read_tokens ??
    usage.input_tokens_details?.cached_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    0,
  ))
  const cacheCreationTokens = Math.max(0, Number(
    usage.cache_creation_input_tokens ??
    usage.cache_creation_tokens ??
    ((usage.cache_creation?.ephemeral_5m_input_tokens ?? 0) +
      (usage.cache_creation?.ephemeral_1h_input_tokens ?? 0)),
  ))

  if (inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens <= 0) {
    return null
  }

  return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens }
}

function resolveUsageRange(range: string): { startMs: number; endMs: number } {
  const now = new Date()
  const endMs = now.getTime()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime()

  switch (range) {
    case '1d':
      return { startMs: endMs - 24 * 60 * 60 * 1000, endMs }
    case '7d':
      return { startMs: endMs - 7 * 24 * 60 * 60 * 1000, endMs }
    case '30d':
      return { startMs: endMs - 30 * 24 * 60 * 60 * 1000, endMs }
    case 'all':
      return { startMs: 0, endMs }
    case 'today':
    default:
      return { startMs: startOfToday, endMs: endOfToday }
  }
}

function getTrendBucket(timestamp: number, range: string): string {
  const date = new Date(timestamp)
  if (range === 'today' || range === '1d') {
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:00`
  }
  return date.toISOString().slice(0, 10)
}

function createEmptyTrendBuckets(
  logs: Array<{ createdAt: number }>,
  startMs: number,
  endMs: number,
  range: string,
): Map<string, {
  date: string
  requestCount: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheCreationTokens: number
  totalTokens: number
  totalCostUsd: number
}> {
  const buckets = new Map<string, ReturnType<typeof emptyTrendBucket>>()
  const firstLogMs = logs.length > 0 ? Math.min(...logs.map((log) => log.createdAt)) : endMs
  const actualStartMs = range === 'all' ? firstLogMs : startMs
  const cursor = new Date(actualStartMs)
  const end = new Date(endMs)

  if (range === 'today' || range === '1d') {
    cursor.setMinutes(0, 0, 0)
    end.setMinutes(0, 0, 0)
    while (cursor.getTime() <= end.getTime()) {
      const bucket = getTrendBucket(cursor.getTime(), range)
      buckets.set(bucket, emptyTrendBucket(bucket))
      cursor.setHours(cursor.getHours() + 1)
    }
    return buckets
  }

  cursor.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)
  while (cursor.getTime() <= end.getTime()) {
    const bucket = getTrendBucket(cursor.getTime(), range)
    buckets.set(bucket, emptyTrendBucket(bucket))
    cursor.setDate(cursor.getDate() + 1)
  }
  return buckets
}

function emptyTrendBucket(date: string) {
  return {
    date,
    requestCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
  }
}

function inferProviderName(model: string): string {
  const normalized = model.toLowerCase()
  if (normalized.includes('minimax')) return 'MiniMax'
  if (normalized.includes('deepseek')) return 'DeepSeek'
  if (normalized.includes('kimi') || normalized.includes('moonshot')) return 'Kimi'
  if (normalized.includes('glm')) return '智谱 GLM'
  if (normalized.includes('qwen')) return '通义千问'
  if (normalized.includes('gemini')) return 'Google Gemini'
  if (normalized.includes('gpt') || normalized.includes('o1') || normalized.includes('o3') || normalized.includes('o4') || normalized.includes('codex')) return 'OpenAI'
  if (normalized.includes('claude')) return 'Anthropic'
  return 'Claude YH'
}

function getConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude-yh')
}

function getVersion(): string {
  // 从 package.json 的 version 字段读取；回退到环境变量或 unknown
  return process.env.APP_VERSION || PRODUCT_DISPLAY_VERSION
}

/**
 * 扫描 configDir 下的 projects 目录，返回已知的项目路径列表。
 * 如果目录不存在，返回空数组。
 */
async function discoverProjects(configDir: string): Promise<string[]> {
  const projectsDir = path.join(configDir, 'projects')
  try {
    const entries = await fs.readdir(projectsDir)
    return entries.filter((e) => !e.startsWith('.'))
  } catch {
    return []
  }
}
