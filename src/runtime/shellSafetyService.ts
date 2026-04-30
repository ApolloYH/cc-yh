import { RustSidecarClient } from './rustSidecarClient.js'
import { getRustSidecarLaunchConfig } from './rustSidecarProtocol.js'

export type RuntimeShellClassifyOptions = {
  shell: 'bash' | 'powershell' | 'pwsh' | string
  command: string
}

export type RuntimeShellClassifyResult = {
  source: 'rust' | 'typescript'
  shell: string
  risk: 'low' | 'medium' | 'high'
  readOnly: boolean
  reasons: string[]
  fallbackReason?: string
}

export async function runtimeClassifyShell(
  options: RuntimeShellClassifyOptions,
): Promise<RuntimeShellClassifyResult> {
  const launch = getRustSidecarLaunchConfig()
  if (!launch) return classifyWithTypescript(options)

  const client = new RustSidecarClient({
    command: launch.command,
    args: launch.args,
    timeoutMs: 10_000,
  })
  try {
    return normalizeResult(await client.request('shell.classify', options, 10_000))
  } catch (error) {
    return {
      ...classifyWithTypescript(options),
      fallbackReason:
        error instanceof Error ? error.message : 'rust sidecar unavailable',
    }
  } finally {
    client.close()
  }
}

function classifyWithTypescript(
  options: RuntimeShellClassifyOptions,
): RuntimeShellClassifyResult {
  const normalized = options.command.toLowerCase()
  const power = options.shell.toLowerCase().includes('power') || options.shell === 'pwsh'
  const high = power
    ? ['invoke-expression', ' iex', 'downloadstring', 'remove-item', ' -recurse']
    : ['rm -rf', 'curl ', 'wget ', '| sh', '| bash', 'mkfs', 'dd if=']
  const medium = ['git push', 'npm install', 'bun install', 'pip install', 'cargo install', 'chmod']
  const highReasons = high.filter(pattern => normalized.includes(pattern))
  if (highReasons.length > 0) {
    return {
      source: 'typescript',
      shell: options.shell,
      risk: 'high',
      readOnly: false,
      reasons: highReasons,
    }
  }
  const mediumReasons = medium.filter(pattern => normalized.includes(pattern))
  return {
    source: 'typescript',
    shell: options.shell,
    risk: mediumReasons.length > 0 ? 'medium' : 'low',
    readOnly: mediumReasons.length === 0,
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
    reasons: Array.isArray(value.reasons)
      ? value.reasons.filter((item): item is string => typeof item === 'string')
      : [],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
