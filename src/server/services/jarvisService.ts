import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { CronService } from './cronService.js'
import { SessionService } from './sessionService.js'
import { sendMarkdownNotification } from './notificationService.js'
import {
  appendJarvisEvent,
  type JarvisConfigPatch,
  readJarvisConfig,
  readJarvisEvents,
  updateJarvisConfig,
} from '../../jarvis/store.js'
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

  constructor(options: JarvisServiceOptions = {}) {
    this.cronService = options.cronService ?? new CronService()
    this.sessionService = options.sessionService ?? new SessionService()
  }

  async start(): Promise<void> {
    const config = await readJarvisConfig()
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
      title: config.enabled ? 'Jarvis Mode enabled' : 'Jarvis Mode disabled',
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
        title: 'Jarvis Mode is paused',
        message: 'The daemon skipped a heartbeat because Jarvis Mode is disabled.',
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
      recentEvents: events,
      metrics,
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
        `Scheduled tasks: ${enabled}/${tasks.length} enabled, ${awayEnabled} linked to Away Runner.`,
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
      parts.push('No sources are enabled. Jarvis Mode is alive but only recording heartbeats.')
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

    return parts.join(' ')
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
      return 'Jarvis Mode is off. Enable it to keep a 24h local companion daemon watching configured sources.'
    }
    const latest = events[0]
    if (!latest) {
      return 'Jarvis Mode is on and waiting for the first checkpoint.'
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
