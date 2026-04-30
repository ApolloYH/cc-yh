import { describe, expect, it } from 'bun:test'
import { enforceRouterInvariants, type JarvisRouterDecision } from '../router.js'
import type { JarvisModeConfig } from '../types.js'

describe('Jarvis router invariants', () => {
  it('normalizes project analysis with workdir from status into a read-only task', () => {
    const decision = enforceRouterInvariants({
      intent: 'status',
      lane: 'read_only',
      workdir: 'C:\\Users\\y1513\\Desktop\\dots2api',
      permissionMode: 'autonomous',
      confidence: 0.98,
      reason: 'User explicitly requests project analysis of a local directory path',
    }, config())

    expect(decision.intent).toBe('new_task')
    expect(decision.lane).toBe('read_only')
    expect(decision.workdir).toBe('C:\\Users\\y1513\\Desktop\\dots2api')
  })

  it('keeps real Jarvis status queries as status with no workdir', () => {
    const decision = enforceRouterInvariants({
      intent: 'status',
      lane: 'none',
      permissionMode: 'autonomous',
      confidence: 1,
      reason: 'User asks current Jarvis queue status',
    }, config())

    expect(decision.intent).toBe('status')
    expect(decision.lane).toBe('none')
    expect(decision.workdir).toBeUndefined()
  })

  it('normalizes new_task lane none to read_only instead of creating a non-runnable task', () => {
    const decision = enforceRouterInvariants({
      intent: 'new_task',
      lane: 'none',
      permissionMode: 'autonomous',
      confidence: 0.9,
      reason: 'User asks to research a repository',
    }, config())

    expect(decision.intent).toBe('new_task')
    expect(decision.lane).toBe('read_only')
  })

  it('keeps progress-report controls out of task supplement inbox', () => {
    const decision = enforceRouterInvariants({
      intent: 'supplement',
      lane: 'none',
      permissionMode: 'autonomous',
      confidence: 0.9,
      reason: 'User wants only final answer for the active task',
      controlAction: 'mute_reports',
    }, config())

    expect(decision.intent).toBe('control')
    expect(decision.lane).toBe('none')
    expect(decision.controlAction).toBe('mute_reports')
  })
})

function config(): JarvisModeConfig {
  return {
    enabled: true,
    intervalMs: 60_000,
    riskMode: 'autonomous',
    companionModeEnabled: true,
    autoResumeQueue: true,
    watchdogEnabled: true,
    sources: {
      scheduledTasks: true,
      sessions: true,
      git: true,
    },
    notificationChannels: ['desktop'],
    maxEventsPerHour: 50,
    requireApprovalForExternalActions: false,
    cloud: {
      enabled: false,
      runnerId: 'local',
      syncQueue: false,
      heartbeatIntervalMs: 60_000,
      tokenSet: false,
    },
    boundaries: {
      allowedWorkdirs: [],
      allowedDomains: [],
      blockedActions: [],
      budgetMinutes: 60,
      maxToolCalls: 80,
      pauseOnSecrets: false,
      pauseOnExternalSend: false,
      pauseOnPayment: false,
      pauseOnLogin: false,
    },
  }
}
