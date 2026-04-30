export type JarvisRiskMode = 'observe' | 'assisted' | 'autonomous'

export type JarvisSourceKey = 'scheduledTasks' | 'sessions' | 'git'

export type JarvisNotificationChannel =
  | 'desktop'
  | 'telegram'
  | 'feishu'
  | 'dingtalk'
  | 'wecom'

export type JarvisModeConfig = {
  enabled: boolean
  intervalMs: number
  riskMode: JarvisRiskMode
  companionModeEnabled: boolean
  autoResumeQueue: boolean
  watchdogEnabled: boolean
  sources: Record<JarvisSourceKey, boolean>
  notificationChannels: JarvisNotificationChannel[]
  maxEventsPerHour: number
  requireApprovalForExternalActions: boolean
  taskPrompt?: string
  cloud: JarvisCloudConfig
  boundaries: JarvisBoundaries
}

export type JarvisCloudConfig = {
  enabled: boolean
  endpoint?: string
  runnerId: string
  syncQueue: boolean
  heartbeatIntervalMs: number
  tokenSet: boolean
  lastHeartbeatAt?: string
  lastRunnerStatus?: string
}

export type JarvisBoundaries = {
  allowedWorkdirs: string[]
  allowedDomains: string[]
  blockedActions: string[]
  budgetMinutes: number
  maxToolCalls: number
  pauseOnSecrets: boolean
  pauseOnExternalSend: boolean
  pauseOnPayment: boolean
  pauseOnLogin: boolean
}

export type JarvisEventType =
  | 'heartbeat'
  | 'checkpoint'
  | 'report'
  | 'config'
  | 'paused'
  | 'error'

export type JarvisEventSeverity = 'info' | 'warn' | 'error'

export type JarvisEvent = {
  id: string
  type: JarvisEventType
  severity: JarvisEventSeverity
  createdAt: string
  title: string
  message: string
}

export type JarvisMetrics = {
  heartbeatCount: number
  eventsToday: number
  enabledSince: string | null
}

export type JarvisStatus = {
  enabled: boolean
  running: boolean
  lastHeartbeatAt: string | null
  nextHeartbeatAt: string | null
  uptimeMs: number
  summary: string
  config: JarvisModeConfig
  recentEvents: JarvisEvent[]
  metrics: JarvisMetrics
  cloud: JarvisCloudConfig
  queue?: {
    pending: number
    running: number
    paused: number
    failed: number
    completed: number
  }
  queueItems?: Array<{
    id: string
    prompt: string
    title?: string
    goal?: string
    status: string
    priority: number
    attempts: number
    maxAttempts: number
    checkpoint?: string
    error?: string
    createdAt: string
    updatedAt: string
  }>
  reports?: Array<{
    id: string
    taskId?: string
    title: string
    status: string
    summary: string
    checkpoint?: string
    reportPath: string
    createdAt: string
  }>
}
