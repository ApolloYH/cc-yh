import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_AWAY_RUNNER_CONFIG,
  evaluateAwayRunner,
  normalizeAwayRunnerConfig,
  type AwayRunnerRunState,
} from '../index.js'

const startedAt = '2026-04-26T01:00:00.000Z'
const now = '2026-04-26T01:05:00.000Z'

function state(overrides: Partial<AwayRunnerRunState> = {}): AwayRunnerRunState {
  return {
    startedAt,
    now,
    turns: 1,
    toolCalls: 1,
    costUsd: 0,
    checkpoints: [
      {
        id: 'cp-1',
        createdAt: startedAt,
        label: 'start',
        summary: 'Initial plan recorded',
      },
    ],
    ...overrides,
  }
}

describe('away runner policy', () => {
  it('is disabled by default', () => {
    const decision = evaluateAwayRunner(undefined, state())
    expect(decision).toEqual({ status: 'disabled', reasons: [] })
  })

  it('normalizes partial config without dropping default safety rules', () => {
    const config = normalizeAwayRunnerConfig({ enabled: true })
    expect(config.enabled).toBe(true)
    expect(config.mode).toBe(DEFAULT_AWAY_RUNNER_CONFIG.mode)
    expect(config.pauseOn).toContain('needs_user_decision')
    expect(config.checkpoints.requireInitial).toBe(true)
  })

  it('allows low-risk assisted work when checkpoint and budgets are valid', () => {
    const decision = evaluateAwayRunner(
      {
        enabled: true,
        mode: 'assisted',
        allowedRisk: 'low',
      },
      state({ requestedRisk: 'low' }),
    )

    expect(decision.status).toBe('allow')
    expect(decision.reasons).toEqual([])
    expect(decision.nextCheckpointDueAt).toBe('2026-04-26T01:10:00.000Z')
  })

  it('requires an initial checkpoint before autonomous continuation', () => {
    const decision = evaluateAwayRunner(
      {
        enabled: true,
        mode: 'autonomous',
      },
      state({ checkpoints: [] }),
    )

    expect(decision.status).toBe('checkpoint_required')
    expect(decision.reasons).toEqual(['missing_checkpoint'])
  })

  it('requires periodic checkpoints for long-running work', () => {
    const decision = evaluateAwayRunner(
      {
        enabled: true,
        mode: 'autonomous',
        checkpoints: {
          requireInitial: true,
          requireFinalReport: true,
          intervalMs: 60_000,
        },
      },
      state(),
    )

    expect(decision.status).toBe('checkpoint_required')
    expect(decision.reasons).toEqual(['missing_checkpoint'])
    expect(decision.nextCheckpointDueAt).toBe('2026-04-26T01:01:00.000Z')
  })

  it('pauses autonomous work when budgets are exhausted', () => {
    const decision = evaluateAwayRunner(
      {
        enabled: true,
        mode: 'autonomous',
        budget: {
          maxRuntimeMs: 60_000,
        },
      },
      state(),
    )

    expect(decision.status).toBe('pause')
    expect(decision.reasons).toEqual(['budget_exhausted'])
  })

  it('denies assisted work when a configured pause reason is present', () => {
    const decision = evaluateAwayRunner(
      {
        enabled: true,
        mode: 'assisted',
      },
      state({ pendingPauseReasons: ['secret_access'] }),
    )

    expect(decision.status).toBe('deny')
    expect(decision.reasons).toEqual(['secret_access'])
  })

  it('pauses when requested risk exceeds policy', () => {
    const decision = evaluateAwayRunner(
      {
        enabled: true,
        mode: 'autonomous',
        allowedRisk: 'low',
      },
      state({ requestedRisk: 'medium' }),
    )

    expect(decision.status).toBe('pause')
    expect(decision.reasons).toEqual(['risk_exceeds_policy'])
  })

  it('keeps observe mode non-executing', () => {
    const decision = evaluateAwayRunner(
      {
        enabled: true,
        mode: 'observe',
      },
      state(),
    )

    expect(decision.status).toBe('pause')
    expect(decision.reasons).toEqual(['observe_only'])
  })
})
