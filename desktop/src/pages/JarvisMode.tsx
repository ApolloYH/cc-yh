import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '../components/shared/Button'
import { MarkdownRenderer } from '../components/markdown/MarkdownRenderer'
import { useJarvisStore } from '../stores/jarvisStore'
import type {
  JarvisApprovalRequest,
  JarvisInboxMessage,
  JarvisModeConfig,
  JarvisNotificationChannel,
} from '../types/jarvis'

type VisibleNotificationChannel = Exclude<JarvisNotificationChannel, 'wecom'>

const CHANNEL_LABELS: Record<VisibleNotificationChannel, string> = {
  desktop: '桌面',
  telegram: 'Telegram',
  feishu: '飞书',
  dingtalk: '钉钉',
}

const VISIBLE_NOTIFICATION_CHANNELS: VisibleNotificationChannel[] = [
  'desktop',
  'telegram',
  'feishu',
  'dingtalk',
]

const MODE_LABELS: Record<JarvisModeConfig['riskMode'], string> = {
  observe: '只观察',
  assisted: '辅助执行',
  autonomous: '自主执行',
}

type PanelId = 'queue' | 'boundaries' | 'notifications'

type ConversationItem =
  | { kind: 'message'; item: JarvisInboxMessage }
  | { kind: 'approval'; item: JarvisApprovalRequest }

function formatQueueSummary(status: { queue?: { pending?: number; running?: number; paused?: number } }) {
  return `待处理 ${status.queue?.pending ?? 0} · 运行 ${status.queue?.running ?? 0} · 暂停 ${status.queue?.paused ?? 0}`
}

export function JarvisMode() {
  const {
    status,
    isLoading,
    isSaving,
    error,
    fetchStatus,
    updateConfig,
    submitTask,
    queueAction,
    resolveApproval,
    tick,
  } = useJarvisStore()
  const [message, setMessage] = useState('')
  const [collapsedPanels, setCollapsedPanels] = useState<Set<PanelId>>(() => new Set())
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    fetchStatus()
    const timer = window.setInterval(fetchStatus, 10_000)
    return () => window.clearInterval(timer)
  }, [fetchStatus])

  const config = status?.config
  const conversation = useMemo<ConversationItem[]>(() => {
    if (!status) return []
    const messages: ConversationItem[] = [
      ...status.inboxMessages.map(item => ({ kind: 'message' as const, item })),
      ...status.approvals
        .filter(item => item.status === 'pending')
        .map(item => ({ kind: 'approval' as const, item })),
    ]
    return messages
      .sort((a, b) => new Date(getConversationTime(a)).getTime() - new Date(getConversationTime(b)).getTime())
      .slice(-120)
  }, [status])

  const togglePanel = (id: PanelId) => {
    setCollapsedPanels(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleTask = (id: string) => {
    setExpandedTasks(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--color-surface)]">
      <div className="px-8 py-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[22px] text-[var(--color-brand)]">sensors</span>
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Jarvis</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {config && status && (
              <>
                <StatusChip>{status.running ? '运行中' : status.enabled ? '待机中' : '已关闭'}</StatusChip>
                <StatusChip>{MODE_LABELS[config.riskMode]}</StatusChip>
                <StatusChip>{formatQueueSummary(status)}</StatusChip>
                <span className="text-xs text-[var(--color-text-tertiary)]">上次 {formatDate(status.lastHeartbeatAt)}</span>
                <Button size="sm" variant="secondary" loading={isSaving} onClick={() => tick()}>
                  立即巡检
                </Button>
              </>
            )}
            <Button
              variant={config?.enabled ? 'secondary' : 'primary'}
              size="sm"
              loading={isSaving}
              disabled={!config}
              icon={<span className="material-symbols-outlined text-[16px]">{config?.enabled ? 'pause' : 'play_arrow'}</span>}
              onClick={() => config && updateConfig({ enabled: !config.enabled })}
            >
              {config?.enabled ? '暂停常驻' : '开启常驻'}
            </Button>
          </div>
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
          <div className="grid min-h-0 gap-4 overflow-hidden xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="flex h-[calc(100vh-150px)] min-h-[520px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container)]">
              <div className="border-b border-[var(--color-border)] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Jarvis 对话</h2>
                    <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                      目标、进度、错误和审批都会作为消息出现。Jarvis 需要你介入时会直接发在这里。
                    </p>
                  </div>
                  <div className="text-right text-xs text-[var(--color-text-tertiary)]">
                    <div>{status.running ? '运行中' : status.enabled ? '待机中' : '已关闭'}</div>
                    <div>下次巡检：{formatDate(status.nextHeartbeatAt)}</div>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                {conversation.length === 0 ? (
                  <div className="flex h-full items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-4 py-10 text-center text-sm text-[var(--color-text-secondary)]">
                    还没有对话。直接在下面把目标交给 Jarvis。
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {conversation.map(entry => entry.kind === 'message'
                      ? <MessageBubble key={entry.item.id} item={entry.item} />
                      : (
                        <ApprovalBubble
                          key={entry.item.id}
                          item={entry.item}
                          disabled={isSaving}
                          onApprove={() => resolveApproval(entry.item.id, 'approved')}
                          onReject={() => resolveApproval(entry.item.id, 'rejected')}
                        />
                      ))}
                  </div>
                )}
              </div>

              <form
                className="border-t border-[var(--color-border)] bg-[var(--color-surface-container)] p-3"
                onSubmit={async (event) => {
                  event.preventDefault()
                  const goal = message.trim()
                  if (!goal) return
                  await submitTask(goal)
                  setMessage('')
                }}
              >
                <div
                  className="relative rounded-[24px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-3 transition-colors focus-within:border-[var(--color-outline)]"
                  style={{ boxShadow: '0 2px 10px rgba(15, 23, 42, 0.06), 0 10px 28px rgba(15, 23, 42, 0.08)' }}
                >
                  <textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="把目标交给 Jarvis..."
                    rows={2}
                    className="w-full resize-none bg-transparent px-2 py-1.5 pb-11 pr-36 text-[15px] leading-7 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]/70"
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    className="absolute bottom-3 right-3 rounded-[18px] px-4"
                    loading={isSaving}
                    disabled={!message.trim()}
                    icon={<span className="material-symbols-outlined text-[15px]">send</span>}
                  >
                    交给 Jarvis
                  </Button>
                </div>
              </form>
            </section>

            <aside className="h-[calc(100vh-150px)] min-h-0 overflow-y-scroll overscroll-contain pr-1">
              <div className="grid content-start gap-3">
                <Panel
                id="queue"
                title={`任务队列（${formatQueueSummary(status)}）`}
                collapsed={collapsedPanels.has('queue')}
                onToggle={togglePanel}
              >
                <div className="grid max-h-[260px] gap-2 overflow-y-auto pr-1">
                  {(status.queueItems ?? []).length === 0 ? (
                    <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-3 py-6 text-center text-sm text-[var(--color-text-secondary)]">
                      暂无队列任务
                    </div>
                  ) : (
                    (status.queueItems ?? []).map(item => {
                      const expanded = expandedTasks.has(item.id)
                      return (
                        <div key={item.id} className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-2 text-left"
                            onClick={() => toggleTask(item.id)}
                          >
                            <div className="min-w-0 truncate text-sm font-medium text-[var(--color-text-primary)]">
                              {item.title || item.goal || item.prompt}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="text-xs text-[var(--color-text-tertiary)]">{queueStatusLabel(item.status)}</span>
                              <span className="material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)]">
                                {expanded ? 'expand_less' : 'expand_more'}
                              </span>
                            </div>
                          </button>
                          {expanded && (
                            <>
                              <div className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap rounded-[var(--radius-sm)] bg-[var(--color-surface-container)] px-2 py-2 text-xs leading-5 text-[var(--color-text-secondary)]">
                                {item.checkpoint || item.error || item.prompt}
                              </div>
                              <div className="mt-2 flex gap-2">
                                {item.status === 'paused' ? (
                                  <Button size="sm" variant="secondary" disabled={isSaving} onClick={() => queueAction(item.id, 'resume')}>
                                    继续
                                  </Button>
                                ) : (
                                  <Button size="sm" variant="ghost" disabled={isSaving} onClick={() => queueAction(item.id, 'pause')}>
                                    暂停
                                  </Button>
                                )}
                                {item.approvalState === 'requested' && (
                                  <Button size="sm" variant="primary" disabled={isSaving} onClick={() => queueAction(item.id, 'approve')}>
                                    批准
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={isSaving}
                                  onClick={() => {
                                    if (window.confirm('确定删除这个 Jarvis 任务吗？')) {
                                      queueAction(item.id, 'delete')
                                    }
                                  }}
                                >
                                  删除
                                </Button>
                              </div>
                            </>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </Panel>

                <Panel
                id="boundaries"
                title="自主边界"
                collapsed={collapsedPanels.has('boundaries')}
                onToggle={togglePanel}
              >
                <label className="mb-2 flex items-center justify-between gap-3 text-sm">
                  <span className="text-xs font-medium text-[var(--color-text-secondary)]">策略模式</span>
                  <select
                    value={config.riskMode}
                    onChange={(event) => updateConfig({ riskMode: event.target.value as JarvisModeConfig['riskMode'] })}
                    className="h-8 w-36 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text-primary)] outline-none"
                  >
                    <option value="observe">只观察</option>
                    <option value="assisted">辅助执行</option>
                    <option value="autonomous">自主执行</option>
                  </select>
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <NumberField
                    label="预算分钟"
                    value={config.boundaries.budgetMinutes}
                    onChange={value => updateConfig({ boundaries: { ...config.boundaries, budgetMinutes: value } })}
                  />
                  <NumberField
                    label="最大工具调用"
                    value={config.boundaries.maxToolCalls}
                    onChange={value => updateConfig({ boundaries: { ...config.boundaries, maxToolCalls: value } })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Toggle
                    label="登录/验证码暂停"
                    checked={config.boundaries.pauseOnLogin}
                    onChange={checked => updateConfig({ boundaries: { ...config.boundaries, pauseOnLogin: checked } })}
                  />
                  <Toggle
                    label="外部发送前暂停"
                    checked={config.boundaries.pauseOnExternalSend}
                    onChange={checked => updateConfig({ boundaries: { ...config.boundaries, pauseOnExternalSend: checked } })}
                  />
                  <Toggle
                    label="支付/不可逆暂停"
                    checked={config.boundaries.pauseOnPayment}
                    onChange={checked => updateConfig({ boundaries: { ...config.boundaries, pauseOnPayment: checked } })}
                  />
                  <Toggle
                    label="密钥/隐私暂停"
                    checked={config.boundaries.pauseOnSecrets}
                    onChange={checked => updateConfig({ boundaries: { ...config.boundaries, pauseOnSecrets: checked } })}
                  />
                </div>
              </Panel>

                <Panel
                id="notifications"
                title="主动通知"
                collapsed={collapsedPanels.has('notifications')}
                onToggle={togglePanel}
              >
                <div className="grid grid-cols-2 gap-2">
                  {VISIBLE_NOTIFICATION_CHANNELS.map(channel => (
                    <Toggle
                      key={channel}
                      label={CHANNEL_LABELS[channel]}
                      checked={config.notificationChannels.includes(channel)}
                      onChange={checked => {
                        const channels = checked
                          ? [...config.notificationChannels, channel]
                          : config.notificationChannels.filter(item => item !== channel)
                        updateConfig({ notificationChannels: channels })
                      }}
                    />
                  ))}
                </div>
              </Panel>
              </div>
            </aside>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function MessageBubble({ item }: { item: JarvisInboxMessage }) {
  const isUser = item.role === 'user'
  const tone = item.severity ?? 'info'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[78%] rounded-[var(--radius-lg)] border px-4 py-3 ${
        isUser
          ? 'border-[var(--color-brand)]/20 bg-[var(--color-brand)]/10'
          : tone === 'error'
            ? 'border-[var(--color-error)]/25 bg-[var(--color-error)]/6'
            : tone === 'warn'
              ? 'border-amber-300/50 bg-amber-50'
              : 'border-[var(--color-border)] bg-[var(--color-surface)]'
      }`}>
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-[var(--color-text-secondary)]">
            {isUser ? sourceLabel(item.source) : item.title || 'Jarvis'}
          </span>
          <span className="text-[11px] text-[var(--color-text-tertiary)]">{formatTime(item.createdAt)}</span>
        </div>
        {isUser ? (
          <div className="whitespace-pre-wrap text-sm leading-6 text-[var(--color-text-primary)]">{item.message}</div>
        ) : (
          <MarkdownRenderer
            content={item.message}
            className="prose-p:leading-6 prose-p:text-sm prose-li:text-sm prose-ul:my-1 prose-ol:my-1"
          />
        )}
      </div>
    </div>
  )
}

function ApprovalBubble({
  item,
  disabled,
  onApprove,
  onReject,
}: {
  item: JarvisApprovalRequest
  disabled: boolean
  onApprove: () => void
  onReject: () => void
}) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[78%] rounded-[var(--radius-lg)] border border-amber-300/60 bg-amber-50 px-4 py-3">
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-amber-700">需要你确认</span>
          <span className="text-[11px] text-[var(--color-text-tertiary)]">{formatTime(item.createdAt)}</span>
        </div>
        <div className="text-sm font-medium text-[var(--color-text-primary)]">{item.title}</div>
        <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--color-text-secondary)]">{item.message}</div>
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="primary" disabled={disabled} onClick={onApprove}>批准继续</Button>
          <Button size="sm" variant="secondary" disabled={disabled} onClick={onReject}>拒绝</Button>
        </div>
      </div>
    </div>
  )
}

function Panel({
  id,
  title,
  collapsed,
  onToggle,
  children,
}: {
  id: PanelId
  title: string
  collapsed: boolean
  onToggle: (id: PanelId) => void
  children: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container)]">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
        onClick={() => onToggle(id)}
      >
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h2>
        <span className="material-symbols-outlined text-[20px] text-[var(--color-text-tertiary)]">
          {collapsed ? 'expand_more' : 'expand_less'}
        </span>
      </button>
      {!collapsed && <div className="border-t border-[var(--color-border)] p-3">{children}</div>}
    </section>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="mb-1.5 flex h-8 cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text-primary)]">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
        className="h-3.5 w-3.5 accent-[var(--color-brand)]"
      />
    </label>
  )
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="mb-2 block">
      <span className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">{label}</span>
      <input
        type="number"
        min={1}
        value={value}
        onChange={event => onChange(Math.max(1, Number.parseInt(event.target.value || '1', 10)))}
        className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text-primary)] outline-none"
      />
    </label>
  )
}

function StatusChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-container)] px-2.5 py-1 text-xs text-[var(--color-text-secondary)]">
      {children}
    </span>
  )
}

function queueStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return '待执行'
    case 'running':
      return '运行中'
    case 'paused':
      return '已暂停'
    case 'completed':
      return '已完成'
    case 'failed':
      return '失败'
    default:
      return status
  }
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'desktop':
      return '桌面'
    case 'web':
      return 'Web'
    case 'cli':
      return 'CLI'
    case 'telegram':
      return 'Telegram'
    case 'feishu':
      return '飞书'
    case 'dingtalk':
      return '钉钉'
    case 'wecom':
      return '企业微信'
    default:
      return '用户'
  }
}

function getConversationTime(entry: ConversationItem): string {
  return entry.item.createdAt
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '未记录'
  return new Date(value).toLocaleString()
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
