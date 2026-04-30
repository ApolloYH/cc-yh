/**
 * CronService — 管理定时任务的增删改查
 *
 * 任务持久化到 ~/.claude-yh/scheduled_tasks.json（JSON 文件）。
 * 文件格式: { "tasks": [ CronTask, ... ] }
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import { ApiError } from '../middleware/errorHandler.js'
import type { AwayRunnerConfig } from '../../awayRunner/index.js'
import { logDiagnosticEvent } from '../../utils/diagnosticLog.js'

export type TaskNotificationConfig = {
  enabled: boolean
  channels: ('telegram' | 'feishu' | 'dingtalk' | 'wecom')[]
}

export type CronTask = {
  id: string
  name?: string
  description?: string
  cron: string // 5-field cron expression
  prompt: string
  createdAt: number // epoch ms
  lastFiredAt?: string // ISO timestamp of last execution
  enabled?: boolean // allow disabling without deleting (default true)
  recurring?: boolean
  permanent?: boolean
  permissionMode?: string
  model?: string
  folderPath?: string
  useWorktree?: boolean
  notification?: TaskNotificationConfig
  awayRunner?: Partial<AwayRunnerConfig>
}

type TasksFile = {
  tasks: CronTask[]
}

const TASKS_FILE_WRITE_ATTEMPTS = 2

export type CronTaskHealthStatus =
  | 'HEALTHY'
  | 'DISABLED'
  | 'NEVER_RUN'
  | 'ERROR'
  | 'OVERDUE'

export type CronTaskRunLike = {
  taskId: string
  status: 'running' | 'completed' | 'failed' | 'timeout'
  startedAt: string
  completedAt?: string
  error?: string
}

export type CronTaskHealth = {
  taskId: string
  name?: string
  status: CronTaskHealthStatus
  reason: string
  lastFiredAt?: string
  lastRunAt?: string
  lastRunStatus?: CronTaskRunLike['status']
  error?: string
}

export class CronService {
  /** 任务文件路径 */
  private getTasksFilePath(): string {
    const configDir =
      process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude-yh')
    return path.join(configDir, 'scheduled_tasks.json')
  }

  // ---------------------------------------------------------------------------
  // 公开方法
  // ---------------------------------------------------------------------------

  /** 获取所有任务 */
  async listTasks(): Promise<CronTask[]> {
    const data = await this.readTasksFile()
    return data.tasks
  }

  async getHealth(runs: CronTaskRunLike[] = []): Promise<CronTaskHealth[]> {
    const tasks = await this.listTasks()
    const latestRunByTask = new Map<string, CronTaskRunLike>()
    for (const run of runs) {
      const current = latestRunByTask.get(run.taskId)
      if (!current || run.startedAt.localeCompare(current.startedAt) > 0) {
        latestRunByTask.set(run.taskId, run)
      }
    }
    return tasks.map(task => {
      const latestRun = latestRunByTask.get(task.id)
      const base = {
        taskId: task.id,
        name: task.name,
        lastFiredAt: task.lastFiredAt,
        lastRunAt: latestRun?.startedAt,
        lastRunStatus: latestRun?.status,
        error: latestRun?.error,
      }
      if (task.enabled === false) {
        return { ...base, status: 'DISABLED' as const, reason: 'Task is disabled.' }
      }
      if (latestRun?.status === 'failed' || latestRun?.status === 'timeout') {
        return {
          ...base,
          status: 'ERROR' as const,
          reason: latestRun.error || `Latest run ended with ${latestRun.status}.`,
        }
      }
      if (!task.lastFiredAt && !latestRun) {
        return { ...base, status: 'NEVER_RUN' as const, reason: 'Task has not fired yet.' }
      }
      if (
        task.recurring !== false &&
        task.lastFiredAt &&
        Date.now() - Date.parse(task.lastFiredAt) > 48 * 60 * 60 * 1000
      ) {
        return {
          ...base,
          status: 'OVERDUE' as const,
          reason: 'Recurring task has not fired in the last 48 hours.',
        }
      }
      return { ...base, status: 'HEALTHY' as const, reason: 'Latest known state is healthy.' }
    })
  }

  /** 创建新任务 */
  async createTask(
    task: Omit<CronTask, 'id' | 'createdAt'>,
  ): Promise<CronTask> {
    if (!task.cron || !task.prompt) {
      throw ApiError.badRequest('Fields "cron" and "prompt" are required')
    }

    const data = await this.readTasksFile()
    const newTask: CronTask = {
      ...task,
      id: crypto.randomBytes(4).toString('hex'),
      createdAt: Date.now(),
    }
    data.tasks.push(newTask)
    await this.writeTasksFile(data)
    logDiagnosticEvent({
      scope: 'scheduledTasks.service',
      event: 'create',
      ok: true,
      data: { taskId: newTask.id, name: newTask.name },
    })
    return newTask
  }

  /** 更新已有任务 */
  async updateTask(id: string, updates: Partial<CronTask>): Promise<CronTask> {
    const data = await this.readTasksFile()
    const index = data.tasks.findIndex((t) => t.id === id)
    if (index === -1) {
      throw ApiError.notFound(`Task not found: ${id}`)
    }

    // 不允许修改 id 和 createdAt
    const { id: _id, createdAt: _ca, ...safeUpdates } = updates
    data.tasks[index] = { ...data.tasks[index], ...safeUpdates }
    await this.writeTasksFile(data)
    logDiagnosticEvent({
      scope: 'scheduledTasks.service',
      event: 'update',
      ok: true,
      data: { taskId: id, keys: Object.keys(safeUpdates) },
    })
    return data.tasks[index]
  }

  /** 删除任务 */
  async deleteTask(id: string): Promise<void> {
    const data = await this.readTasksFile()
    const index = data.tasks.findIndex((t) => t.id === id)
    if (index === -1) {
      throw ApiError.notFound(`Task not found: ${id}`)
    }
    data.tasks.splice(index, 1)
    await this.writeTasksFile(data)
    logDiagnosticEvent({
      scope: 'scheduledTasks.service',
      event: 'delete',
      ok: true,
      data: { taskId: id },
    })
  }

  /** 更新任务的最后执行时间 */
  async updateLastFired(taskId: string, timestamp: string): Promise<void> {
    const data = await this.readTasksFile()
    const index = data.tasks.findIndex((t) => t.id === taskId)
    if (index === -1) {
      return // Task may have been deleted; silently ignore
    }
    data.tasks[index].lastFiredAt = timestamp
    await this.writeTasksFile(data)
  }

  // ---------------------------------------------------------------------------
  // 内部: 文件读写
  // ---------------------------------------------------------------------------

  /** 读取任务 JSON 文件。文件不存在时返回空列表。 */
  private async readTasksFile(): Promise<TasksFile> {
    try {
      const raw = await fs.readFile(this.getTasksFilePath(), 'utf-8')
      const parsed = JSON.parse(raw) as TasksFile
      // 兼容异常格式
      if (!Array.isArray(parsed.tasks)) {
        return { tasks: [] }
      }
      return parsed
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { tasks: [] }
      }
      throw ApiError.internal(
        `Failed to read scheduled tasks: ${(err as Error).message}`,
      )
    }
  }

  /** 原子写入任务 JSON 文件 */
  private async writeTasksFile(data: TasksFile): Promise<void> {
    const filePath = this.getTasksFilePath()
    const dir = path.dirname(filePath)
    const contents = JSON.stringify(data, null, 2) + '\n'
    let lastError: Error | undefined

    for (let attempt = 0; attempt < TASKS_FILE_WRITE_ATTEMPTS; attempt++) {
      const tmpFile = `${filePath}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}`

      try {
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(tmpFile, contents, 'utf-8')
        await fs.rename(tmpFile, filePath)
        return
      } catch (err) {
        lastError = err as Error
        await fs.unlink(tmpFile).catch(() => {})

        if (
          (err as NodeJS.ErrnoException).code !== 'ENOENT' ||
          attempt === TASKS_FILE_WRITE_ATTEMPTS - 1
        ) {
          break
        }
      }
    }

    throw ApiError.internal(
      `Failed to write scheduled tasks: ${lastError?.message ?? 'unknown error'}`,
    )
  }
}
