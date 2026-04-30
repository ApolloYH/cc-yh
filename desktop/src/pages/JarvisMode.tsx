import { useEffect, useMemo, useState } from 'react'
import { Button } from '../components/shared/Button'
import { useJarvisStore } from '../stores/jarvisStore'
import type { JarvisModeConfig, JarvisNotificationChannel, JarvisSourceKey } from '../types/jarvis'

const SOURCE_LABELS: Record<JarvisSourceKey, { label: string; detail: string }> = {
  scheduledTasks: {
    label: '定时任务',
    detail: '观察到期、失败和等待恢复的任务。',
  },
  sessions: {
    label: '会话记录',
    detail: '观察最近对话、checkpoint 和未完成目标。',
  },
  git: {
    label: 'Git 工作区',
    detail: '观察变更、失败测试和待处理工作。',
  },
}

const CHANNEL_LABELS: Record<JarvisNotificationChannel, string> = {
  desktop: '桌面',
  telegram: 'Telegram',
  feishu: '飞书',
  dingtalk: '钉钉',
  wecom: '企业微信',
}

const MODE_LABELS: Record<JarvisModeConfig['riskMode'], string> = {
  observe: '只观察',
  assisted: '辅助执行',
  autonomous: '自主执行',
}

const DEFAULT_CONFIG: JarvisModeConfig = {
  enabled: false,
  intervalMs: 5 * 60_000,
  riskMode: 'observe',
  companionModeEnabled: false,
  autoResumeQueue: true,
  watchdogEnabled: true,
  sources: {
    scheduledTasks: true,
    sessions: true,
    git: false,
  },
  notificationChannels: ['desktop'],
  maxEventsPerHour: 12,
  requireApprovalForExternalActions: true,
  taskPrompt: undefined,
  cloud: {
    enabled: false,
    runnerId: 'local',
    syncQueue: true,
    heartbeatIntervalMs: 5 * 60_000,
    tokenSet: false,
  },
  boundaries: {
    allowedWorkdirs: [],
    allowedDomains: ['*'],
    blockedActions: ['payment', 'captcha', '2fa', 'credential-exfiltration', 'irreversible-external-send'],
    budgetMinutes: 60,
    maxToolCalls: 80,
    pauseOnSecrets: true,
    pauseOnExternalSend: true,
    pauseOnPayment: true,
    pauseOnLogin: true,
  },
}

export function JarvisMode() {
  const {
    status,
    autostart,
    isLoading,
    isSaving,
    error,
    fetchStatus,
    updateConfig,
    updateAutostart,
    submitTask,
    tick,
  } = useJarvisStore()
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetchStatus()
    const timer = window.setInterval(fetchStatus, 15_000)
    return () => window.clearInterval(timer)
  }, [fetchStatus])

  const config = status?.config ? withJarvisDefaults(status.config) : null
  const timeline = useMemo(() => {
    if (!status) return []
    const events = status.recentEvents.map((event) => ({
      id: event.id,
      time: event.createdAt,
      title: cleanJarvisText(event.title),
      message: cleanJarvisText(event.message),
      tone: event.severity,
      kind: 'event' as const,
    }))
    const queue = (status.queueItems ?? []).map((item) => ({
      id: item.id,
      time: item.updatedAt,
      title: item.title || item.goal || 'Jarvis 队列任务',
      message: cleanJarvisText(`${item.status} · ${item.checkpoint || item.error || item.prompt}`),
      tone: item.status === 'failed' ? 'error' as const : item.status === 'paused' ? 'warn' as const : 'info' as const,
      kind: 'queue' as const,
    }))
    return [...events, ...queue]
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 18)
  }, [status])

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--color-surface)]">
      <div className="px-10 py-7">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-[22px] text-[var(--color-brand)]">sensors</span>
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Jarvis</h1>
            </div>
            <p className="max-w-4xl text-sm leading-6 text-[var(--color-text-secondary)]">
              主动型常驻智能体。你把目标交给 Jarvis，它会观察配置的信息来源、安排队列、写 checkpoint，并在需要确认时通过页面、桌面或 IM 找你。它不会绕过验证码、登录、支付或不可逆操作。
            </p>
          </div>
          <Button
            variant={config?.enabled ? 'secondary' : 'primary'}
            loading={isSaving}
            disabled={!config}
            icon={<span className="material-symbols-outlined text-[16px]">{config?.enabled ? 'pause' : 'play_arrow'}</span>}
            onClick={() => config && updateConfig({ enabled: !config.enabled })}
          >
            {config?.enabled ? '停止 Jarvis' : '启动 Jarvis'}
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
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
            <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container)]">
              <div className="grid gap-px overflow-hidden rounded-t-[var(--radius-lg)] bg-[var(--color-border)] md:grid-cols-4">
                <Metric label="运行状态" value={status.running ? '运行中' : status.enabled ? '等待启动' : '已停止'} tone={status.running ? 'good' : 'muted'} />
                <Metric label="上次 checkpoint" value={formatDate(status.lastHeartbeatAt)} />
                <Metric label="下次 checkpoint" value={formatDate(status.nextHeartbeatAt)} />
                <Metric label="今日事件" value={`${status.metrics.eventsToday}`} />
              </div>
              <div className="border-t border-[var(--color-border)] p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">当前摘要</div>
                <p className="text-sm leading-6 text-[var(--color-text-primary)]">{cleanJarvisText(status.summary)}</p>
              </div>
            </section>

            <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container)] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">自主策略</h2>
                  <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                    CLI 同步命令：/jarvis status、/jarvis on、/jarvis enqueue 你的目标。
                  </p>
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
                  <span className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">检查间隔（分钟）</span>
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
                    <option value="autonomous">自主执行</option>
                  </select>
                </label>
              </div>

              <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs leading-5 text-[var(--color-text-secondary)]">
                当前模式：{MODE_LABELS[config.riskMode]}。
                {config.riskMode === 'observe' && ' Jarvis 只汇总和提醒，不执行任务。'}
                {config.riskMode === 'assisted' && ' Jarvis 会准备方案和低风险动作，高风险前暂停。'}
                {config.riskMode === 'autonomous' && ' Jarvis 会在边界内自主推进，遇到红线就暂停找你。'}
              </div>
            </section>

            <section className="min-h-[560px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container)]">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Jarvis 对话</h2>
                  <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">这里显示 Jarvis 主动发来的消息、checkpoint 和队列状态。</p>
                </div>
                <span className="text-xs text-[var(--color-text-tertiary)]">~/.claude-yh/jarvis_events.jsonl</span>
              </div>
              <div className="max-h-[520px] overflow-y-auto px-4 py-3">
                {timeline.length === 0 ? (
                  <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-4 py-10 text-center text-sm text-[var(--color-text-secondary)]">
                    还没有消息。给 Jarvis 一个目标，或点击手动 checkpoint。
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {timeline.map(item => (
                      <div key={`${item.kind}-${item.id}`} className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${item.tone === 'error' ? 'bg-[var(--color-error)]' : item.tone === 'warn' ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-success)]'}`} />
                            <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">{item.title}</span>
                          </div>
                          <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">{formatDate(item.time)}</span>
                        </div>
                        <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--color-text-secondary)]">{item.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="border-t border-[var(--color-border)] p-4">
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="把目标交给 Jarvis，例如：持续观察这个项目，发现失败任务就分析原因并尝试修复；遇到登录、验证码、支付、外部发送或不可逆操作时暂停等我确认。"
                  rows={3}
                  className="w-full resize-none rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm leading-6 text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
                />
                <div className="mt-2 flex justify-end">
                  <Button
                    variant="primary"
                    size="sm"
                    loading={isSaving}
                    disabled={!message.trim()}
                    icon={<span className="material-symbols-outlined text-[15px]">send</span>}
                    onClick={async () => {
                      const goal = message.trim()
                      if (!goal) return
                      await submitTask(goal)
                      setMessage('')
                    }}
                  >
                    交给 Jarvis
                  </Button>
                </div>
              </div>
            </section>

            <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container)] p-4">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">边界和信息来源</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                “信息来源”是 Jarvis 会主动观察的输入，不是权限本身；真正执行仍受策略模式和红线控制。
              </p>

              <div className="mt-4 grid gap-2">
                {(Object.keys(config.sources) as JarvisSourceKey[]).map((source) => (
                  <ToggleRow
                    key={source}
                    label={SOURCE_LABELS[source].label}
                    detail={SOURCE_LABELS[source].detail}
                    checked={config.sources[source]}
                    onChange={(checked) => updateConfig({ sources: { ...config.sources, [source]: checked } })}
                  />
                ))}
              </div>

              <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                <div className="mb-2 text-xs font-semibold text-[var(--color-text-primary)]">自主边界</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <NumberField label="预算分钟" value={config.boundaries.budgetMinutes} min={5} max={1440} onChange={budgetMinutes => updateConfig({ boundaries: { ...config.boundaries, budgetMinutes } })} />
                  <NumberField label="最大工具调用" value={config.boundaries.maxToolCalls} min={1} max={500} onChange={maxToolCalls => updateConfig({ boundaries: { ...config.boundaries, maxToolCalls } })} />
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <ToggleRow label="遇到密钥/隐私暂停" checked={config.boundaries.pauseOnSecrets} onChange={(checked) => updateConfig({ boundaries: { ...config.boundaries, pauseOnSecrets: checked } })} compact />
                  <ToggleRow label="外部发送前暂停" checked={config.boundaries.pauseOnExternalSend} onChange={(checked) => updateConfig({ boundaries: { ...config.boundaries, pauseOnExternalSend: checked } })} compact />
                  <ToggleRow label="登录/验证码暂停" checked={config.boundaries.pauseOnLogin} onChange={(checked) => updateConfig({ boundaries: { ...config.boundaries, pauseOnLogin: checked } })} compact />
                  <ToggleRow label="支付/不可逆操作暂停" checked={config.boundaries.pauseOnPayment} onChange={(checked) => updateConfig({ boundaries: { ...config.boundaries, pauseOnPayment: checked } })} compact />
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <ToggleRow
                  label="Jarvis 主动模式"
                  detail="开启后默认启用常驻、自主执行和队列恢复。"
                  checked={config.companionModeEnabled}
                  onChange={(checked) => updateConfig({
                    companionModeEnabled: checked,
                    enabled: checked ? true : config.enabled,
                    riskMode: checked ? 'autonomous' : config.riskMode,
                  })}
                />
                <ToggleRow
                  label="自动恢复队列"
                  detail="进程重启后恢复未完成任务。"
                  checked={config.autoResumeQueue}
                  onChange={(checked) => updateConfig({ autoResumeQueue: checked })}
                />
                <ToggleRow
                  label="崩溃守护检查"
                  detail="配合系统常驻拉起服务进程。"
                  checked={config.watchdogEnabled}
                  onChange={(checked) => updateConfig({ watchdogEnabled: checked })}
                />
                <ToggleRow
                  label="高风险前暂停"
                  detail="外部发送、付费、不可逆操作必须等你确认。"
                  checked={config.requireApprovalForExternalActions}
                  onChange={(checked) => updateConfig({ requireApprovalForExternalActions: checked })}
                />
              </div>

              {autostart && (
                <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-[var(--color-text-primary)]">本机系统常驻</div>
                      <div className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                        用本机开机自启和 watchdog 保持 Jarvis 后台运行；云端 Runner 请通过 CLI 的 /jarvis cloud 单独配置。
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={autostart.enabled}
                      disabled={!autostart.supported || isSaving}
                      onChange={(event) => updateAutostart(event.target.checked)}
                      className="h-4 w-4 accent-[var(--color-brand)]"
                    />
                  </div>
                  <div className="grid gap-1 text-xs text-[var(--color-text-tertiary)]">
                    <div className="truncate">启动项：{autostart.targetPath}</div>
                    <div className="truncate">守护脚本：{autostart.watchdogPath}</div>
                    {!autostart.supported && <div>{autostart.note}</div>}
                  </div>
                </div>
              )}

              <div className="mt-4">
                <div className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">通知渠道</div>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(CHANNEL_LABELS) as JarvisNotificationChannel[]).map((channel) => {
                    const active = config.notificationChannels.includes(channel)
                    return (
                      <button
                        key={channel}
                        type="button"
                        onClick={() => {
                          const next = active
                            ? config.notificationChannels.filter((item) => item !== channel)
                            : [...config.notificationChannels, channel]
                          updateConfig({ notificationChannels: next.length ? next : ['desktop'] })
                        }}
                        className={`rounded-[var(--radius-md)] border px-3 py-1.5 text-xs font-medium transition-colors ${active ? 'border-[var(--color-brand)] bg-[var(--color-brand)]/10 text-[var(--color-brand)]' : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'}`}
                      >
                        {CHANNEL_LABELS[channel]}
                      </button>
                    )
                  })}
                </div>
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

function ToggleRow({
  label,
  detail,
  checked,
  onChange,
  compact = false,
}: {
  label: string
  detail?: string
  checked: boolean
  onChange: (checked: boolean) => void
  compact?: boolean
}) {
  return (
    <label className={`flex min-h-10 items-start justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 ${compact ? '' : 'w-full'}`}>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-[var(--color-text-primary)]">{label}</span>
        {detail && <span className="mt-1 block text-[11px] leading-4 text-[var(--color-text-tertiary)]">{detail}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-brand)]"
      />
    </label>
  )
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number.parseInt(event.target.value, 10) || min)}
        className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
      />
    </label>
  )
}

function formatDate(value: string | null): string {
  if (!value) return '未记录'
  return new Date(value).toLocaleString()
}

function withJarvisDefaults(config: Partial<JarvisModeConfig>): JarvisModeConfig {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    sources: {
      ...DEFAULT_CONFIG.sources,
      ...(config.sources ?? {}),
    },
    notificationChannels: config.notificationChannels?.length
      ? config.notificationChannels
      : DEFAULT_CONFIG.notificationChannels,
    cloud: {
      ...DEFAULT_CONFIG.cloud,
      ...(config.cloud ?? {}),
    },
    boundaries: {
      ...DEFAULT_CONFIG.boundaries,
      ...(config.boundaries ?? {}),
    },
  }
}

function cleanJarvisText(value: string): string {
  return value
    .replaceAll('Away Runner', 'Jarvis execution')
    .replaceAll('Jarvis Mode', 'Jarvis')
}
