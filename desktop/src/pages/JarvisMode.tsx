import { useEffect } from 'react'
import { Button } from '../components/shared/Button'
import { useJarvisStore } from '../stores/jarvisStore'
import type { JarvisModeConfig, JarvisNotificationChannel, JarvisSourceKey } from '../types/jarvis'

const SOURCE_LABELS: Record<JarvisSourceKey, string> = {
  scheduledTasks: '定时任务',
  sessions: '会话记录',
  git: 'Git 工作区',
}

const CHANNEL_LABELS: Record<string, string> = {
  desktop: '桌面',
  telegram: 'Telegram',
  feishu: '飞书',
  dingtalk: '钉钉',
  wecom: '企业微信',
}

export function JarvisMode() {
  const { status, isLoading, isSaving, error, fetchStatus, updateConfig, tick } = useJarvisStore()

  useEffect(() => {
    fetchStatus()
    const timer = window.setInterval(fetchStatus, 15_000)
    return () => window.clearInterval(timer)
  }, [fetchStatus])

  const config = status?.config

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--color-surface)]">
      <div className="px-10 py-8">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-[22px] text-[var(--color-brand)]">sensors</span>
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Away Session</h1>
            </div>
            <p className="max-w-3xl text-sm leading-6 text-[var(--color-text-secondary)]">
              24 小时常驻伴侣层会持续做 checkpoint、观察定时任务和会话状态。它不会绕过验证码、登录、支付或替你确认高风险操作。
            </p>
          </div>
          <Button
            variant={config?.enabled ? 'secondary' : 'primary'}
            loading={isSaving}
            disabled={!config}
            icon={<span className="material-symbols-outlined text-[16px]">{config?.enabled ? 'pause' : 'play_arrow'}</span>}
            onClick={() => config && updateConfig({ enabled: !config.enabled })}
          >
            {config?.enabled ? '关闭常驻' : '开启常驻'}
          </Button>
        </div>

        {error && (
          <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-error)]/25 bg-[var(--color-error)]/6 px-4 py-3 text-sm text-[var(--color-error)]">
            {error}
          </div>
        )}

        {isLoading && !status ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-brand)] border-t-transparent" />
          </div>
        ) : config && status ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
            <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container)]">
              <div className="grid gap-px overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-border)] md:grid-cols-4">
                <Metric label="运行状态" value={status.running ? '运行中' : status.enabled ? '等待启动' : '已关闭'} tone={status.running ? 'good' : 'muted'} />
                <Metric label="上次 checkpoint" value={formatDate(status.lastHeartbeatAt)} />
                <Metric label="下次 checkpoint" value={formatDate(status.nextHeartbeatAt)} />
                <Metric label="今日事件" value={`${status.metrics.eventsToday}`} />
              </div>
              <div className="border-t border-[var(--color-border)] p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">当前摘要</div>
                <p className="text-sm leading-6 text-[var(--color-text-primary)]">{status.summary}</p>
              </div>
            </section>

            <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container)] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">常驻策略</h2>
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">CLI 同步命令：/jarvis status、/jarvis on、/jarvis interval 5</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={isSaving}
                  icon={<span className="material-symbols-outlined text-[15px]">sync</span>}
                  onClick={() => tick()}
                >
                  手动 checkpoint
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">间隔分钟</span>
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={Math.round(config.intervalMs / 60_000)}
                    onChange={(event) => {
                      const minutes = Number.parseInt(event.target.value, 10)
                      if (Number.isFinite(minutes)) {
                        updateConfig({ intervalMs: Math.max(1, minutes) * 60_000 })
                      }
                    }}
                    className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">策略模式</span>
                  <select
                    value={config.riskMode}
                    onChange={(event) => updateConfig({ riskMode: event.target.value as JarvisModeConfig['riskMode'] })}
                    className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
                  >
                    <option value="observe">只观察</option>
                    <option value="assisted">辅助执行</option>
                  </select>
                </label>
              </div>

              <div className="mt-4">
                <div className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">观察来源</div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(Object.keys(config.sources) as JarvisSourceKey[]).map((source) => (
                    <ToggleRow
                      key={source}
                      label={SOURCE_LABELS[source]}
                      checked={config.sources[source]}
                      onChange={(checked) => updateConfig({ sources: { ...config.sources, [source]: checked } })}
                    />
                  ))}
                </div>
              </div>

              <div className="mt-4">
                <ToggleRow
                  label="外部发送、付费、不可逆操作必须暂停等待批准"
                  checked={config.requireApprovalForExternalActions}
                  onChange={(checked) => updateConfig({ requireApprovalForExternalActions: checked })}
                  wide
                />
              </div>

              <div className="mt-4">
                <div className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">通知渠道</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(CHANNEL_LABELS).map(([channel, label]) => {
                    const typedChannel = channel as JarvisNotificationChannel
                    const active = config.notificationChannels.includes(typedChannel)
                    return (
                      <button
                        key={channel}
                        type="button"
                        onClick={() => {
                          const next = active
                            ? config.notificationChannels.filter((item) => item !== typedChannel)
                            : [...config.notificationChannels, typedChannel]
                          updateConfig({ notificationChannels: next.length ? next : ['desktop'] })
                        }}
                        className={`rounded-[var(--radius-md)] border px-3 py-1.5 text-xs font-medium transition-colors ${active ? 'border-[var(--color-brand)] bg-[var(--color-brand)]/10 text-[var(--color-brand)]' : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'}`}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </section>

            <section className="xl:col-span-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container)]">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
                <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">最近 checkpoint</h2>
                <span className="text-xs text-[var(--color-text-tertiary)]">保存到 ~/.claude-yh/jarvis_events.jsonl</span>
              </div>
              <div className="divide-y divide-[var(--color-border)]">
                {status.recentEvents.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-[var(--color-text-secondary)]">
                    暂无事件。开启常驻或点击手动 checkpoint 后会显示记录。
                  </div>
                ) : (
                  status.recentEvents.slice(0, 12).map((event) => (
                    <div key={event.id} className="grid gap-2 px-4 py-3 md:grid-cols-[160px_minmax(0,1fr)]">
                      <div className="text-xs text-[var(--color-text-tertiary)]">{formatDate(event.createdAt)}</div>
                      <div>
                        <div className="mb-1 flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${event.severity === 'error' ? 'bg-[var(--color-error)]' : event.severity === 'warn' ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-success)]'}`} />
                          <span className="text-sm font-medium text-[var(--color-text-primary)]">{event.title}</span>
                        </div>
                        <p className="text-sm leading-6 text-[var(--color-text-secondary)]">{event.message}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Metric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'good' | 'muted' }) {
  return (
    <div className="bg-[var(--color-surface-container)] p-4">
      <div className="mb-1 text-xs font-medium text-[var(--color-text-tertiary)]">{label}</div>
      <div className={`truncate text-sm font-semibold ${tone === 'good' ? 'text-[var(--color-success)]' : tone === 'muted' ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-primary)]'}`}>
        {value}
      </div>
    </div>
  )
}

function ToggleRow({ label, checked, onChange, wide = false }: { label: string; checked: boolean; onChange: (checked: boolean) => void; wide?: boolean }) {
  return (
    <label className={`flex min-h-10 items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 ${wide ? 'w-full' : ''}`}>
      <span className="text-xs font-medium text-[var(--color-text-primary)]">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[var(--color-brand)]"
      />
    </label>
  )
}

function formatDate(value: string | null): string {
  if (!value) return '未记录'
  return new Date(value).toLocaleString()
}
