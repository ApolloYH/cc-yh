export type Workflow = 'claude' | 'claude-review' | string

export type Warning = {
  title?: string
  message?: string
  description?: string
  severity?: string
  [key: string]: unknown
}

export type State = Record<string, any>
