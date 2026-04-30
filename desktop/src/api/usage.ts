import { api } from './client'

export type UsageRange = 'today' | '1d' | '7d' | '30d' | 'all'

export type UsageSummary = {
  totalRequests: number
  totalCost: string
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheCreationTokens: number
  totalTokens: number
  successRate: number
}

export type UsageTrend = {
  date: string
  requestCount: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheCreationTokens: number
  totalTokens: number
  totalCostUsd: number
}

export type UsageModelStats = {
  model: string
  requestCount: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  totalCostUsd: number
}

export type UsageProviderStats = {
  providerName: string
  requestCount: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  totalCostUsd: number
  successRate: number
}

export type UsageLog = {
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

export type ModelPricing = {
  modelId: string
  displayName: string
  inputCostPerMillion: string
  outputCostPerMillion: string
  cacheReadCostPerMillion: string
  cacheCreationCostPerMillion: string
}

export type UsageDetail = {
  range: UsageRange
  summary: UsageSummary
  trends: UsageTrend[]
  providers: UsageProviderStats[]
  models: UsageModelStats[]
  logs: UsageLog[]
}

export const usageApi = {
  getDetail(range: UsageRange = 'today') {
    return api.get<UsageDetail>(`/api/status/usage-detail?range=${encodeURIComponent(range)}`, { timeout: 60_000 })
  },
  async getPricing() {
    const result = await api.get<{ pricing: ModelPricing[] }>('/api/status/model-pricing')
    return result.pricing
  },
  async savePricing(pricing: ModelPricing[]) {
    const result = await api.put<{ pricing: ModelPricing[] }>('/api/status/model-pricing', { pricing })
    return result.pricing
  },
}
