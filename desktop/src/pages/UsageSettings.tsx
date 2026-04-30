import { useEffect, useMemo, useState } from 'react'
import { usageApi, type UsageDetail, type UsageRange, type UsageTrend } from '../api/usage'

const RANGE_OPTIONS: Array<{ value: UsageRange; label: string }> = [
  { value: 'today', label: '当天' },
  { value: '1d', label: '24 小时' },
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
  { value: 'all', label: '全部' },
]

function formatNumber(value: number): string {
  return value.toLocaleString()
}

function formatCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

export function UsageSettings() {
  const [range, setRange] = useState<UsageRange>('today')
  const [data, setData] = useState<UsageDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await usageApi.getDetail(range))
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [range])

  const summary = data?.summary ?? {
    totalRequests: 0,
    totalCost: '0.000000',
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    totalTokens: 0,
    successRate: 0,
  }

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h2 className="text-2xl font-bold text-[var(--color-text-primary)]">Token 使用详情</h2>
        <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">
          查看当前 Claude YH 会话记录中的模型用量和 Token 统计。
        </p>
      </div>

      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center gap-2">
          {RANGE_OPTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setRange(item.value)}
              className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
                range === item.value
                  ? 'border-blue-200 bg-blue-50 text-blue-600'
                  : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void load()}
            className="ml-auto inline-flex items-center gap-1 rounded-xl border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
          >
            <span className={`material-symbols-outlined text-[16px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
            刷新
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4 md:grid-cols-2">
        <UsageCard icon="monitoring" tone="blue" label="总请求数" value={formatNumber(summary.totalRequests)} />
        <UsageCard icon="attach_money" tone="green" label="总成本" value={`$${summary.totalCost}`} hint="未配置价格表时为 0" />
        <UsageCard
          icon="layers"
          tone="purple"
          label="总 Token 数"
          value={formatNumber(summary.totalTokens)}
          detail={[
            ['Input', formatCompact(summary.totalInputTokens)],
            ['Output', formatCompact(summary.totalOutputTokens)],
          ]}
        />
        <UsageCard
          icon="database"
          tone="orange"
          label="缓存 Token"
          value={formatNumber(summary.totalCacheReadTokens + summary.totalCacheCreationTokens)}
          detail={[
            ['创建', formatCompact(summary.totalCacheCreationTokens)],
            ['命中', formatCompact(summary.totalCacheReadTokens)],
          ]}
        />
      </div>

      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">使用趋势</h3>
          <span className="text-sm text-[var(--color-text-tertiary)]">{RANGE_OPTIONS.find((item) => item.value === range)?.label}</span>
        </div>
        <UsageTrendChart trends={data?.trends ?? []} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <h3 className="mb-4 text-base font-semibold text-[var(--color-text-primary)]">模型统计</h3>
          <div className="space-y-2">
            {(data?.models ?? []).slice(0, 10).map((model) => (
              <div key={model.model} className="rounded-xl border border-[var(--color-border)] px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">{model.model}</span>
                  <span className="text-sm text-[var(--color-text-secondary)]">{formatNumber(model.totalTokens)} Token</span>
                </div>
                <div className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                  {model.requestCount} 次请求 · 输入 {formatNumber(model.inputTokens)} · 输出 {formatNumber(model.outputTokens)}
                </div>
              </div>
            ))}
            {(data?.models ?? []).length === 0 && (
              <div className="rounded-xl border border-dashed border-[var(--color-border)] py-8 text-center text-sm text-[var(--color-text-tertiary)]">
                暂无用量记录
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <h3 className="mb-4 text-base font-semibold text-[var(--color-text-primary)]">最近请求</h3>
          <div className="space-y-2">
            {(data?.logs ?? []).slice(0, 12).map((log) => (
              <div key={log.requestId} className="rounded-xl border border-[var(--color-border)] px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">{log.sessionTitle}</span>
                  <span className="text-xs text-[var(--color-text-tertiary)]">{new Date(log.createdAt).toLocaleString()}</span>
                </div>
                <div className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                  {log.model} · {formatNumber(log.totalTokens)} Token · 输入 {formatNumber(log.inputTokens)} / 输出 {formatNumber(log.outputTokens)}
                </div>
              </div>
            ))}
            {(data?.logs ?? []).length === 0 && (
              <div className="rounded-xl border border-dashed border-[var(--color-border)] py-8 text-center text-sm text-[var(--color-text-tertiary)]">
                暂无请求记录
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function UsageCard({
  icon,
  tone,
  label,
  value,
  hint,
  detail,
}: {
  icon: string
  tone: 'blue' | 'green' | 'purple' | 'orange'
  label: string
  value: string
  hint?: string
  detail?: Array<[string, string]>
}) {
  const toneClass = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    purple: 'bg-purple-50 text-purple-600',
    orange: 'bg-orange-50 text-orange-600',
  }[tone]

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between">
        <div className="text-sm font-semibold text-[var(--color-text-secondary)]">{label}</div>
        <span className={`material-symbols-outlined rounded-xl p-2 text-[18px] ${toneClass}`}>{icon}</span>
      </div>
      <div className="mt-5 text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">{value}</div>
      {hint && <div className="mt-2 text-xs text-[var(--color-text-tertiary)]">{hint}</div>}
      {detail && (
        <div className="mt-5 space-y-1 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-text-tertiary)]">
          {detail.map(([name, val]) => (
            <div key={name} className="flex justify-between">
              <span>{name}</span>
              <span>{val}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function UsageTrendChart({ trends }: { trends: UsageTrend[] }) {
  const points = useMemo(() => {
    const values = trends.map((item) => item.totalTokens)
    const max = Math.max(...values, 1)
    return trends.map((item, index) => {
      const x = trends.length <= 1 ? 0 : (index / (trends.length - 1)) * 100
      const y = 100 - (item.totalTokens / max) * 82 - 8
      return { x, y, item }
    })
  }, [trends])

  if (trends.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] text-sm text-[var(--color-text-tertiary)]">
        暂无趋势数据
      </div>
    )
  }

  const line = points.map((point) => `${point.x},${point.y}`).join(' ')
  const area = `0,100 ${line} 100,100`

  return (
    <div className="h-[320px] w-full">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-[260px] w-full overflow-visible">
        <defs>
          <linearGradient id="usageGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[20, 40, 60, 80].map((y) => (
          <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="var(--color-border)" strokeWidth="0.25" strokeDasharray="1 1" />
        ))}
        <polygon points={area} fill="url(#usageGradient)" />
        <polyline points={line} fill="none" stroke="#3b82f6" strokeWidth="1.4" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="mt-2 flex justify-between gap-2 overflow-hidden text-[10px] text-[var(--color-text-tertiary)]">
        {points.slice(0, 8).map((point) => (
          <span key={point.item.date} className="truncate">{point.item.date.replace(new Date().getFullYear().toString() + '-', '')}</span>
        ))}
      </div>
      <div className="mt-3 flex justify-center gap-4 text-xs">
        <span className="text-blue-600">输入/输出 Token</span>
        <span className="text-purple-600">缓存 Token</span>
      </div>
    </div>
  )
}
