import { CronService, type CronTask } from './cronService.js'
import { cronScheduler, type TaskRun } from './cronScheduler.js'
import { SessionService } from './sessionService.js'
import { callConfiguredMainModel } from '../../services/model/mainModelClient.js'
import { logDiagnosticEvent } from '../../utils/diagnosticLog.js'
import { parseCronExpression } from '../../utils/cron.js'
import {
  appendJarvisEvent,
  type JarvisConfigPatch,
  readJarvisConfig,
  readJarvisEvents,
  updateJarvisConfig,
} from '../../jarvis/store.js'
import {
  deleteJarvisQueueItem,
  type JarvisQueueItem,
  listJarvisQueue,
  recoverInterruptedJarvisQueue,
  updateJarvisQueueItem,
} from '../../jarvis/queue.js'
import { submitJarvisGoal } from '../../jarvis/planner.js'
import {
  routeJarvisInput,
  type JarvisRouterDecision,
} from '../../jarvis/router.js'
import {
  appendJarvisTodo,
  ensureJarvisWorkspace,
  readJarvisReports,
  writeJarvisReport,
} from '../../jarvis/reports.js'
import {
  addJarvisWorker,
  createJarvisRun,
  findActiveJarvisRuns,
  listJarvisRuns,
  normalizeReportPolicy,
  updateJarvisRun,
  updateJarvisWorkerByQueueItem,
} from '../../jarvis/runs.js'
import {
  appendJarvisInboxMessage,
  backupAndClearJarvisInbox,
  readJarvisApprovals,
  readJarvisInboxMessages,
  updateJarvisApproval,
} from '../../jarvis/inbox.js'
import { appendJarvisTaskLog } from '../../jarvis/logs.js'
import { handleJarvisManagerStreamLine } from '../../jarvis/streamReporter.js'
import { buildJarvisTranscriptContext } from '../../jarvis/transcript.js'
import { recordJarvisRuntimeEvent } from '../../jarvis/eventRouter.js'
import type {
  JarvisApprovalStatus,
  JarvisEvent,
  JarvisInboxSource,
  JarvisManagerPlan,
  JarvisMetrics,
  JarvisModeConfig,
  JarvisStatus,
} from '../../jarvis/types.js'

const DEFAULT_PROGRESS_INTERVAL_MS = 30_000
const GENERIC_PROGRESS_IDLE_MS = DEFAULT_PROGRESS_INTERVAL_MS * 2
const STALLED_AFTER_MS = 10 * 60_000

type JarvisServiceOptions = {
  cronService?: CronService
  sessionService?: SessionService
  runTask?: (task: CronTask, options?: {
    onStdoutLine?: (line: string) => void | Promise<void>
    onProcessStarted?: (pid: number | undefined) => void | Promise<void>
  }) => Promise<TaskRun>
  routeInput?: typeof routeJarvisInput
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
  private runTask: (task: CronTask, options?: {
    onStdoutLine?: (line: string) => void | Promise<void>
    onProcessStarted?: (pid: number | undefined) => void | Promise<void>
  }) => Promise<TaskRun>
  private routeInput: typeof routeJarvisInput

  constructor(options: JarvisServiceOptions = {}) {
    this.cronService = options.cronService ?? new CronService()
    this.sessionService = options.sessionService ?? new SessionService()
    this.runTask = options.runTask ?? ((task, runOptions) => cronScheduler.executeTask(task, {
      createSession: true,
      ...runOptions,
    }))
    this.routeInput = options.routeInput ?? routeJarvisInput
  }

  async start(): Promise<void> {
    await ensureJarvisWorkspace()
    const config = await readJarvisConfig()
    const recovered = await recoverInterruptedJarvisQueue()
    if (recovered > 0) {
      await appendJarvisEvent({
        type: 'checkpoint',
        title: 'Jarvis queue recovered',
        message: `${recovered} interrupted task(s) were restored after process restart.`,
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
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.startedAt = null
    this.enabledSince = null
    this.nextHeartbeatAt = null
  }

  async updateConfig(patch: JarvisConfigPatch): Promise<JarvisStatus> {
    const config = await updateJarvisConfig(patch)
    await appendJarvisEvent({
      type: 'config',
      title: config.enabled ? 'Jarvis enabled' : 'Jarvis disabled',
      message: `enabled=${config.enabled}, mode=${config.riskMode}, interval=${Math.round(config.intervalMs / 60_000)}m`,
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
    const now = new Date().toISOString()
    this.lastHeartbeatAt = now
    this.heartbeatCount += 1
    this.nextHeartbeatAt = config.enabled
      ? new Date(Date.now() + config.intervalMs).toISOString()
      : null

    await this.watchdog()
    await this.dispatchJarvisManagers(config)

    return appendJarvisEvent({
      type: 'checkpoint',
      title: reason === 'manual' ? 'Manual checkpoint complete' : 'Jarvis checkpoint complete',
      message: await this.collectSnapshot(config),
    })
  }

  async getStatus(): Promise<JarvisStatus> {
    const config = await readJarvisConfig()
    const events = await readJarvisEvents(50)
    const lastHeartbeat = this.lastHeartbeatAt ??
      events.find(event => event.type === 'checkpoint' || event.type === 'heartbeat')?.createdAt ??
      null
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
      metrics: this.buildMetrics(events),
      queue: await this.buildQueueSummary(),
      queueItems: (await listJarvisQueue()).slice(0, 50).map(item => ({
        id: item.id,
        prompt: item.prompt,
        title: item.title,
        goal: item.goal,
        status: item.status,
        lane: item.lane,
        workdir: item.workdir,
        permissionMode: item.permissionMode,
        sessionId: item.sessionId,
        pid: item.pid,
        lastEventAt: item.lastEventAt,
        exitCode: item.exitCode,
        reportMuted: item.reportMuted,
        supplementSummary: item.supplementSummary,
        priority: item.priority,
        attempts: item.attempts,
        maxAttempts: item.maxAttempts,
        approvalState: item.approvalState,
        checkpoint: item.checkpoint,
        error: item.error,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      runs: await listJarvisRuns(30),
      reports: await readJarvisReports(10),
    }
  }

  async submitGoal(
    goal: string,
    priority?: number,
    source: JarvisInboxSource = 'desktop',
    clientMessageId?: string,
  ): Promise<JarvisStatus> {
    const startedAt = Date.now()
    const trimmedGoal = goal.trim()
    if (!trimmedGoal) return this.getStatus()
    if (trimmedGoal === '/new') {
      const backupPath = await backupAndClearJarvisInbox()
      await appendJarvisInboxMessage({
        role: 'jarvis',
        source: 'system',
        title: '新对话已开启',
        message: `已清空当前 Jarvis 对话；旧记录已备份到：${backupPath}`,
        metadata: { backupPath, clientMessageId },
      })
      return this.getStatus()
    }
    const config = await updateJarvisConfig({ enabled: true })

    await appendJarvisInboxMessage({
      role: 'user',
      source,
      title: '交给 Jarvis 的消息',
      message: trimmedGoal,
      metadata: { priority, clientMessageId },
    })

    const activeTasks = (await listJarvisQueue())
      .filter(item => item.status === 'pending' || item.status === 'running' || item.status === 'paused' || item.status === 'stalled')
      .map(item => ({
        id: item.id,
        title: item.title,
        goal: item.goal,
        status: item.status,
        lane: item.lane,
        workdir: item.workdir,
      }))
    const route: JarvisRouterDecision = await this.routeInput({
      message: trimmedGoal,
      config,
      activeTasks,
    })
    logDiagnosticEvent({
      scope: 'jarvis.service',
      event: 'goal_route_decided',
      ok: true,
      durationMs: Date.now() - startedAt,
      data: {
        source,
        intent: route.intent,
        lane: route.lane,
        targetTaskId: route.targetTaskId ?? null,
        permissionMode: route.permissionMode,
        confidence: route.confidence,
        reason: route.reason,
      },
    })
    await appendJarvisTaskLog('router', {
      type: 'router_decision',
      data: { source, message: trimmedGoal, route },
    })

    if (route.intent !== 'new_task') {
      const reply = await this.handleImmediateInput(trimmedGoal, config, route)
      await appendJarvisInboxMessage({
        role: 'jarvis',
        source: 'system',
        title: reply.title,
        message: reply.message,
        taskId: route.targetTaskId,
        severity: reply.severity,
        metadata: { route, modelUsed: reply.modelUsed },
      })
      return this.getStatus()
    }

    const plan = await submitJarvisGoal({
      goal: trimmedGoal,
      config,
      priority,
      lane: route.lane,
      workdir: route.workdir,
      permissionMode: route.permissionMode,
    })
    const managerPlan: JarvisManagerPlan = {
      goal: trimmedGoal,
      strategy: 'single_manager_cli',
      workers: [{
        role: 'manager',
        title: plan.title,
        task: trimmedGoal,
        expectedOutput: 'Manager CLI final report with taskId, result, evidence, blockers, and next action if useful.',
        timeoutMinutes: Math.max(5, Math.min(config.boundaries.budgetMinutes, 24 * 60)),
      }],
      reportPolicy: normalizeReportPolicy({
        progressMode: 'normal',
        progressIntervalMs: DEFAULT_PROGRESS_INTERVAL_MS,
        reportOnlyWhenChanged: true,
        reportOnBlocked: true,
        reportOnRisk: true,
        finalReportRequired: true,
      }),
      riskNotes: isUnrestrictedJarvisMode(route.permissionMode)
        ? ['Autonomous mode uses dangerously-skip-permissions.']
        : [],
    }
    const run = await createJarvisRun({
      goal: trimmedGoal,
      managerPlan,
      reportPolicy: managerPlan.reportPolicy,
    })
    const item = plan.items[0]
    if (item) {
      await updateJarvisQueueItem(item.id, { runId: run.id })
      await addJarvisWorker(run.id, {
        queueItemId: item.id,
        role: 'manager',
        title: plan.title,
        prompt: item.prompt,
        expectedOutput: managerPlan.workers[0]?.expectedOutput,
        checkpoint: item.checkpoint,
      })
    }
    await updateJarvisRun(run.id, { status: 'running' })
    await appendJarvisTodo(`${plan.title}: ${trimmedGoal}`)
    await appendJarvisInboxMessage({
      role: 'jarvis',
      source: 'system',
      title: '任务已接收',
      message: `${plan.title}：已创建一个 Manager CLI 任务。Jarvis 会监听进度、记录日志，并在关键节点向你报告。`,
      taskId: item?.id,
      metadata: {
        route,
        queuedItemIds: plan.items.map(entry => entry.id),
        runId: run.id,
      },
    })
    await appendJarvisEvent({
      type: 'checkpoint',
      title: 'Jarvis Manager task created',
      message: `${plan.title}: one Manager CLI task queued.`,
    })
    if (config.riskMode !== 'observe') {
      this.dispatchJarvisManagers(config).catch(error => {
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

  async resolveApproval(
    id: string,
    status: JarvisApprovalStatus,
    note?: string,
  ): Promise<JarvisStatus> {
    await updateJarvisApproval(id, { status, resolutionNote: note })
    return this.getStatus()
  }

  async deleteQueueItem(id: string): Promise<{
    item: JarvisQueueItem | null
    status: JarvisStatus
    cancelledRunningProcess: boolean
  }> {
    const cancelled = cronScheduler.cancelTask(`jarvis-${id}`)
    const item = await deleteJarvisQueueItem(id)
    if (item) {
      await appendJarvisInboxMessage({
        role: 'jarvis',
        source: 'system',
        title: '任务已删除',
        message: `${item.title || item.goal || id}${cancelled ? '\n已同时停止运行进程。' : ''}`,
        taskId: id,
        severity: 'warn',
      })
    }
    return {
      item,
      status: await this.getStatus(),
      cancelledRunningProcess: cancelled,
    }
  }

  async runAction(
    id: string,
    action: 'pause' | 'resume' | 'cancel',
  ): Promise<JarvisStatus> {
    const items = await listJarvisQueue()
    const queueItems = items.filter(item => item.runId === id || item.id === id)
    for (const item of queueItems) {
      if (action === 'pause') {
        if (item.status === 'running') cronScheduler.cancelTask(`jarvis-${item.id}`)
        await updateJarvisQueueItem(item.id, { status: 'paused', checkpoint: 'Paused from Jarvis UI.' })
        await updateJarvisWorkerByQueueItem(item.id, { status: 'blocked', checkpoint: 'Paused from Jarvis UI.' })
      } else if (action === 'resume') {
        await updateJarvisQueueItem(item.id, { status: 'pending', checkpoint: 'Resumed from Jarvis UI.' })
        await updateJarvisWorkerByQueueItem(item.id, { status: 'pending', checkpoint: 'Resumed from Jarvis UI.' })
      } else {
        cronScheduler.cancelTask(`jarvis-${item.id}`)
        await updateJarvisQueueItem(item.id, { status: 'cancelled', checkpoint: 'Cancelled from Jarvis UI.' })
        await updateJarvisWorkerByQueueItem(item.id, { status: 'cancelled', checkpoint: 'Cancelled from Jarvis UI.' })
      }
    }
    await updateJarvisRun(id, {
      status: action === 'pause' ? 'paused' : action === 'resume' ? 'running' : 'cancelled',
    })
    return this.getStatus()
  }

  private async handleImmediateInput(
    message: string,
    config: JarvisModeConfig,
    route: JarvisRouterDecision,
  ): Promise<{ title: string; message: string; modelUsed: boolean; severity?: 'info' | 'warn' | 'error' }> {
    if (route.intent === 'control') return this.handleControl(route)
    if (route.intent === 'status') return this.buildStatusReply(config)
    if (route.intent === 'supplement') return this.handleSupplement(route, message)
    if (route.intent === 'schedule') return this.handleSchedule(route, message, config)
    if (route.intent === 'clarify') {
      return {
        title: '需要确认',
        message: `我还不能确定应该怎么处理这条消息。请说明这是新任务、补充当前任务、控制命令、状态查询，还是普通问答。\n\n原因：${route.reason}`,
        modelUsed: false,
        severity: 'warn',
      }
    }
    return this.buildChatReply(message, config, route.reason)
  }

  private async handleSchedule(
    route: JarvisRouterDecision,
    message: string,
    config: JarvisModeConfig,
  ): Promise<{ title: string; message: string; modelUsed: boolean; severity?: 'info' | 'warn' | 'error' }> {
    const spec = route.schedule
    const fireAt = spec?.fireAtIso ? new Date(spec.fireAtIso) : null
    const cron = spec?.cron || (fireAt ? cronForDate(fireAt) : null)
    const prompt = spec?.prompt?.trim() || message.trim()
    const scheduleMode = spec?.mode ?? 'reminder'
    if (!cron) {
      return {
        title: '需要确认定时时间',
        message: '我识别到你想创建定时任务，但还缺少明确的执行时间或 cron 表达式。请补充“几分钟后 / 明天几点 / 每天几点”等时间。',
        modelUsed: false,
        severity: 'warn',
      }
    }
    if (!parseCronExpression(cron)) {
      return {
        title: '定时表达式无效',
        message: `我识别到的 cron 表达式无效：${cron}。请换一种更明确的时间说法。`,
        modelUsed: false,
        severity: 'warn',
      }
    }
    if (fireAt && Number.isFinite(fireAt.getTime()) && fireAt.getTime() <= Date.now()) {
      return {
        title: '定时时间已过',
        message: `我识别到的执行时间已经过去：${fireAt.toLocaleString()}。请重新指定一个未来时间。`,
        modelUsed: false,
        severity: 'warn',
      }
    }

    const task = await this.cronService.createTask({
      name: spec?.name || buildScheduleName(message),
      description: spec?.description || `由 Jarvis 创建：${message}`,
      cron,
      prompt,
      enabled: true,
      recurring: spec?.recurring === true,
      permanent: spec?.recurring === true,
      origin: 'jarvis',
      jarvisTaskType: scheduleMode,
      jarvisReminderMessage: scheduleMode === 'reminder' ? prompt : undefined,
      permissionMode: config.riskMode === 'autonomous' || config.riskMode === 'full_autonomous'
        ? 'bypassPermissions'
        : undefined,
    })
    await appendJarvisTaskLog('schedule', {
      type: 'scheduled_task_created',
      data: {
        taskId: task.id,
        name: task.name,
        cron: task.cron,
        recurring: task.recurring === true,
        prompt: task.prompt,
        route,
      },
    })
    await appendJarvisEvent({
      type: 'checkpoint',
      title: '定时任务已创建',
      message: `${task.name || task.id} · ${task.cron}`,
    })
    return {
      title: '定时任务已创建',
      message: [
        `${task.name || '定时任务'} 已写入全局定时任务列表。`,
        `任务 ID：${task.id}`,
        `Cron：${task.cron}`,
        task.recurring ? '类型：周期任务' : '类型：一次性任务，触发后会自动停用',
        '你可以在左侧“定时任务”页面看到它。',
      ].join('\n'),
      modelUsed: false,
    }
  }

  private async handleControl(route: JarvisRouterDecision): Promise<{ title: string; message: string; modelUsed: boolean; severity?: 'info' | 'warn' | 'error' }> {
    const action = route.controlAction
    if (!action) {
      return { title: '控制指令不完整', message: '我识别到这是控制指令，但动作不明确。', modelUsed: false, severity: 'warn' }
    }
    const items = await listJarvisQueue()
    const targets = route.targetTaskId
      ? items.filter(item => item.id === route.targetTaskId || item.runId === route.targetTaskId)
      : items.filter(item => item.status === 'pending' || item.status === 'running' || item.status === 'paused' || item.status === 'stalled')

    if (action === 'mute_reports' || action === 'unmute_reports') {
      const muted = action === 'mute_reports'
      for (const item of targets) await updateJarvisQueueItem(item.id, { reportMuted: muted })
      return {
        title: muted ? '已静音进度汇报' : '已恢复进度汇报',
        message: targets.length === 0 ? '当前没有可调整的任务。' : `已${muted ? '静音' : '恢复'} ${targets.length} 个任务的中间进度汇报；日志仍会继续记录。`,
        modelUsed: false,
      }
    }

    for (const item of targets) {
      if (action === 'pause') {
        if (item.status === 'running') cronScheduler.cancelTask(`jarvis-${item.id}`)
        await updateJarvisQueueItem(item.id, { status: 'paused', checkpoint: 'Paused by Jarvis control.' })
        await updateJarvisWorkerByQueueItem(item.id, { status: 'blocked', checkpoint: 'Paused by Jarvis control.' })
      } else if (action === 'resume') {
        await updateJarvisQueueItem(item.id, { status: 'pending', checkpoint: 'Resumed by Jarvis control.' })
        await updateJarvisWorkerByQueueItem(item.id, { status: 'pending', checkpoint: 'Resumed by Jarvis control.' })
      } else if (action === 'delete') {
        cronScheduler.cancelTask(`jarvis-${item.id}`)
        await deleteJarvisQueueItem(item.id)
      } else {
        cronScheduler.cancelTask(`jarvis-${item.id}`)
        await updateJarvisQueueItem(item.id, { status: 'cancelled', checkpoint: `Cancelled by Jarvis control: ${action}.` })
        await updateJarvisWorkerByQueueItem(item.id, { status: 'cancelled', checkpoint: `Cancelled by Jarvis control: ${action}.` })
      }
    }
    if (action === 'resume') {
      this.dispatchJarvisManagers(await readJarvisConfig()).catch(() => {})
    }
    return {
      title: controlTitle(action),
      message: targets.length === 0 ? '当前没有匹配的任务。' : `已处理 ${targets.length} 个任务。`,
      modelUsed: false,
    }
  }

  private async buildStatusReply(config: JarvisModeConfig): Promise<{ title: string; message: string; modelUsed: boolean }> {
    const queue = await this.buildQueueSummary()
    const active = (await listJarvisQueue()).filter(item =>
      item.status === 'pending' || item.status === 'running' || item.status === 'paused' || item.status === 'stalled',
    )
    return {
      title: '当前任务状态',
      message: [
        `模式：${modeLabel(config.riskMode)}`,
        `队列：待处理 ${queue.pending}，运行 ${queue.running}，暂停 ${queue.paused}，失败 ${queue.failed}，已完成 ${queue.completed}`,
        active.length === 0
          ? '当前没有活动任务。'
          : active.slice(0, 10).map(item => `- ${item.title || item.goal || item.id}：${item.status}${item.lane ? ` / ${item.lane}` : ''}`).join('\n'),
      ].join('\n'),
      modelUsed: false,
    }
  }

  private async handleSupplement(
    route: JarvisRouterDecision,
    message: string,
  ): Promise<{ title: string; message: string; modelUsed: boolean; severity?: 'info' | 'warn' }> {
    const items = await listJarvisQueue()
    const target = route.targetTaskId
      ? items.find(item => item.id === route.targetTaskId || item.runId === route.targetTaskId)
      : items.find(item => item.status === 'running' || item.status === 'pending' || item.status === 'paused')
    if (!target) {
      return {
        title: '没有找到可补充的任务',
        message: '我识别到这是补充指令，但当前没有明确的目标任务。请指定任务，或作为新任务重新提交。',
        modelUsed: false,
        severity: 'warn',
      }
    }
    const supplementSummary = [
      target.supplementSummary,
      `[${new Date().toISOString()}] queued_for_injection: ${message}`,
    ].filter(Boolean).join('\n')
    await updateJarvisQueueItem(target.id, {
      supplementSummary,
      checkpoint: `Supplement queued for Manager CLI injection: ${message}`,
    })
    await appendJarvisTaskLog(target.id, {
      type: 'supplement_queued_for_injection',
      data: { message, targetTaskId: target.id, route },
    })
    return {
      title: '补充指令已加入任务',
      message: `${target.title || target.goal || target.id}：补充指令已写入 task inbox。Manager CLI 下一轮可读取并执行。`,
      modelUsed: false,
    }
  }

  private async buildChatReply(
    message: string,
    config: JarvisModeConfig,
    reason: string,
  ): Promise<{ title: string; message: string; modelUsed: boolean }> {
    const transcript = await buildJarvisTranscriptContext({
      maxChars: 18_000,
      tailLimit: 80,
    })
    const modelReply = await callConfiguredMainModel({
      maxTokens: 1200,
      timeoutMs: 30_000,
      systemPrompt: [
        '你是 Jarvis，claude-yh 的 24 小时主动型管家对话体。',
        '你不是普通规则机器人。你可以持续记住本轮 Jarvis 对话、解释状态、回答轻量问题，并在需要时通过 Jarvis 工具层创建任务、设置提醒、控制任务或启动 Manager CLI。',
        '当前调用是轻量对话通道：直接回答用户，不创建后台任务，不声称已经排队。',
        'Jarvis transcript 是当前 Jarvis 会话的权威上下文；如果用户问“刚才说了什么”，优先根据 transcript 回答。',
        '主动事件策略：重要提醒、阻塞、错误需要明确告诉用户；普通工具细节不要刷屏。',
        '回答用中文，除非用户使用其他语言。保持自然、简洁、Markdown 可渲染。',
      ].join('\n'),
      userPrompt: JSON.stringify({
        message,
        jarvisMode: config.riskMode,
        routeReason: reason,
        transcriptSummary: transcript.summary,
        recentTranscript: transcript.recent,
      }),
    }).catch(() => null)
    const content = modelReply?.content.trim()
    return {
      title: 'Jarvis 回复',
      message: content || '我在。这条消息会作为当前 Jarvis 对话的一部分继续保留。',
      modelUsed: Boolean(content),
    }
  }

  private armTimer(config: JarvisModeConfig): void {
    if (this.timer) clearInterval(this.timer)
    this.nextHeartbeatAt = new Date(Date.now() + config.intervalMs).toISOString()
    this.timer = setInterval(() => {
      this.tick('interval').catch(error => {
        appendJarvisEvent({
          type: 'error',
          severity: 'error',
          title: 'Jarvis checkpoint failed',
          message: error instanceof Error ? error.message : String(error),
        }).catch(() => {})
      })
    }, config.intervalMs)
  }

  private async dispatchJarvisManagers(config: JarvisModeConfig): Promise<void> {
    if (!config.enabled || config.riskMode === 'observe') return
    const queue = await listJarvisQueue()
    const running = queue.filter(item => item.status === 'running')
    const runnable = queue
      .filter(item => (item.status === 'pending' || item.status === 'failed') && item.attempts < item.maxAttempts)
      .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt))
    const plannedRunning = [...running]
    const started: Promise<void>[] = []
    for (const item of runnable) {
      if (!this.canStartLane(item, plannedRunning)) continue
      const next = await updateJarvisQueueItem(item.id, {
        status: 'running',
        attempts: item.attempts + 1,
        lastEventAt: new Date().toISOString(),
      })
      if (!next) continue
      plannedRunning.push(next)
      started.push(this.executeManagerQueueItem(next, config))
    }
    await Promise.all(started)
  }

  private canStartLane(item: JarvisQueueItem, running: JarvisQueueItem[]): boolean {
    const lane = item.lane ?? 'read_only'
    if (lane === 'read_only') {
      return running.filter(entry => (entry.lane ?? 'read_only') === 'read_only').length < 4
    }
    if (lane === 'write') {
      const workdir = item.workdir || ''
      return !running.some(entry =>
        entry.status === 'running' &&
        (entry.lane ?? 'read_only') === 'write' &&
        (entry.workdir || '') === workdir,
      )
    }
    if (lane === 'external') {
      return running.filter(entry => (entry.lane ?? 'read_only') === 'external').length < 2
    }
    return true
  }

  private async executeManagerQueueItem(
    item: JarvisQueueItem,
    config: JarvisModeConfig,
  ): Promise<void> {
    const itemLabel = item.title || item.goal || item.id
    await appendJarvisTaskLog(item.id, {
      type: 'manager_execution_start',
      data: {
        itemId: item.id,
        title: item.title,
        lane: item.lane,
        workdir: item.workdir,
        permissionMode: item.permissionMode ?? config.riskMode,
        attempts: item.attempts,
      },
    })
    await updateJarvisWorkerByQueueItem(item.id, {
      status: 'running',
      assignedAt: new Date().toISOString(),
      lastProgressAt: new Date().toISOString(),
      checkpoint: 'Manager CLI started.',
    })
    await recordJarvisRuntimeEvent({
      kind: 'task_started',
      title: '任务开始执行',
      message: `${itemLabel} 已启动 Manager CLI。`,
      taskId: item.id,
      severity: 'info',
      priority: 'digest',
    })

    const permissionMode = normalizeJarvisPermissionMode(item.permissionMode ?? config.riskMode)
    const task: CronTask = {
      id: `jarvis-${item.id}`,
      name: item.title || 'Jarvis Manager task',
      cron: '* * * * *',
      prompt: item.prompt,
      createdAt: Date.now(),
      enabled: true,
      recurring: false,
      folderPath: item.workdir,
      permissionMode: permissionMode === 'autonomous'
        ? 'bypassPermissions'
        : undefined,
      awayRunner: {
        enabled: permissionMode === 'assisted',
        mode: 'assisted',
        allowedRisk: 'low',
      },
    }

    const streamSessionId = item.sessionId || item.id
    const progressTimer = setInterval(() => {
      ;(async () => {
        const currentItem = await findJarvisQueueItem(item.id).catch(() => null)
        const muted = currentItem?.reportMuted ?? item.reportMuted
        const lastEventAt = currentItem?.lastEventAt ?? item.lastEventAt ?? item.updatedAt
        const lastEventMs = Date.parse(lastEventAt)
        if (Number.isFinite(lastEventMs) && Date.now() - lastEventMs < GENERIC_PROGRESS_IDLE_MS) {
          return
        }
        await updateJarvisQueueItem(item.id, {
          lastEventAt: new Date().toISOString(),
          checkpoint: `${itemLabel} 仍在运行，Jarvis 正在等待模型或工具返回。`,
        }).catch(() => {})
        await updateJarvisWorkerByQueueItem(item.id, {
          status: 'running',
          lastProgressAt: new Date().toISOString(),
          checkpoint: `${itemLabel} 仍在运行。`,
        }).catch(() => {})
        await recordJarvisRuntimeEvent({
          kind: 'task_progress',
          title: '任务仍在进行',
          message: `${itemLabel} 仍在运行，Jarvis 正在等待模型或工具返回。`,
          taskId: item.id,
          severity: 'info',
          priority: 'digest',
          muted,
        }).catch(() => {})
      })().catch(() => {})
    }, DEFAULT_PROGRESS_INTERVAL_MS)
    progressTimer.unref?.()

    let run: TaskRun
    try {
      run = await this.runTask(task, {
        onProcessStarted: async (pid) => {
          await updateJarvisQueueItem(item.id, {
            pid,
            lastEventAt: new Date().toISOString(),
          })
          await appendJarvisTaskLog(item.id, {
            type: 'manager_process_started',
            data: { pid: pid ?? null },
          })
        },
        onStdoutLine: async (line) => {
          await updateJarvisQueueItem(item.id, {
            lastEventAt: new Date().toISOString(),
          })
          const currentItem = await findJarvisQueueItem(item.id).catch(() => null)
          await handleJarvisManagerStreamLine({
            item: currentItem ?? item,
            sessionId: streamSessionId,
            line,
          })
        },
      }).catch((error): TaskRun => ({
        id: `jarvis-${item.id}-${Date.now()}`,
        taskId: task.id,
        taskName: task.name || task.id,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: 'failed',
        prompt: task.prompt,
        error: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      clearInterval(progressTimer)
    }
    const visibleOutput = cleanManagerVisibleOutput(run.output)
    const visibleResult = completedMessage(visibleOutput, run.error, run.id)
    const completed = run.status === 'completed'
    await appendJarvisTaskLog(item.id, {
      type: 'manager_execution_exit',
      ok: completed,
      severity: completed ? 'info' : 'error',
      data: {
        runId: run.id,
        sessionId: run.sessionId ?? null,
        status: run.status,
        exitCode: run.exitCode ?? null,
        durationMs: run.durationMs ?? null,
        error: run.error ?? null,
        outputPreview: run.output?.slice(0, 1000) ?? null,
        visiblePreview: visibleResult.slice(0, 1000),
      },
    })
    await updateJarvisQueueItem(item.id, {
      status: completed ? 'completed' : 'failed',
      runId: run.id,
      sessionId: run.sessionId,
      exitCode: run.exitCode,
      lastEventAt: new Date().toISOString(),
      checkpoint: visibleOutput.slice(0, 5000) || item.checkpoint,
      error: run.error,
    })
    await updateJarvisWorkerByQueueItem(item.id, {
      status: completed ? 'completed' : 'failed',
      result: visibleResult,
      error: run.error,
      checkpoint: visibleOutput.slice(0, 5000) || item.checkpoint,
      lastProgressAt: new Date().toISOString(),
    })
    await this.refreshLinkedRunStatus(item.id, run)
    const report = await writeJarvisReport({
      taskId: item.id,
      title: item.title || 'Jarvis Manager task',
      goal: item.goal || item.prompt,
      status: completed ? 'completed' : 'failed',
      summary: visibleResult,
      checkpoint: visibleOutput.slice(0, 2000) || item.checkpoint,
    })
    await recordJarvisRuntimeEvent({
      kind: completed ? 'task_completed' : 'task_error',
      title: completed ? '任务完成' : '任务失败',
      message: visibleResult,
      taskId: item.id,
      severity: completed ? 'info' : 'error',
      priority: 'interrupt',
      metadata: { runId: run.id, reportPath: report.reportPath },
    })
    await appendJarvisEvent({
      type: completed ? 'report' : 'error',
      severity: completed ? 'info' : 'error',
      title: completed ? 'Jarvis task completed' : 'Jarvis task failed',
      message: `${itemLabel}: ${visibleResult}`,
    })
  }

  private async watchdog(): Promise<void> {
    const now = Date.now()
    const items = await listJarvisQueue()
    for (const item of items.filter(entry => entry.status === 'running')) {
      const last = Date.parse(item.lastEventAt || item.updatedAt)
      if (Number.isFinite(last) && now - last > STALLED_AFTER_MS) {
        await updateJarvisQueueItem(item.id, {
          status: 'stalled',
          checkpoint: `No manager event for ${Math.round((now - last) / 60_000)} minute(s).`,
        })
        await updateJarvisWorkerByQueueItem(item.id, {
          status: 'blocked',
          checkpoint: 'Watchdog marked task as stalled.',
        })
      }
    }
  }

  private async refreshLinkedRunStatus(queueItemId: string, taskRun: TaskRun): Promise<void> {
    const runs = await listJarvisRuns(100)
    const linkedRun = runs.find(run => run.workers.some(worker => worker.queueItemId === queueItemId))
    if (!linkedRun) return
    const workers = linkedRun.workers.map(worker =>
      worker.queueItemId === queueItemId
        ? {
            ...worker,
            status: taskRun.status === 'completed' ? 'completed' as const : 'failed' as const,
            result: taskRun.output,
            error: taskRun.error,
            lastProgressAt: new Date().toISOString(),
          }
        : worker,
    )
    const allCompleted = workers.length > 0 && workers.every(worker => worker.status === 'completed')
    const anyFailed = workers.some(worker => worker.status === 'failed')
    await updateJarvisRun(linkedRun.id, {
      workers,
      status: allCompleted ? 'completed' : anyFailed ? 'failed' : 'running',
      finalReport: allCompleted ? taskRun.output : linkedRun.finalReport,
    })
  }

  private async collectSnapshot(config: JarvisModeConfig): Promise<string> {
    const queue = await this.buildQueueSummary()
    const sessions = await this.sessionService.listSessions({ limit: 1 }).catch(() => null)
    const tasks = await this.cronService.listTasks().catch(() => [])
    return [
      `Mode: ${modeLabel(config.riskMode)}.`,
      `Queue: pending=${queue.pending}, running=${queue.running}, paused=${queue.paused}, failed=${queue.failed}, completed=${queue.completed}.`,
      `Scheduled tasks: ${tasks.length}.`,
      sessions?.sessions[0] ? `Latest session: ${sessions.sessions[0].title}.` : 'No recent session snapshot.',
    ].join(' ')
  }

  private async buildQueueSummary(): Promise<NonNullable<JarvisStatus['queue']>> {
    const items = await listJarvisQueue()
    return {
      pending: items.filter(item => item.status === 'pending').length,
      running: items.filter(item => item.status === 'running').length,
      paused: items.filter(item => item.status === 'paused').length,
      failed: items.filter(item => item.status === 'failed').length,
      completed: items.filter(item => item.status === 'completed').length,
      cancelled: items.filter(item => item.status === 'cancelled').length,
      stalled: items.filter(item => item.status === 'stalled').length,
    }
  }

  private buildSummary(config: JarvisModeConfig, events: JarvisEvent[]): string {
    if (!config.enabled) return 'Jarvis is off.'
    const latest = events[0]
    return latest ? `${latest.title}: ${latest.message}` : 'Jarvis is on and waiting for tasks.'
  }

  private buildMetrics(events: JarvisEvent[]): JarvisMetrics {
    const today = new Date().toISOString().slice(0, 10)
    return {
      heartbeatCount: this.heartbeatCount,
      eventsToday: events.filter(event => event.createdAt.startsWith(today)).length,
      enabledSince: this.enabledSince,
    }
  }
}

function controlTitle(action: string): string {
  if (action === 'pause') return '任务已暂停'
  if (action === 'resume') return '任务已恢复'
  if (action === 'delete') return '任务已删除'
  if (action === 'kill') return '任务进程已终止'
  if (action === 'stop_all') return '全部任务已停止'
  return '任务已取消'
}

function modeLabel(mode: JarvisModeConfig['riskMode']): string {
  if (mode === 'observe') return '观察模式'
  if (mode === 'assisted') return '辅助模式'
  if (mode === 'autonomous') return '自主模式'
  return '自主模式'
}

function normalizeJarvisPermissionMode(mode: JarvisModeConfig['riskMode']): Exclude<JarvisModeConfig['riskMode'], 'full_autonomous'> {
  return mode === 'full_autonomous' ? 'autonomous' : mode
}

function isUnrestrictedJarvisMode(mode: JarvisModeConfig['riskMode']): boolean {
  return normalizeJarvisPermissionMode(mode) === 'autonomous'
}

async function findJarvisQueueItem(id: string): Promise<JarvisQueueItem | null> {
  return (await listJarvisQueue()).find(item => item.id === id) ?? null
}

function cleanManagerVisibleOutput(output?: string): string {
  if (!output) return ''
  const noisyLine = /^(minimax:tool_call|anthropic:tool_call|openai:tool_call|tool_call\b|tool_result\b)/i
  const proceduralLine = /^(listing|reading|checking|scanning|searching|running|loading|inspecting)\b.*(\.\.\.)?$/i
  const lines = output
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => {
      const trimmed = line.trim()
      if (!trimmed) return true
      if (noisyLine.test(trimmed)) return false
      if (proceduralLine.test(trimmed) && trimmed.length < 140) return false
      if (/^Manager CLI 收到工具结果/.test(trimmed)) return false
      return true
    })
  const cleaned = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!cleaned) return ''
  const meaningfulChars = cleaned.replace(/[`*_#>\-\s\d.:：,，。!！?？()[\]{}"'“”‘’]/g, '')
  return meaningfulChars.length < 12 ? '' : cleaned
}

function completedMessage(output: string, error: string | undefined, runId: string): string {
  const trimmedError = error?.trim()
  if (trimmedError) return trimmedError
  const trimmedOutput = output.trim()
  if (trimmedOutput) return trimmedOutput
  return `任务已结束，但 Manager CLI 没有返回可读的最终报告。原始输出已写入 Jarvis 日志和任务报告。\n\nRun ID：${runId}`
}

function cronForDate(date: Date): string | null {
  if (!Number.isFinite(date.getTime())) return null
  return `${date.getMinutes()} ${date.getHours()} ${date.getDate()} ${date.getMonth() + 1} *`
}

function buildScheduleName(message: string): string {
  const trimmed = message.replace(/\s+/g, ' ').trim()
  return trimmed.length > 32 ? `${trimmed.slice(0, 32)}...` : trimmed || 'Jarvis 定时任务'
}

export const jarvisService = new JarvisService()
