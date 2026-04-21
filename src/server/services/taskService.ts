/**
 * TaskService - read CLI task files from ~/.claude/tasks.
 *
 * Supports both the current task-list layout:
 *   ~/.claude/tasks/<task_list_id>/*.json
 * and older flat layouts that stored JSON files directly under:
 *   ~/.claude/tasks/*.json
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'running'
  | 'failed'

export type TaskInfo = {
  id: string
  subject: string
  description: string
  name?: string
  type?: string
  activeForm?: string
  owner?: string
  status: TaskStatus
  blocks: string[]
  blockedBy: string[]
  metadata?: Record<string, unknown>
  taskListId: string
  teamName?: string
  createdAt?: number
  completedAt?: number
}

export type TaskListSummary = {
  id: string
  taskCount: number
  completedCount: number
  inProgressCount: number
  pendingCount: number
}

const ROOT_TASK_LIST_ID = 'default'

export class TaskService {
  private getConfigDir(): string {
    return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  }

  private getTasksDir(): string {
    return path.join(this.getConfigDir(), 'tasks')
  }

  private sortTasks(tasks: TaskInfo[]): TaskInfo[] {
    return [...tasks].sort((a, b) => {
      const createdA = typeof a.createdAt === 'number' ? a.createdAt : undefined
      const createdB = typeof b.createdAt === 'number' ? b.createdAt : undefined
      if (createdA !== undefined || createdB !== undefined) {
        return (createdB ?? 0) - (createdA ?? 0)
      }

      const numA = Number.parseInt(a.id, 10)
      const numB = Number.parseInt(b.id, 10)
      if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB
      return a.id.localeCompare(b.id)
    })
  }

  private async readTasksFromDir(dir: string, taskListId: string): Promise<TaskInfo[]> {
    const entries = await fs.readdir(dir)
    const tasks: TaskInfo[] = []

    for (const filename of entries) {
      if (!filename.endsWith('.json')) continue
      try {
        const raw = await fs.readFile(path.join(dir, filename), 'utf-8')
        const data = JSON.parse(raw)
        const task = this.parseTaskFile(data, taskListId)
        if (task) tasks.push(task)
      } catch {
        // Skip unreadable or invalid JSON files.
      }
    }

    return this.sortTasks(tasks)
  }

  async listTaskLists(): Promise<TaskListSummary[]> {
    const tasksDir = this.getTasksDir()
    try {
      const entries = await fs.readdir(tasksDir, { withFileTypes: true })
      const results: TaskListSummary[] = []

      const rootTasks = await this.getTasksForList(ROOT_TASK_LIST_ID)
      if (rootTasks.length > 0) {
        results.push(this.toSummary(ROOT_TASK_LIST_ID, rootTasks))
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const tasks = await this.getTasksForList(entry.name)
        if (tasks.length === 0) continue
        results.push(this.toSummary(entry.name, tasks))
      }

      return results
    } catch (err: any) {
      if (err.code === 'ENOENT') return []
      throw err
    }
  }

  async getTasksForList(taskListId: string): Promise<TaskInfo[]> {
    const listDir =
      taskListId === ROOT_TASK_LIST_ID
        ? this.getTasksDir()
        : path.join(this.getTasksDir(), taskListId)

    try {
      return await this.readTasksFromDir(listDir, taskListId)
    } catch (err: any) {
      if (err.code === 'ENOENT') return []
      throw err
    }
  }

  async listTasks(): Promise<TaskInfo[]> {
    const tasksDir = this.getTasksDir()
    try {
      const entries = await fs.readdir(tasksDir, { withFileTypes: true })
      const allTasks = await this.getTasksForList(ROOT_TASK_LIST_ID)

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const tasks = await this.getTasksForList(entry.name)
        allTasks.push(...tasks)
      }

      return this.sortTasks(allTasks)
    } catch (err: any) {
      if (err.code === 'ENOENT') return []
      throw err
    }
  }

  async getTask(taskListId: string, taskId: string): Promise<TaskInfo | null>
  async getTask(taskId: string): Promise<TaskInfo | null>
  async getTask(taskListIdOrTaskId: string, maybeTaskId?: string): Promise<TaskInfo | null> {
    if (maybeTaskId) {
      const tasks = await this.getTasksForList(taskListIdOrTaskId)
      return tasks.find((task) => task.id === maybeTaskId) || null
    }

    const allTasks = await this.listTasks()
    return allTasks.find((task) => task.id === taskListIdOrTaskId) || null
  }

  private parseTaskFile(data: any, taskListId: string): TaskInfo | null {
    if (!data || typeof data !== 'object' || !data.id) return null

    const subject = data.subject || data.name || data.teamName || String(data.id)

    if (data.metadata?._internal) return null

    const status = (
      ['pending', 'in_progress', 'completed', 'running', 'failed'].includes(data.status)
        ? data.status
        : 'pending'
    ) as TaskStatus

    return {
      id: String(data.id),
      subject,
      description: data.description || '',
      name: data.name,
      type: data.type,
      activeForm: data.activeForm,
      owner: data.owner,
      status,
      blocks: Array.isArray(data.blocks) ? data.blocks : [],
      blockedBy: Array.isArray(data.blockedBy) ? data.blockedBy : [],
      metadata: data.metadata,
      taskListId,
      teamName: data.teamName,
      createdAt: typeof data.createdAt === 'number' ? data.createdAt : undefined,
      completedAt: typeof data.completedAt === 'number' ? data.completedAt : undefined,
    }
  }

  private toSummary(id: string, tasks: TaskInfo[]): TaskListSummary {
    return {
      id,
      taskCount: tasks.length,
      completedCount: tasks.filter((task) => task.status === 'completed').length,
      inProgressCount: tasks.filter(
        (task) => task.status === 'in_progress' || task.status === 'running',
      ).length,
      pendingCount: tasks.filter((task) => task.status === 'pending').length,
    }
  }
}

export const taskService = new TaskService()
