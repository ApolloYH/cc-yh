import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { isProviderManagedEnvVar } from '../utils/managedEnvConstants.js'
import { stripBOM } from '../utils/jsonRead.js'

process.env.CLAUDE_CONFIG_DIR ||= path.join(homedir(), '.claude-yh')

if (
  process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST !== '1' &&
  process.env.CLAUDE_YH_EXPLICIT_ENV_FILE !== '1'
) {
  try {
    const settingsPath = path.join(process.env.CLAUDE_CONFIG_DIR, 'settings.json')
    const raw = readFileSync(settingsPath, 'utf-8')
    const parsed = JSON.parse(stripBOM(raw)) as {
      env?: Record<string, unknown>
      claudeYhProviders?: unknown
    }
    const env = parsed.env ?? {}
    const hasUnifiedProvider =
      parsed.claudeYhProviders !== undefined ||
      Object.keys(env).some((key) => isProviderManagedEnvVar(key))

    if (hasUnifiedProvider) {
      for (const key of Object.keys(process.env)) {
        if (isProviderManagedEnvVar(key)) {
          delete process.env[key]
        }
      }
    }
  } catch {
    // Missing or invalid settings should not prevent server startup.
  }
}
