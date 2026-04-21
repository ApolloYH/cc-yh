// @generated stub from scan-missing-imports
// 该文件自动生成，对应 ant-internal 的 feature() gated 模块。
// 所有外部 build 的代码路径在 DCE 后都不会真的执行这里的代码，这只是
// bun build resolver 的占位符。
const __target = function noop() {}
const __handler: ProxyHandler<any> = {
  get(_t, prop) {
    if (prop === '__esModule') return true
    if (prop === 'default') return new Proxy(__target, __handler)
    if (prop === Symbol.toPrimitive) return () => undefined
    if (prop === Symbol.iterator) return function* () {}
    if (prop === Symbol.asyncIterator) return async function* () {}
    if (prop === 'then') return undefined
    return new Proxy(__target, __handler)
  },
  apply() {
    return new Proxy(__target, __handler)
  },
  construct() {
    return new Proxy(__target, __handler)
  },
}
const stub: any = new Proxy(__target, __handler)
export default stub
export const __stubMissing = true
type LooseMessage = {
  type: string
  role?: string
  uuid?: string
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

export type Message = LooseMessage
export type AssistantMessage = LooseMessage
export type AttachmentMessage<T = any> = LooseMessage & { attachment?: T }
export type CollapsedReadSearchGroup = LooseMessage
export type GroupedToolUseMessage = LooseMessage
export type HookResultMessage = LooseMessage
export type NormalizedAssistantMessage = LooseMessage
export type NormalizedMessage = LooseMessage
export type NormalizedUserMessage = LooseMessage
export type ProgressMessage<T = any> = LooseMessage & { progress?: T }
export type RenderableMessage = LooseMessage
export type SystemAPIErrorMessage = LooseMessage
export type SystemBridgeStatusMessage = LooseMessage
export type SystemCompactBoundaryMessage = LooseMessage
export type SystemFileSnapshotMessage = LooseMessage
export type SystemInformationalMessage = LooseMessage
export type SystemMemorySavedMessage = LooseMessage
export type SystemMessage = LooseMessage
export type SystemStopHookSummaryMessage = LooseMessage
export type SystemThinkingMessage = LooseMessage
export type SystemTurnDurationMessage = LooseMessage
export type UserMessage = LooseMessage
export type MessageOrigin =
  | 'user'
  | 'assistant'
  | 'system'
  | { kind?: string; server?: string; [key: string]: any }
  | (string & {})
export type PartialCompactDirection = 'before' | 'after' | (string & {})
export type CompactMetadata = Record<string, unknown>
// 兼容常见的命名导出 —— 没列在这里的也会通过 default Proxy 兜底
export const createCachedMCState = stub
export const isCachedMicrocompactEnabled = stub
export const isModelSupportedForCacheEditing = stub
export const getCachedMCConfig = stub
export const markToolsSentToAPI = stub
export const resetCachedMCState = stub
export const checkProtectedNamespace = stub
export const getCoordinatorUserContext = stub
