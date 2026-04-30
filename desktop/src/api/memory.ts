import { api } from './client'

export type MemoryLayer = 'L1' | 'L2' | 'L3' | 'L4'

export type MemoryV2StaleStatus = {
  stale: boolean
  reason: string
  ageDays?: number
  severity: 'fresh' | 'watch' | 'stale'
}

export type MemoryV2Entry = {
  layer: MemoryLayer
  id: string
  title: string
  path: string
  source?: string
  verified: boolean
  content?: string
  summary?: string
  updatedAt?: string
  stale?: MemoryV2StaleStatus
}

export type MemoryV2LayerStatus = {
  layer: MemoryLayer
  title: string
  description: string
  path: string
  entries: MemoryV2Entry[]
}

export type MemoryV2Status = {
  root: string
  indexPath: string
  factsDir: string
  sopsDir: string
  sessionsDir: string
  summariesDir: string
  vectorIndexPath: string
  embeddingCachePath: string
  faissIndexPath: string
  faissMetaPath: string
  candidatePath: string
  vectorProvider: 'faiss' | 'local'
  embeddingProvider: 'dashscope' | 'openai-compatible' | 'local'
  embeddingModel: string
  embeddingBaseUrl: string
  embeddingDimensions: number
  embeddingRemote: boolean
  embeddingHasApiKey: boolean
  embeddingMethod: 'faiss-dashscope-embedding' | 'faiss-openai-compatible-embedding' | 'faiss-local-embedding'
  entries: MemoryV2Entry[]
  facts: MemoryV2Entry[]
  sops: MemoryV2Entry[]
  layers: MemoryV2LayerStatus[]
  stale: MemoryV2Entry[]
}

export type MemoryV2SearchResult = {
  entry: MemoryV2Entry
  score: number
  matchedTerms: string[]
  method: 'faiss-dashscope-embedding' | 'faiss-openai-compatible-embedding' | 'faiss-local-embedding' | 'local-semantic-embedding'
}

export type MemoryEmbeddingConfig = {
  provider: 'dashscope' | 'openai-compatible' | 'local'
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

export type MemoryEvent = {
  timestamp?: string
  scope?: string
  event?: string
  severity?: 'debug' | 'info' | 'warn' | 'error'
  ok?: boolean
  durationMs?: number
  data?: Record<string, unknown>
  error?: string
}

export const memoryApi = {
  status() {
    return api.get<MemoryV2Status>('/api/memory-v2')
  },
  entry(layer: MemoryLayer, id: string) {
    return api.get<{ entry: MemoryV2Entry }>(`/api/memory-v2/entry/${layer}/${encodeURIComponent(id)}`)
  },
  updateEntry(input: { layer: MemoryLayer; id: string; title?: string; content: string; source?: string }) {
    return api.put<{ entry: MemoryV2Entry }>(`/api/memory-v2/entry/${input.layer}/${encodeURIComponent(input.id)}`, {
      title: input.title,
      content: input.content,
      source: input.source,
      verified: true,
    })
  },
  search(query: string) {
    return api.post<{ results: MemoryV2SearchResult[] }>('/api/memory-v2/search', { query, limit: 20 })
  },
  embedding() {
    return api.get<{ config: MemoryEmbeddingConfig }>('/api/memory-v2/embedding')
  },
  updateEmbedding(input: Partial<MemoryEmbeddingConfig> & { apiKey?: string; apiKeyEnv?: string }) {
    return api.put<{ config: MemoryEmbeddingConfig }>('/api/memory-v2/embedding', input)
  },
  events(limit = 50) {
    return api.get<{ path: string; events: MemoryEvent[] }>(`/api/memory-v2/events?limit=${limit}`)
  },
}
