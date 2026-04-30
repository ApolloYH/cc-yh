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

export type AwayRunnerBudget = {
  maxRuntimeMs?: number
  maxTurns?: number
  maxToolCalls?: number
  maxCostUsd?: number
  deadlineAt?: string
}

export type AwayRunnerCheckpointPolicy = {
  requireInitial: boolean
  requireFinalReport: boolean
  intervalMs?: number
}

export type AwayRunnerConfig = {
  enabled: boolean
  mode: AwayRunnerMode
  budget: AwayRunnerBudget
  checkpoints: AwayRunnerCheckpointPolicy
  pauseOn: AwayRunnerPauseReason[]
  allowedRisk: AwayRunnerRiskLevel
}

export type AwayRunnerCheckpoint = {
  id: string
  createdAt: string
  label: string
  summary: string
}

export type AwayRunnerRunState = {
  startedAt: string
  now: string
  turns: number
  toolCalls: number
  costUsd: number
  requestedRisk?: AwayRunnerRiskLevel
  pendingPauseReasons?: AwayRunnerPauseReason[]
  checkpoints: AwayRunnerCheckpoint[]
  finalReportWritten?: boolean
}

export type AwayRunnerDecisionStatus =
  | 'disabled'
  | 'allow'
  | 'checkpoint_required'
  | 'pause'
  | 'deny'

export type AwayRunnerDecision = {
  status: AwayRunnerDecisionStatus
  reasons: AwayRunnerPauseReason[]
  nextCheckpointDueAt?: string
}
