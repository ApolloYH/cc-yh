import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

export type MemoryEmbeddingProvider = 'dashscope' | 'openai-compatible' | 'local'

export type MemoryEmbeddingConfig = {
  provider: MemoryEmbeddingProvider
  baseUrl: string
  model: string
  dimensions: number
  batchSize: number
  timeoutMs: number
  enabled: boolean
  hasApiKey: boolean
  method: 'faiss-dashscope-embedding' | 'faiss-openai-compatible-embedding' | 'faiss-local-embedding'
  source: 'env' | 'settings' | 'default'
}

export type MemoryEmbeddingResult = {
  embeddings: number[][]
  config: MemoryEmbeddingConfig
  remote: boolean
  error?: string
}

type MemoryEmbeddingSettings = {
  provider?: unknown
  baseUrl?: unknown
  apiKey?: unknown
  apiKeyEnv?: unknown
  model?: unknown
  dimensions?: unknown
  batchSize?: unknown
  timeoutMs?: unknown
  enabled?: unknown
}

type EmbeddingCacheRecord = {
  key: string
  embedding: number[]
  provider: MemoryEmbeddingProvider
  model: string
  dimensions: number
  updatedAt: string
}

type EmbeddingCache = {
  version: 1
  records: Record<string, EmbeddingCacheRecord>
}

const DEFAULT_DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const DEFAULT_DASHSCOPE_MODEL = 'text-embedding-v4'
const DEFAULT_REMOTE_DIMENSIONS = 1024
const DEFAULT_LOCAL_DIMENSIONS = 256

export async function getMemoryEmbeddingConfig(): Promise<MemoryEmbeddingConfig> {
  const settings = await readEmbeddingSettings()
  const provider = readProvider(
    process.env.CLAUDE_YH_EMBEDDING_PROVIDER ??
      asString(settings.provider) ??
      'dashscope',
  )
  const source: MemoryEmbeddingConfig['source'] =
    process.env.CLAUDE_YH_EMBEDDING_PROVIDER ||
    process.env.CLAUDE_YH_EMBEDDING_API_KEY ||
    process.env.DASHSCOPE_API_KEY ||
    process.env.BAILIAN_API_KEY
      ? 'env'
      : Object.keys(settings).length
        ? 'settings'
        : 'default'
  const enabled = readBoolean(
    process.env.CLAUDE_YH_EMBEDDING_ENABLED ?? asString(settings.enabled),
    true,
  )
  const apiKey = resolveApiKey(settings)
  const isLocal = provider === 'local' || !enabled || !apiKey
  const dimensions = readPositiveInt(
    process.env.CLAUDE_YH_EMBEDDING_DIMENSIONS ?? asString(settings.dimensions),
    isLocal ? DEFAULT_LOCAL_DIMENSIONS : DEFAULT_REMOTE_DIMENSIONS,
  )
  const configProvider = isLocal ? 'local' : provider
  return {
    provider: configProvider,
    baseUrl: normalizeBaseUrl(
      process.env.CLAUDE_YH_EMBEDDING_BASE_URL ??
        asString(settings.baseUrl) ??
        DEFAULT_DASHSCOPE_BASE_URL,
    ),
    model:
      process.env.CLAUDE_YH_EMBEDDING_MODEL ??
      asString(settings.model) ??
      DEFAULT_DASHSCOPE_MODEL,
    dimensions,
    batchSize: readPositiveInt(
      process.env.CLAUDE_YH_EMBEDDING_BATCH_SIZE ?? asString(settings.batchSize),
      10,
    ),
    timeoutMs: readPositiveInt(
      process.env.CLAUDE_YH_EMBEDDING_TIMEOUT_MS ?? asString(settings.timeoutMs),
      20_000,
    ),
    enabled,
    hasApiKey: Boolean(apiKey),
    method: configProvider === 'dashscope'
      ? 'faiss-dashscope-embedding'
      : configProvider === 'openai-compatible'
        ? 'faiss-openai-compatible-embedding'
        : 'faiss-local-embedding',
    source,
  }
}

export async function embedMemoryTexts(input: {
  texts: string[]
  cachePath: string
}): Promise<MemoryEmbeddingResult> {
  const config = await getMemoryEmbeddingConfig()
  if (input.texts.length === 0) {
    return { embeddings: [], config, remote: false }
  }

  if (config.provider === 'local') {
    return {
      embeddings: input.texts.map(text => localSemanticEmbedding(text, config.dimensions)),
      config,
      remote: false,
    }
  }

  const cache = await readCache(input.cachePath)
  const keys = input.texts.map(text => cacheKey(config, text))
  const embeddings: Array<number[] | null> = keys.map(key => {
    const record = cache.records[key]
    return record?.embedding?.length === config.dimensions ? record.embedding : null
  })
  const missingIndexes = embeddings
    .map((embedding, index) => embedding ? -1 : index)
    .filter(index => index >= 0)

  try {
    for (let offset = 0; offset < missingIndexes.length; offset += config.batchSize) {
      const indexes = missingIndexes.slice(offset, offset + config.batchSize)
      const remote = await requestRemoteEmbeddings({
        config,
        texts: indexes.map(index => input.texts[index]),
      })
      remote.forEach((embedding, batchIndex) => {
        const index = indexes[batchIndex]
        const normalized = normalizeEmbedding(embedding, config.dimensions)
        embeddings[index] = normalized
        cache.records[keys[index]] = {
          key: keys[index],
          embedding: normalized,
          provider: config.provider,
          model: config.model,
          dimensions: config.dimensions,
          updatedAt: new Date().toISOString(),
        }
      })
    }
    await writeCache(input.cachePath, cache)
    return {
      embeddings: embeddings.map((embedding, index) =>
        embedding ?? localSemanticEmbedding(input.texts[index], config.dimensions),
      ),
      config,
      remote: true,
    }
  } catch (error) {
    const localConfig: MemoryEmbeddingConfig = {
      ...config,
      provider: 'local',
      method: 'faiss-local-embedding',
    }
    return {
      embeddings: input.texts.map(text => localSemanticEmbedding(text, localConfig.dimensions)),
      config: localConfig,
      remote: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function semanticTerms(value: string): string[] {
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
      搜索: ['search', 'find', 'query'],
    }
    return [token, ...(synonyms[token] ?? []), ...cjkBigrams(token)]
  })
  return [...new Set(expanded)]
}

export function localSemanticEmbedding(value: string, dimensions = DEFAULT_LOCAL_DIMENSIONS): number[] {
  const vector = Array.from({ length: dimensions }, () => 0)
  for (const term of semanticTerms(value)) {
    const index = hashTerm(term) % dimensions
    vector[index] += 1
  }
  return normalizeEmbedding(vector, dimensions)
}

function resolveApiKey(settings: MemoryEmbeddingSettings): string | undefined {
  const explicit =
    process.env.CLAUDE_YH_EMBEDDING_API_KEY ??
    process.env.DASHSCOPE_API_KEY ??
    process.env.BAILIAN_API_KEY ??
    asString(settings.apiKey)
  if (explicit) return explicit

  const apiKeyEnv = asString(settings.apiKeyEnv)
  if (apiKeyEnv) return process.env[apiKeyEnv]
  return undefined
}

async function requestRemoteEmbeddings(input: {
  config: MemoryEmbeddingConfig
  texts: string[]
}): Promise<number[][]> {
  const apiKey = await resolveRemoteApiKey()
  if (!apiKey) throw new Error('embedding_api_key_missing')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.config.timeoutMs)
  try {
    const response = await fetch(`${input.config.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: input.config.model,
        input: input.texts,
        dimensions: input.config.dimensions,
        encoding_format: 'float',
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`embedding_http_${response.status}:${detail.slice(0, 500)}`)
    }
    const payload = await response.json() as {
      data?: Array<{ embedding?: unknown; index?: number }>
    }
    const data = Array.isArray(payload.data) ? payload.data : []
    const ordered = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    if (ordered.length !== input.texts.length) {
      throw new Error(`embedding_count_mismatch:${ordered.length}/${input.texts.length}`)
    }
    return ordered.map(item => {
      if (!Array.isArray(item.embedding)) throw new Error('embedding_missing_vector')
      return item.embedding.map(Number)
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function resolveRemoteApiKey(): Promise<string | undefined> {
  const settings = await readEmbeddingSettings()
  return resolveApiKey(settings)
}

async function readEmbeddingSettings(): Promise<MemoryEmbeddingSettings> {
  const raw = await fs.readFile(path.join(getClaudeConfigHomeDir(), 'settings.json'), 'utf-8')
    .catch(() => '')
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const value = parsed.memoryEmbedding ?? parsed.embeddingProvider
    return value && typeof value === 'object' ? value as MemoryEmbeddingSettings : {}
  } catch {
    return {}
  }
}

async function readCache(cachePath: string): Promise<EmbeddingCache> {
  try {
    const raw = await fs.readFile(cachePath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<EmbeddingCache>
    return {
      version: 1,
      records: parsed.records && typeof parsed.records === 'object'
        ? parsed.records as Record<string, EmbeddingCacheRecord>
        : {},
    }
  } catch {
    return { version: 1, records: {} }
  }
}

async function writeCache(cachePath: string, cache: EmbeddingCache): Promise<void> {
  await fs.mkdir(path.dirname(cachePath), { recursive: true })
  const records = Object.fromEntries(
    Object.entries(cache.records)
      .sort(([, left], [, right]) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 10_000),
  )
  await fs.writeFile(cachePath, JSON.stringify({ version: 1, records }, null, 2) + '\n', 'utf-8')
}

function cacheKey(config: MemoryEmbeddingConfig, text: string): string {
  return createHash('sha256')
    .update([config.provider, config.baseUrl, config.model, config.dimensions, text].join('\0'))
    .digest('hex')
}

function normalizeEmbedding(value: readonly number[], dimensions: number): number[] {
  const vector = Array.from({ length: dimensions }, (_, index) => Number(value[index] ?? 0))
  const length = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0))
  return length > 0 ? vector.map(item => Number((item / length).toFixed(8))) : vector
}

function readProvider(value: string): MemoryEmbeddingProvider {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'local') return 'local'
  if (normalized === 'openai' || normalized === 'openai-compatible') return 'openai-compatible'
  return 'dashscope'
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function readPositiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseInt(value, 10)
      : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function cjkBigrams(value: string): string[] {
  const chars = [...value].filter(char => /\p{Script=Han}/u.test(char))
  const result: string[] = []
  for (let index = 0; index < chars.length - 1; index += 1) {
    result.push(`${chars[index]}${chars[index + 1]}`)
  }
  return result
}

function hashTerm(value: string): number {
  let hash = 2166136261
  for (const char of value) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
