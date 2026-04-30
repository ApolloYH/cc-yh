// Source: src/server/services/sessionService.ts

export type SessionListItem = {
  id: string
  title: string
  createdAt: string
  modifiedAt: string
  messageCount: number
  projectPath: string
  workDir: string | null
  workDirExists: boolean
}

export type MessageEntry = {
  id: string
  type: 'user' | 'assistant' | 'system' | 'tool_use' | 'tool_result'
  content: unknown
  timestamp: string
  model?: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_tokens?: number
    cache_creation_tokens?: number
    prompt_tokens_details?: {
      cached_tokens?: number
    }
    input_tokens_details?: {
      cached_tokens?: number
    }
    cache_creation?: {
      ephemeral_5m_input_tokens?: number
      ephemeral_1h_input_tokens?: number
    }
  }
  parentUuid?: string
  parentToolUseId?: string
  isSidechain?: boolean
}

export type SessionDetail = SessionListItem & {
  messages: MessageEntry[]
}
