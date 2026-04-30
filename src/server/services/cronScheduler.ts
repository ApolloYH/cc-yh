/**
 * CronScheduler — Execution engine for scheduled tasks
 *
 * Periodically checks all scheduled tasks and executes those whose cron
 * expression matches the current time. Tasks are run by spawning a CLI
 * subprocess with the task's prompt. Execution history is persisted to
 * ~/.claude-yh/scheduled_tasks_log.json.
 */

import * as fs from 'fs/promises'
import { existsSync, statSync } from 'node:fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import { CronService, type CronTask } from './cronService.js'
import { SessionService } from './sessionService.js'
import { sendTaskNotification } from './notificationService.js'
import {
  DEFAULT_AWAY_RUNNER_CONFIG,
  evaluateAwayRunner,
  normalizeAwayRunnerConfig,
  type AwayRunnerCheckpoint,
  type AwayRunnerConfig,
} from '../../awayRunner/index.js'
import { appendJarvisEvent } from '../../jarvis/store.js'
import { recordJarvisRuntimeEvent } from '../../jarvis/eventRouter.js'
import { logDiagnosticEvent } from '../../utils/diagnosticLog.js'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type TaskRun = {
  id: string // random ID
  taskId: string // references CronTask.id
  taskName: string
  startedAt: string // ISO timestamp
  completedAt?: string
  status: 'running' | 'completed' | 'failed' | 'timeout'
  prompt: string
  output?: string // captured stdout summary
  error?: string
  exitCode?: number
  durationMs?: number
  sessionId?: string // links to a session for rich output rendering
}

// ─── Output extraction ────────────────────────────────────────────────────────

/**
 * Extract meaningful assistant text from raw CLI stream-json (NDJSON) output.
 *
 * The raw stdout contains system/init messages, tool_use blocks, tool_result
 * echoes, and thinking blocks — all of which are noise to the end user. The
 * actual AI answer (assistant text blocks + final result) is what matters.
 *
 * By extracting server-side we avoid the 10K naive truncation problem where
 * the useful content sits well past the first 10K characters.
 */
export function extractAssistantText(raw: string): string {
  if (!raw) return ''
  const lines = raw.split('\n')
  const parts: string[] = []

  for (const line of lines) {
    if (!line.trim()) continue
    let parsed: any
    try {
      parsed = JSON.parse(line)
    } catch {
      continue // skip non-JSON lines and truncated lines
    }

    const type = parsed?.type

    if (type === 'assistant') {
      const content = parsed?.message?.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (block.type === 'text' && block.text?.trim()) {
          parts.push(block.text.trim())
        }
        // Skip tool_use, thinking blocks
      }
    }

    if (type === 'result') {
      const result = parsed?.result
      if (typeof result === 'string' && result.trim()) {
        parts.push(result.trim())
      } else if (result?.message?.trim()) {
        parts.push(result.message.trim())
      }
    }
  }

  const deduped: string[] = []
  for (const part of parts) {
    if (deduped[deduped.length - 1] !== part) {
      deduped.push(part)
    }
  }

  return deduped.join('\n\n')
}

// ─── Cron expression matching ──────────────────────────────────────────────────

/**
 * Check whether a single cron field matches a given numeric value.
 *
 * Supported syntax per field:
 *   *          — any value
 *   5          — exact match
 *   1,3,5      — list
 *   1-5        — inclusive range
 *   *​/2        — step from 0
 *   1-10/3     — step within a range
 */
export function fieldMatches(field: string, value: number): boolean {
  if (field === '*') return true

  // Comma-separated list — each element can be a range or step
  const parts = field.split(',')
  return parts.some((part) => singleFieldMatches(part.trim(), value))
}

function singleFieldMatches(part: string, value: number): boolean {
  // Step: */n or range/n
  if (part.includes('/')) {
    const [rangePart, stepStr] = part.split('/')
    const step = parseInt(stepStr, 10)
    if (isNaN(step) || step <= 0) return false

    if (rangePart === '*') {
      return value % step === 0
    }
    // range/step  e.g. 1-10/3
    if (rangePart.includes('-')) {
      const [startStr, endStr] = rangePart.split('-')
      const start = parseInt(startStr, 10)
      const end = parseInt(endStr, 10)
      if (value < start || value > end) return false
      return (value - start) % step === 0
    }
    // single/step  e.g. 5/2  — treat as start with step
    const start = parseInt(rangePart, 10)
    if (value < start) return false
    return (value - start) % step === 0
  }

  // Range: a-b
  if (part.includes('-')) {
    const [startStr, endStr] = part.split('-')
    const start = parseInt(startStr, 10)
    const end = parseInt(endStr, 10)
    return value >= start && value <= end
  }

  // Exact number
  return parseInt(part, 10) === value
}

/**
 * Check whether a standard 5-field cron expression matches the given date.
 * Fields: minute hour day-of-month month day-of-week
 */
export function cronMatches(cronExpr: string, date: Date): boolean {
  const fields = cronExpr.trim().split(/\s+/)
  if (fields.length !== 5) return false

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields
  return (
    fieldMatches(minute, date.getMinutes()) &&
    fieldMatches(hour, date.getHours()) &&
    fieldMatches(dayOfMonth, date.getDate()) &&
    fieldMatches(month, date.getMonth() + 1) &&
    fieldMatches(dayOfWeek, date.getDay())
  )
}

// ─── Log file I/O ──────────────────────────────────────────────────────────────

type RunsFile = { runs: TaskRun[] }

function getLogFilePath(): string {
  const configDir =
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude-yh')
  return path.join(configDir, 'scheduled_tasks_log.json')
}

async function readRunsFile(): Promise<RunsFile> {
  try {
    const raw = await fs.readFile(getLogFilePath(), 'utf-8')
    const parsed = JSON.parse(raw) as RunsFile
    if (!Array.isArray(parsed.runs)) return { runs: [] }
    return parsed
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { runs: [] }
    }
    throw err
  }
}

async function writeRunsFile(data: RunsFile): Promise<void> {
  const filePath = getLogFilePath()
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })

  const tmpFile = `${filePath}.tmp.${Date.now()}`
  try {
    await fs.writeFile(tmpFile, JSON.stringify(data, null, 2) + '\n', 'utf-8')
    await fs.rename(tmpFile, filePath)
  } catch (err) {
    await fs.unlink(tmpFile).catch(() => {})
    throw err
  }
}

/** Append a run to the log and trim to keep at most MAX_RUNS_PER_TASK per task. */
async function appendRun(run: TaskRun): Promise<void> {
  const data = await readRunsFile()
  data.runs.push(run)
  trimRuns(data)
  await writeRunsFile(data)
  logDiagnosticEvent({
    scope: 'scheduledTasks.scheduler',
    event: 'run_append',
    ok: true,
    data: {
      runId: run.id,
      taskId: run.taskId,
      status: run.status,
    },
  })
}

/** Update an existing run in the log (matched by run.id). */
async function updateRun(run: TaskRun): Promise<void> {
  const data = await readRunsFile()
  const idx = data.runs.findIndex((r) => r.id === run.id)
  if (idx !== -1) {
    data.runs[idx] = run
  } else {
    data.runs.push(run)
  }
  trimRuns(data)
  await writeRunsFile(data)
  logDiagnosticEvent({
    scope: 'scheduledTasks.scheduler',
    event: 'run_update',
    ok: run.status === 'completed' || run.status === 'running',
    severity: run.status === 'completed' || run.status === 'running' ? 'info' : 'warn',
    data: {
      runId: run.id,
      taskId: run.taskId,
      status: run.status,
      error: run.error,
      durationMs: run.durationMs,
    },
  })
}

const MAX_RUNS_PER_TASK = 100

/** Keep only the latest MAX_RUNS_PER_TASK entries per task. */
function trimRuns(data: RunsFile): void {
  const countByTask = new Map<string, number>()
  // Count from the end (newest first) and mark for removal
  const keep = new Array<boolean>(data.runs.length).fill(false)
  for (let i = data.runs.length - 1; i >= 0; i--) {
    const taskId = data.runs[i].taskId
    const count = countByTask.get(taskId) || 0
    if (count < MAX_RUNS_PER_TASK) {
      keep[i] = true
      countByTask.set(taskId, count + 1)
    }
  }
  data.runs = data.runs.filter((_, i) => keep[i])
}

// ─── Scheduler ─────────────────────────────────────────────────────────────────

const TASK_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

export class CronScheduler {
  private intervalId: Timer | null = null
  private runningTasks = new Map<
    string,
    { proc: ReturnType<typeof Bun.spawn>; startedAt: number; runId: string }
  >()
  /** Track which minute each task last fired (prevents same-process duplicate within a minute). */
  private lastFiredMinuteKey = new Map<string, string>()
  private cronService: CronService
  private sessionService: SessionService

  constructor(cronService?: CronService) {
    this.cronService = cronService || new CronService()
    this.sessionService = new SessionService()
  }

  /** Return a string key representing the calendar minute of `date`. */
  private static minuteKey(date: Date): string {
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`
  }

  /** Start the scheduler (called on server boot). */
  start(): void {
    if (this.intervalId) return // already running
    console.log('[CronScheduler] Starting — checking every 60 s')
    // Clean up stale "running" entries left by previously crashed processes
    this.cleanupStaleRuns().catch((err) =>
      console.error('[CronScheduler] Error cleaning up stale runs:', err),
    )
    this.intervalId = setInterval(() => this.tick(), 60_000)
    // Immediate first check
    this.tick()
  }

  /** Stop the scheduler and kill any running task processes. */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    for (const [taskId, entry] of this.runningTasks) {
      try {
        entry.proc.kill()
      } catch {
        // process may have already exited
      }
      this.runningTasks.delete(taskId)
    }
    console.log('[CronScheduler] Stopped')
  }

  cancelTask(taskId: string): boolean {
    const entry = this.runningTasks.get(taskId)
    if (!entry) return false
    try {
      entry.proc.kill()
    } catch {
      // process may have already exited
    }
    this.runningTasks.delete(taskId)
    logDiagnosticEvent({
      scope: 'scheduledTasks.scheduler',
      event: 'cancel_task',
      ok: true,
      data: {
        taskId,
        runId: entry.runId,
        durationMs: Date.now() - entry.startedAt,
      },
    })
    return true
  }

  /** One tick of the scheduler — evaluate all tasks against the current time. */
  async tick(): Promise<void> {
    try {
      const tasks = await this.cronService.listTasks()
      const now = new Date()
      const currentKey = CronScheduler.minuteKey(now)

      for (const task of tasks) {
        // Skip disabled tasks
        if (task.enabled === false) continue

        // Skip if already running (in-memory guard — same process)
        if (this.runningTasks.has(task.id)) continue

        // Skip if this process already fired the task in the current minute
        if (this.lastFiredMinuteKey.get(task.id) === currentKey) continue

        // Skip if ANY process already fired the task in the current minute
        // (cross-process guard via file-persisted lastFiredAt)
        if (task.lastFiredAt) {
          const lastFiredKey = CronScheduler.minuteKey(new Date(task.lastFiredAt))
          if (lastFiredKey === currentKey) continue
        }

        if (cronMatches(task.cron, now)) {
          // Record the minute key BEFORE firing to prevent double-fire
          this.lastFiredMinuteKey.set(task.id, currentKey)
          // Fire and forget — don't await; we want all matching tasks to start
          this.executeTask(task).catch((err) => {
            console.error(
              `[CronScheduler] Unhandled error executing task ${task.id}:`,
              err,
            )
          })
        }
      }
    } catch (err) {
      console.error('[CronScheduler] Error during tick:', err)
    }
  }

  /**
   * Execute a single task by spawning a CLI subprocess.
   * @param task The task to execute
   * @param options.createSession When true, creates a Session for rich output viewing (used for manual "Run Now")
   */
  async executeTask(task: CronTask, options?: {
    createSession?: boolean
    onStdoutLine?: (line: string) => void | Promise<void>
    onProcessStarted?: (pid: number | undefined) => void | Promise<void>
  }): Promise<TaskRun> {
    // Prevent concurrent executions of the same task
    const existing = this.runningTasks.get(task.id)
    if (existing) {
      console.log(
        `[CronScheduler] Task ${task.id} is already running (runId=${existing.runId}), skipping`,
      )
      return {
        id: existing.runId,
        taskId: task.id,
        taskName: task.name || task.prompt.slice(0, 60),
        startedAt: new Date(existing.startedAt).toISOString(),
        status: 'running',
        prompt: task.prompt,
      }
    }

    const runId = crypto.randomBytes(6).toString('hex')
    const startedAt = new Date().toISOString()
    let workDir = task.folderPath || os.homedir()
    if (task.folderPath && (!existsSync(task.folderPath) || !statSync(task.folderPath).isDirectory())) {
      console.warn(`[cron] task ${task.id}: folderPath "${task.folderPath}" is not a valid directory, falling back to homedir`)
      workDir = os.homedir()
    }

    // Only create a session when explicitly requested (manual "Run Now"),
    // not for automatic cron runs — avoids flooding the sidebar.
    let sessionId: string | undefined
    if (options?.createSession) {
      try {
        const result = await this.sessionService.createSession(workDir)
        sessionId = result.sessionId
        // Delete the placeholder JSONL file so the CLI can create it fresh
        // with actual content. Same pattern as conversationService.ts.
        await this.sessionService.deleteSessionFile(sessionId)
      } catch {
        // Fall back to no session if creation fails
      }
    }

    const run: TaskRun = {
      id: runId,
      taskId: task.id,
      taskName: task.name || task.prompt.slice(0, 60),
      startedAt,
      status: 'running',
      prompt: task.prompt,
      sessionId,
    }

    // Update lastFiredAt IMMEDIATELY so other scheduler processes see it
    // and skip this task in the current minute (cross-process dedup).
    await this.cronService.updateLastFired(task.id, startedAt)

    // Persist the "running" state
    await appendRun(run)
    logDiagnosticEvent({
      scope: 'scheduledTasks.scheduler',
      event: 'execute_start',
      ok: true,
      data: {
        runId,
        taskId: task.id,
        taskName: task.name || task.prompt.slice(0, 60),
        workDir,
        createSession: options?.createSession === true,
        sessionId: sessionId ?? null,
        recurring: task.recurring === true,
        model: task.model ?? null,
        promptHash: hashForDiagnostics(task.prompt),
        promptLength: task.prompt.length,
      },
    })

    if (task.origin === 'jarvis' && task.jarvisTaskType === 'reminder') {
      const completedAt = new Date().toISOString()
      const reminderText = task.jarvisReminderMessage || task.prompt
      const completedRun: TaskRun = {
        ...run,
        completedAt,
        status: 'completed',
        output: `时间到了：${reminderText}`,
        exitCode: 0,
        durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
      }
      await updateRun(completedRun)
      await recordJarvisRuntimeEvent({
        kind: 'reminder_fired',
        title: '提醒到了',
        message: `时间到了，${reminderText}`,
        taskId: task.id,
        severity: 'info',
        priority: 'interrupt',
        metadata: {
          runId,
          cron: task.cron,
          scheduledTaskId: task.id,
        },
      })
      if (!task.recurring) {
        await this.cronService.updateTask(task.id, { enabled: false }).catch(() => {})
      }
      logDiagnosticEvent({
        scope: 'scheduledTasks.scheduler',
        event: 'jarvis_reminder_delivered',
        ok: true,
        data: {
          runId,
          taskId: task.id,
          messageLength: reminderText.length,
        },
      })
      return completedRun
    }

    const away = await this.prepareAwayRunner(task)
    logDiagnosticEvent({
      scope: 'scheduledTasks.scheduler',
      event: 'away_decision',
      ok: away.status === 'allow' || away.status === 'disabled',
      severity: away.status === 'allow' || away.status === 'disabled' ? 'info' : 'warn',
      data: {
        runId,
        taskId: task.id,
        status: away.status,
        reasons: away.reasons,
        mode: away.config?.mode ?? null,
        allowedRisk: away.config?.allowedRisk ?? null,
      },
    })
    if (away.status === 'deny' || away.status === 'pause') {
      const pausedRun: TaskRun = {
        ...run,
        completedAt: new Date().toISOString(),
        status: 'failed',
        error: `Jarvis execution paused before execution: ${away.reasons.join(', ')}`,
        durationMs: Date.now() - new Date(startedAt).getTime(),
      }
      await updateRun(pausedRun)
      return pausedRun
    }
    const permissionMode = this.resolvePermissionMode(task, away.config)
    const permissionArgs = permissionMode === 'bypassPermissions' || permissionMode === 'full_autonomous'
      ? ['--dangerously-skip-permissions']
      : permissionMode
        ? ['--permission-mode', permissionMode]
        : []
    const cliInvocation = this.resolveCliInvocation([
      '--print',
      '--verbose',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      ...(sessionId ? ['--session-id', sessionId] : []),
      ...(task.model ? ['--model', task.model] : []),
      ...permissionArgs,
    ])
    logDiagnosticEvent({
      scope: 'scheduledTasks.scheduler',
      event: 'cli_resolved',
      ok: true,
      data: {
        runId,
        taskId: task.id,
        executable: cliInvocation[0],
        argv: cliInvocation,
        cwd: workDir,
        callerDir: workDir,
        permissionMode: permissionMode ?? null,
        hasSessionId: Boolean(sessionId),
        sourceRoot: this.findSourceProjectRoot(),
        binRoot: this.findBinProjectRoot(),
        bundledCli: this.resolveBundledCliPath(),
      },
    })

    const prompt = away.prompt ?? task.prompt
    const inputPayload = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: prompt }],
      },
      parent_tool_use_id: null,
      session_id: sessionId || '',
    }) + '\n'

    const proc = Bun.spawn(
      cliInvocation,
      {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        cwd: workDir,
        env: {
          ...process.env,
          CALLER_DIR: workDir,
          PWD: workDir,
          CLAUDE_YH_SKIP_DOTENV: '1',
        },
      },
    )
    logDiagnosticEvent({
      scope: 'scheduledTasks.scheduler',
      event: 'spawn_started',
      ok: true,
      data: {
        runId,
        taskId: task.id,
        executable: cliInvocation[0],
        cwd: workDir,
      },
    })

    this.runningTasks.set(task.id, { proc, startedAt: Date.now(), runId })
    await options?.onProcessStarted?.(proc.pid)

    // Write prompt to stdin then close it
    try {
      proc.stdin.write(inputPayload)
      proc.stdin.end()
    } catch (error) {
      logDiagnosticEvent({
        scope: 'scheduledTasks.scheduler',
        event: 'stdin_write_failed',
        ok: false,
        severity: 'warn',
        data: {
          runId,
          taskId: task.id,
          error: error instanceof Error ? error.message : String(error),
        },
      })
      // If writing fails, the process may have already exited
    }

    // Set up a timeout
    const timeoutId = setTimeout(() => {
      if (this.runningTasks.has(task.id)) {
        logDiagnosticEvent({
          scope: 'scheduledTasks.scheduler',
          event: 'timeout_kill',
          ok: false,
          severity: 'warn',
          data: {
            runId,
            taskId: task.id,
            timeoutMs: TASK_TIMEOUT_MS,
          },
        })
        try {
          proc.kill()
        } catch {
          // ignore
        }
      }
    }, TASK_TIMEOUT_MS)

    try {
      // Collect stdout
      const stdoutChunks: string[] = []
      let stdoutCarry = ''
      if (proc.stdout) {
        const reader = proc.stdout.getReader()
        const decoder = new TextDecoder()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const chunk = decoder.decode(value, { stream: true })
            stdoutChunks.push(chunk)
            stdoutCarry += chunk
            const lines = stdoutCarry.split('\n')
            stdoutCarry = lines.pop() ?? ''
            for (const line of lines) {
              if (line.trim()) await options?.onStdoutLine?.(line)
            }
          }
          if (stdoutCarry.trim()) await options?.onStdoutLine?.(stdoutCarry)
        } catch {
          // stream may be interrupted on kill
        }
      }

      // Wait for exit
      const exitCode = await proc.exited

      clearTimeout(timeoutId)
      this.runningTasks.delete(task.id)

      const completedAt = new Date().toISOString()
      const rawOutput = stdoutChunks.join('')
      const durationMs =
        new Date(completedAt).getTime() - new Date(startedAt).getTime()

      // Determine if this was a timeout
      const wasTimeout = durationMs >= TASK_TIMEOUT_MS

      // Extract only meaningful AI text responses from raw NDJSON output.
      // The raw stream contains system/init messages, tool_use blocks, and
      // tool_result echoes that consume thousands of chars before any actual
      // AI answer appears. A naive .slice(0, 10_000) would lose the answer.
      const output = extractAssistantText(rawOutput)

      const completedRun: TaskRun = {
        ...run,
        completedAt,
        status: wasTimeout ? 'timeout' : exitCode === 0 ? 'completed' : 'failed',
        output: output.slice(0, 50_000), // cap after extraction
        exitCode,
        durationMs,
      }

      // Collect stderr for error field
      let stderrLength = 0
      if (exitCode !== 0 && proc.stderr) {
        try {
          const stderrText = await new Response(proc.stderr).text()
          stderrLength = stderrText.length
          completedRun.error = stderrText.slice(0, 5_000)
        } catch {
          // ignore
        }
      }

      await updateRun(completedRun)
      await this.markJarvisExecutionSessionHidden(sessionId, task.id, runId)
      logDiagnosticEvent({
        scope: 'scheduledTasks.scheduler',
        event: 'process_exit',
        ok: completedRun.status === 'completed',
        severity: completedRun.status === 'completed' ? 'info' : 'warn',
        durationMs,
        data: {
          runId,
          taskId: task.id,
          status: completedRun.status,
          exitCode,
          rawOutputLength: rawOutput.length,
          extractedOutputLength: output.length,
          stderrLength,
          error: completedRun.error,
          outputPreview: output.slice(0, 600),
        },
      })
      await this.recordAwayRunnerCompletion(task, completedRun)

      // Send IM notification if configured
      if (task.notification?.enabled && task.notification.channels.length > 0) {
        sendTaskNotification(completedRun, task.notification).catch((err) => {
          console.error(`[CronScheduler] Notification error for task ${task.id}:`, err)
        })
      }

      // If non-recurring, disable after first run
      if (!task.recurring) {
        await this.cronService.updateTask(task.id, { enabled: false }).catch(() => {
          // Task may have been deleted
        })
      }

      return completedRun
    } catch (err) {
      clearTimeout(timeoutId)
      this.runningTasks.delete(task.id)

      const completedAt = new Date().toISOString()
      const failedRun: TaskRun = {
        ...run,
        completedAt,
        status: 'failed',
        error: (err as Error).message,
        durationMs:
          new Date(completedAt).getTime() - new Date(startedAt).getTime(),
      }

      await updateRun(failedRun)
      await this.markJarvisExecutionSessionHidden(sessionId, task.id, runId)
      logDiagnosticEvent({
        scope: 'scheduledTasks.scheduler',
        event: 'execute_exception',
        ok: false,
        severity: 'error',
        data: {
          runId,
          taskId: task.id,
          error: failedRun.error,
          durationMs: failedRun.durationMs,
        },
      })
      await this.recordAwayRunnerCompletion(task, failedRun)

      return failedRun
    }
  }

  private async prepareAwayRunner(task: CronTask): Promise<{
    status: 'allow' | 'deny' | 'pause' | 'disabled'
    reasons: string[]
    prompt?: string
    config?: AwayRunnerConfig
  }> {
    if (!task.awayRunner?.enabled) {
      return { status: 'disabled', reasons: [] }
    }

    const config = normalizeAwayRunnerConfig({
      ...DEFAULT_AWAY_RUNNER_CONFIG,
      ...task.awayRunner,
    })
    const now = new Date().toISOString()
    const checkpoints: AwayRunnerCheckpoint[] = []
    const initial = evaluateAwayRunner(config, {
      startedAt: now,
      now,
      turns: 0,
      toolCalls: 0,
      costUsd: 0,
      requestedRisk: config.allowedRisk,
      checkpoints,
    })

    if (initial.status === 'disabled') {
      return { status: 'disabled', reasons: [] }
    }

    if (initial.status === 'pause' || initial.status === 'deny') {
      await appendJarvisEvent({
        type: 'paused',
        severity: 'warn',
        title: `Jarvis execution paused: ${task.name || task.id}`,
        message: initial.reasons.join(', '),
      }).catch(() => {})
      return { status: initial.status, reasons: initial.reasons, config }
    }

    if (initial.status === 'checkpoint_required') {
      checkpoints.push({
        id: `checkpoint-${Date.now()}`,
        createdAt: now,
        label: 'initial',
        summary: `Starting task ${task.name || task.id} with Jarvis mode=${config.mode}.`,
      })
      await appendJarvisEvent({
        type: 'checkpoint',
        title: `Jarvis initial checkpoint: ${task.name || task.id}`,
        message: checkpoints[0]!.summary,
      }).catch(() => {})
    }

    const decision = evaluateAwayRunner(config, {
      startedAt: now,
      now,
      turns: 0,
      toolCalls: 0,
      costUsd: 0,
      requestedRisk: config.allowedRisk,
      checkpoints,
    })

    if (decision.status !== 'allow') {
      await appendJarvisEvent({
        type: 'paused',
        severity: 'warn',
        title: `Jarvis execution blocked: ${task.name || task.id}`,
        message: decision.reasons.join(', '),
      }).catch(() => {})
      return {
        status: decision.status === 'disabled' ? 'disabled' : 'pause',
        reasons: decision.reasons,
        config,
      }
    }

    return {
      status: 'allow',
      reasons: [],
      config,
      prompt: buildAwayRunnerPrompt(task.prompt, config, checkpoints),
    }
  }

  private resolvePermissionMode(
    task: CronTask,
    config?: AwayRunnerConfig,
  ): string | undefined {
    if (task.permissionMode) return task.permissionMode
    if (!config || !config.enabled) return undefined
    if (config.mode === 'autonomous' && config.allowedRisk === 'low') {
      return 'acceptEdits'
    }
    return undefined
  }

  private async markJarvisExecutionSessionHidden(
    sessionId: string | undefined,
    taskId: string,
    runId: string,
  ): Promise<void> {
    if (!sessionId || !taskId.startsWith('jarvis-')) return
    await this.sessionService.markSessionHidden(sessionId, {
      origin: 'jarvis',
      reason: 'background-execution-session',
      taskId,
      runId,
    })
    logDiagnosticEvent({
      scope: 'scheduledTasks.scheduler',
      event: 'hide_jarvis_session',
      ok: true,
      data: { sessionId, taskId, runId },
    })
  }

  private resolveCliInvocation(baseArgs: string[]): string[] {
    const explicitCli = process.env.CLAUDE_CLI_PATH
    if (explicitCli) return this.wrapCliCommand(explicitCli, baseArgs)

    const bundledCli = this.resolveBundledCliPath()
    if (bundledCli) return this.wrapCliCommand(bundledCli, baseArgs)

    const sourceRoot = this.findSourceProjectRoot()
    if (sourceRoot) {
      return [
        'bun',
        '--preload',
        path.join(sourceRoot, 'preload.ts'),
        path.join(sourceRoot, 'src', 'entrypoints', 'cli.tsx'),
        ...baseArgs,
      ]
    }

    const binRoot = this.findBinProjectRoot()
    if (binRoot) {
      return [
        'node',
        path.join(binRoot, 'bin', 'claude-yh.js'),
        ...baseArgs,
      ]
    }

    return ['claude-yh', ...baseArgs]
  }

  private wrapCliCommand(cliCommand: string, baseArgs: string[]): string[] {
    const cliBaseName = path.basename(cliCommand)
    if (cliBaseName.startsWith('claude-sidecar')) {
      return process.env.CLAUDE_APP_ROOT
        ? [cliCommand, 'cli', '--app-root', process.env.CLAUDE_APP_ROOT, ...baseArgs]
        : [cliCommand, 'cli', ...baseArgs]
    }
    if (
      process.env.CLAUDE_APP_ROOT &&
      cliBaseName.startsWith('claude-cli')
    ) {
      return [cliCommand, '--app-root', process.env.CLAUDE_APP_ROOT, ...baseArgs]
    }
    if (/\.(?:[cm]?[jt]s|tsx?)$/i.test(cliCommand)) {
      const root = this.findSourceProjectRoot() ?? process.cwd()
      return ['bun', '--preload', path.join(root, 'preload.ts'), cliCommand, ...baseArgs]
    }
    return [cliCommand, ...baseArgs]
  }

  private resolveBundledCliPath(): string | null {
    const execPath = process.execPath
    const execName = path.basename(execPath)
    if (execName.startsWith('claude-sidecar')) return execPath
    if (execName.startsWith('claude-server')) {
      const bundledCliPath = path.join(
        path.dirname(execPath),
        execName.replace(/^claude-server/, 'claude-cli'),
      )
      return existsSync(bundledCliPath) ? bundledCliPath : null
    }
    return null
  }

  private findSourceProjectRoot(): string | null {
    return this.findProjectRootCandidate(root =>
      existsSync(path.join(root, 'src', 'entrypoints', 'cli.tsx')) &&
      existsSync(path.join(root, 'preload.ts')),
    )
  }

  private findBinProjectRoot(): string | null {
    return this.findProjectRootCandidate(root =>
      existsSync(path.join(root, 'bin', 'claude-yh.js')),
    )
  }

  private findProjectRootCandidate(predicate: (root: string) => boolean): string | null {
    const candidates = [
      process.env.CLAUDE_APP_ROOT,
      process.env.CLAUDE_YH_ROOT,
      process.cwd(),
      path.resolve(process.cwd(), '..'),
      path.resolve(process.cwd(), '..', '..'),
      path.resolve(import.meta.dir, '../../..'),
      path.resolve(import.meta.dir, '../../../..'),
    ].filter((value): value is string => Boolean(value))

    for (const candidate of new Set(candidates)) {
      if (predicate(candidate)) return candidate
    }
    return null
  }

  private async recordAwayRunnerCompletion(
    task: CronTask,
    run: TaskRun,
  ): Promise<void> {
    if (!task.awayRunner?.enabled) return
    await appendJarvisEvent({
      type: run.status === 'completed' ? 'checkpoint' : 'paused',
      severity: run.status === 'completed' ? 'info' : 'warn',
      title: `Jarvis execution ${run.status}: ${task.name || task.id}`,
      message: [
        `Run ${run.id} finished with status=${run.status}.`,
        run.output ? `Output: ${run.output.slice(0, 1000)}` : '',
        run.error ? `Error: ${run.error.slice(0, 1000)}` : '',
      ].filter(Boolean).join('\n\n'),
    }).catch(() => {})
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  /**
   * Mark stale "running" entries as "failed" on startup.
   * These are leftover from previous process instances that crashed or were
   * killed before they could update the run log.
   */
  private async cleanupStaleRuns(): Promise<void> {
    const data = await readRunsFile()
    let changed = false
    const now = Date.now()

    for (const run of data.runs) {
      if (run.status !== 'running') continue
      const startedAt = new Date(run.startedAt).getTime()
      // If "running" for longer than the task timeout + 1-minute buffer,
      // the owning process is certainly dead.
      if (now - startedAt > TASK_TIMEOUT_MS + 60_000) {
        run.status = 'failed'
        run.error = 'Process terminated before task could complete'
        run.completedAt = new Date().toISOString()
        run.durationMs = now - startedAt
        changed = true
        console.log(
          `[CronScheduler] Cleaned up stale run ${run.id} for task ${run.taskId}`,
        )
      }
    }

    if (changed) {
      await writeRunsFile(data)
    }
  }

  // ─── Query helpers ─────────────────────────────────────────────────────────

  /** Get execution history for a specific task. */
  async getTaskRuns(taskId: string): Promise<TaskRun[]> {
    const data = await readRunsFile()
    return data.runs
      .filter((r) => r.taskId === taskId)
      .sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      )
  }

  /** Get recent runs across all tasks. */
  async getRecentRuns(limit = 50): Promise<TaskRun[]> {
    const data = await readRunsFile()
    return data.runs
      .sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      )
      .slice(0, limit)
  }
}

// ─── Singleton export ──────────────────────────────────────────────────────────

export const cronScheduler = new CronScheduler()

function buildAwayRunnerPrompt(
  prompt: string,
  config: AwayRunnerConfig,
  checkpoints: AwayRunnerCheckpoint[],
): string {
  return [
    'You are running under claude-yh Jarvis execution.',
    '',
    `Mode: ${config.mode}`,
    `Allowed risk: ${config.allowedRisk}`,
    `Budget: maxTurns=${config.budget.maxTurns ?? 'unset'}, maxToolCalls=${config.budget.maxToolCalls ?? 'unset'}, maxRuntimeMs=${config.budget.maxRuntimeMs ?? 'unset'}`,
    'Stop and report instead of continuing if the task needs login, captcha, 2FA, payment confirmation, destructive external action, secret access, or an irreversible user decision.',
    'Write a concise checkpoint before major irreversible steps and a final report at completion.',
    checkpoints.length > 0
      ? `Initial checkpoint: ${checkpoints[0]!.summary}`
      : 'Initial checkpoint: not required by policy.',
    '',
    'Original task:',
    prompt,
  ].join('\n')
}

function hashForDiagnostics(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16)
}
