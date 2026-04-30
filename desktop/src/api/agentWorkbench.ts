import { api } from './client'
import type { JarvisEvent, JarvisStatus } from '../types/jarvis'

export type RuntimeDiagnostics = {
  nodeVersion: string
  bunVersion: string
  platform: string
  arch: string
  cwd: string
  configDir: string
}

export type RuntimeGlobResult = {
  source: 'typescript' | 'rust'
  cwd: string
  files: string[]
  total: number
  truncated: boolean
  fallbackReason?: string
}

export type RuntimeGrepMatch = {
  filePath: string
  lineNumber: number
  line: string
}

export type RuntimeGrepResult = {
  source: 'typescript' | 'rust'
  cwd: string
  matches: RuntimeGrepMatch[]
  total: number
  truncated: boolean
  fallbackReason?: string
}

export type MemoryV2Entry = {
  layer: 'L2' | 'L3'
  id: string
  title: string
  path: string
  source?: string
  verified: boolean
}

export type MemoryV2Status = {
  root: string
  indexPath: string
  factsDir: string
  sopsDir: string
  sessionsDir: string
  vectorIndexPath?: string
  embeddingCachePath?: string
  faissIndexPath?: string
  faissMetaPath?: string
  vectorProvider?: 'faiss' | 'local'
  embeddingProvider?: 'dashscope' | 'openai-compatible' | 'local'
  embeddingModel?: string
  embeddingDimensions?: number
  embeddingRemote?: boolean
  entries: MemoryV2Entry[]
  facts: MemoryV2Entry[]
  sops: MemoryV2Entry[]
}

export type BrowserControlDecision = {
  decision: 'allow' | 'confirm' | 'deny'
  reason: string
  confirmation?: string
}

export type BrowserControlExecutionResult = {
  ok: boolean
  backendId: string
  decision: BrowserControlDecision
  auditId: string
  data?: unknown
  error?: string
}

export type BrowserControlPolicy = {
  enabled: boolean
  allowedDomains: string[]
  deniedDomains?: string[]
  allowHighRiskBackends?: boolean
  allowHighRiskCapabilities?: boolean
  requireConfirmationForSensitiveActions?: boolean
}

export type DistilledSkill = {
  name: string
  description: string
  source: 'user' | 'project'
  userInvocable: boolean
  version?: string
}

export const agentWorkbenchApi = {
  diagnostics() {
    return api.get<RuntimeDiagnostics>('/api/status/diagnostics')
  },

  glob(cwd: string, pattern: string) {
    return api.post<RuntimeGlobResult>('/api/runtime/fs-glob', {
      cwd,
      pattern,
      limit: 8,
    })
  },

  grep(cwd: string, pattern: string, glob: string) {
    return api.post<RuntimeGrepResult>('/api/runtime/fs-grep', {
      cwd,
      pattern,
      glob,
      limit: 8,
    })
  },

  memoryStatus() {
    return api.get<MemoryV2Status>('/api/memory-v2')
  },

  writeFact(input: { title: string; content: string; source: string }) {
    return api.post<{ entry: MemoryV2Entry }>('/api/memory-v2/fact', {
      ...input,
      verified: true,
    })
  },

  writeSop(input: { title: string; content: string; source: string }) {
    return api.post<{ entry: MemoryV2Entry }>('/api/memory-v2/sop', {
      ...input,
      verified: true,
    })
  },

  updateBrowserPolicy(policy: Partial<BrowserControlPolicy>) {
    return api.put<{ policy: BrowserControlPolicy; backends: unknown[] }>(
      '/api/browser-control/policy',
      policy,
    )
  },

  assessBrowserAction(input: {
    backendId: string
    capability: string
    domain: string
    url: string
    userConfirmed?: boolean
  }) {
    return api.post<{ decision: BrowserControlDecision }>(
      '/api/browser-control/assess',
      {
        backendId: input.backendId,
        action: {
          capability: input.capability,
          domain: input.domain,
          url: input.url,
          userConfirmed: input.userConfirmed,
        },
      },
    )
  },

  executeBrowserAction(input: {
    backendId: string
    capability: string
    domain?: string
    url?: string
    userConfirmed?: boolean
    selector?: string
    text?: string
    submit?: boolean
    devtools?: {
      port?: number
      launch?: boolean
      timeoutMs?: number
    }
  }) {
    return api.post<BrowserControlExecutionResult>(
      '/api/browser-control/execute',
      {
        backendId: input.backendId,
        action: {
          capability: input.capability,
          domain: input.domain,
          url: input.url,
          userConfirmed: input.userConfirmed,
        },
        selector: input.selector,
        text: input.text,
        submit: input.submit,
        devtools: input.devtools,
      },
      { timeout: 45_000 },
    )
  },

  distillSkill(input: {
    name: string
    markdown: string
    projectRoot: string
  }) {
    return api.post<{ skill: DistilledSkill; skillRoot: string; reviewed: boolean }>(
      '/api/skills/distill',
      {
        name: input.name,
        markdown: input.markdown,
        scope: 'project',
        projectRoot: input.projectRoot,
        overwrite: true,
      },
    )
  },

  jarvisTick() {
    return api.post<{ event: JarvisEvent; status: JarvisStatus }>('/api/jarvis/tick', {})
  },
}
