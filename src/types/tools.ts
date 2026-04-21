type BaseProgress = {
  message?: string
  status?: string
  [key: string]: unknown
}

export type ShellProgress = BaseProgress & {
  fullOutput?: string
  output?: string
  elapsedTimeSeconds?: number
  totalLines?: number
  totalBytes?: number
  timeoutMs?: number
  taskId?: string
}

export type PowerShellProgress = ShellProgress
export type MCPProgress = BaseProgress
export type TaskOutputProgress = BaseProgress
export type WebSearchProgress = BaseProgress
export type SdkWorkflowProgress = BaseProgress
export type AgentToolProgress = BaseProgress
