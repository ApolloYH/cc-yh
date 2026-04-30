// Source: src/server/services/cronService.ts

export type TaskNotificationConfig = {
  enabled: boolean
  channels: ('telegram' | 'feishu')[]
}

export type AwayRunnerMode = 'observe' | 'assisted' | 'autonomous'

export type AwayRunnerRiskLevel = 'low' | 'medium' | 'high'

export type AwayRunnerPauseReason =
  | 'observe_only'
  | 'needs_user_decision'
  | 'sensitive_action'
  | 'browser_human_only'
  | 'external_api'
  | 'secret_access'
  | 'destructive_file_operation'
  | 'workspace_not_clean'
  | 'test_failure'
  | 'unknown_error'
  | 'budget_exhausted'
  | 'missing_checkpoint'
  | 'risk_exceeds_policy'

export type AwayRunnerConfig = {
  enabled: boolean
  mode: AwayRunnerMode
  budget: {
    maxRuntimeMs?: number
    maxTurns?: number
    maxToolCalls?: number
    maxCostUsd?: number
    deadlineAt?: string
  }
  checkpoints: {
    requireInitial: boolean
    requireFinalReport: boolean
    intervalMs?: number
  }
  pauseOn: AwayRunnerPauseReason[]
  allowedRisk: AwayRunnerRiskLevel
}

export type CronTask = {
  id: string
  name: string
  description?: string
  cron: string
  prompt: string
  enabled: boolean
  recurring?: boolean
  permanent?: boolean
  createdAt: number
  lastRunAt?: number
  lastFiredAt?: string
  nextRunAt?: number
  permissionMode?: string
  model?: string
  folderPath?: string
  useWorktree?: boolean
  notification?: TaskNotificationConfig
  awayRunner?: Partial<AwayRunnerConfig>
}

export type CreateTaskInput = {
  name: string
  description?: string
  cron: string
  prompt: string
  enabled?: boolean
  recurring?: boolean
  permanent?: boolean
  permissionMode?: string
  model?: string
  folderPath?: string
  useWorktree?: boolean
  notification?: TaskNotificationConfig
  awayRunner?: Partial<AwayRunnerConfig>
}

export type TaskRun = {
  id: string
  taskId: string
  taskName: string
  startedAt: string
  completedAt?: string
  status: 'running' | 'completed' | 'failed' | 'timeout'
  prompt: string
  output?: string
  error?: string
  exitCode?: number
  durationMs?: number
  sessionId?: string
}
