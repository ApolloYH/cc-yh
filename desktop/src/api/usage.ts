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

export type UsageLog = {
  requestId: string
  sessionId: string
  sessionTitle: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  totalCostUsd: string
  createdAt: number
}

export type UsageDetail = {
  range: UsageRange
  summary: UsageSummary
  trends: UsageTrend[]
  models: UsageModelStats[]
  logs: UsageLog[]
}

export const usageApi = {
  getDetail(range: UsageRange = 'today') {
    return api.get<UsageDetail>(`/api/status/usage-detail?range=${encodeURIComponent(range)}`, { timeout: 60_000 })
  },
}
