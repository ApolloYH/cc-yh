import type { JarvisQueueItem } from './queue.js'
import type { JarvisModeConfig } from './types.js'
import type { JarvisLane } from './router.js'

export type JarvisTaskEnvelope = {
  taskId: string
  originalGoal: string
  workdir?: string
  lane: JarvisLane
  permissionMode: JarvisModeConfig['riskMode']
  fullAutonomous: boolean
  reportMuted: boolean
  concurrencyRule: string
  outputFormat: string
  supplementSummary?: string
}

export function buildJarvisTaskEnvelope(input: {
  taskId: string
  goal: string
  workdir?: string
  lane: JarvisLane
  permissionMode: JarvisModeConfig['riskMode']
  reportMuted?: boolean
  supplementSummary?: string
}): JarvisTaskEnvelope {
  return {
    taskId: input.taskId,
    originalGoal: input.goal,
    workdir: input.workdir,
    lane: input.lane,
    permissionMode: input.permissionMode,
    fullAutonomous: input.permissionMode === 'autonomous' || input.permissionMode === 'full_autonomous',
    reportMuted: input.reportMuted === true,
    concurrencyRule: input.lane === 'write'
      ? 'Same-project write work is serialized by Jarvis. If you use subagents that write files, prefer native worktree isolation.'
      : input.lane === 'read_only'
        ? 'Read-only managers may run concurrently. Do not write files unless you explicitly reclassify the task.'
        : 'Follow Jarvis lane policy and report blockers.',
    outputFormat: 'Stream progress through normal Claude stream-json. Final answer must include taskId and a concise result.',
    supplementSummary: input.supplementSummary,
  }
}

export function buildJarvisManagerPrompt(item: JarvisQueueItem): string {
  const envelope = buildJarvisTaskEnvelope({
    taskId: item.id,
    goal: item.goal || item.prompt,
    workdir: item.workdir,
    lane: item.lane ?? 'read_only',
    permissionMode: item.permissionMode ?? 'assisted',
    reportMuted: item.reportMuted,
    supplementSummary: item.supplementSummary,
  })
  return [
    'You are Jarvis Manager for claude-yh.',
    '',
    'Rules:',
    '- You are the execution brain for one complete user goal.',
    '- Jarvis Service already routed and scheduled this task. Do not ask Jarvis to split it.',
    '- Plan the task yourself using native Claude behavior.',
    '- Use TodoWrite/TaskCreate when useful.',
    '- Use native AgentTool/subagents for complex work. Read-only subagents can run in parallel; writing subagents should use worktree isolation by default.',
    '- If the user goal is only to create a delayed reminder or recurring scheduled task, do not merely claim it was scheduled. Report that this should be routed through Jarvis schedule handling or use an actual scheduling tool and include the created task id.',
    '- Do not spam progress. Report meaningful phase changes, blockers, risk, permissions, and final result.',
    '- If blocked, failed, or waiting for user input, report that in a structured way.',
    '- The final report must be written by you and must include the taskId.',
    '',
    'TaskEnvelope:',
    JSON.stringify(envelope, null, 2),
    '',
    'User goal:',
    envelope.originalGoal,
  ].join('\n')
}
