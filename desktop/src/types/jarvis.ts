export type JarvisRiskMode = 'observe' | 'assisted' | 'autonomous' | 'full_autonomous'

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

export type JarvisEvent = {
  id: string
  type: 'heartbeat' | 'checkpoint' | 'report' | 'inbox' | 'approval' | 'config' | 'paused' | 'error'
  severity: 'info' | 'warn' | 'error'
  createdAt: string
  title: string
  message: string
}

export type JarvisInboxSource =
  | 'desktop'
  | 'web'
  | 'cli'
  | 'telegram'
  | 'feishu'
  | 'dingtalk'
  | 'wecom'
  | 'system'

export type JarvisInboxMessage = {
  id: string
  role: 'user' | 'jarvis' | 'system'
  source: JarvisInboxSource
  createdAt: string
  title?: string
  message: string
  taskId?: string
  severity?: 'info' | 'warn' | 'error'
  metadata?: Record<string, unknown>
}

export type JarvisApprovalRequest = {
  id: string
  taskId?: string
  source: JarvisInboxSource
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
  updatedAt: string
  title: string
  message: string
  risk: 'external-send' | 'login' | 'payment' | 'secret' | 'irreversible' | 'other'
  resolutionNote?: string
}

export type JarvisRunStatus =
  | 'planning'
  | 'running'
  | 'paused'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type JarvisWorkerRole =
  | 'manager'
  | 'explorer'
  | 'implementer'
  | 'tester'
  | 'browser_operator'
  | 'researcher'
  | 'reviewer'
  | 'writer'
  | 'custom'

export type JarvisWorkerStatus =
  | 'pending'
  | 'running'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type JarvisReportPolicy = {
  progressMode: 'normal' | 'quiet' | 'silent'
  progressIntervalMs: number
  reportOnlyWhenChanged: boolean
  reportOnBlocked: boolean
  reportOnRisk: boolean
  finalReportRequired: boolean
}

export type JarvisManagerPlan = {
  goal: string
  strategy: string
  workers: Array<{
    role: JarvisWorkerRole
    title: string
    task: string
    expectedOutput: string
    timeoutMinutes: number
  }>
  reportPolicy: JarvisReportPolicy
  riskNotes: string[]
}

export type JarvisWorkerTask = {
  id: string
  runId: string
  queueItemId?: string
  role: JarvisWorkerRole
  title: string
  prompt: string
  expectedOutput?: string
  status: JarvisWorkerStatus
  assignedAt?: string
  lastProgressAt?: string
  timeoutAt?: string
  checkpoint?: string
  result?: string
  error?: string
}

export type JarvisRun = {
  id: string
  goal: string
  status: JarvisRunStatus
  managerPlan?: JarvisManagerPlan
  workers: JarvisWorkerTask[]
  reportPolicy: JarvisReportPolicy
  createdAt: string
  updatedAt: string
  finalReport?: string
}

export type JarvisStatus = {
  enabled: boolean
  running: boolean
  lastHeartbeatAt: string | null
  nextHeartbeatAt: string | null
  uptimeMs: number
  summary: string
  config: JarvisModeConfig
  cloud: JarvisCloudConfig
  recentEvents: JarvisEvent[]
  inboxMessages: JarvisInboxMessage[]
  approvals: JarvisApprovalRequest[]
  metrics: {
    heartbeatCount: number
    eventsToday: number
    enabledSince: string | null
  }
  queue?: {
    pending: number
    running: number
    paused: number
    failed: number
    completed: number
    cancelled?: number
    stalled?: number
  }
  queueItems?: Array<{
    id: string
    prompt: string
    title?: string
    goal?: string
    status: string
    lane?: 'none' | 'read_only' | 'write' | 'external'
    workdir?: string
    permissionMode?: JarvisRiskMode
    sessionId?: string
    pid?: number
    lastEventAt?: string
    exitCode?: number
    reportMuted?: boolean
    supplementSummary?: string
    priority: number
    attempts: number
    maxAttempts: number
    approvalState?: 'none' | 'requested' | 'approved'
    checkpoint?: string
    error?: string
    createdAt: string
    updatedAt: string
  }>
  runs?: JarvisRun[]
}
