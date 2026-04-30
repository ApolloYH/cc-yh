import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { CronService } from './cronService.js'
import type { CronTask } from './cronService.js'
import { cronScheduler, type TaskRun } from './cronScheduler.js'
import { SessionService } from './sessionService.js'
import { sendMarkdownNotification } from './notificationService.js'
import {
  appendJarvisEvent,
  type JarvisConfigPatch,
  readJarvisConfig,
  readJarvisEvents,
  updateJarvisConfig,
} from '../../jarvis/store.js'
import {
  claimNextJarvisTask,
  enqueueJarvisTask,
  listJarvisQueue,
  recoverInterruptedJarvisQueue,
  updateJarvisQueueItem,
} from '../../jarvis/queue.js'
import { submitJarvisGoal } from '../../jarvis/planner.js'
import type {
  JarvisEvent,
  JarvisMetrics,
  JarvisModeConfig,
  JarvisStatus,
} from '../../jarvis/types.js'

const execFileAsync = promisify(execFile)

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

  constructor(options: JarvisServiceOptions = {}) {
    this.cronService = options.cronService ?? new CronService()
    this.sessionService = options.sessionService ?? new SessionService()
    this.runTask = options.runTask ?? ((task) => cronScheduler.executeTask(task, { createSession: true }))
  }

  async start(): Promise<void> {
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
        checkpoint: item.checkpoint,
        error: item.error,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    }
  }

  async submitGoal(goal: string, priority?: number): Promise<JarvisStatus> {
    const config = await updateJarvisConfig({ enabled: true })
    const plan = await submitJarvisGoal({ goal, config, priority })
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
      if (!item) return
      if (
        config.requireApprovalForExternalActions &&
        item.approvalState === 'requested'
      ) {
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
      const run = await this.runTask(task)
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
      await appendJarvisEvent({
        type: run.status === 'completed' ? 'checkpoint' : 'paused',
        severity: run.status === 'completed' ? 'info' : 'warn',
        title: `Jarvis autonomous task ${run.status}`,
        message: run.output || run.error || `Run ${run.id} finished.`,
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

export const jarvisService = new JarvisService()
