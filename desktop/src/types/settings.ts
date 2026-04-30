// Source: src/server/api/models.ts, src/server/api/settings.ts

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' | 'dontAsk'

export type EffortLevel = 'low' | 'medium' | 'high' | 'max'

export type ModelInfo = {
  id: string
  name: string
  description: string
  context: string
}

export type UserSettings = {
  model?: string
  modelContext?: string
  effort?: EffortLevel
  permissionMode?: PermissionMode
  webSearch?: WebSearchSettings
  [key: string]: unknown
}

export type WebSearchSettings = {
  enabled?: boolean
  mode?: 'auto' | 'anthropic' | 'local' | 'off'
  localProvider?: 'duckduckgo' | 'custom'
  maxResults?: number
  custom?: CustomWebSearchSettings
}

export type CustomWebSearchSettings = {
  endpoint?: string
  method?: 'GET' | 'POST'
  apiKey?: string
  authHeader?: string
  authPrefix?: string
  queryParam?: string
  headers?: Record<string, string>
  bodyTemplate?: string
  resultsPath?: string
  titlePath?: string
  urlPath?: string
  snippetPath?: string
}
