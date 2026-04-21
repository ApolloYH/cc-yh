// Local recovery shim for missing generated SDK types.
export type SDKMessage = {
  type?: string
  role?: string
  message?: {
    content?: any
    usage?: any
    model?: any
    id?: any
    [key: string]: any
  }
  content?: any
  usage?: any
  model?: any
  id?: any
  [key: string]: any
}
export type SDKUserMessage = SDKMessage
export type SDKAssistantMessage = SDKMessage
export type SDKAssistantMessageError = SDKMessage
export type SDKResultMessage = SDKMessage
export type SDKResultSuccess = SDKMessage & { ok?: true }
export type SDKSessionInfo = Record<string, unknown>
export type SDKStatus = string
export type ModelInfo = Record<string, unknown>
export type ModelUsage = Record<string, unknown>
export type PermissionResult = Record<string, unknown>
export type McpServerConfigForProcessTransport = Record<string, unknown>
export type McpServerStatus = Record<string, unknown>
export type RewindFilesResult = Record<string, unknown>
export type ApiKeySource = string
export type PermissionMode = string
export type HookInput = Record<string, unknown>
export type HookJSONOutput = Record<string, unknown>
export type SyncHookJSONOutput = Record<string, unknown>
export type AsyncHookJSONOutput = Record<string, unknown>
export type PermissionUpdate = Record<string, unknown>
