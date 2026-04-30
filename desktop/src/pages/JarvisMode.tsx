import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { Button } from '../components/shared/Button'
import { AssistantMessage } from '../components/chat/AssistantMessage'
import { UserMessage } from '../components/chat/UserMessage'
import { randomSpinnerVerb } from '../config/spinnerVerbs'
import { useJarvisStore } from '../stores/jarvisStore'
import type {
  JarvisApprovalRequest,
  JarvisInboxMessage,
  JarvisModeConfig,
  JarvisNotificationChannel,
} from '../types/jarvis'

type VisibleNotificationChannel = Exclude<JarvisNotificationChannel, 'wecom'>
type PanelId = 'queue' | 'boundaries' | 'notifications'
type ConversationItem =
  | { kind: 'message'; item: JarvisInboxMessage }
  | { kind: 'approval'; item: JarvisApprovalRequest }

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
  observe: '观察模式',
  assisted: '辅助模式',
  autonomous: '自主模式',
  full_autonomous: '自主模式',
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const conversationScrollRef = useRef<HTMLDivElement>(null)
  const [pendingMessages, setPendingMessages] = useState<JarvisInboxMessage[]>([])
  const [pendingReplies, setPendingReplies] = useState(0)
  const [pendingStartedAt, setPendingStartedAt] = useState<number | null>(null)
  const [pendingVerb, setPendingVerb] = useState(() => randomSpinnerVerb())
  const [pendingElapsedSeconds, setPendingElapsedSeconds] = useState(0)
  const [tickLoading, setTickLoading] = useState(false)
  const [toggleEnabledLoading, setToggleEnabledLoading] = useState(false)
  const [collapsedPanels, setCollapsedPanels] = useState<Set<PanelId>>(() => new Set())
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(() => new Set())

  const resizeTextarea = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`
  }

  useEffect(() => {
    fetchStatus()
    const timer = window.setInterval(fetchStatus, 3_000)
    return () => window.clearInterval(timer)
  }, [fetchStatus])

  useEffect(() => {
    resizeTextarea()
  }, [message])

  useEffect(() => {
    if (!status) return
    // Reconcile optimistic local user bubbles with the persisted Jarvis
    // conversation stream. This is an ack/replace path, not content de-duping:
    // repeated user messages with different clientMessageIds must stay visible.
    const acknowledgedClientMessageIds = new Set(
      status.inboxMessages
        .map(getClientMessageId)
        .filter((id): id is string => Boolean(id)),
    )
    if (acknowledgedClientMessageIds.size === 0) return
    setPendingMessages(current => current.filter(item => {
      const clientMessageId = getClientMessageId(item)
      return !clientMessageId || !acknowledgedClientMessageIds.has(clientMessageId)
    }))
  }, [status])

  const activeQueueItems = useMemo(() => (
    (status?.queueItems ?? []).filter(item => item.status === 'running' || item.status === 'pending' || item.status === 'stalled')
  ), [status?.queueItems])
  const showThinking = pendingReplies > 0 || activeQueueItems.length > 0
  const thinkingStartedAt = pendingStartedAt ??
    parseTaskTime(activeQueueItems[0]?.updatedAt || activeQueueItems[0]?.createdAt)

  useEffect(() => {
    if (!thinkingStartedAt || !showThinking) {
      setPendingElapsedSeconds(0)
      return
    }
    const updateElapsed = () => {
      setPendingElapsedSeconds(Math.max(0, Math.floor((Date.now() - thinkingStartedAt) / 1000)))
    }
    updateElapsed()
    const timer = window.setInterval(updateElapsed, 1000)
    return () => window.clearInterval(timer)
  }, [showThinking, thinkingStartedAt])

  const conversation = useMemo<ConversationItem[]>(() => {
    if (!status) return []
    const acknowledgedClientMessageIds = new Set(
      status.inboxMessages
        .map(getClientMessageId)
        .filter((id): id is string => Boolean(id)),
    )
    const localOnlyMessages = pendingMessages.filter(item => {
      const clientMessageId = getClientMessageId(item)
      return !clientMessageId || !acknowledgedClientMessageIds.has(clientMessageId)
    })
    return [
      ...localOnlyMessages.map(item => ({ kind: 'message' as const, item })),
      ...status.inboxMessages.map(item => ({ kind: 'message' as const, item })),
      ...status.approvals
        .filter(item => item.status === 'pending')
        .map(item => ({ kind: 'approval' as const, item })),
    ]
      .sort((a, b) => new Date(getConversationTime(a)).getTime() - new Date(getConversationTime(b)).getTime())
      .slice(-120)
  }, [pendingMessages, status])

  const config = status?.config
  const displayRiskMode = config?.riskMode === 'full_autonomous' ? 'autonomous' : config?.riskMode

  useEffect(() => {
    const el = conversationScrollRef.current
    if (!el) return
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }, [conversation.length, showThinking])

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

  const submit = async () => {
    const goal = message.trim()
    if (!goal) return
    const clientMessageId = `client-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const optimisticMessage: JarvisInboxMessage = {
      id: `pending-${clientMessageId}`,
      role: 'user',
      source: 'desktop',
      title: '交给 Jarvis 的消息',
      message: goal,
      createdAt: new Date().toISOString(),
      metadata: { pending: true, clientMessageId },
    }
    setPendingMessages(current => [...current, optimisticMessage])
    setPendingStartedAt(Date.now())
    setPendingVerb(randomSpinnerVerb())
    setPendingReplies(count => count + 1)
    setMessage('')
    requestAnimationFrame(resizeTextarea)
    submitTask(goal, clientMessageId).finally(() => {
      setPendingReplies(count => {
        const next = Math.max(0, count - 1)
        if (next === 0) setPendingStartedAt(null)
        return next
      })
    })
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    submit()
  }

  const runTick = async () => {
    setTickLoading(true)
    try {
      await tick()
    } finally {
      setTickLoading(false)
    }
  }

  const toggleEnabled = async () => {
    if (!config) return
    setToggleEnabledLoading(true)
    try {
      await updateConfig({ enabled: !config.enabled })
    } finally {
      setToggleEnabledLoading(false)
    }
  }

  return (
    <div className="flex-1 overflow-hidden bg-[var(--color-surface)]">
      <div className="flex h-full flex-col gap-4 px-8 py-6">
        <header className="flex shrink-0 items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[22px] text-[var(--color-brand)]">sensors</span>
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Jarvis</h1>
          </div>
          {status && config && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <StatusChip>{status.enabled ? '常驻开启' : '已关闭'}</StatusChip>
              <StatusChip>{MODE_LABELS[config.riskMode]}</StatusChip>
              <StatusChip>{queueSummaryV2(status.queue)}</StatusChip>
              <Button size="sm" variant="secondary" disabled={tickLoading} loading={tickLoading} onClick={runTick}>
                立即巡检
              </Button>
              <Button
                size="sm"
                variant={config.enabled ? 'secondary' : 'primary'}
                disabled={toggleEnabledLoading}
                loading={toggleEnabledLoading}
                onClick={toggleEnabled}
              >
                {config.enabled ? '暂停常驻' : '开启常驻'}
              </Button>
            </div>
          )}
        </header>

        {error && (
          <div className="shrink-0 rounded-[var(--radius-md)] border border-[var(--color-error)]/25 bg-[var(--color-error)]/6 px-4 py-3 text-sm text-[var(--color-error)]">
            {error}
          </div>
        )}

        {isLoading && !status ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-brand)] border-t-transparent" />
          </div>
        ) : status && config ? (
          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container)]">
              <div className="shrink-0 border-b border-[var(--color-border)] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Jarvis 对话</h2>
                    <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                      目标、进度、错误和审批都会作为消息出现。Jarvis 需要你介入时会直接发在这里。
                    </p>
                  </div>
                  <div className="text-right text-xs text-[var(--color-text-tertiary)]">
                    <div>{status.enabled ? '运行中' : '已关闭'}</div>
                    <div>下次巡检：{formatDate(status.nextHeartbeatAt)}</div>
                  </div>
                </div>
              </div>

              <div ref={conversationScrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                {conversation.length === 0 ? (
                  <div className="flex h-full items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-4 py-10 text-center text-sm text-[var(--color-text-secondary)]">
                    还没有对话。直接在下面把目标交给 Jarvis。
                  </div>
                ) : (
                  <div className="mx-auto flex max-w-[820px] flex-col">
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
                    {showThinking && (
                      <ThinkingBubble
                        verb={pendingReplies > 0 ? pendingVerb : 'Working'}
                        elapsedSeconds={pendingElapsedSeconds}
                      />
                    )}
                  </div>
                )}
              </div>

              <form
                className="shrink-0 px-4 pb-5 pt-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  submit()
                }}
              >
                <div className="mx-auto w-full max-w-[820px]">
                  <div
                    className="relative rounded-[28px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-4 transition-colors focus-within:border-[var(--color-outline)]"
                    style={{ boxShadow: '0 2px 10px rgba(15, 23, 42, 0.08), 0 16px 42px rgba(15, 23, 42, 0.10)' }}
                  >
                    <textarea
                      ref={textareaRef}
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      onKeyDown={handleInputKeyDown}
                      placeholder="把目标交给 Jarvis..."
                      rows={1}
                      className="max-h-[220px] w-full resize-none overflow-y-auto bg-transparent py-2 text-[15px] leading-7 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] disabled:opacity-50"
                    />
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)]/70 pt-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-1 text-xs text-[var(--color-text-secondary)]">
                          Jarvis
                        </span>
                      </div>
                      <button
                        type="submit"
                        aria-label="发送"
                        disabled={!message.trim()}
                        className="flex w-[112px] items-center justify-center gap-1 rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-white transition-all hover:opacity-90 disabled:opacity-30"
                      >
                        <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
                        发送
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            </section>

            <aside className="min-h-0 overflow-y-auto overscroll-contain pr-1">
              <div className="grid content-start gap-3">
                <Panel
                  id="queue"
                  title={`任务队列（${queueSummaryV2(status.queue)}）`}
                  collapsed={collapsedPanels.has('queue')}
                  onToggle={togglePanel}
                >
                  <div className="grid max-h-[300px] gap-2 overflow-y-auto pr-1">
                    {(status.queueItems ?? []).length === 0 ? (
                      <EmptyState>暂无队列任务</EmptyState>
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
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                                  {item.title || item.goal || item.prompt}
                                </div>
                                <div className="mt-0.5 truncate text-xs text-[var(--color-text-tertiary)]">
                                  {queueStatusLabel(item.status)} · {item.lane || 'none'} · {MODE_LABELS[(item.permissionMode || config.riskMode) as JarvisModeConfig['riskMode']]}
                                </div>
                              </div>
                              <span className="material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)]">
                                {expanded ? 'expand_less' : 'expand_more'}
                              </span>
                            </button>
                            {expanded && (
                              <div className="mt-2">
                                <div className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-[var(--radius-sm)] bg-[var(--color-surface-container)] px-2 py-2 text-xs leading-5 text-[var(--color-text-secondary)]">
                                  {item.error || item.checkpoint || item.goal || item.prompt}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {item.status === 'paused' || item.status === 'stalled' ? (
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
                                  <Button size="sm" variant="danger" disabled={isSaving} onClick={() => queueAction(item.id, 'delete')}>
                                    删除
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                </Panel>

                <Panel id="boundaries" title="自主边界" collapsed={collapsedPanels.has('boundaries')} onToggle={togglePanel}>
                  <label className="mb-2 flex items-center justify-between gap-3 text-sm">
                    <span className="text-xs font-medium text-[var(--color-text-secondary)]">权限模式</span>
                    <select
                      value={displayRiskMode}
                      onChange={(event) => updateConfig({ riskMode: event.target.value as JarvisModeConfig['riskMode'] })}
                      className="h-8 w-36 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text-primary)] outline-none"
                    >
                      <option value="observe">观察模式</option>
                      <option value="assisted">辅助模式</option>
                      <option value="autonomous">自主模式</option>
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

                <Panel id="notifications" title="主动通知" collapsed={collapsedPanels.has('notifications')} onToggle={togglePanel}>
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
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        onClick={() => onToggle(id)}
      >
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</span>
        <span className="material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)]">
          {collapsed ? 'expand_more' : 'expand_less'}
        </span>
      </button>
      {!collapsed && <div className="border-t border-[var(--color-border)] p-3">{children}</div>}
    </section>
  )
}

function MessageBubble({ item }: { item: JarvisInboxMessage }) {
  const isUser = item.role === 'user'
  if (isUser) return <UserMessage content={item.message} />

  const prefix = item.title && item.title !== 'Jarvis 回复'
    ? `**${item.title}**\n\n`
    : ''
  return <AssistantMessage content={`${prefix}${item.message}`} />
}

function getClientMessageId(item: JarvisInboxMessage): string | null {
  const value = item.metadata?.clientMessageId
  return typeof value === 'string' ? value : null
}

function ThinkingBubble({ verb, elapsedSeconds }: { verb: string; elapsedSeconds: number }) {
  return (
    <div className="flex justify-start">
      <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[var(--color-border)]/40 bg-[var(--color-surface-container-low)] px-3 py-1">
        <span className="animate-shimmer text-xs text-[var(--color-brand)]">✦</span>
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">{verb}...</span>
        {elapsedSeconds > 0 && (
          <span className="text-[10px] text-[var(--color-text-tertiary)]">
            {formatElapsed(elapsedSeconds)}
          </span>
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
    <article className="rounded-[var(--radius-lg)] border border-amber-300 bg-amber-50 px-4 py-3">
      <div className="mb-1 flex items-center justify-between gap-4 text-xs text-[var(--color-text-tertiary)]">
        <span className="font-medium text-amber-800">{item.title}</span>
        <span>{formatTime(item.createdAt)}</span>
      </div>
      <div className="whitespace-pre-wrap text-sm leading-6 text-[var(--color-text-primary)]">{item.message}</div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="primary" disabled={disabled} onClick={onApprove}>批准</Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={onReject}>拒绝</Button>
      </div>
    </article>
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
    <label className="flex h-10 items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm">
      <span className="truncate text-[var(--color-text-primary)]">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[var(--color-brand)]"
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
    <label className="grid gap-1 text-xs text-[var(--color-text-secondary)]">
      {label}
      <input
        type="number"
        min={1}
        value={value}
        onChange={(event) => onChange(Math.max(1, Number(event.target.value) || 1))}
        className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text-primary)] outline-none"
      />
    </label>
  )
}

function StatusChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-[var(--color-surface-container)] px-2.5 py-1 text-xs text-[var(--color-text-secondary)]">
      {children}
    </span>
  )
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-3 py-6 text-center text-sm text-[var(--color-text-secondary)]">
      {children}
    </div>
  )
}

function queueSummaryV2(queue: {
  pending?: number
  running?: number
  paused?: number
  stalled?: number
  failed?: number
  completed?: number
} | undefined) {
  const parts = [
    `待处理 ${queue?.pending ?? 0}`,
    `运行 ${queue?.running ?? 0}`,
    `暂停 ${queue?.paused ?? 0}`,
  ]
  if ((queue?.stalled ?? 0) > 0) parts.push(`停滞 ${queue?.stalled ?? 0}`)
  if ((queue?.failed ?? 0) > 0) parts.push(`失败 ${queue?.failed ?? 0}`)
  if ((queue?.completed ?? 0) > 0) parts.push(`完成 ${queue?.completed ?? 0}`)
  return parts.join(' · ')
}

function parseTaskTime(value?: string): number | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

export function queueSummary(queue: { pending?: number; running?: number; paused?: number } | undefined) {
  return `待处理 ${queue?.pending ?? 0} · 运行 ${queue?.running ?? 0} · 暂停 ${queue?.paused ?? 0}`
}

function queueStatusLabel(status: string): string {
  if (status === 'pending') return '待执行'
  if (status === 'running') return '运行中'
  if (status === 'paused') return '暂停'
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'cancelled') return '已取消'
  if (status === 'stalled') return '停滞'
  return status
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

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}m ${rest}s`
}
