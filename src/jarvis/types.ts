export type JarvisRiskMode = 'observe' | 'assisted'

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
  sources: Record<JarvisSourceKey, boolean>
  notificationChannels: JarvisNotificationChannel[]
  maxEventsPerHour: number
  requireApprovalForExternalActions: boolean
}

export type JarvisEventType =
  | 'heartbeat'
  | 'checkpoint'
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
}
