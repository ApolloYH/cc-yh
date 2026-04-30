import { logDiagnosticEvent } from '../utils/diagnosticLog.js'
import { tryRustSidecarRequest } from './rustSidecarService.js'

export type RuntimeShellClassifyOptions = {
  shell: 'bash' | 'powershell' | 'pwsh' | string
  command: string
}

export type RuntimeShellClassifyResult = {
  source: 'rust' | 'typescript'
  shell: string
  risk: 'low' | 'medium' | 'high'
  readOnly: boolean
  action: 'allow' | 'confirm' | 'deny'
  reasons: string[]
  fallbackReason?: string
}

export async function runtimeClassifyShell(
  options: RuntimeShellClassifyOptions,
): Promise<RuntimeShellClassifyResult> {
  const rust = await tryRustSidecarRequest('shell.classify', options, {
    component: `runtime.shell.${options.shell}`,
    logSuccess: true,
  })
  if (rust.ok) return normalizeResult(rust.result)
  const fallback = classifyWithTypescript(options)
  logDiagnosticEvent({
    scope: 'runtime.shell',
    event: 'fallback',
    ok: true,
    data: {
      shell: options.shell,
      reason: rust.reason,
      risk: fallback.risk,
      action: fallback.action,
      reasons: fallback.reasons,
    },
  })
  return {
    ...fallback,
    fallbackReason: rust.reason,
  }
}

function classifyWithTypescript(
  options: RuntimeShellClassifyOptions,
): RuntimeShellClassifyResult {
  const normalized = options.command.toLowerCase()
  const power = options.shell.toLowerCase().includes('power') || options.shell === 'pwsh'
  const high = power
    ? ['invoke-expression', ' iex', 'downloadstring', 'remove-item', ' -recurse', 'format c:', 'cipher /w', 'remove-item c:\\', 'del /s /q c:\\']
    : ['rm -rf', 'curl ', 'wget ', '| sh', '| bash', 'mkfs', 'dd if=', 'rm -rf /']
  const medium = ['git push', 'npm install', 'bun install', 'pip install', 'cargo install', 'chmod']
  const highReasons = high.filter(pattern => normalized.includes(pattern))
  if (highReasons.length > 0) {
    return {
      source: 'typescript',
      shell: options.shell,
      risk: 'high',
      readOnly: false,
      action: highReasons.some(pattern =>
        ['format c:', 'cipher /w', 'rm -rf /', 'remove-item c:\\', 'del /s /q c:\\'].includes(pattern),
      )
        ? 'deny'
        : 'confirm',
      reasons: highReasons,
    }
  }
  const mediumReasons = medium.filter(pattern => normalized.includes(pattern))
  return {
    source: 'typescript',
    shell: options.shell,
    risk: mediumReasons.length > 0 ? 'medium' : 'low',
    readOnly: mediumReasons.length === 0,
    action: mediumReasons.length > 0 ? 'confirm' : 'allow',
    reasons: mediumReasons,
  }
}

function normalizeResult(value: unknown): RuntimeShellClassifyResult {
  if (!isRecord(value)) throw new Error('shell.classify result must be an object')
  const risk = value.risk === 'high' || value.risk === 'medium' ? value.risk : 'low'
  return {
    source: value.source === 'rust' ? 'rust' : 'typescript',
    shell: String(value.shell ?? ''),
    risk,
    readOnly: value.readOnly === true,
    action: value.action === 'deny' || value.action === 'confirm' ? value.action : 'allow',
    reasons: Array.isArray(value.reasons)
      ? value.reasons.filter((item): item is string => typeof item === 'string')
      : [],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
