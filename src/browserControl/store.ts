import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { stripBOM } from '../utils/jsonRead.js'
import {
  DEFAULT_BROWSER_CONTROL_POLICY,
  normalizeBrowserDomain,
} from './policy.js'
import type { BrowserControlPolicy } from './types.js'

const SETTINGS_KEY = 'browserControl'

export async function readBrowserControlPolicy(): Promise<BrowserControlPolicy> {
  const settings = await readSettings()
  return normalizeBrowserControlPolicy(settings[SETTINGS_KEY])
}

export async function updateBrowserControlPolicy(
  patch: Partial<BrowserControlPolicy>,
): Promise<BrowserControlPolicy> {
  const current = await readBrowserControlPolicy()
  const next = normalizeBrowserControlPolicy({
    ...current,
    ...patch,
    allowedDomains: patch.allowedDomains ?? current.allowedDomains,
    deniedDomains: patch.deniedDomains ?? current.deniedDomains,
  })
  const settings = await readSettings()
  await writeSettings({ ...settings, [SETTINGS_KEY]: next })
  return next
}

export function normalizeBrowserControlPolicy(
  value: unknown,
): BrowserControlPolicy {
  const raw = isRecord(value) ? value : {}
  return {
    ...DEFAULT_BROWSER_CONTROL_POLICY,
    enabled:
      typeof raw.enabled === 'boolean'
        ? raw.enabled
        : DEFAULT_BROWSER_CONTROL_POLICY.enabled,
    allowedDomains: Array.isArray(raw.allowedDomains)
      ? normalizeDomainList(raw.allowedDomains)
      : DEFAULT_BROWSER_CONTROL_POLICY.allowedDomains,
    deniedDomains: Array.isArray(raw.deniedDomains)
      ? normalizeDomainList(raw.deniedDomains)
      : DEFAULT_BROWSER_CONTROL_POLICY.deniedDomains,
    allowHighRiskBackends:
      typeof raw.allowHighRiskBackends === 'boolean'
        ? raw.allowHighRiskBackends
        : DEFAULT_BROWSER_CONTROL_POLICY.allowHighRiskBackends,
    allowHighRiskCapabilities:
      typeof raw.allowHighRiskCapabilities === 'boolean'
        ? raw.allowHighRiskCapabilities
        : DEFAULT_BROWSER_CONTROL_POLICY.allowHighRiskCapabilities,
    requireConfirmationForSensitiveActions:
      typeof raw.requireConfirmationForSensitiveActions === 'boolean'
        ? raw.requireConfirmationForSensitiveActions
        : DEFAULT_BROWSER_CONTROL_POLICY.requireConfirmationForSensitiveActions,
  }
}

async function readSettings(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(getSettingsPath(), 'utf-8')
    const parsed = JSON.parse(stripBOM(raw))
    return isRecord(parsed) ? parsed : {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

async function writeSettings(settings: Record<string, unknown>): Promise<void> {
  const filePath = getSettingsPath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmpFile = `${filePath}.tmp.${process.pid}.${Date.now()}`
  try {
    await fs.writeFile(tmpFile, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
    await fs.rename(tmpFile, filePath)
  } catch (error) {
    await fs.unlink(tmpFile).catch(() => {})
    throw error
  }
}

function getSettingsPath(): string {
  return path.join(getClaudeConfigHomeDir(), 'settings.json')
}

function normalizeDomainList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map(normalizeBrowserDomain)
        .filter(Boolean),
    ),
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
