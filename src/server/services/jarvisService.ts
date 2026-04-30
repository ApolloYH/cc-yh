import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { CronService } from './cronService.js'
import type { CronTask } from './cronService.js'
import { cronScheduler, type TaskRun } from './cronScheduler.js'
import { SessionService } from './sessionService.js'
import { sendMarkdownNotification } from './notificationService.js'
import { callConfiguredMainModel } from '../../services/model/mainModelClient.js'
import { logDiagnosticEvent } from '../../utils/diagnosticLog.js'
import {
  appendJarvisEvent,
  type JarvisConfigPatch,
  readJarvisConfig,
  readJarvisEvents,
  updateJarvisConfig,
} from '../../jarvis/store.js'
import {
  claimNextJarvisTask,
  deleteJarvisQueueItem,
  enqueueJarvisTask,
  type JarvisQueueItem,
  listJarvisQueue,
  recoverInterruptedJarvisQueue,
  updateJarvisQueueItem,
} from '../../jarvis/queue.js'
import { submitJarvisGoal } from '../../jarvis/planner.js'
import {
  appendJarvisTodo,
  ensureJarvisWorkspace,
  readJarvisReports,
  writeJarvisReport,
} from '../../jarvis/reports.js'
import {
  appendJarvisInboxMessage,
  createJarvisApproval,
  readJarvisApprovals,
  readJarvisInboxMessages,
  updateJarvisApproval,
} from '../../jarvis/inbox.js'
import type {
  JarvisApprovalStatus,
  JarvisEvent,
  JarvisInboxSource,
  JarvisMetrics,
  JarvisModeConfig,
  JarvisStatus,
} from '../../jarvis/types.js'

const execFileAsync = promisify(execFile)
const JARVIS_PROGRESS_INTERVAL_MS = 30_000

type JarvisServiceOptions = {
  cronService?: CronService
  sessionService?: SessionService
  runTask?: (task: CronTask) => Promise<TaskRun>
}

export class JarvisService {
  private timer: Timer | null = null
  private startedAt: number | null = null
  private lastHeartbeatAt: string | null = null
  private nextHeartbeatAt: string | null = null
  private heartbeatCount = 0
  private enabledSince: string | null = null
  private cronService: CronService
  private sessionService: SessionService
  private runTask: (task: CronTask) => Promise<TaskRun>
  private runningContinuousTask = false
  private mutedProgressTaskIds = new Set<string>()

  constructor(options: JarvisServiceOptions = {}) {
    this.cronService = options.cronService ?? new CronService()
    this.sessionService = options.sessionService ?? new SessionService()
    this.runTask = options.runTask ?? ((task) => cronScheduler.executeTask(task, { createSession: true }))
  }

  async start(): Promise<void> {
    await ensureJarvisWorkspace()
    const config = await readJarvisConfig()
    const recovered = await recoverInterruptedJarvisQueue()
    if (recovered > 0) {
      await appendJarvisEvent({
        type: 'checkpoint',
        title: 'Jarvis queue recovered',
        message: `${recovered} interrupted queue item(s) were restored after process restart.`,
      })
    }
    if (!config.enabled) {
      this.stop()
      return
    }
    if (!this.startedAt) {
      this.startedAt = Date.now()
      this.enabledSince = new Date().toISOString()
    }
    this.armTimer(config)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.startedAt = null
    this.enabledSince = null
    this.nextHeartbeatAt = null
  }

  async updateConfig(
    patch: JarvisConfigPatch,
  ): Promise<JarvisStatus> {
    const config = await updateJarvisConfig(patch)
    await appendJarvisEvent({
      type: 'config',
      title: config.enabled ? 'Jarvis enabled' : 'Jarvis disabled',
      message: this.describeConfig(config),
    })

    if (config.enabled) {
      if (!this.startedAt) {
        this.startedAt = Date.now()
        this.enabledSince = new Date().toISOString()
      }
      this.armTimer(config)
    } else {
      this.stop()
    }

    return this.getStatus()
  }

  async tick(reason = 'manual'): Promise<JarvisEvent> {
    const config = await readJarvisConfig()
    if (!config.enabled && reason !== 'manual') {
      return appendJarvisEvent({
        type: 'paused',
        severity: 'warn',
        title: 'Jarvis is paused',
        message: 'The daemon skipped a heartbeat because Jarvis is disabled.',
      })
    }

    const snapshot = await this.collectSnapshot(config)
    const now = new Date().toISOString()
    this.lastHeartbeatAt = now
    this.heartbeatCount += 1
    this.nextHeartbeatAt = config.enabled
      ? new Date(Date.now() + config.intervalMs).toISOString()
      : null

    const event = await appendJarvisEvent({
      type: 'checkpoint',
      title: reason === 'manual' ? 'Manual checkpoint complete' : '24h checkpoint complete',
      message: snapshot,
    })
    await this.notifyCheckpoint(config, event.title, snapshot)
    await this.publishCloudHeartbeat(config, event).catch((error) => {
      appendJarvisEvent({
        type: 'error',
        severity: 'warn',
        title: 'Jarvis cloud heartbeat failed',
        message: error instanceof Error ? error.message : String(error),
      }).catch(() => {})
    })
    await this.maybeRunAutonomousWork(config)
    return event
  }

  async getStatus(): Promise<JarvisStatus> {
    const config = await readJarvisConfig()
    const events = await readJarvisEvents(50)
    const lastHeartbeat =
      this.lastHeartbeatAt ??
      events.find((event) => event.type === 'checkpoint' || event.type === 'heartbeat')
        ?.createdAt ??
      null
    const metrics = this.buildMetrics(events)
    return {
      enabled: config.enabled,
      running: config.enabled && this.timer !== null,
      lastHeartbeatAt: lastHeartbeat,
      nextHeartbeatAt: this.nextHeartbeatAt,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
      summary: this.buildSummary(config, events),
      config,
      cloud: config.cloud,
      recentEvents: events,
      inboxMessages: await readJarvisInboxMessages(120),
      approvals: await readJarvisApprovals(80),
      metrics,
      queue: await this.buildQueueSummary(),
      queueItems: (await listJarvisQueue()).slice(0, 20).map(item => ({
        id: item.id,
        prompt: item.prompt,
        title: item.title,
        goal: item.goal,
        status: item.status,
        priority: item.priority,
        attempts: item.attempts,
        maxAttempts: item.maxAttempts,
        approvalState: item.approvalState,
        checkpoint: item.checkpoint,
        error: item.error,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      reports: await readJarvisReports(10),
    }
  }

  async submitGoal(
    goal: string,
    priority?: number,
    source: JarvisInboxSource = 'desktop',
  ): Promise<JarvisStatus> {
    const startedAt = Date.now()
    const config = await updateJarvisConfig({ enabled: true })
    logDiagnosticEvent({
      scope: 'jarvis.service',
      event: 'submit_goal',
      ok: true,
      data: {
        source,
        priority: priority ?? null,
        riskMode: config.riskMode,
        companionModeEnabled: config.companionModeEnabled,
        goalLength: goal.length,
      },
    })
    await appendJarvisInboxMessage({
      role: 'user',
      source,
      title: '交给 Jarvis 的目标',
      message: goal,
      metadata: { priority },
    })
    const route = classifyJarvisGoalRoute(goal)
    logDiagnosticEvent({
      scope: 'jarvis.service',
      event: 'goal_route_decided',
      ok: true,
      data: {
        route: route.route,
        reason: route.reason,
        source,
        goalLength: goal.length,
      },
    })
    if (route.route === 'interactive') {
      const reply = await this.buildInteractiveReply(goal, config, route.reason)
      await appendJarvisInboxMessage({
        role: 'jarvis',
        source: 'system',
        title: reply.title,
        message: reply.message,
        metadata: {
          goal,
          route: 'interactive',
          reason: route.reason,
          modelUsed: reply.modelUsed,
        },
      })
      logDiagnosticEvent({
        scope: 'jarvis.service',
        event: 'interactive_reply_completed',
        ok: true,
        durationMs: Date.now() - startedAt,
        data: {
          source,
          reason: route.reason,
          modelUsed: reply.modelUsed,
          outputLength: reply.message.length,
        },
      })
      return this.getStatus()
    }

    const plan = await submitJarvisGoal({ goal, config, priority })
    logDiagnosticEvent({
      scope: 'jarvis.service',
      event: 'plan_created',
      ok: true,
      data: {
        source,
        title: plan.title,
        stepCount: plan.steps.length,
        itemIds: plan.items.map(item => item.id),
        modelUsed: plan.modelUsed,
      },
    })
    await appendJarvisTodo(`${plan.title}: ${goal}`)
    await appendJarvisInboxMessage({
      role: 'jarvis',
      source: 'system',
      title: '任务已接收',
      message: plan.steps.length === 1
        ? `${plan.title}：已加入任务队列。${plan.modelUsed ? '由主模型确认。' : '由兜底规划器确认。'}`
        : `${plan.title}：已拆成 ${plan.steps.length} 个步骤。${plan.modelUsed ? '由主模型规划。' : '由兜底规划器规划。'}`,
      taskId: plan.items[0]?.id,
      metadata: {
        goal,
        steps: plan.steps,
        queuedItemIds: plan.items.map(item => item.id),
      },
    })
    await appendJarvisEvent({
      type: 'checkpoint',
      title: 'Jarvis task planned',
      message: `${plan.title}: ${plan.steps.length} step(s) queued${plan.modelUsed ? ' by main model' : ' by fallback planner'}.`,
    })
    if (config.riskMode !== 'observe') {
      this.maybeRunAutonomousWork(config).catch((error) => {
        appendJarvisEvent({
          type: 'error',
          severity: 'error',
          title: 'Jarvis task start failed',
          message: error instanceof Error ? error.message : String(error),
        }).catch(() => {})
      })
    }
    return this.getStatus()
  }

  private async buildInteractiveReply(
    goal: string,
    config: JarvisModeConfig,
    reason: string,
  ): Promise<{ title: string; message: string; modelUsed: boolean }> {
    const progressControl = await this.handleProgressControl(goal)
    if (progressControl) return progressControl

    const statusQuestion = isJarvisStatusQuestion(goal)
    if (statusQuestion) {
      const queue = await this.buildQueueSummary()
      const title = '当前任务状态'
      const message = [
        `当前模式：${config.riskMode === 'autonomous' ? '自主执行' : config.riskMode === 'assisted' ? '辅助执行' : '仅观察'}`,
        `任务队列：待处理 ${queue.pending}，运行 ${queue.running}，暂停 ${queue.paused}，失败 ${queue.failed}，已完成 ${queue.completed}`,
        config.enabled ? 'Jarvis 已开启。' : 'Jarvis 未开启。',
      ].join('\n')
      return { title, message, modelUsed: false }
    }

    const modelReply = await callConfiguredMainModel({
      maxTokens: 900,
      timeoutMs: 30_000,
      systemPrompt: [
        'You are Jarvis, the interactive companion surface for claude-yh.',
        'Answer the user directly in Chinese unless they use another language.',
        'This route is for lightweight conversation and explanation only.',
        'Do not claim that a background task was queued.',
        'If the user asks for work that requires tools, browser control, file edits, long-running monitoring, or external side effects, say that it should be handed to the background task queue.',
        'Keep the answer concise and renderable as Markdown.',
      ].join(' '),
      userPrompt: JSON.stringify({
        message: goal,
        jarvisMode: config.riskMode,
        routeReason: reason,
      }),
    }).catch(() => null)

    if (modelReply?.content.trim()) {
      return {
        title: 'Jarvis 回复',
        message: modelReply.content.trim(),
        modelUsed: true,
      }
    }

    return {
      title: 'Jarvis 回复',
      message: [
        '我在这里。这个输入被识别为轻量对话，所以没有创建后台任务。',
        '',
        '如果你要我持续执行、操作浏览器、修改文件、搜索网页或监控项目，请直接描述目标，我会把它进入后台队列。',
      ].join('\n'),
      modelUsed: false,
    }
  }

  async resolveApproval(
    id: string,
    status: JarvisApprovalStatus,
    note?: string,
  ): Promise<JarvisStatus> {
    logDiagnosticEvent({
      scope: 'jarvis.service',
      event: 'approval_resolve_requested',
      ok: true,
      data: { approvalId: id, status, hasNote: Boolean(note) },
    })
    const approval = await updateJarvisApproval(id, {
      status,
      resolutionNote: note,
    })
    if (approval?.taskId) {
      await updateJarvisQueueItem(approval.taskId, {
        status: status === 'approved' ? 'pending' : 'paused',
        approvalState: status === 'approved' ? 'approved' : 'requested',
        checkpoint: status === 'approved'
          ? `Approval ${id} approved. Resume from this point.`
          : `Approval ${id} rejected${note ? `: ${note}` : ''}. Re-plan before continuing.`,
      })
    }
    logDiagnosticEvent({
      scope: 'jarvis.service',
      event: 'approval_resolved',
      ok: Boolean(approval),
      data: {
        approvalId: id,
        taskId: approval?.taskId ?? null,
        status,
      },
    })
    return this.getStatus()
  }

  async deleteQueueItem(id: string): Promise<{
    item: JarvisQueueItem | null
    status: JarvisStatus
    cancelledRunningProcess: boolean
  }> {
    const cancelled = cronScheduler.cancelTask(`jarvis-${id}`)
    const item = await deleteJarvisQueueItem(id)
    logDiagnosticEvent({
      scope: 'jarvis.service',
      event: 'queue_item_deleted',
      ok: Boolean(item),
      severity: item ? 'info' : 'warn',
      data: {
        itemId: id,
        cancelledRunningProcess: cancelled,
        deletedStatus: item?.status ?? null,
        title: item?.title ?? null,
      },
    })
    if (!item) {
      return {
        item: null,
        status: await this.getStatus(),
        cancelledRunningProcess: cancelled,
      }
    }
    await appendJarvisInboxMessage({
      role: 'jarvis',
      source: 'system',
      title: '任务已删除',
      message: `${item.title || item.goal || item.prompt.slice(0, 80)}${cancelled ? '\n已同时停止正在运行的执行进程。' : ''}`,
      taskId: id,
      severity: 'warn',
    })
    await appendJarvisEvent({
      type: 'paused',
      severity: 'warn',
      title: 'Jarvis task deleted',
      message: `${item.title || item.goal || item.id} deleted.${cancelled ? ' Running process was cancelled.' : ''}`,
    })
    return {
      item,
      status: await this.getStatus(),
      cancelledRunningProcess: cancelled,
    }
  }

  private armTimer(config: JarvisModeConfig): void {
    if (this.timer) {
      clearInterval(this.timer)
    }
    this.nextHeartbeatAt = new Date(Date.now() + config.intervalMs).toISOString()
    this.timer = setInterval(() => {
      this.tick('interval').catch((error) => {
        appendJarvisEvent({
          type: 'error',
          severity: 'error',
          title: 'Jarvis checkpoint failed',
          message: error instanceof Error ? error.message : String(error),
        }).catch(() => {})
      })
    }, config.intervalMs)
  }

  private async collectSnapshot(config: JarvisModeConfig): Promise<string> {
    const parts: string[] = []

    if (config.sources.scheduledTasks) {
      const tasks = await this.cronService.listTasks()
      const enabled = tasks.filter((task) => task.enabled !== false).length
      const awayEnabled = tasks.filter((task) => task.awayRunner?.enabled).length
      parts.push(
        `Scheduled tasks: ${enabled}/${tasks.length} enabled, ${awayEnabled} linked to Jarvis execution.`,
      )
    }

    if (config.sources.sessions) {
      const { sessions, total } = await this.sessionService.listSessions({ limit: 5 })
      const latest = sessions[0]
      parts.push(
        latest
          ? `Sessions: ${total} indexed, latest "${latest.title}" modified ${latest.modifiedAt}.`
          : 'Sessions: no local sessions indexed yet.',
      )
    }

    if (config.sources.git) {
      parts.push(await this.collectGitSnapshot())
    }

    if (parts.length === 0) {
      parts.push('No sources are enabled. Jarvis is alive but only recording heartbeats.')
    }

    if (config.riskMode === 'observe') {
      parts.push('Mode: observe-only. It will not execute external actions.')
    } else {
      parts.push(
        config.requireApprovalForExternalActions
          ? 'Mode: assisted. External or irreversible actions still require approval.'
          : 'Mode: assisted. Approval guard is disabled by configuration.',
      )
    }
    if (config.taskPrompt) {
      parts.push(`Continuous task configured: ${config.taskPrompt.slice(0, 120)}.`)
    }

    return parts.join(' ')
  }

  private async maybeRunAutonomousWork(config: JarvisModeConfig): Promise<void> {
    if (!config.enabled || config.riskMode === 'observe') return
    const queueBefore = await listJarvisQueue()
    const hasRunnableQueue = queueBefore.some(item =>
      (item.status === 'pending' || item.status === 'failed') &&
      item.attempts < item.maxAttempts,
    )
    logDiagnosticEvent({
      scope: 'jarvis.service',
      event: 'autonomous_scan',
      ok: true,
      data: {
        queueLength: queueBefore.length,
        hasRunnableQueue,
        hasContinuousPrompt: Boolean(config.taskPrompt),
        runningContinuousTask: this.runningContinuousTask,
        riskMode: config.riskMode,
      },
    })
    if (!config.taskPrompt && !hasRunnableQueue) return
    if (this.runningContinuousTask) {
      await appendJarvisEvent({
        type: 'paused',
        severity: 'warn',
        title: 'Jarvis continuous task skipped',
        message: 'Previous continuous task is still running.',
      })
      return
    }

    this.runningContinuousTask = true
    try {
      const queue = queueBefore
      const alreadyQueued = queue.some(item =>
        item.prompt === config.taskPrompt &&
        (item.status === 'pending' || item.status === 'running' || item.status === 'paused'),
      )
      if (config.taskPrompt && !alreadyQueued) {
        await enqueueJarvisTask({
          prompt: config.taskPrompt,
          priority: config.companionModeEnabled ? 80 : config.riskMode === 'autonomous' ? 70 : 50,
        })
      }
      const item = await claimNextJarvisTask()
      if (!item) {
        logDiagnosticEvent({
          scope: 'jarvis.service',
          event: 'claim_none',
          ok: true,
          data: { queueLength: queue.length },
        })
        return
      }
      logDiagnosticEvent({
        scope: 'jarvis.service',
        event: 'item_claimed',
        ok: true,
        data: {
          itemId: item.id,
          status: item.status,
          attempts: item.attempts,
          maxAttempts: item.maxAttempts,
          approvalState: item.approvalState,
          title: item.title,
          goalLength: item.goal?.length ?? null,
          promptLength: item.prompt.length,
        },
      })
      if (
        config.requireApprovalForExternalActions &&
        item.approvalState === 'requested'
      ) {
        const pendingApproval = (await readJarvisApprovals(300))
          .find(approval => approval.taskId === item.id && approval.status === 'pending')
        if (!pendingApproval) {
          await createJarvisApproval({
            taskId: item.id,
            source: 'system',
            title: 'Jarvis 等待确认',
            message: item.checkpoint || '这个任务需要用户确认后才能继续。',
            risk: 'other',
          })
          logDiagnosticEvent({
            scope: 'jarvis.service',
            event: 'approval_requested',
            ok: true,
            data: { itemId: item.id },
          })
        } else {
          logDiagnosticEvent({
            scope: 'jarvis.service',
            event: 'approval_already_pending',
            ok: true,
            data: { itemId: item.id, approvalId: pendingApproval.id },
          })
        }
        await updateJarvisQueueItem(item.id, {
          status: 'paused',
          checkpoint: item.checkpoint || 'Waiting for approval from CLI, web, desktop, or IM.',
        })
        return
      }
      const task: CronTask = {
        id: `jarvis-${item.id}`,
        name: 'Jarvis continuous task',
        cron: '* * * * *',
        prompt: item.checkpoint
          ? `${item.prompt}\n\nResume checkpoint:\n${item.checkpoint}\n\n${item.boundarySummary || ''}`
          : `${item.prompt}\n\n${item.boundarySummary || ''}`,
        createdAt: Date.now(),
        enabled: true,
        recurring: false,
        awayRunner: {
          enabled: true,
          mode: config.riskMode === 'autonomous' ? 'autonomous' : 'assisted',
          allowedRisk: 'low',
        },
      }
      const itemLabel = item.title || item.goal || item.prompt.slice(0, 80) || 'Jarvis 任务'
      await appendJarvisInboxMessage({
        role: 'jarvis',
        source: 'system',
        title: '任务开始执行',
        message: `${itemLabel} 已开始执行。后台会持续报告进度，直到完成、暂停或失败。`,
        taskId: item.id,
        severity: 'info',
        metadata: {
          attempts: item.attempts,
          maxAttempts: item.maxAttempts,
        },
      })
      logDiagnosticEvent({
        scope: 'jarvis.service',
        event: 'task_execution_started',
        ok: true,
        data: {
          itemId: item.id,
          title: item.title,
          attempts: item.attempts,
          maxAttempts: item.maxAttempts,
        },
      })
      const progressStartedAt = Date.now()
      let progressTick = 0
      const progressTimer = setInterval(() => {
        if (this.mutedProgressTaskIds.has(item.id)) {
          logDiagnosticEvent({
            scope: 'jarvis.service',
            event: 'task_progress_heartbeat_muted',
            ok: true,
            data: {
              itemId: item.id,
              progressTick: progressTick + 1,
            },
          })
          return
        }
        progressTick += 1
        const elapsedSeconds = Math.max(1, Math.round((Date.now() - progressStartedAt) / 1000))
        appendJarvisInboxMessage({
          role: 'jarvis',
          source: 'system',
          title: '任务进行中',
          message: `${itemLabel} 已运行 ${elapsedSeconds} 秒，仍在等待模型或工具返回结果。`,
          taskId: item.id,
          severity: 'info',
          metadata: {
            progressTick,
            elapsedSeconds,
          },
        }).catch(() => {})
        logDiagnosticEvent({
          scope: 'jarvis.service',
          event: 'task_progress_heartbeat',
          ok: true,
          data: {
            itemId: item.id,
            progressTick,
            elapsedSeconds,
          },
        })
      }, JARVIS_PROGRESS_INTERVAL_MS)
      progressTimer.unref?.()
      let run: TaskRun
      try {
        run = await this.runTask(task)
      } finally {
        clearInterval(progressTimer)
      }
      logDiagnosticEvent({
        scope: 'jarvis.service',
        event: 'task_run_returned',
        ok: run.status === 'completed',
        severity: run.status === 'completed' ? 'info' : 'warn',
        data: {
          itemId: item.id,
          runId: run.id,
          status: run.status,
          exitCode: run.exitCode,
          durationMs: run.durationMs,
          outputLength: run.output?.length ?? 0,
          error: run.error,
        },
      })
      const report = await writeJarvisReport({
        taskId: item.id,
        title: item.title || 'Jarvis autonomous task',
        goal: item.goal || item.prompt,
        status: run.status === 'completed' ? 'completed' : 'paused',
        summary: run.output || run.error || `Run ${run.id} finished without output.`,
        checkpoint: run.output?.slice(0, 2000) || item.checkpoint,
      })
      await updateJarvisQueueItem(item.id, {
        status: run.status === 'completed'
          ? 'completed'
          : item.attempts + 1 >= item.maxAttempts
            ? 'failed'
            : 'pending',
        runId: run.id,
        checkpoint: run.output?.slice(0, 2000) || item.checkpoint,
        error: run.error,
      })
      this.mutedProgressTaskIds.delete(item.id)
      await appendJarvisInboxMessage({
        role: 'jarvis',
        source: 'system',
        title: run.status === 'completed' ? '任务完成' : '任务暂停',
        message: run.output || run.error || `Run ${run.id} finished.`,
        taskId: item.id,
        severity: run.status === 'completed' ? 'info' : 'warn',
        metadata: { runId: run.id },
      })
      await appendJarvisEvent({
        type: run.status === 'completed' ? 'checkpoint' : 'paused',
        severity: run.status === 'completed' ? 'info' : 'warn',
        title: `Jarvis autonomous task ${run.status}`,
        message: `${run.output || run.error || `Run ${run.id} finished.`} Report: ${report.reportPath}`,
      })
      await appendJarvisEvent({
        type: 'report',
        severity: run.status === 'completed' ? 'info' : 'warn',
        title: 'Jarvis report written',
        message: report.reportPath,
      })
    } finally {
      this.runningContinuousTask = false
    }
  }

  private async buildQueueSummary(): Promise<JarvisStatus['queue']> {
    const items = await listJarvisQueue()
    return {
      pending: items.filter(item => item.status === 'pending').length,
      running: items.filter(item => item.status === 'running').length,
      paused: items.filter(item => item.status === 'paused').length,
      failed: items.filter(item => item.status === 'failed').length,
      completed: items.filter(item => item.status === 'completed').length,
    }
  }

  private async handleProgressControl(goal: string): Promise<{
    title: string
    message: string
    modelUsed: boolean
  } | null> {
    const intent = classifyProgressReportIntent(goal)
    if (intent === 'none') return null

    const queue = await listJarvisQueue()
    const runningItems = queue.filter(item => item.status === 'running')
    if (runningItems.length === 0) {
      return {
        title: intent === 'mute' ? '进度报告已关闭' : '进度报告已开启',
        message: '当前没有正在运行的 Jarvis 任务，所以没有需要调整的进度报告。',
        modelUsed: false,
      }
    }

    for (const item of runningItems) {
      if (intent === 'mute') this.mutedProgressTaskIds.add(item.id)
      else this.mutedProgressTaskIds.delete(item.id)
    }
    logDiagnosticEvent({
      scope: 'jarvis.service',
      event: intent === 'mute' ? 'progress_reports_muted' : 'progress_reports_unmuted',
      ok: true,
      data: {
        affectedTaskIds: runningItems.map(item => item.id),
        affectedCount: runningItems.length,
      },
    })
    return {
      title: intent === 'mute' ? '进度报告已关闭' : '进度报告已开启',
      message: intent === 'mute'
        ? `已关闭 ${runningItems.length} 个运行中任务的中间进度报告。任务最终完成、暂停或失败时仍会通知你。`
        : `已恢复 ${runningItems.length} 个运行中任务的中间进度报告。`,
      modelUsed: false,
    }
  }

  private async collectGitSnapshot(): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', ['status', '--short'], {
        timeout: 5000,
        windowsHide: true,
      })
      const changed = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean).length
      return changed === 0
        ? 'Git: working tree clean.'
        : `Git: ${changed} changed file(s) detected.`
    } catch {
      return 'Git: unavailable for this workspace.'
    }
  }

  private buildSummary(config: JarvisModeConfig, events: JarvisEvent[]): string {
    if (!config.enabled) {
      return 'Jarvis is off. Enable it to keep a 24h proactive companion watching configured sources.'
    }
    const latest = events[0]
    if (!latest) {
      return 'Jarvis is on and waiting for the first checkpoint.'
    }
    return `${latest.title}: ${latest.message}`
  }

  private buildMetrics(events: JarvisEvent[]): JarvisMetrics {
    const today = new Date().toISOString().slice(0, 10)
    return {
      heartbeatCount: this.heartbeatCount,
      eventsToday: events.filter((event) => event.createdAt.startsWith(today)).length,
      enabledSince: this.enabledSince,
    }
  }

  private describeConfig(config: JarvisModeConfig): string {
    const minutes = Math.round(config.intervalMs / 60_000)
    const sources = Object.entries(config.sources)
      .filter(([, enabled]) => enabled)
      .map(([source]) => source)
      .join(', ')
    return `enabled=${config.enabled}, interval=${minutes}m, mode=${config.riskMode}, sources=${sources || 'none'}`
  }

  private async publishCloudHeartbeat(
    config: JarvisModeConfig,
    event: JarvisEvent,
  ): Promise<void> {
    if (!config.cloud.enabled || !config.cloud.endpoint) return
    const token = process.env.CLAUDE_YH_JARVIS_CLOUD_TOKEN
    const queue = await this.buildQueueSummary()
    const response = await fetch(config.cloud.endpoint.replace(/\/+$/, '') + '/heartbeat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        runnerId: config.cloud.runnerId,
        createdAt: event.createdAt,
        status: config.enabled ? 'running' : 'paused',
        summary: event.message,
        queue,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const now = new Date().toISOString()
    await updateJarvisConfig({
      cloud: {
        ...config.cloud,
        lastHeartbeatAt: now,
        lastRunnerStatus: response.ok ? 'ok' : `http_${response.status}`,
      },
    })
  }

  private async notifyCheckpoint(
    config: JarvisModeConfig,
    title: string,
    message: string,
  ): Promise<void> {
    const channels = config.notificationChannels.filter(
      (channel): channel is 'dingtalk' | 'wecom' =>
        channel === 'dingtalk' || channel === 'wecom',
    )
    if (channels.length === 0) return
    await sendMarkdownNotification({
      title,
      markdown: `**${title}**\n\n${message}`,
      channels,
    })
  }
}

type JarvisGoalRoute = {
  route: 'interactive' | 'background'
  reason: string
}

function classifyJarvisGoalRoute(goal: string): JarvisGoalRoute {
  const text = goal.replace(/\s+/g, ' ').trim()
  if (!text) return { route: 'interactive', reason: 'empty-or-whitespace' }
  const progressIntent = classifyProgressReportIntent(text)
  if (progressIntent !== 'none') {
    return { route: 'interactive', reason: `progress-report-${progressIntent}` }
  }
  if (isJarvisStatusQuestion(text)) {
    return { route: 'interactive', reason: 'jarvis-status-question' }
  }

  const lower = text.toLowerCase()
  const hasQuestionSignal = /[?？]$/.test(text) ||
    /(什么|为何|为什么|怎么|怎样|如何|区别|意思|介绍|说明|解释|是谁|叫什么|能不能|可以吗|是否|吗|呢)/.test(text) ||
    /\b(what|why|how|explain|describe|who|can you|could you|status)\b/i.test(text)
  const hasBackgroundSignal = /(搜索|搜|打开|访问|浏览|点击|输入|填写|下载|上传|发送|发给|登录|注册|支付|购买|删除|修改|编辑|写入|创建|生成文件|运行|执行|测试|修复|实现|部署|构建|安装|迁移|重构|监控|持续|定时|每隔|后台|队列|恢复|研究一下|分析这个项目|查看网页|操作浏览器)/.test(text) ||
    /\b(search|open|visit|click|type|download|upload|send|login|pay|delete|edit|write|create|run|execute|test|fix|implement|deploy|build|install|migrate|refactor|monitor|watch|background|queue)\b/i.test(lower)

  if (hasQuestionSignal && !hasBackgroundSignal) {
    return { route: 'interactive', reason: 'lightweight-question' }
  }
  if (text.length <= 32 && !hasBackgroundSignal) {
    return { route: 'interactive', reason: 'short-conversation' }
  }
  return { route: 'background', reason: hasBackgroundSignal ? 'requires-execution' : 'default-background-goal' }
}

function isJarvisStatusQuestion(goal: string): boolean {
  const text = goal.replace(/\s+/g, ' ').trim().toLowerCase()
  return /(当前任务|任务状态|任务列表|队列状态|还有什么任务|有什么任务|查状态|查询状态|运行状态)/.test(text) ||
    /\b(queue status|task status|current tasks|running tasks|jarvis status)\b/i.test(text)
}

function classifyProgressReportIntent(goal: string): 'mute' | 'unmute' | 'none' {
  const text = goal.replace(/\s+/g, ' ').trim().toLowerCase()
  if (!text) return 'none'
  if (
    /(继续|恢复|重新|打开|开启|开始).{0,8}(报告|汇报|进度|中间状态|节点)/.test(text) ||
    /(报告|汇报|进度|中间状态|节点).{0,8}(继续|恢复|重新|打开|开启|开始)/.test(text) ||
    /\b(resume|enable|turn on|unmute).{0,24}(progress|report|heartbeat|updates?)\b/i.test(text)
  ) {
    return 'unmute'
  }
  if (
    /(不要|不用|别|停止|关闭|取消|暂停|少).{0,10}(报告|汇报|进度|中间状态|节点|刷屏|通知)/.test(text) ||
    /(报告|汇报|进度|中间状态|节点|通知).{0,10}(不要|不用|别|停止|关闭|取消|暂停)/.test(text) ||
    /\b(stop|disable|turn off|mute|suppress).{0,24}(progress|report|heartbeat|updates?|notifications?)\b/i.test(text)
  ) {
    return 'mute'
  }
  return 'none'
}

export const jarvisService = new JarvisService()
