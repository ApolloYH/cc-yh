import type {
  AwayRunnerCheckpointPolicy,
  AwayRunnerConfig,
  AwayRunnerDecision,
  AwayRunnerPauseReason,
  AwayRunnerRiskLevel,
  AwayRunnerRunState,
} from './types.js'

const RISK_ORDER: Record<AwayRunnerRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
}

export const DEFAULT_AWAY_RUNNER_CONFIG: AwayRunnerConfig = {
  enabled: false,
  mode: 'assisted',
  budget: {
    maxRuntimeMs: 30 * 60 * 1000,
    maxTurns: 20,
    maxToolCalls: 80,
  },
  checkpoints: {
    requireInitial: true,
    requireFinalReport: true,
    intervalMs: 10 * 60 * 1000,
  },
  pauseOn: [
    'needs_user_decision',
    'sensitive_action',
    'browser_human_only',
    'external_api',
    'secret_access',
    'destructive_file_operation',
    'workspace_not_clean',
    'test_failure',
    'unknown_error',
  ],
  allowedRisk: 'low',
}

export function normalizeAwayRunnerConfig(
  config?: Partial<AwayRunnerConfig> | null,
): AwayRunnerConfig {
  return {
    ...DEFAULT_AWAY_RUNNER_CONFIG,
    ...config,
    budget: {
      ...DEFAULT_AWAY_RUNNER_CONFIG.budget,
      ...config?.budget,
    },
    checkpoints: {
      ...DEFAULT_AWAY_RUNNER_CONFIG.checkpoints,
      ...config?.checkpoints,
    },
    pauseOn: config?.pauseOn ?? DEFAULT_AWAY_RUNNER_CONFIG.pauseOn,
  }
}

export function evaluateAwayRunner(
  rawConfig: Partial<AwayRunnerConfig> | null | undefined,
  state: AwayRunnerRunState,
): AwayRunnerDecision {
  const config = normalizeAwayRunnerConfig(rawConfig)
  if (!config.enabled) {
    return { status: 'disabled', reasons: [] }
  }

  if (config.mode === 'observe') {
    return { status: 'pause', reasons: ['observe_only'] }
  }

  const nowMs = Date.parse(state.now)
  const startedAtMs = Date.parse(state.startedAt)
  const reasons = uniqueReasons([
    ...budgetReasons(config, state, nowMs, startedAtMs),
    ...explicitPauseReasons(config, state.pendingPauseReasons ?? []),
    ...riskReasons(config, state.requestedRisk),
  ])

  if (reasons.length > 0) {
    return { status: config.mode === 'autonomous' ? 'pause' : 'deny', reasons }
  }

  const checkpointDecision = evaluateCheckpointPolicy(
    config.checkpoints,
    state,
    nowMs,
  )
  if (checkpointDecision) return checkpointDecision

  return {
    status: 'allow',
    reasons: [],
    nextCheckpointDueAt: nextCheckpointDueAt(config.checkpoints, state),
  }
}

function budgetReasons(
  config: AwayRunnerConfig,
  state: AwayRunnerRunState,
  nowMs: number,
  startedAtMs: number,
): AwayRunnerPauseReason[] {
  const budget = config.budget
  const elapsedMs = nowMs - startedAtMs

  if (
    (budget.maxRuntimeMs !== undefined && elapsedMs > budget.maxRuntimeMs) ||
    (budget.maxTurns !== undefined && state.turns > budget.maxTurns) ||
    (budget.maxToolCalls !== undefined && state.toolCalls > budget.maxToolCalls) ||
    (budget.maxCostUsd !== undefined && state.costUsd > budget.maxCostUsd) ||
    (budget.deadlineAt !== undefined && nowMs > Date.parse(budget.deadlineAt))
  ) {
    return ['budget_exhausted']
  }

  return []
}

function explicitPauseReasons(
  config: AwayRunnerConfig,
  reasons: AwayRunnerPauseReason[],
): AwayRunnerPauseReason[] {
  const pauseOn = new Set(config.pauseOn)
  return reasons.filter((reason) => pauseOn.has(reason))
}

function riskReasons(
  config: AwayRunnerConfig,
  requestedRisk: AwayRunnerRiskLevel | undefined,
): AwayRunnerPauseReason[] {
  if (!requestedRisk) return []
  return RISK_ORDER[requestedRisk] > RISK_ORDER[config.allowedRisk]
    ? ['risk_exceeds_policy']
    : []
}

function evaluateCheckpointPolicy(
  policy: AwayRunnerCheckpointPolicy,
  state: AwayRunnerRunState,
  nowMs: number,
): AwayRunnerDecision | null {
  if (policy.requireInitial && state.checkpoints.length === 0) {
    return { status: 'checkpoint_required', reasons: ['missing_checkpoint'] }
  }

  if (
    policy.requireFinalReport &&
    state.pendingPauseReasons?.includes('needs_user_decision') &&
    !state.finalReportWritten
  ) {
    return { status: 'checkpoint_required', reasons: ['missing_checkpoint'] }
  }

  if (!policy.intervalMs || state.checkpoints.length === 0) {
    return null
  }

  const latest = state.checkpoints[state.checkpoints.length - 1]
  const latestMs = Date.parse(latest.createdAt)
  if (nowMs - latestMs > policy.intervalMs) {
    return {
      status: 'checkpoint_required',
      reasons: ['missing_checkpoint'],
      nextCheckpointDueAt: new Date(latestMs + policy.intervalMs).toISOString(),
    }
  }

  return null
}

function nextCheckpointDueAt(
  policy: AwayRunnerCheckpointPolicy,
  state: AwayRunnerRunState,
): string | undefined {
  if (!policy.intervalMs || state.checkpoints.length === 0) return undefined
  const latest = state.checkpoints[state.checkpoints.length - 1]
  return new Date(Date.parse(latest.createdAt) + policy.intervalMs).toISOString()
}

function uniqueReasons(reasons: AwayRunnerPauseReason[]): AwayRunnerPauseReason[] {
  return [...new Set(reasons)]
}
