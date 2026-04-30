import { useEffect, useState, type ReactNode } from 'react'
import {
  usageApi,
  type ModelPricing,
  type UsageDetail,
  type UsageLog,
  type UsageModelStats,
  type UsageProviderStats,
  type UsageRange,
  type UsageTrend,
} from '../api/usage'

const RANGE_OPTIONS: Array<{ value: UsageRange; label: string }> = [
  { value: 'today', label: '当天' },
  { value: '1d', label: '24 小时' },
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
  { value: 'all', label: '全部' },
]

const EMPTY_PRICING: ModelPricing = {
  modelId: '',
  displayName: '',
  inputCostPerMillion: '0',
  outputCostPerMillion: '0',
  cacheReadCostPerMillion: '0',
  cacheCreationCostPerMillion: '0',
}

type TableTab = 'logs' | 'providers' | 'models'

function formatNumber(value: number): string {
  return value.toLocaleString()
}

function formatCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

function formatCost(value: string | number): string {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return '$0.000000'
  return `$${numeric.toFixed(6)}`
}

export function UsageSettings() {
  const [range, setRange] = useState<UsageRange>('today')
  const [data, setData] = useState<UsageDetail | null>(null)
  const [pricing, setPricing] = useState<ModelPricing[]>([])
  const [editing, setEditing] = useState<ModelPricing | null>(null)
  const [activeTable, setActiveTable] = useState<TableTab>('logs')
  const [pricingOpen, setPricingOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [savingPricing, setSavingPricing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [detail, pricingList] = await Promise.all([
        usageApi.getDetail(range),
        usageApi.getPricing(),
      ])
      setData(detail)
      setPricing(pricingList)
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

  const handleSavePricing = async (item: ModelPricing) => {
    const normalized = {
      ...item,
      modelId: item.modelId.trim(),
      displayName: item.displayName.trim() || item.modelId.trim(),
    }
    if (!normalized.modelId) {
      setError('模型 ID 不能为空')
      return
    }

    setSavingPricing(true)
    setError(null)
    try {
      const next = [
        ...pricing.filter((entry) => entry.modelId.toLowerCase() !== normalized.modelId.toLowerCase()),
        normalized,
      ].sort((a, b) => a.modelId.localeCompare(b.modelId))
      setPricing(await usageApi.savePricing(next))
      setEditing(null)
      setData(await usageApi.getDetail(range))
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存计费配置失败')
    } finally {
      setSavingPricing(false)
    }
  }

  const handleDeletePricing = async (modelId: string) => {
    if (!window.confirm(`删除模型计费 "${modelId}"？`)) return
    setSavingPricing(true)
    setError(null)
    try {
      setPricing(await usageApi.savePricing(pricing.filter((item) => item.modelId !== modelId)))
      setData(await usageApi.getDetail(range))
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除计费配置失败')
    } finally {
      setSavingPricing(false)
    }
  }

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h2 className="text-2xl font-bold text-[var(--color-text-primary)]">使用统计</h2>
        <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">
          从 ~/.claude-yh/projects 的会话 JSONL 读取 usage，并按模型计费表计算成本。
        </p>
      </div>

      <div className="cc-glass-card rounded-2xl border border-[var(--color-border)] p-4">
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <UsageCard icon="monitoring" tone="blue" label="总请求数" value={formatNumber(summary.totalRequests)} />
        <UsageCard icon="attach_money" tone="green" label="总成本" value={formatCost(summary.totalCost)} />
        <UsageCard
          icon="layers"
          tone="purple"
          label="总 Token 数"
          value={formatNumber(summary.totalTokens)}
          detail={[
            ['输入', formatCompact(summary.totalInputTokens)],
            ['输出', formatCompact(summary.totalOutputTokens)],
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

      <div className="cc-glass-card rounded-2xl border border-[var(--color-border)] p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">使用趋势</h3>
          <span className="text-sm text-[var(--color-text-tertiary)]">
            {RANGE_OPTIONS.find((item) => item.value === range)?.label}
          </span>
        </div>
        <UsageTrendChart trends={data?.trends ?? []} />
      </div>

      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <UsageTabs active={activeTable} onChange={setActiveTable} />
        <div className="mt-4">
          {activeTable === 'logs' && <RequestLogTable logs={data?.logs ?? []} />}
          {activeTable === 'providers' && <ProviderStatsTable providers={data?.providers ?? []} />}
          {activeTable === 'models' && <ModelStatsTable models={data?.models ?? []} />}
        </div>
      </div>

      <PricingPanel
        open={pricingOpen}
        pricing={pricing}
        editing={editing}
        saving={savingPricing}
        onToggle={() => setPricingOpen((value) => !value)}
        onAdd={() => {
          setPricingOpen(true)
          setEditing(EMPTY_PRICING)
        }}
        onEdit={(item) => {
          setPricingOpen(true)
          setEditing(item)
        }}
        onCancel={() => setEditing(null)}
        onSave={(item) => void handleSavePricing(item)}
        onDelete={(modelId) => void handleDeletePricing(modelId)}
      />
    </div>
  )
}

function UsageCard({
  icon,
  tone,
  label,
  value,
  detail,
}: {
  icon: string
  tone: 'blue' | 'green' | 'purple' | 'orange'
  label: string
  value: string
  detail?: Array<[string, string]>
}) {
  const toneClass = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    purple: 'bg-purple-50 text-purple-600',
    orange: 'bg-orange-50 text-orange-600',
  }[tone]

  return (
    <div className="cc-glass-card rounded-2xl border border-[var(--color-border)] p-5">
      <div className="flex items-start justify-between">
        <div className="text-sm font-semibold text-[var(--color-text-secondary)]">{label}</div>
        <span className={`material-symbols-outlined rounded-xl p-2 text-[18px] ${toneClass}`}>{icon}</span>
      </div>
      <div className="mt-5 text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">{value}</div>
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
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const normalizedTrends = normalizeTrendSeries(trimTrailingEmptyTrendBuckets(trends))
  const tokenMax = Math.max(
    ...normalizedTrends.flatMap((item) => [
      item.totalInputTokens,
      item.totalOutputTokens,
      item.totalCacheCreationTokens,
      item.totalCacheReadTokens,
    ]),
    1,
  )
  const costMax = Math.max(...normalizedTrends.map((item) => item.totalCostUsd), 0.000001)

  const pointsFor = (selector: (item: UsageTrend) => number, max: number) => {
    return normalizedTrends.map((item, index) => {
      const x = normalizedTrends.length <= 1 ? 50 : (index / (normalizedTrends.length - 1)) * 100
      const value = Math.max(0, selector(item))
      const y = clamp(92 - (value / max) * 82, 10, 92)
      return { x, y, item }
    })
  }

  const input = pointsFor((item) => item.totalInputTokens, tokenMax)
  const output = pointsFor((item) => item.totalOutputTokens, tokenMax)
  const cacheCreate = pointsFor((item) => item.totalCacheCreationTokens, tokenMax)
  const cacheRead = pointsFor((item) => item.totalCacheReadTokens, tokenMax)
  const cost = pointsFor((item) => item.totalCostUsd, costMax)
  const labels = pickLabels(input)
  const hoveredTrend = hoveredIndex == null ? null : normalizedTrends[hoveredIndex]
  const hoveredPoint = hoveredIndex == null ? null : input[hoveredIndex]
  const hoverDots: Array<{ point: { x: number; y: number; item: UsageTrend }; color: string }> =
    hoveredIndex == null
      ? []
      : [
          { point: cost[hoveredIndex], color: '#ff3b5c' },
          { point: cacheCreate[hoveredIndex], color: '#f97316' },
          { point: cacheRead[hoveredIndex], color: '#8b5cf6' },
          { point: input[hoveredIndex], color: '#3b82f6' },
          { point: output[hoveredIndex], color: '#22c55e' },
        ].flatMap((entry) => (entry.point ? [{ point: entry.point, color: entry.color }] : []))

  if (normalizedTrends.length === 0) {
    return <EmptyState text="暂无趋势数据" />
  }

  return (
    <div className="relative h-[420px] w-full">
      <div className="relative h-[340px] w-full" onMouseLeave={() => setHoveredIndex(null)}>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
        >
        <defs>
          <linearGradient id="inputGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity="0.2" />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="outputGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="#22c55e" stopOpacity="0.2" />
            <stop offset="95%" stopColor="#22c55e" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="cacheCreateGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="#f97316" stopOpacity="0.2" />
            <stop offset="95%" stopColor="#f97316" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="cacheReadGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="#8b5cf6" stopOpacity="0.2" />
            <stop offset="95%" stopColor="#8b5cf6" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[10, 30, 50, 70, 90].map((y) => (
          <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="var(--color-border)" strokeWidth="0.22" strokeDasharray="1 1" />
        ))}
        <path d={areaPath(input)} fill="url(#inputGradient)" />
        <path d={areaPath(output)} fill="url(#outputGradient)" />
        <path d={areaPath(cacheCreate)} fill="url(#cacheCreateGradient)" />
        <path d={areaPath(cacheRead)} fill="url(#cacheReadGradient)" />
        <SeriesLine points={cost} color="#ff3b5c" dash="4 4" />
        <SeriesLine points={cacheCreate} color="#f97316" />
        <SeriesLine points={cacheRead} color="#8b5cf6" />
        <SeriesLine points={input} color="#3b82f6" />
        <SeriesLine points={output} color="#22c55e" />
        {hoveredPoint && (
          <line
            x1={hoveredPoint.x}
            x2={hoveredPoint.x}
            y1="8"
            y2="92"
            stroke="rgba(15,23,42,0.18)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {normalizedTrends.map((item, index) => {
          const left = normalizedTrends.length <= 1 ? 0 : ((index - 0.5) / (normalizedTrends.length - 1)) * 100
          const right = normalizedTrends.length <= 1 ? 100 : ((index + 0.5) / (normalizedTrends.length - 1)) * 100
          return (
            <rect
              key={`${item.date}-${index}`}
              x={Math.max(0, left)}
              y="0"
              width={Math.max(2, Math.min(100, right) - Math.max(0, left))}
              height="100"
              fill="transparent"
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseMove={() => setHoveredIndex(index)}
            />
          )
        })}
        </svg>
        {hoverDots.map(({ point, color }, index) => (
          <span
            key={`${color}-${index}`}
            className="pointer-events-none absolute z-10 h-3 w-3 rounded-full border-2 border-white shadow-[0_2px_8px_rgba(15,23,42,0.18)] transition-[left,top,opacity,transform] duration-300 ease-[var(--ease-out-quint)]"
            style={{
              left: `${point.x}%`,
              top: `${point.y}%`,
              backgroundColor: color,
              transform: 'translate(-50%, -50%)',
            }}
          />
        ))}
      {hoveredTrend && hoveredPoint && (
        <div
          className="pointer-events-none absolute z-20 min-w-max max-w-[320px] rounded-2xl border border-white/60 bg-white/82 px-4 py-3.5 text-sm shadow-[0_24px_70px_rgba(15,23,42,0.16)] backdrop-blur-xl transition-[left,top,opacity,transform] duration-300 ease-[var(--ease-out-quint)]"
          style={{
            left: `clamp(132px, ${hoveredPoint.x}%, calc(100% - 132px))`,
            top: `${Math.min(76, Math.max(16, hoveredPoint.y - 8))}%`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <div className="mb-3 text-base font-semibold text-[var(--color-text-primary)]">
            {formatTrendLabel(hoveredTrend.date)}
          </div>
          <TooltipRow color="#3b82f6" label="输入" value={formatNumber(hoveredTrend.totalInputTokens)} />
          <TooltipRow color="#22c55e" label="输出" value={formatNumber(hoveredTrend.totalOutputTokens)} />
          <TooltipRow color="#f97316" label="缓存创建" value={formatNumber(hoveredTrend.totalCacheCreationTokens)} />
          <TooltipRow color="#8b5cf6" label="缓存命中" value={formatNumber(hoveredTrend.totalCacheReadTokens)} />
          <TooltipRow color="#ff3b5c" label="成本" value={formatCost(hoveredTrend.totalCostUsd)} />
        </div>
      )}
      </div>
      <div className="mt-2 flex justify-between gap-2 overflow-hidden text-[10px] text-[var(--color-text-tertiary)]">
        {labels.map((point) => (
          <span key={point.item.date} className="truncate">
            {formatTrendLabel(point.item.date)}
          </span>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs">
        <Legend color="#ff3b5c" label="成本" />
        <Legend color="#f97316" label="缓存创建" />
        <Legend color="#8b5cf6" label="缓存命中" />
        <Legend color="#3b82f6" label="输入" />
        <Legend color="#22c55e" label="输出" />
      </div>
    </div>
  )
}

function SeriesLine({
  points,
  color,
  dash,
}: {
  points: Array<{ x: number; y: number }>
  color: string
  dash?: string
}) {
  return (
    <path
      d={smoothPath(points)}
      fill="none"
      stroke={color}
      strokeWidth="2.35"
      strokeDasharray={dash}
      vectorEffect="non-scaling-stroke"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  )
}

function TooltipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="mt-1.5 grid grid-cols-[auto_auto] items-center justify-between gap-x-4 whitespace-nowrap">
      <span className="inline-flex items-center gap-2 font-semibold" style={{ color }}>
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        {label}:
      </span>
      <span className="text-right font-medium tabular-nums text-[var(--color-text-primary)]">{value}</span>
    </div>
  )
}

function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  if (points.length === 1) {
    const point = points[0]!
    return `M ${point.x - 1.6} ${point.y} L ${point.x + 1.6} ${point.y}`
  }

  const first = points[0]!
  const path = [`M ${first.x} ${first.y}`]
  for (let index = 0; index < points.length - 1; index++) {
    const current = points[index]!
    const next = points[index + 1]!
    const previous = points[index - 1] ?? current
    const afterNext = points[index + 2] ?? next
    const tension = 0.22
    const minY = Math.min(current.y, next.y)
    const maxY = Math.max(current.y, next.y)
    const cp1x = current.x + (next.x - previous.x) * tension
    const cp1y = clamp(current.y + (next.y - previous.y) * tension, minY, maxY)
    const cp2x = next.x - (afterNext.x - current.x) * tension
    const cp2y = clamp(next.y - (afterNext.y - current.y) * tension, minY, maxY)
    path.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${next.x} ${next.y}`)
  }
  return path.join(' ')
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function areaPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  if (points.length === 1) {
    const point = points[0]!
    const halfWidth = 1.6
    return `M ${point.x - halfWidth} 92 L ${point.x - halfWidth} ${point.y} L ${point.x + halfWidth} ${point.y} L ${point.x + halfWidth} 92 Z`
  }
  const first = points[0]!
  const last = points[points.length - 1]!
  return `M ${first.x} 92 L ${first.x} ${first.y} ${smoothPath(points).replace(/^M\s+[\d.-]+\s+[\d.-]+/, '')} L ${last.x} 92 Z`
}

function normalizeTrendSeries(trends: UsageTrend[]): UsageTrend[] {
  if (trends.length !== 1) return trends
  const only = trends[0]!
  return [
    { ...only, totalInputTokens: 0, totalOutputTokens: 0, totalCacheReadTokens: 0, totalCacheCreationTokens: 0, totalTokens: 0, totalCostUsd: 0, requestCount: 0 },
    only,
    { ...only, totalInputTokens: 0, totalOutputTokens: 0, totalCacheReadTokens: 0, totalCacheCreationTokens: 0, totalTokens: 0, totalCostUsd: 0, requestCount: 0 },
  ]
}

function trimTrailingEmptyTrendBuckets(trends: UsageTrend[]): UsageTrend[] {
  let lastDataIndex = -1
  for (let index = trends.length - 1; index >= 0; index--) {
    if (hasTrendValue(trends[index]!)) {
      lastDataIndex = index
      break
    }
  }
  if (lastDataIndex === -1) return []
  return trends.slice(0, lastDataIndex + 1)
}

function hasTrendValue(trend: UsageTrend): boolean {
  return (
    trend.requestCount > 0 ||
    trend.totalInputTokens > 0 ||
    trend.totalOutputTokens > 0 ||
    trend.totalCacheReadTokens > 0 ||
    trend.totalCacheCreationTokens > 0 ||
    trend.totalTokens > 0 ||
    trend.totalCostUsd > 0
  )
}

function pickLabels<T extends { item: UsageTrend }>(points: T[]): T[] {
  if (points.length <= 8) return points
  const lastIndex = points.length - 1
  const indexes = new Set<number>()
  for (let i = 0; i < 8; i++) indexes.add(Math.round((i / 7) * lastIndex))
  return [...indexes]
    .sort((a, b) => a - b)
    .map((index) => points[index])
    .filter((point): point is T => Boolean(point))
}

function formatTrendLabel(date: string): string {
  return date.replace(`${new Date().getFullYear()}-`, '')
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" style={{ color }}>
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}

function UsageTabs({
  active,
  onChange,
}: {
  active: TableTab
  onChange: (tab: TableTab) => void
}) {
  const tabs: Array<{ id: TableTab; icon: string; label: string }> = [
    { id: 'logs', icon: 'subject', label: '请求日志' },
    { id: 'providers', icon: 'monitoring', label: 'Provider 统计' },
    { id: 'models', icon: 'bar_chart', label: '模型统计' },
  ]
  return (
    <div className="inline-flex rounded-2xl bg-[var(--color-surface-container-low)] p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`inline-flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-semibold transition-colors ${
            active === tab.id
              ? 'bg-blue-500 text-white shadow-sm'
              : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function RequestLogTable({ logs }: { logs: UsageLog[] }) {
  return (
    <DataTable
      headers={['时间', '供应商', '计费模型', '输入', '输出', '总成本', '用时/首字', '状态', '来源']}
      empty="暂无请求日志"
      rows={logs.slice(0, 80).map((log) => [
        new Date(log.createdAt).toLocaleString(),
        log.providerName,
        log.billingModel,
        formatNumber(log.inputTokens),
        formatNumber(log.outputTokens),
        formatCost(log.totalCostUsd),
        formatLatency(log),
        <StatusBadge key="status" status={log.status} />,
        log.source,
      ])}
    />
  )
}

function ProviderStatsTable({ providers }: { providers: UsageProviderStats[] }) {
  return (
    <DataTable
      headers={['供应商', '请求数', 'Token', '输入', '输出', '缓存创建', '缓存命中', '总成本', '成功率']}
      empty="暂无 Provider 统计"
      rows={providers.map((provider) => [
        provider.providerName,
        formatNumber(provider.requestCount),
        formatNumber(provider.totalTokens),
        formatNumber(provider.inputTokens),
        formatNumber(provider.outputTokens),
        formatNumber(provider.cacheCreationTokens),
        formatNumber(provider.cacheReadTokens),
        formatCost(provider.totalCostUsd),
        `${provider.successRate.toFixed(1)}%`,
      ])}
    />
  )
}

function ModelStatsTable({ models }: { models: UsageModelStats[] }) {
  return (
    <DataTable
      headers={['模型', '请求数', 'Token', '输入', '输出', '缓存创建', '缓存命中', '总成本']}
      empty="暂无模型统计"
      rows={models.map((model) => [
        model.model,
        formatNumber(model.requestCount),
        formatNumber(model.totalTokens),
        formatNumber(model.inputTokens),
        formatNumber(model.outputTokens),
        formatNumber(model.cacheCreationTokens),
        formatNumber(model.cacheReadTokens),
        formatCost(model.totalCostUsd),
      ])}
    />
  )
}

function DataTable({
  headers,
  rows,
  empty,
}: {
  headers: string[]
  rows: Array<Array<ReactNode>>
  empty: string
}) {
  if (rows.length === 0) return <EmptyState text={empty} />
  return (
    <div className="overflow-auto rounded-xl border border-[var(--color-border)]">
      <table className="min-w-full table-auto text-left text-sm">
        <thead className="bg-[var(--color-surface-container-low)] text-xs font-semibold text-[var(--color-text-secondary)]">
          <tr>
            {headers.map((header) => (
              <th key={header} className="whitespace-nowrap px-4 py-3">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="hover:bg-[var(--color-surface-hover)]">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="max-w-[260px] whitespace-nowrap px-4 py-3 text-[var(--color-text-secondary)]">
                  <span className="block truncate">{cell}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function formatLatency(log: UsageLog): string {
  if (log.latencyMs == null && log.firstTokenMs == null) return '-'
  const total = log.latencyMs == null ? '-' : `${log.latencyMs}ms`
  const first = log.firstTokenMs == null ? '-' : `${log.firstTokenMs}ms`
  return `${total} / ${first}`
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
      {status}
    </span>
  )
}

function PricingPanel({
  open,
  pricing,
  editing,
  saving,
  onToggle,
  onAdd,
  onEdit,
  onCancel,
  onSave,
  onDelete,
}: {
  open: boolean
  pricing: ModelPricing[]
  editing: ModelPricing | null
  saving: boolean
  onToggle: () => void
  onAdd: () => void
  onEdit: (item: ModelPricing) => void
  onCancel: () => void
  onSave: (item: ModelPricing) => void
  onDelete: (modelId: string) => void
}) {
  const [query, setQuery] = useState('')
  const visiblePricing = pricing.filter((item) => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return true
    return item.modelId.toLowerCase().includes(keyword) || item.displayName.toLowerCase().includes(keyword)
  }).slice(0, 80)

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between text-left"
      >
        <div>
          <h3 className="text-base font-semibold text-[var(--color-text-primary)]">模型计费表</h3>
          <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
            单位为 USD / 1M tokens。默认表参考 cc-switch，可在这里覆盖或新增模型。
          </p>
        </div>
        <span className={`material-symbols-outlined text-[22px] text-[var(--color-text-tertiary)] transition-transform ${open ? 'rotate-180' : ''}`}>
          expand_more
        </span>
      </button>

      {open && (
        <div className="mt-4">
          <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索模型..."
              className="h-9 w-56 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 text-sm outline-none focus:border-[var(--color-border-focus)]"
            />
            <button
              type="button"
              onClick={onAdd}
              className="inline-flex h-9 items-center gap-1 rounded-xl bg-[var(--color-brand)] px-3 text-sm font-medium text-white disabled:opacity-50"
              disabled={saving}
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              添加
            </button>
          </div>

          {editing && (
            <PricingEditor
              key={editing.modelId || 'new'}
              item={editing}
              saving={saving}
              onCancel={onCancel}
              onSave={onSave}
            />
          )}

          <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
            <div className="grid grid-cols-[minmax(180px,1.2fr)_minmax(140px,1fr)_repeat(4,110px)_100px] bg-[var(--color-surface-container-low)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)]">
              <span>模型 ID</span>
              <span>显示名称</span>
              <span>输入</span>
              <span>输出</span>
              <span>缓存命中</span>
              <span>缓存创建</span>
              <span className="text-right">操作</span>
            </div>
            <div className="max-h-[520px] overflow-auto">
              {visiblePricing.map((item) => (
                <div
                  key={item.modelId}
                  className="grid grid-cols-[minmax(180px,1.2fr)_minmax(140px,1fr)_repeat(4,110px)_100px] items-center border-t border-[var(--color-border)] px-3 py-2 text-sm"
                >
                  <span className="truncate font-mono text-xs text-[var(--color-text-primary)]">{item.modelId}</span>
                  <span className="truncate text-[var(--color-text-secondary)]">{item.displayName}</span>
                  <span>{item.inputCostPerMillion}</span>
                  <span>{item.outputCostPerMillion}</span>
                  <span>{item.cacheReadCostPerMillion}</span>
                  <span>{item.cacheCreationCostPerMillion}</span>
                  <span className="flex justify-end gap-1">
                    <button type="button" onClick={() => onEdit(item)} className="rounded-lg px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">编辑</button>
                    <button type="button" onClick={() => onDelete(item.modelId)} className="rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50">删除</button>
                  </span>
                </div>
              ))}
              {visiblePricing.length === 0 && <EmptyState text="没有匹配的模型计费配置" />}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PricingEditor({
  item,
  saving,
  onCancel,
  onSave,
}: {
  item: ModelPricing
  saving: boolean
  onCancel: () => void
  onSave: (item: ModelPricing) => void
}) {
  const [draft, setDraft] = useState<ModelPricing>(item)
  const update = (key: keyof ModelPricing, value: string) => setDraft((current) => ({ ...current, [key]: value }))

  return (
    <div className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
        <PricingInput label="模型 ID" value={draft.modelId} onChange={(value) => update('modelId', value)} className="xl:col-span-2" />
        <PricingInput label="显示名称" value={draft.displayName} onChange={(value) => update('displayName', value)} className="xl:col-span-2" />
        <PricingInput label="输入" value={draft.inputCostPerMillion} onChange={(value) => update('inputCostPerMillion', value)} />
        <PricingInput label="输出" value={draft.outputCostPerMillion} onChange={(value) => update('outputCostPerMillion', value)} />
        <PricingInput label="缓存命中" value={draft.cacheReadCostPerMillion} onChange={(value) => update('cacheReadCostPerMillion', value)} />
        <PricingInput label="缓存创建" value={draft.cacheCreationCostPerMillion} onChange={(value) => update('cacheCreationCostPerMillion', value)} />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-xl border border-[var(--color-border)] px-4 py-2 text-sm" disabled={saving}>取消</button>
        <button type="button" onClick={() => onSave(draft)} className="rounded-xl bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={saving}>
          {saving ? '保存中...' : '保存计费'}
        </button>
      </div>
    </div>
  )
}

function PricingInput({
  label,
  value,
  onChange,
  className = '',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm outline-none focus:border-[var(--color-border-focus)]"
      />
    </label>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--color-border)] py-8 text-center text-sm text-[var(--color-text-tertiary)]">
      {text}
    </div>
  )
}
